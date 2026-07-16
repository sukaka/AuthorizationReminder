"""LangGraph runtime selection with an explicit, fail-closed boundary."""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher
from .langgraph_graph import langgraph_graph_status
from .langgraph_service_binding import LangGraphRunBinding
from .native_langgraph_adapter import NativeLangGraphAdapter
from .native_runtime import NativeRuntime
from ..models import AgentRun
from .protocol import ResumeCommand, RunRequest, RunSnapshot


LANGGRAPH_REAL_RUNTIME_AVAILABLE = False
LANGGRAPH_NATIVE_ADAPTER_IMPLEMENTED = True


def langgraph_backend_status() -> dict[str, object]:
    """Return an explicit, machine-readable readiness status for the pilot backend.

    Dependency presence is reported separately from implementation readiness so an
    installed package cannot accidentally be treated as a production graph.
    """
    graph_status = langgraph_graph_status()
    dependency_installed = bool(graph_status["graph_dependency_installed"])
    if LANGGRAPH_REAL_RUNTIME_AVAILABLE:
        reason = "ready"
    elif not dependency_installed:
        reason = "dependency_missing"
    elif not bool(graph_status["checkpointer_supported"]):
        reason = "checkpointer_dependency_missing"
    else:
        reason = "production_integration_pending"
    return {
        "dependency_installed": dependency_installed,
        "implemented": LANGGRAPH_REAL_RUNTIME_AVAILABLE,
        "business_adapter_implemented": LANGGRAPH_NATIVE_ADAPTER_IMPLEMENTED,
        "production_checkpointer_supported": False,
        "production_ready": LANGGRAPH_REAL_RUNTIME_AVAILABLE,
        "reason": reason,
        **graph_status,
    }


def langgraph_enabled() -> bool:
    return str(os.environ.get("AI_LANGGRAPH_RUNTIME_ENABLED", "")).lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


class LangGraphRuntime:
    """Shadow runtime: currently delegates to NativeRuntime with metadata flag.

    When the real LangGraph pilot lands, replace `_execute` body only.
    """

    def __init__(
        self,
        db: Session,
        cipher: ContentCipher,
        *,
        key_version: str = "v1",
        mode: str = "shadow",
        **kwargs,
    ) -> None:
        self._native = NativeRuntime(db, cipher, key_version=key_version, **kwargs)
        self.db = db
        self.mode = str(mode or "shadow")

    @property
    def capabilities(self) -> dict[str, object]:
        """Expose the actual backend contract for health checks and audits."""
        return {
            "backend": "langgraph",
            "mode": self.mode,
            "delegates_to": "native" if self.mode == "shadow" else "native_business_adapter",
            **langgraph_backend_status(),
        }

    async def start(self, request: RunRequest) -> RunSnapshot:
        # NativeRuntime.start is itself a synchronous wrapper.  Route through
        # start_sync so an explicitly selected real pilot can never silently
        # fall back to the shadow path.
        return self.start_sync(request)

    def start_sync(self, request: RunRequest) -> RunSnapshot:
        if self.mode == "real":
            snap = self._native.start_sync_with_executor(request, self._execute_real)
        else:
            snap = self._native.start_sync(request)
        result = dict(snap.result or {})
        result["runtime"] = "langgraph_real" if self.mode == "real" else "langgraph_shadow"
        return snap.model_copy(update={"result": result})

    async def resume(self, run_id: str, command: ResumeCommand) -> RunSnapshot:
        if self.mode != "real" or command.action != "retry":
            return await self._native.resume(run_id, command)
        run = self.db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
        if run is None:
            return await self._native.resume(run_id, command)
        self._native.service.retry(run)
        request_payload = self._native.service.decrypt_request(run)
        return self.start_sync(
            RunRequest(
                run_id=run.uuid,
                owner_user_id=run.owner_user_id,
                input_text=str(request_payload.get("input_text") or ""),
                conversation_id=run.conversation_id,
                message_id=run.message_id,
                run_type=run.run_type,
            )
        )

    async def cancel(self, run_id: str) -> RunSnapshot:
        return await self._native.cancel(run_id)

    async def inspect(self, run_id: str) -> RunSnapshot:
        return await self._native.inspect(run_id)

    def _execute_real(
        self,
        row: AgentRun,
        request: RunRequest,
        worker_id: str,
        fencing_token: int,
    ) -> None:
        status = langgraph_graph_status()
        if not status["checkpointer_supported"]:
            raise RuntimeError("real LangGraph mode requires the optional checkpointer dependency")
        binding = LangGraphRunBinding(
            service=self._native.service,
            row=row,
            worker_id=worker_id,
            fencing_token=fencing_token,
            native_adapter=NativeLangGraphAdapter(self._native, row, request),
        )
        binding.invoke(input_text=request.input_text)


def select_runtime(db: Session, cipher: ContentCipher, *, settings=None, **kwargs) -> NativeRuntime | LangGraphRuntime:
    # The environment variable remains an emergency override; the admin-controlled
    # file flag is the normal local/staging switch and is already validated on load.
    from ..feature_flags import load_feature_flags

    flags = load_feature_flags(settings)
    if langgraph_enabled() or bool(flags.get("langgraph_runtime", False)):
        mode = str(flags.get("langgraph_runtime_mode") or "shadow")
        if mode == "real" and not LANGGRAPH_REAL_RUNTIME_AVAILABLE:
            raise RuntimeError(
                "langgraph_runtime_mode=real is blocked by the production readiness gate; "
                "the local Native business adapter is implemented but multi-instance checkpointer "
                "and staging evidence are still required"
            )
        return LangGraphRuntime(db, cipher, mode=mode, **kwargs)
    return NativeRuntime(db, cipher, **kwargs)
