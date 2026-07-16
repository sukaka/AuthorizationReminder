"""Versioned, serializable state contract for durable agent runs."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping


RUN_STATE_SCHEMA_VERSION = "1.0"
_SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS = {None, "0", "0.0", RUN_STATE_SCHEMA_VERSION}


class RunStateContractError(ValueError):
    """Raised when a checkpoint cannot be safely interpreted."""


@dataclass(frozen=True)
class RunCursor:
    last_safe_step: int = 0
    completed_steps: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.last_safe_step < 0:
            raise RunStateContractError("last_safe_step must be non-negative")


@dataclass(frozen=True)
class RunStateV1:
    run_id: int
    status: str
    stage: str
    attempt: int
    revision: int
    cursor: RunCursor
    schema_version: str = RUN_STATE_SCHEMA_VERSION
    checkpoint: dict[str, Any] = field(default_factory=dict)
    legacy_checkpoint: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.run_id <= 0:
            raise RunStateContractError("run_id must be positive")
        if self.attempt < 0 or self.revision < 0:
            raise RunStateContractError("attempt and revision must be non-negative")
        if self.schema_version != RUN_STATE_SCHEMA_VERSION:
            raise RunStateContractError(f"unsupported run state schema: {self.schema_version}")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def migrate_checkpoint_to_run_state_v1(
    *, run_id: int, checkpoint: Mapping[str, Any] | None, status: str,
    attempt: int, revision: int = 0,
) -> RunStateV1:
    payload = dict(checkpoint or {})
    source_schema = payload.get("schema_version")
    if source_schema not in _SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS:
        raise RunStateContractError(f"unsupported checkpoint schema: {source_schema}")
    if source_schema == RUN_STATE_SCHEMA_VERSION and "run_state" in payload:
        return _parse_v1_payload(run_id, payload["run_state"], status, attempt, revision)

    raw_step = payload.get("last_safe_step", payload.get("resume_from_sequence", 0))
    try:
        last_safe_step = int(raw_step or 0)
    except (TypeError, ValueError):
        last_safe_step = 0
    completed_steps = payload.get("completed_steps", [])
    if not isinstance(completed_steps, list) or not all(isinstance(step, str) for step in completed_steps):
        raise RunStateContractError("completed_steps must be a list of strings")
    return RunStateV1(
        run_id=run_id, status=status, stage=str(payload.get("stage") or "accepted"),
        attempt=attempt, revision=revision,
        cursor=RunCursor(last_safe_step=last_safe_step, completed_steps=list(completed_steps)),
        checkpoint=payload, legacy_checkpoint=payload,
    )


def _parse_v1_payload(run_id: int, payload: Any, status: str, attempt: int, revision: int) -> RunStateV1:
    if not isinstance(payload, Mapping):
        raise RunStateContractError("run_state must be an object")
    cursor = payload.get("cursor", {})
    if not isinstance(cursor, Mapping):
        raise RunStateContractError("run_state.cursor must be an object")
    completed_steps = cursor.get("completed_steps", [])
    if not isinstance(completed_steps, list) or not all(isinstance(step, str) for step in completed_steps):
        raise RunStateContractError("completed_steps must be a list of strings")
    return RunStateV1(
        run_id=int(payload.get("run_id", run_id)), status=str(payload.get("status", status)),
        stage=str(payload.get("stage", "accepted")), attempt=int(payload.get("attempt", attempt)),
        revision=int(payload.get("revision", revision)),
        cursor=RunCursor(last_safe_step=int(cursor.get("last_safe_step", 0)), completed_steps=list(completed_steps)),
        checkpoint=dict(payload.get("checkpoint", {})), legacy_checkpoint=payload.get("legacy_checkpoint"),
    )
