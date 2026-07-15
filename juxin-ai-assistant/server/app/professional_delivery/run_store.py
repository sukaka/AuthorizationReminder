from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent_contracts import AgentRunStage, AgentRunStatus
from ..crypto import ContentCipher
from ..models import AgentRun, AgentRunEvent, AgentRunStep


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _enum_value(value: str | AgentRunStage | AgentRunStatus) -> str:
    return value.value if hasattr(value, "value") else str(value)


class ProfessionalRunStore:
    """Small Run/Step/Event adapter backed only by the 2.0 task tables."""

    def __init__(
        self,
        db: Session,
        cipher: ContentCipher,
        *,
        key_version: str,
    ) -> None:
        self.db = db
        self.cipher = cipher
        self.key_version = key_version

    def create_run(
        self,
        *,
        owner_user_id: str,
        input_text: str,
        conversation_id: str = "",
        message_id: str = "",
        run_type: str = "professional_delivery",
        title: str = "专业成果任务",
        max_steps: int = 16,
        max_model_calls: int = 2,
        max_cost_micros: int = 0,
        metadata: dict[str, Any] | None = None,
    ) -> AgentRun:
        encrypted = self.cipher.encrypt_json(
            {
                "input_text": input_text,
                "conversation_id": conversation_id,
                "message_id": message_id,
            },
            associated_data=owner_user_id.encode("utf-8"),
        )
        row = AgentRun(
            owner_user_id=owner_user_id,
            conversation_id=conversation_id,
            message_id=message_id,
            run_type=run_type,
            title=(title or "专业成果任务")[:255],
            status="queued",
            stage=AgentRunStage.ACCEPTED.value,
            progress=0,
            attempt=1,
            cancel_requested=False,
            max_steps=max_steps,
            max_model_calls=max_model_calls,
            max_cost_micros=max_cost_micros,
            model_calls=0,
            cost_micros=0,
            request_ciphertext=encrypted.ciphertext,
            request_nonce=encrypted.nonce,
            key_version=self.key_version,
            metadata_json=dict(metadata or {}),
        )
        self.db.add(row)
        self.db.flush()
        self.append_event(
            row,
            event_type="stage",
            stage=AgentRunStage.ACCEPTED,
            label="专业任务已创建",
            progress=0,
            event_key="professional:accepted",
        )
        return row

    def get_owned_run(self, run_uuid: str, owner_user_id: str) -> AgentRun | None:
        return self.db.scalar(
            select(AgentRun).where(
                AgentRun.uuid == run_uuid,
                AgentRun.owner_user_id == owner_user_id,
                AgentRun.run_type == "professional_delivery",
            )
        )

    def _next_step_sequence(self, run_uuid: str) -> int:
        current = self.db.scalar(
            select(func.max(AgentRunStep.sequence)).where(
                AgentRunStep.run_id == run_uuid
            )
        )
        return int(current or 0) + 1

    def _next_event_sequence(self, run_uuid: str) -> int:
        current = self.db.scalar(
            select(func.max(AgentRunEvent.sequence)).where(
                AgentRunEvent.run_id == run_uuid
            )
        )
        return int(current or 0) + 1

    def add_step(
        self,
        row: AgentRun,
        *,
        step_type: str,
        status: str,
        role: str = "",
        input_summary: dict[str, Any] | None = None,
        output_summary: dict[str, Any] | None = None,
        checkpoint: dict[str, Any] | None = None,
        usage: dict[str, Any] | None = None,
        latency_ms: int = 0,
        error_code: str = "",
        error_message_safe: str = "",
    ) -> AgentRunStep:
        step_count = int(
            self.db.scalar(
                select(func.count()).select_from(AgentRunStep).where(
                    AgentRunStep.run_id == row.uuid
                )
            )
            or 0
        )
        if row.max_steps and step_count >= int(row.max_steps):
            raise RuntimeError("professional_run_step_budget_exceeded")
        now = _utc_now()
        step = AgentRunStep(
            run_id=row.uuid,
            sequence=self._next_step_sequence(row.uuid),
            step_type=step_type,
            role=role,
            status=status,
            attempt=1,
            input_summary_json=input_summary,
            output_summary_json=output_summary,
            checkpoint_json=checkpoint,
            usage_json=usage or {},
            latency_ms=max(0, int(latency_ms)),
            error_code=error_code,
            error_message_safe=error_message_safe,
            started_at=now,
            finished_at=(
                now if status in {"succeeded", "failed", "cancelled"} else None
            ),
        )
        self.db.add(step)
        self.db.flush()
        return step

    def append_event(
        self,
        row: AgentRun,
        *,
        event_type: str,
        stage: str | AgentRunStage | None = None,
        label: str = "",
        progress: int | None = None,
        content: str = "",
        source: dict[str, Any] | None = None,
        artifact: dict[str, Any] | None = None,
        quality: dict[str, Any] | None = None,
        event_key: str | None = None,
    ) -> AgentRunEvent:
        if event_key:
            existing = self.db.scalar(
                select(AgentRunEvent).where(
                    AgentRunEvent.run_id == row.uuid,
                    AgentRunEvent.event_key == event_key,
                )
            )
            if existing is not None:
                return existing
        event = AgentRunEvent(
            run_id=row.uuid,
            sequence=self._next_event_sequence(row.uuid),
            event_key=event_key,
            event_type=event_type,
            stage=_enum_value(stage) if stage is not None else "",
            label=label[:255],
            progress=progress,
            content=content[:20_000],
            source_json=source,
            artifact_json=artifact,
            quality_json=quality,
        )
        self.db.add(event)
        self.db.flush()
        return event

    def list_steps(self, run_uuid: str) -> list[AgentRunStep]:
        return list(
            self.db.scalars(
                select(AgentRunStep)
                .where(AgentRunStep.run_id == run_uuid)
                .order_by(AgentRunStep.sequence.asc())
            )
        )

    def list_events(
        self,
        run_uuid: str,
        *,
        after_sequence: int = 0,
    ) -> list[AgentRunEvent]:
        return list(
            self.db.scalars(
                select(AgentRunEvent)
                .where(
                    AgentRunEvent.run_id == run_uuid,
                    AgentRunEvent.sequence > max(0, int(after_sequence)),
                )
                .order_by(AgentRunEvent.sequence.asc())
            )
        )

    def transition_status(
        self,
        row: AgentRun,
        target: str | AgentRunStatus,
    ) -> None:
        row.status = _enum_value(target)
        self.db.add(row)

    def mark_running(
        self,
        row: AgentRun,
        *,
        stage: AgentRunStage = AgentRunStage.PLANNING,
    ) -> None:
        self.transition_status(row, AgentRunStatus.RUNNING)
        row.stage = stage.value
        row.started_at = row.started_at or _utc_now()
        self.append_event(
            row,
            event_type="stage",
            stage=stage,
            label="专业流程已启动",
            progress=int(row.progress or 0),
            event_key="professional:running",
        )

    def mark_succeeded(
        self,
        row: AgentRun,
        *,
        result: dict[str, Any],
        progress: int = 100,
    ) -> None:
        self.transition_status(row, AgentRunStatus.SUCCEEDED)
        row.stage = AgentRunStage.COMPLETED.value
        row.progress = max(0, min(100, int(progress)))
        row.result_json = dict(result)
        row.finished_at = _utc_now()
        self.append_event(
            row,
            event_type="completed",
            stage=AgentRunStage.COMPLETED,
            label="专业成果已生成",
            progress=row.progress,
            artifact={
                "artifact_id": str(result.get("created_version_uuid") or "")
            },
            event_key="professional:completed",
        )

    def mark_cancelled(self, row: AgentRun) -> None:
        if row.status in {"succeeded", "completed", "failed", "cancelled"}:
            return
        row.cancel_requested = True
        self.transition_status(row, AgentRunStatus.CANCELLED)
        row.stage = AgentRunStage.CANCELLED.value
        row.finished_at = _utc_now()
        self.append_event(
            row,
            event_type="cancelled",
            stage=AgentRunStage.CANCELLED,
            label="专业任务已取消",
            progress=int(row.progress or 0),
            event_key="professional:cancelled",
        )

    def persist_safe_checkpoint(
        self,
        row: AgentRun,
        *,
        checkpoint: dict[str, Any],
        stage: AgentRunStage | None = None,
        progress: int | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        payload = dict(checkpoint)
        if stage is not None:
            row.stage = stage.value
            payload["stage"] = stage.value
        if progress is not None:
            row.progress = max(0, min(100, int(progress)))
            payload["progress"] = row.progress
        row.checkpoint_json = payload
        if result is not None:
            row.result_json = dict(result)
        self.db.add(row)
        self.db.flush()
        if stage is not None and stage not in {
            AgentRunStage.COMPLETED,
            AgentRunStage.FAILED,
            AgentRunStage.CANCELLED,
        }:
            self.append_event(
                row,
                event_type="stage",
                stage=stage,
                label="专业流程状态已更新",
                progress=row.progress,
            )

    @staticmethod
    def public_run(row: AgentRun) -> dict[str, Any]:
        return {
            "run_id": row.uuid,
            "title": str(row.title or "专业成果任务")[:255],
            "run_type": str(row.run_type or "professional_delivery")[:48],
            "status": str(row.status or "queued"),
            "stage": str(row.stage or "accepted"),
            "progress": max(0, min(100, int(row.progress or 0))),
            "artifact": None,
            "citations": [],
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def public_step(step: AgentRunStep) -> dict[str, Any]:
        return {
            "step_id": step.uuid,
            "run_id": step.run_id,
            "sequence": step.sequence,
            "step_type": step.step_type,
            "status": step.status,
            "role": step.role or "",
            "summary": str((step.output_summary_json or {}).get("summary") or "")[
                :2000
            ],
        }

    @staticmethod
    def public_event(event: AgentRunEvent) -> dict[str, Any]:
        return {
            "event_id": event.uuid,
            "run_id": event.run_id,
            "sequence": event.sequence,
            "event_type": event.event_type,
            "stage": event.stage or None,
            "label": event.label or "",
            "progress": event.progress,
            "content": event.content or "",
            "source": event.source_json,
            "artifact_id": str(
                (event.artifact_json or {}).get("artifact_id") or ""
            ),
            "quality": event.quality_json,
        }
