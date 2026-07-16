"""Shared state and phase contract for the Native/LangGraph runtimes.

The contract is intentionally storage-agnostic.  It describes only the
run-scoped fields that must survive a checkpoint and the four ordered harness
phases.  Persistence, lease fencing and tool authorization remain owned by
their existing services.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..run_state_contracts import RUN_STATE_SCHEMA_VERSION


PHASE_STEPS = ("prepare", "execute", "verify", "finish")
ALLOWED_PHASES = frozenset({"accepted", "prepared", "executed", "verified", "completed", "failed"})
TERMINAL_PHASES = frozenset({"completed", "failed"})
REQUIRED_STATE_FIELDS = ("run_id", "owner_user_id", "input_text")
_PHASE_COMPLETED_LENGTH = {
    "accepted": 0,
    "prepared": 1,
    "executed": 2,
    "verified": 3,
    "completed": 4,
}


def state_validation_error(state: Mapping[str, Any]) -> tuple[str, str] | None:
    """Return a stable error code/message when a checkpoint state is invalid."""

    missing = [
        key
        for key in REQUIRED_STATE_FIELDS
        if not str(state.get(key) or "").strip()
    ]
    if missing:
        return "INVALID_RUN_STATE", "任务状态缺少必要字段"

    phase = str(state.get("phase") or "accepted")
    if phase not in ALLOWED_PHASES:
        return "INVALID_RUN_PHASE", "任务状态阶段无效"

    schema_version = state.get("schema_version")
    if schema_version is not None and str(schema_version) != RUN_STATE_SCHEMA_VERSION:
        return "INVALID_RUN_STATE_SCHEMA", "任务状态版本不受支持"

    completed = state.get("completed_steps", [])
    if not isinstance(completed, list) or any(
        not isinstance(step, str) or step not in PHASE_STEPS for step in completed
    ):
        return "INVALID_RUN_STEPS", "任务状态步骤无效"
    if len(completed) != len(set(completed)):
        return "INVALID_RUN_STEPS", "任务状态步骤重复"
    if completed != list(PHASE_STEPS[: len(completed)]):
        return "INVALID_RUN_STEPS", "任务状态步骤顺序无效"
    if phase != "failed":
        expected = list(PHASE_STEPS[: _PHASE_COMPLETED_LENGTH[phase]])
        if completed != expected:
            return "INVALID_RUN_STEPS", "任务状态步骤与阶段不一致"
    return None


def append_completed_step(steps: Sequence[str] | None, step: str) -> list[str]:
    """Append a harness step once, preserving the checkpoint's idempotency."""

    if step not in PHASE_STEPS:
        raise ValueError(f"unknown runtime phase step: {step}")
    result = list(steps or [])
    if any(not isinstance(item, str) for item in result):
        raise ValueError("invalid completed steps prefix")
    if result != list(PHASE_STEPS[: len(result)]) or len(result) != len(set(result)):
        raise ValueError("invalid completed steps prefix")
    if step in result:
        return result
    if len(result) >= len(PHASE_STEPS) or PHASE_STEPS[len(result)] != step:
        raise ValueError("invalid completed steps transition")
    result.append(step)
    return result


def phase_contract_status() -> dict[str, object]:
    """Expose the contract version for diagnostics and release evidence."""

    return {
        "version": 1,
        "schema_version": RUN_STATE_SCHEMA_VERSION,
        "phase_steps": list(PHASE_STEPS),
        "terminal_phases": sorted(TERMINAL_PHASES),
        "required_state_fields": list(REQUIRED_STATE_FIELDS),
    }
