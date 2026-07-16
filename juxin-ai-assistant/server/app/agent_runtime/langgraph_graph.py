"""Optional real LangGraph graph used by the local persistence pilot.

The application still routes production work through ``NativeRuntime``.  This
module deliberately keeps the graph boundary small and injectable so that the
phase callbacks can be migrated one at a time without duplicating lease or
tool policy code.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, TypedDict

from .runtime_state_contract import (
    PHASE_STEPS,
    append_completed_step,
    phase_contract_status,
    state_validation_error,
)


class LangGraphState(TypedDict, total=False):
    """Stable state contract persisted by the pilot graph."""

    run_id: str
    owner_user_id: str
    input_text: str
    schema_version: str
    phase: str
    completed_steps: list[str]
    result: dict[str, Any]
    evidence_count: int
    effects: list[str]
    tool_name: str
    outcome: str
    issue_codes: list[str]
    error_code: str
    error_message_safe: str


class LangGraphDependencyError(RuntimeError):
    """Raised when the optional graph/checkpointer dependencies are unavailable."""


PhaseCallback = Callable[[LangGraphState], Mapping[str, Any]]


def langgraph_thread_config(run_id: str) -> dict[str, dict[str, str]]:
    """Return the only supported checkpoint identity for an agent run."""

    normalized = str(run_id or "").strip()
    if not normalized:
        raise ValueError("run_id is required for LangGraph checkpoint identity")
    return {"configurable": {"thread_id": normalized}}


def langgraph_graph_status() -> dict[str, object]:
    """Report graph and checkpointer availability without importing eagerly."""

    try:
        from langgraph.graph import END, START, StateGraph  # noqa: F401
    except Exception:
        return {
            "graph_dependency_installed": False,
            "checkpointer_dependency_installed": False,
            "agent_run_saver_supported": False,
            "graph_implemented": False,
            "checkpointer_supported": False,
            "state_contract": phase_contract_status(),
        }

    try:
        from langgraph.checkpoint.base import BaseCheckpointSaver  # noqa: F401

        agent_run_saver_supported = True
    except Exception:
        agent_run_saver_supported = False

    try:
        from langgraph.checkpoint.sqlite import SqliteSaver  # noqa: F401
    except Exception:
        return {
            "graph_dependency_installed": True,
            "checkpointer_dependency_installed": False,
            "agent_run_saver_supported": agent_run_saver_supported,
            "graph_implemented": True,
            "checkpointer_supported": False,
            "state_contract": phase_contract_status(),
        }

    return {
        "graph_dependency_installed": True,
        "checkpointer_dependency_installed": True,
        "agent_run_saver_supported": agent_run_saver_supported,
        "graph_implemented": True,
        "checkpointer_supported": True,
        "state_contract": phase_contract_status(),
    }


def build_langgraph_contract_graph(
    *,
    checkpointer: Any,
    prepare: PhaseCallback | None = None,
    execute: PhaseCallback | None = None,
    verify: PhaseCallback | None = None,
    finish: PhaseCallback | None = None,
):
    """Build a durable four-phase graph with explicit state transitions.

    Callbacks are injected so the graph cannot bypass the existing service,
    lease, tool, or authorization contracts.  Each callback returns a partial
    state update; the graph itself owns phase ordering and checkpoint identity.
    """

    try:
        from langgraph.graph import END, START, StateGraph
    except Exception as exc:  # pragma: no cover - depends on optional package
        raise LangGraphDependencyError("langgraph dependency is not installed") from exc
    if checkpointer is None:
        raise LangGraphDependencyError("a durable LangGraph checkpointer is required")

    def _safe_completed_steps(state: LangGraphState) -> list[str]:
        completed = state.get("completed_steps", [])
        if not isinstance(completed, list):
            return []
        if any(not isinstance(step, str) for step in completed):
            return []
        if len(completed) != len(set(completed)):
            return []
        if completed != list(PHASE_STEPS[: len(completed)]):
            return []
        return list(completed)

    def _failure_update(state: LangGraphState, error: tuple[str, str]) -> dict[str, Any]:
        return {
            "phase": "failed",
            "completed_steps": _safe_completed_steps(state),
            "error_code": error[0],
            "error_message_safe": error[1],
        }

    def _node_contract_error(
        state: LangGraphState,
        expected_phase: str,
        expected_steps: list[str],
    ) -> tuple[str, str] | None:
        error = state_validation_error(state)
        if error:
            return error
        phase = str(state.get("phase") or "accepted")
        completed = state.get("completed_steps", [])
        if phase != expected_phase or completed != expected_steps:
            return "INVALID_RUN_STEPS", "任务状态步骤与阶段不一致"
        return None

    def _normalize_update(
        state: LangGraphState,
        update: Mapping[str, Any],
        *,
        step: str,
        default_phase: str,
    ) -> dict[str, Any]:
        normalized = dict(update)
        phase = str(normalized.get("phase") or default_phase)
        failed = phase == "failed" or bool(normalized.get("error_code"))
        if failed:
            normalized["phase"] = "failed"
            if not normalized.get("error_code"):
                normalized["error_code"] = "RUNTIME_PHASE_FAILED"
                normalized["error_message_safe"] = "阶段回调报告失败"
            candidate = normalized.get("completed_steps")
            if not isinstance(candidate, list) or candidate != list(PHASE_STEPS[: len(candidate)]):
                try:
                    candidate = append_completed_step(state.get("completed_steps"), step)
                except ValueError:
                    candidate = _safe_completed_steps(state)
            normalized["completed_steps"] = list(candidate)
        else:
            normalized["phase"] = phase
            try:
                normalized["completed_steps"] = append_completed_step(
                    state.get("completed_steps"),
                    step,
                )
            except ValueError as exc:
                return _failure_update(
                    state,
                    ("INVALID_RUN_STEPS", str(exc)),
                )

        merged = {**state, **normalized}
        error = state_validation_error(merged)
        if error:
            return _failure_update(state, error)
        return normalized

    def _validate(state: LangGraphState) -> dict[str, Any]:
        error = state_validation_error(state)
        if error:
            return {
                "phase": "failed",
                "completed_steps": ["prepare"],
                "error_code": error[0],
                "error_message_safe": error[1],
            }
        return {
            "schema_version": phase_contract_status()["schema_version"],
            "phase": "prepared",
            "completed_steps": append_completed_step(state.get("completed_steps"), "prepare"),
        }

    def _run_prepare(state: LangGraphState) -> dict[str, Any]:
        if prepare is None:
            return _normalize_update(
                state,
                _validate(state),
                step="prepare",
                default_phase="prepared",
            )
        error = _node_contract_error(state, "accepted", [])
        if error:
            return _failure_update(state, error)
        return _normalize_update(
            state,
            prepare(state),
            step="prepare",
            default_phase="prepared",
        )

    def _run_execute(state: LangGraphState) -> dict[str, Any]:
        error = _node_contract_error(state, "prepared", ["prepare"])
        if error:
            return _failure_update(state, error)
        return _normalize_update(
            state,
            execute(state) if execute else {},
            step="execute",
            default_phase="executed",
        )

    def _run_verify(state: LangGraphState) -> dict[str, Any]:
        error = _node_contract_error(state, "executed", ["prepare", "execute"])
        if error:
            return _failure_update(state, error)
        return _normalize_update(
            state,
            verify(state) if verify else {},
            step="verify",
            default_phase="verified",
        )

    def _finish(state: LangGraphState) -> dict[str, Any]:
        error = state_validation_error(state)
        if error:
            return _failure_update(state, error)
        if state.get("error_code") or state.get("phase") == "failed":
            return {
                "phase": "failed",
                "completed_steps": _safe_completed_steps(state),
            }
        if state.get("phase") != "verified" or state.get("completed_steps") != [
            "prepare",
            "execute",
            "verify",
        ]:
            return _failure_update(
                state,
                ("INVALID_RUN_STEPS", "任务状态步骤与阶段不一致"),
            )
        return {
            "phase": "completed",
            "completed_steps": append_completed_step(state.get("completed_steps"), "finish"),
        }

    def _run_finish(state: LangGraphState) -> dict[str, Any]:
        error = state_validation_error(state)
        if error:
            return _failure_update(state, error)
        failed = bool(state.get("error_code")) or state.get("phase") == "failed"
        if not failed and (
            state.get("phase") != "verified"
            or state.get("completed_steps") != ["prepare", "execute", "verify"]
        ):
            return _failure_update(
                state,
                ("INVALID_RUN_STEPS", "任务状态步骤与阶段不一致"),
            )
        update = finish(state) if finish else _finish(state)
        normalized = dict(update)
        if failed or str(normalized.get("phase") or "") == "failed":
            normalized["phase"] = "failed"
            normalized["completed_steps"] = _safe_completed_steps(state)
            if not normalized.get("error_code"):
                normalized["error_code"] = str(state.get("error_code") or "RUNTIME_PHASE_FAILED")
                normalized["error_message_safe"] = str(
                    state.get("error_message_safe") or "阶段回调报告失败"
                )
        else:
            normalized["phase"] = "completed"
            try:
                normalized["completed_steps"] = append_completed_step(
                    state.get("completed_steps"),
                    "finish",
                )
            except ValueError as exc:
                return _failure_update(state, ("INVALID_RUN_STEPS", str(exc)))
        merged = {**state, **normalized}
        contract_error = state_validation_error(merged)
        if contract_error:
            return _failure_update(state, contract_error)
        return normalized

    def _route_after_prepare(state: LangGraphState) -> str:
        return "finish" if state.get("error_code") or state.get("phase") == "failed" else "execute"

    def _route_after_execute(state: LangGraphState) -> str:
        return "finish" if state.get("error_code") or state.get("phase") == "failed" else "verify"

    builder = StateGraph(LangGraphState)
    builder.add_node("prepare", _run_prepare)
    builder.add_node("execute", _run_execute)
    builder.add_node("verify", _run_verify)
    builder.add_node("finish", _run_finish)
    builder.add_edge(START, "prepare")
    builder.add_conditional_edges(
        "prepare",
        _route_after_prepare,
        {"execute": "execute", "finish": "finish"},
    )
    builder.add_conditional_edges(
        "execute",
        _route_after_execute,
        {"verify": "verify", "finish": "finish"},
    )
    builder.add_edge("verify", "finish")
    builder.add_edge("finish", END)
    return builder.compile(checkpointer=checkpointer)
