"""Local LangGraph pilot binding for the durable AgentRun contracts.

This adapter is intentionally not selected by the production runtime.  It
proves that graph phases can use the existing lease, checkpoint, tool and
outcome authorities without creating a second source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..agent_run_service import AgentRunService, LeaseLostError
from ..models import AgentRun
from .langgraph_graph import (
    LangGraphState,
    build_langgraph_contract_graph,
    langgraph_thread_config,
)
from .native_langgraph_adapter import NativeLangGraphAdapter
from .outcome_evaluator import OutcomeEvaluator, SuccessContract
from .runtime_state_contract import append_completed_step, state_validation_error
from .runtime_state_contract import phase_contract_status
from .tool_base import ToolContext
from .tool_registry import ToolRegistry


@dataclass
class LangGraphRunBinding:
    """Bind pilot graph callbacks to one leased ``AgentRun`` row."""

    service: AgentRunService
    row: AgentRun
    worker_id: str
    fencing_token: int
    tool_registry: ToolRegistry | None = None
    tool_context: ToolContext | None = None
    tool_name: str = ""
    tool_input: dict[str, Any] = field(default_factory=dict)
    outcome_evaluator: OutcomeEvaluator = field(default_factory=OutcomeEvaluator)
    success_contract: SuccessContract = field(default_factory=SuccessContract)
    native_adapter: NativeLangGraphAdapter | None = None

    def initial_state(self, input_text: str) -> LangGraphState:
        return {
            "run_id": str(self.row.uuid),
            "owner_user_id": str(self.row.owner_user_id),
            "input_text": str(input_text or ""),
            "schema_version": str(phase_contract_status()["schema_version"]),
            "phase": "accepted",
            "completed_steps": [],
        }

    def build(self, *, checkpointer: Any):
        lock = getattr(checkpointer, "execution_lock", None)

        def locked(callback):
            if lock is None:
                return callback

            def invoke(state: LangGraphState):
                with lock:
                    return callback(state)

            return invoke

        return build_langgraph_contract_graph(
            checkpointer=checkpointer,
            prepare=locked(self.prepare),
            execute=locked(self.execute),
            verify=locked(self.verify),
            finish=locked(self.finish),
        )

    def invoke(self, *, checkpointer: Any | None = None, input_text: str) -> LangGraphState:
        if checkpointer is None:
            from .agent_run_checkpoint_saver import AgentRunCheckpointSaver

            checkpointer = AgentRunCheckpointSaver(
                self.service,
                self.row,
                worker_id=self.worker_id,
                fencing_token=self.fencing_token,
            )
        graph = self.build(checkpointer=checkpointer)
        return graph.invoke(
            self.initial_state(input_text),
            config=langgraph_thread_config(str(self.row.uuid)),
        )

    def prepare(self, state: LangGraphState) -> dict[str, Any]:
        contract_error = state_validation_error(state)
        if contract_error:
            return self._phase_error(*contract_error)
        guard = self._guard(state)
        if guard:
            return guard
        if self.native_adapter is not None:
            return self.native_adapter.prepare(state)
        # A graph thread can be invoked again after a worker restart.  The
        # durable AgentRun steps, rather than LangGraph's in-memory callback
        # execution, are the idempotency authority.
        if self._step_succeeded("langgraph_prepare"):
            return {"phase": "prepared", "completed_steps": append_completed_step(state.get("completed_steps"), "prepare")}
        self.service.mark_running(self.row)
        self.service.add_step(
            self.row,
            step_type="langgraph_prepare",
            status="succeeded",
            role="harness",
            output_summary={"thread_id": str(self.row.uuid)},
            checkpoint={"langgraph_thread_id": str(self.row.uuid)},
        )
        self.service.persist_safe_checkpoint(
            self.row,
            checkpoint={"langgraph_thread_id": str(self.row.uuid), "phase": "prepare"},
            stage=self._stage("planning"),
            progress=10,
            durable=True,
        )
        return {"phase": "prepared", "completed_steps": append_completed_step(state.get("completed_steps"), "prepare")}

    def execute(self, state: LangGraphState) -> dict[str, Any]:
        guard = self._guard(state)
        if guard:
            return guard
        if self.native_adapter is not None:
            return self.native_adapter.execute(state)

        # Never repeat a tool/effect merely because the graph was re-invoked
        # with the same thread id.  The previous result was written by the
        # service checkpoint before the execute step was marked successful.
        if self._has_replayable_execute_result():
            payload = self._stored_result()
            checkpoint = self.row.checkpoint_json if isinstance(self.row.checkpoint_json, dict) else {}
            return {
                "phase": "executed",
                "result": payload,
                "evidence_count": int(checkpoint.get("evidence_count") or 0),
                "effects": ["read"],
                "tool_name": self.tool_name,
            }

        payload: dict[str, Any] = {"answer": str(state.get("input_text") or "")}
        evidence_count = 0
        effects = ["read"]
        if self.tool_registry is not None or self.tool_name:
            if self.tool_registry is None or not self.tool_name:
                return self._phase_error("TOOL_BINDING_INVALID", "pilot 工具绑定不完整")
            spec = self.tool_registry.get_spec(self.tool_name)
            if spec is None:
                return self._phase_error("TOOL_NOT_FOUND", "工具不存在")
            if spec.effect != "read_only":
                return self._phase_error("LANGGRAPH_PILOT_WRITE_TOOL_BLOCKED", "pilot 只允许只读工具")
            context = self.tool_context
            if context is None or context.run_id != self.row.uuid or context.user_id != self.row.owner_user_id:
                return self._phase_error("TOOL_CONTEXT_MISMATCH", "工具上下文未绑定当前任务")
            result = self.tool_registry.execute(self.tool_name, dict(self.tool_input), context)
            if result.status != "success":
                return self._phase_error(result.error_code or "TOOL_EXECUTION_FAILED", result.error_message_safe)
            payload = dict(result.payload)
            evidence_count = int(result.source_count or 0)

        guard = self._guard(state)
        if guard:
            return guard
        # Persist the replayable result before recording the successful step.
        # A crash between these writes can therefore only cause a harmless
        # step retry, never a false claim that an absent result is reusable.
        self.service.persist_safe_checkpoint(
            self.row,
            checkpoint={
                "langgraph_thread_id": str(self.row.uuid),
                "phase": "execute",
                "evidence_count": evidence_count,
            },
            stage=self._stage("executing"),
            progress=60,
            result=payload,
            durable=True,
        )
        self.service.add_step(
            self.row,
            step_type="langgraph_execute",
            status="succeeded",
            role="executor",
            output_summary=result_summary(payload),
            checkpoint={"langgraph_thread_id": str(self.row.uuid), "phase": "execute"},
        )
        return {
            "phase": "executed",
            "result": payload,
            "evidence_count": evidence_count,
            "effects": effects,
            "tool_name": self.tool_name,
        }

    def verify(self, state: LangGraphState) -> dict[str, Any]:
        guard = self._guard(state)
        if guard:
            return guard
        if self.native_adapter is not None:
            return self.native_adapter.verify(state)
        if state.get("error_code"):
            self.service.add_step(
                self.row,
                step_type="langgraph_verify",
                status="failed",
                role="reviewer",
                error_code=str(state.get("error_code")),
                error_message_safe=str(state.get("error_message_safe") or "任务执行失败"),
            )
            return {"phase": "failed"}
        evaluation = self.outcome_evaluator.evaluate(
            self.success_contract,
            output=state.get("result") or {},
            evidence_count=int(state.get("evidence_count") or 0),
            effects=state.get("effects") or ["read"],
        )
        if not evaluation.passed:
            code = evaluation.issue_codes[0] if evaluation.issue_codes else "OUTCOME_FAILED"
            self.service.add_step(
                self.row,
                step_type="langgraph_verify",
                status="failed",
                role="reviewer",
                error_code=code,
                error_message_safe="任务结果未通过成功契约",
            )
            return {
                "phase": "failed",
                "outcome": evaluation.outcome,
                "issue_codes": list(evaluation.issue_codes),
                "error_code": code,
                "error_message_safe": "任务结果未通过成功契约",
            }

        if self._step_succeeded("langgraph_verify"):
            checkpoint = self.row.checkpoint_json if isinstance(self.row.checkpoint_json, dict) else {}
            return {
                "phase": "verified",
                "outcome": str(checkpoint.get("outcome") or "success"),
                "issue_codes": [],
            }

        self.service.add_step(
            self.row,
            step_type="langgraph_verify",
            status="succeeded",
            role="reviewer",
            output_summary={"outcome": evaluation.outcome},
            checkpoint={
                "langgraph_thread_id": str(self.row.uuid),
                "phase": "verify",
                "outcome": evaluation.outcome,
            },
        )
        self.service.persist_safe_checkpoint(
            self.row,
            checkpoint={
                "langgraph_thread_id": str(self.row.uuid),
                "phase": "verify",
                "outcome": evaluation.outcome,
            },
            stage=self._stage("reviewing"),
            progress=90,
            result=state.get("result") or {},
            durable=True,
        )
        return {"phase": "verified", "outcome": evaluation.outcome, "issue_codes": []}

    def finish(self, state: LangGraphState) -> dict[str, Any]:
        guard = self._guard(state)
        if guard:
            return guard
        if self.native_adapter is not None:
            return self.native_adapter.finish(state)
        if self.row.status == "succeeded":
            return {"phase": "completed"}
        if self._step_succeeded("langgraph_finish"):
            # A worker can crash after the durable finish Step is written but
            # before the Run snapshot is transitioned to succeeded.  Replaying
            # the thread must repair that final projection instead of merely
            # reporting completion to the caller.
            result = self._stored_result()
            self.service.mark_succeeded(self.row, result=result)
            return {"phase": "completed", "result": result}
        failed = bool(state.get("error_code"))
        if failed:
            self.service.add_step(
                self.row,
                step_type="langgraph_finish",
                status="failed",
                role="harness",
                error_code=str(state.get("error_code") or "LANGGRAPH_FAILED"),
                error_message_safe=str(state.get("error_message_safe") or "任务执行失败"),
            )
            self.service.mark_failed(
                self.row,
                code=str(state.get("error_code") or "LANGGRAPH_FAILED"),
                message=str(state.get("error_message_safe") or "任务执行失败"),
            )
            return {"phase": "failed"}

        result = dict(state.get("result") or {})
        self.service.persist_safe_checkpoint(
            self.row,
            checkpoint={"langgraph_thread_id": str(self.row.uuid), "phase": "finish"},
            stage=self._stage("completed"),
            progress=100,
            result=result,
            durable=True,
        )
        self.service.add_step(
            self.row,
            step_type="langgraph_finish",
            status="succeeded",
            role="harness",
            output_summary=result_summary(result),
        )
        self.service.mark_succeeded(self.row, result=result)
        return {"phase": "completed"}

    def _guard(self, state: LangGraphState) -> dict[str, Any] | None:
        contract_error = state_validation_error(state)
        if contract_error:
            return self._phase_error(*contract_error)
        if state.get("run_id") != self.row.uuid or state.get("owner_user_id") != self.row.owner_user_id:
            return self._phase_error("RUN_IDENTITY_MISMATCH", "任务身份与图状态不一致")
        try:
            self.service.assert_lease(self.row, self.worker_id, self.fencing_token)
            self.service.db.refresh(self.row)
        except LeaseLostError:
            return self._phase_error("RUN_LEASE_LOST", "任务执行租约已失效")
        return None

    def _step_succeeded(self, step_type: str) -> bool:
        return any(
            step.step_type == step_type and step.status in {"succeeded", "completed", "ok"}
            for step in self.service.list_steps(self.row.uuid)
        )

    def _stored_result(self) -> dict[str, Any]:
        result = self.row.result_json
        return dict(result) if isinstance(result, dict) else {}

    def _has_replayable_execute_result(self) -> bool:
        checkpoint = self.row.checkpoint_json
        if not isinstance(checkpoint, dict):
            return False
        phase = str(checkpoint.get("phase") or "")
        return phase in {"execute", "verify", "finish"} and bool(self._stored_result())

    def _phase_error(self, code: str, message: str) -> dict[str, Any]:
        return {"phase": "failed", "error_code": code, "error_message_safe": message}

    @staticmethod
    def _stage(value: str):
        from ..agent_contracts import AgentRunStage

        return AgentRunStage(value)


def result_summary(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep step output summaries bounded and free of raw large results."""

    answer = payload.get("answer")
    return {"fields": sorted(str(key) for key in payload), "answer_chars": len(answer) if isinstance(answer, str) else 0}
