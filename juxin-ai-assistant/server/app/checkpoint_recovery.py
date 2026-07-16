"""Checkpoint recovery helpers + offline recovery suite for GA §8.1."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_contracts import AgentEventType, AgentRunStage, AgentRunStatus
from .agent_run_service import AgentRunService
from .run_state_contracts import (
    RUN_STATE_SCHEMA_VERSION,
    migrate_checkpoint_to_run_state_v1,
)
from .models import AgentRun, AgentRunStep

SAFE_STEP_STATUSES = frozenset({"succeeded", "completed", "ok"})


@dataclass
class SafeCheckpoint:
    run_id: str
    source: str  # run | step
    sequence: int | None
    stage: str
    progress: int
    payload: dict[str, Any]
    step_type: str = ""
    role: str = ""


def extract_safe_checkpoint(db: Session, row: AgentRun) -> SafeCheckpoint | None:
    """Pick the latest safe resume point: run.checkpoint_json or last succeeded step."""
    run_cp = row.checkpoint_json if isinstance(row.checkpoint_json, dict) else None
    if run_cp:
        payload = _normalize_checkpoint_payload(row, run_cp)
        return SafeCheckpoint(
            run_id=row.uuid,
            source="run",
            sequence=None,
            stage=str(payload.get("stage") or row.stage or AgentRunStage.ACCEPTED.value),
            progress=int(payload.get("progress") or row.progress or 0),
            payload=payload,
        )

    steps = list(
        db.scalars(
            select(AgentRunStep)
            .where(AgentRunStep.run_id == row.uuid)
            .order_by(AgentRunStep.sequence.desc())
        )
    )
    for step in steps:
        if step.status not in SAFE_STEP_STATUSES:
            continue
        cp = step.checkpoint_json if isinstance(step.checkpoint_json, dict) else {}
        stage = str(cp.get("stage") or step.step_type or row.stage or "")
        progress = int(cp.get("progress") if cp.get("progress") is not None else max(0, min(99, step.sequence * 10)))
        payload = {
            "from_step_uuid": step.uuid,
            "from_sequence": step.sequence,
            "step_type": step.step_type,
            "role": step.role,
            **cp,
        }
        payload = _normalize_checkpoint_payload(row, payload)
        return SafeCheckpoint(
            run_id=row.uuid,
            source="step",
            sequence=int(step.sequence),
            stage=stage or AgentRunStage.EXECUTING.value,
            progress=progress,
            payload=payload,
            step_type=step.step_type or "",
            role=step.role or "",
        )
    return None


def apply_checkpoint_on_retry(
    service: AgentRunService,
    row: AgentRun,
    *,
    resume_source: str | None = None,
    event_key_prefix: str = "checkpoint-resume",
    event_label_prefix: str = "从 checkpoint 恢复",
) -> SafeCheckpoint | None:
    """Restore stage/progress from last safe checkpoint during retry or ops rollback."""
    cp = extract_safe_checkpoint(service.db, row)
    if cp is None:
        return None
    row.stage = cp.stage[:64] if cp.stage else AgentRunStage.ACCEPTED.value
    row.progress = max(0, min(100, int(cp.progress)))
    # Persist resume pointer on the run for worker consumption
    merged = dict(cp.payload)
    merged["resumed_at"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    # Preserve the legacy retry contract (run/step); callers such as ops
    # rollback may override it with a more specific audit source.
    merged["resume_source"] = resume_source or cp.source
    if cp.sequence is not None:
        merged["resume_from_sequence"] = cp.sequence
    state_source = dict(merged)
    state_source.pop("schema_version", None)
    state_source.pop("run_state", None)
    merged["schema_version"] = RUN_STATE_SCHEMA_VERSION
    merged["run_state"] = migrate_checkpoint_to_run_state_v1(
        run_id=int(row.id),
        checkpoint=state_source,
        status=str(row.status),
        attempt=int(row.attempt or 0),
        revision=int(row.state_revision or 0) + 1,
    ).to_dict()
    row.state_schema_version = RUN_STATE_SCHEMA_VERSION
    row.checkpoint_json = merged
    service.db.add(row)
    service.append_event(
        row,
        event_type=AgentEventType.STAGE,
        stage=AgentRunStage(cp.stage) if _is_stage(cp.stage) else AgentRunStage.ACCEPTED,
        label=f"{event_label_prefix}（{cp.source}"
        + (f"#{cp.sequence}" if cp.sequence is not None else "")
        + "）",
        progress=row.progress,
        event_key=f"{event_key_prefix}-{row.attempt}",
        content=str(merged.get("summary") or "")[:500],
    )
    return cp


def _is_stage(value: str) -> bool:
    try:
        AgentRunStage(value)
        return True
    except ValueError:
        return False


def _normalize_checkpoint_payload(row: AgentRun, payload: dict[str, Any]) -> dict[str, Any]:
    """Attach v1 state without discarding legacy worker-specific fields."""

    normalized = dict(payload)
    state = migrate_checkpoint_to_run_state_v1(
        run_id=int(row.id),
        checkpoint=normalized,
        status=str(row.status),
        attempt=int(row.attempt or 0),
        revision=int(row.state_revision or 0),
    )
    normalized["schema_version"] = RUN_STATE_SCHEMA_VERSION
    normalized["run_state"] = state.to_dict()
    return normalized


def simulate_checkpoint_recovery(
    service: AgentRunService,
    *,
    owner_user_id: str = "checkpoint-suite",
    cases: int = 20,
) -> dict[str, Any]:
    """Offline suite: create failed runs with checkpoints, retry, assert resume.

    Returns recovery rate for GA metric ``checkpoint_recovery_rate``.
    """
    cases = max(1, min(int(cases), 100))
    ok = 0
    failures: list[dict[str, Any]] = []
    for i in range(cases):
        label = f"checkpoint-case-{i}"
        row = service.create_run(
            owner_user_id=owner_user_id,
            input_text=f"长任务恢复演练 {label}",
            run_type="complex",
            title=label,
            max_steps=32,
        )
        # Simulate multi-step progress with safe checkpoints
        service.add_step(
            row,
            step_type="retrieve",
            status="succeeded",
            role="researcher",
            checkpoint={"stage": AgentRunStage.RETRIEVING.value, "progress": 30, "summary": "检索完成"},
            output_summary={"hits": 3},
        )
        service.add_step(
            row,
            step_type="draft",
            status="succeeded",
            role="writer",
            checkpoint={"stage": AgentRunStage.EXECUTING.value, "progress": 60, "summary": "草稿完成"},
            output_summary={"chars": 1200},
        )
        # Fail mid-review
        service.add_step(
            row,
            step_type="review",
            status="failed",
            role="reviewer",
            error_code="simulated_failure",
            error_message_safe="simulated crash",
            checkpoint={"stage": AgentRunStage.REVIEWING.value, "progress": 75},
        )
        row.status = AgentRunStatus.FAILED.value
        row.stage = AgentRunStage.FAILED.value
        row.error_code = "simulated_failure"
        row.error_message_safe = "simulated crash before complete"
        row.progress = 75
        # Also stash run-level checkpoint from last safe step
        row.checkpoint_json = {
            "stage": AgentRunStage.EXECUTING.value,
            "progress": 60,
            "summary": "草稿完成",
            "last_safe_step": "draft",
        }
        service.db.add(row)
        service.db.flush()

        before_attempt = int(row.attempt or 1)
        service.retry(row)
        service.db.flush()

        resumed = extract_safe_checkpoint(service.db, row)
        success = (
            row.status == AgentRunStatus.RETRYING.value
            and int(row.attempt or 0) == before_attempt + 1
            and resumed is not None
            and int(row.progress or 0) >= 30
            and str(row.stage) not in {AgentRunStage.FAILED.value, ""}
        )
        # Prefer restored progress from checkpoint (≥60 if run-level used)
        if success and int(row.progress or 0) < 30:
            success = False
        if success:
            ok += 1
        else:
            failures.append(
                {
                    "run_id": row.uuid,
                    "status": row.status,
                    "stage": row.stage,
                    "progress": row.progress,
                    "attempt": row.attempt,
                    "checkpoint": row.checkpoint_json,
                }
            )

    rate = ok / cases if cases else 0.0
    return {
        "total": cases,
        "recovered": ok,
        "failed": cases - ok,
        "recovery_rate": round(rate, 4),
        "target": 0.99,
        "passed": rate >= 0.99,
        "failures": failures[:10],
        "owner_user_id": owner_user_id,
    }
