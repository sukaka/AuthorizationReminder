"""Unified Agent Run service for the current 5.0 task contract.

Product UI: 任务
Technical: Run / Step / Event
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from .agent_contracts import (
    AgentArtifactContract,
    AgentEventContract,
    AgentEventType,
    AgentQualityContract,
    AgentRunContract,
    AgentRunStage,
    AgentRunStatus,
    AgentStepContract,
)
from .crypto import ContentCipher, EncryptedPayload
from .faq_matcher import match_shared_faq
from .harness_spec_registry import HarnessSpecRegistry
from .agent_state_machine import AgentRunStateMachine
from .models import AgentRun, AgentRunEvent, AgentRunStep


class BudgetExceededError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class LeaseLostError(RuntimeError):
    """Raised when a worker no longer owns the run lease it tries to mutate."""


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _safe_positive_int(value: Any, default: int = 1) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _normalized_artifact(
    raw: Any,
    *,
    fallback_title: str,
) -> AgentArtifactContract | None:
    if not isinstance(raw, dict):
        return None
    artifact_id = str(raw.get("artifact_id") or raw.get("id") or "").strip()
    if not artifact_id:
        return None
    artifact_format = str(
        raw.get("format")
        or raw.get("kind")
        or raw.get("artifact_type")
        or raw.get("type")
        or ""
    ).strip().lower()
    artifact_type = str(raw.get("artifact_type") or raw.get("type") or artifact_format or "file")
    download_ref = str(raw.get("download_ref") or raw.get("download_url") or "")
    downloadable = bool(raw.get("downloadable", bool(download_ref)))
    editable_default = artifact_format in {"markdown", "md"} or (
        downloadable and artifact_format in {"html", "docx", "xlsx", "pptx"}
    )
    try:
        return AgentArtifactContract(
            artifact_id=artifact_id[:128],
            artifact_type=artifact_type[:48],
            title=str(
                raw.get("title")
                or raw.get("artifact_title")
                or raw.get("file_name")
                or fallback_title
                or "成果"
            )[:255],
            status=str(raw.get("status") or "ready")[:24],
            version=_safe_positive_int(raw.get("version")),
            format=artifact_format[:48],
            mime_type=str(raw.get("mime_type") or raw.get("media_type") or "")[:128],
            download_ref=download_ref[:1024],
            downloadable=downloadable,
            editable=bool(raw.get("editable", editable_default)),
        )
    except Exception:
        return None


def _artifact_from_result(result: Any, *, fallback_title: str) -> AgentArtifactContract | None:
    if not isinstance(result, dict):
        return None
    candidates = [result.get("artifact")]
    artifacts = result.get("artifacts")
    if isinstance(artifacts, list) and artifacts:
        candidates.append(artifacts[0])
    candidates.append(result)
    for candidate in candidates:
        artifact = _normalized_artifact(candidate, fallback_title=fallback_title)
        if artifact is not None:
            return artifact
    return None


def _next_action_for_status(status: str, checkpoint: Any) -> str:
    if isinstance(checkpoint, dict):
        explicit = str(checkpoint.get("next_action") or "").strip()
        if explicit:
            return explicit[:500]
    if status in {"waiting_user", "waiting_confirmation"}:
        return "请确认或补充信息后继续"
    if status == "failed":
        return "请检查失败原因后重试"
    if status == "cancelled":
        return "如仍需处理，可重新运行任务"
    if status in {"succeeded", "completed"}:
        return "可查看或下载任务成果"
    if status in {"created", "queued"}:
        return "等待系统开始处理"
    return "任务正在处理中"


class AgentRunService:
    def __init__(self, db: Session, cipher: ContentCipher, *, key_version: str = "v1") -> None:
        self.db = db
        self.cipher = cipher
        self.key_version = key_version
        self._lease_owner: str | None = None
        self._fencing_token: int | None = None

    def bind_lease(self, worker_id: str, fencing_token: int) -> None:
        self._lease_owner = worker_id
        self._fencing_token = fencing_token

    def unbind_lease(self) -> None:
        self._lease_owner = None
        self._fencing_token = None

    def _assert_bound_lease(self, row: AgentRun) -> None:
        if self._lease_owner is not None and self._fencing_token is not None:
            self.assert_lease(row, self._lease_owner, self._fencing_token)
            # Lease mutations use atomic SQL updates, so synchronize the ORM row
            # before its next version-checked write.
            self.db.refresh(row)

    def create_run(
        self,
        *,
        owner_user_id: str,
        input_text: str,
        conversation_id: str = "",
        message_id: str = "",
        run_type: str = "chat",
        title: str = "AI 任务",
        max_steps: int = 32,
        max_model_calls: int = 20,
        max_cost_micros: int = 0,
        max_step_tool_calls: int = 0,
        max_step_tokens: int = 0,
        max_step_latency_ms: int = 0,
        metadata: dict[str, Any] | None = None,
        request_context: dict[str, Any] | None = None,
    ) -> AgentRun:
        active_harness_spec = HarnessSpecRegistry(self.db).get_or_bootstrap_active()
        encrypted = self.cipher.encrypt_json(
            {
                "input_text": input_text,
                "conversation_id": conversation_id,
                "message_id": message_id,
                "context": request_context or {},
            },
            associated_data=owner_user_id.encode("utf-8"),
        )
        row = AgentRun(
            owner_user_id=owner_user_id,
            conversation_id=conversation_id or "",
            message_id=message_id or "",
            run_type=run_type or "chat",
            title=(title or "AI 任务")[:255],
            status=AgentRunStatus.CREATED.value,
            stage=AgentRunStage.ACCEPTED.value,
            progress=0,
            attempt=1,
            max_steps=max_steps,
            max_model_calls=max_model_calls,
            max_cost_micros=max_cost_micros,
            max_step_tool_calls=max_step_tool_calls,
            max_step_tokens=max_step_tokens,
            max_step_latency_ms=max_step_latency_ms,
            request_ciphertext=encrypted.ciphertext,
            request_nonce=encrypted.nonce,
            key_version=self.key_version,
            state_schema_version="1.0",
            harness_spec_uuid=active_harness_spec.uuid,
            harness_spec_version=active_harness_spec.semantic_version,
            harness_spec_hash=active_harness_spec.content_hash,
            state_revision=0,
            metadata_json=metadata or {},
        )
        self.db.add(row)
        self.db.flush()
        self.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=AgentRunStage.ACCEPTED,
            label="任务已创建",
            progress=0,
            event_key="accepted",
        )
        return row

    def get_owned_run(self, run_id: str, owner_user_id: str) -> AgentRun | None:
        row = self.db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
        if row is None:
            return None
        if str(row.owner_user_id) != str(owner_user_id):
            return None
        return row

    def list_owned(
        self,
        owner_user_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
        status: str = "",
        conversation_id: str = "",
        query: str = "",
    ) -> list[AgentRun]:
        filters = self._owned_filters(
            owner_user_id,
            status=status,
            conversation_id=conversation_id,
            query=query,
        )
        stmt = (
            select(AgentRun)
            .where(*filters)
            .order_by(AgentRun.updated_at.desc(), AgentRun.id.desc())
            .offset(max(0, int(offset)))
            .limit(max(1, min(int(limit), 200)))
        )
        return list(self.db.scalars(stmt))

    def count_owned(
        self,
        owner_user_id: str,
        *,
        status: str = "",
        conversation_id: str = "",
        query: str = "",
    ) -> int:
        filters = self._owned_filters(
            owner_user_id,
            status=status,
            conversation_id=conversation_id,
            query=query,
        )
        return int(
            self.db.scalar(select(func.count(AgentRun.id)).where(*filters)) or 0
        )

    @staticmethod
    def _owned_filters(
        owner_user_id: str,
        *,
        status: str = "",
        conversation_id: str = "",
        query: str = "",
    ) -> list[Any]:
        filters: list[Any] = [AgentRun.owner_user_id == owner_user_id]
        if status.strip():
            filters.append(AgentRun.status == status.strip())
        if conversation_id.strip():
            filters.append(AgentRun.conversation_id == conversation_id.strip())
        normalized_query = query.strip().lower()
        if normalized_query:
            filters.append(func.lower(AgentRun.title).contains(normalized_query, autoescape=True))
        return filters

    def decrypt_request(self, row: AgentRun) -> dict[str, Any]:
        return self.cipher.decrypt_json(
            EncryptedPayload(ciphertext=row.request_ciphertext, nonce=row.request_nonce),
            associated_data=str(row.owner_user_id).encode("utf-8"),
        )

    def ensure_budget(self, row: AgentRun, *, model_calls_delta: int = 0) -> None:
        if row.max_model_calls and (int(row.model_calls or 0) + model_calls_delta) > int(row.max_model_calls):
            raise BudgetExceededError("MODEL_CALL_BUDGET_EXCEEDED", "模型调用次数已达上限")
        step_count = self.db.scalar(
            select(func.count()).select_from(AgentRunStep).where(AgentRunStep.run_id == row.uuid)
        ) or 0
        if row.max_steps and int(step_count) >= int(row.max_steps):
            raise BudgetExceededError("STEP_BUDGET_EXCEEDED", "任务步骤数已达上限")

    def record_model_call(self, row: AgentRun, *, cost_micros: int = 0) -> None:
        self._assert_bound_lease(row)
        self.ensure_budget(row, model_calls_delta=1)
        row.model_calls = int(row.model_calls or 0) + 1
        row.cost_micros = int(row.cost_micros or 0) + int(cost_micros or 0)
        self.db.add(row)

    def next_step_sequence(self, run_id: str) -> int:
        current = self.db.scalar(
            select(func.max(AgentRunStep.sequence)).where(AgentRunStep.run_id == run_id)
        )
        return int(current or 0) + 1

    def next_event_sequence(self, run_id: str) -> int:
        current = self.db.scalar(
            select(func.max(AgentRunEvent.sequence)).where(AgentRunEvent.run_id == run_id)
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
        self._assert_bound_lease(row)
        self.ensure_budget(row)
        normalized_usage = usage or {}
        tool_calls = int(normalized_usage.get("tool_calls") or 0)
        total_tokens = int(
            normalized_usage.get("total_tokens")
            or normalized_usage.get("tokens")
            or 0
        )
        if row.max_step_tool_calls and tool_calls > int(row.max_step_tool_calls):
            raise BudgetExceededError("STEP_TOOL_CALL_BUDGET_EXCEEDED", "步骤工具调用次数已达上限")
        if row.max_step_tokens and total_tokens > int(row.max_step_tokens):
            raise BudgetExceededError("STEP_TOKEN_BUDGET_EXCEEDED", "步骤令牌用量已达上限")
        if row.max_step_latency_ms and int(latency_ms or 0) > int(row.max_step_latency_ms):
            raise BudgetExceededError("STEP_LATENCY_BUDGET_EXCEEDED", "步骤执行时长已达上限")
        sequence = self.next_step_sequence(row.uuid)
        # Idempotent by (run_id, sequence) unique constraint; callers should not re-use sequence.
        step = AgentRunStep(
            run_id=row.uuid,
            sequence=sequence,
            step_type=step_type,
            role=role or "",
            status=status,
            attempt=1,
            input_summary_json=input_summary,
            output_summary_json=output_summary,
            checkpoint_json=checkpoint,
            usage_json=normalized_usage,
            latency_ms=latency_ms,
            error_code=error_code or "",
            error_message_safe=error_message_safe or "",
            started_at=_utc_now(),
            finished_at=_utc_now() if status in {"succeeded", "failed", "cancelled"} else None,
        )
        self.db.add(step)
        self.db.flush()
        return step

    def append_event(
        self,
        row: AgentRun,
        *,
        event_type: AgentEventType,
        stage: AgentRunStage | None = None,
        label: str = "",
        progress: int | None = None,
        content: str = "",
        source: dict[str, Any] | None = None,
        artifact: dict[str, Any] | None = None,
        quality: dict[str, Any] | None = None,
        event_key: str | None = None,
    ) -> AgentRunEvent:
        self._assert_bound_lease(row)
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
            sequence=self.next_event_sequence(row.uuid),
            event_key=event_key,
            event_type=event_type.value,
            stage=stage.value if stage else "",
            label=label or "",
            progress=progress,
            content=content or "",
            source_json=source,
            artifact_json=artifact,
            quality_json=quality,
        )
        self.db.add(event)
        self.db.flush()
        return event

    def list_events(self, run_id: str, *, after_sequence: int = 0) -> list[AgentRunEvent]:
        stmt = (
            select(AgentRunEvent)
            .where(AgentRunEvent.run_id == run_id)
            .where(AgentRunEvent.sequence > after_sequence)
            .order_by(AgentRunEvent.sequence.asc())
        )
        return list(self.db.scalars(stmt))

    def list_steps(self, run_id: str) -> list[AgentRunStep]:
        stmt = (
            select(AgentRunStep)
            .where(AgentRunStep.run_id == run_id)
            .order_by(AgentRunStep.sequence.asc())
        )
        return list(self.db.scalars(stmt))

    def mark_running(self, row: AgentRun, *, stage: AgentRunStage = AgentRunStage.ROUTING) -> None:
        self.transition_status(row, AgentRunStatus.RUNNING)
        row.stage = stage.value
        row.started_at = row.started_at or _utc_now()
        self.db.add(row)

    def mark_succeeded(
        self,
        row: AgentRun,
        *,
        result: dict[str, Any],
        progress: int = 100,
    ) -> None:
        self.transition_status(row, AgentRunStatus.SUCCEEDED)
        row.stage = AgentRunStage.COMPLETED.value
        # A successful run is terminal; a stale caller checkpoint must not
        # leak into the task center as an incomplete percentage.
        row.progress = 100
        row.result_json = result
        row.finished_at = _utc_now()
        self.db.add(row)

    def mark_failed(self, row: AgentRun, *, code: str, message: str) -> None:
        self.transition_status(row, AgentRunStatus.FAILED)
        row.stage = AgentRunStage.FAILED.value
        row.error_code = code
        row.error_message_safe = message
        row.finished_at = _utc_now()
        self.db.add(row)

    def request_cancel(self, row: AgentRun) -> AgentRun:
        if row.status in {
            AgentRunStatus.SUCCEEDED.value,
            AgentRunStatus.COMPLETED.value,
            AgentRunStatus.FAILED.value,
            AgentRunStatus.CANCELLED.value,
        }:
            return row
        row.cancel_requested = True
        self.transition_status(row, AgentRunStatus.CANCELLED)
        row.stage = AgentRunStage.CANCELLED.value
        row.finished_at = _utc_now()
        self.db.add(row)
        self.append_event(
            row,
            event_type=AgentEventType.CANCELLED,
            stage=AgentRunStage.CANCELLED,
            label="任务已取消",
            progress=row.progress,
            event_key=f"cancelled-{row.attempt}",
        )
        return row

    def pause(self, row: AgentRun) -> AgentRun:
        """Pause at a durable lifecycle boundary; repeated pause is idempotent."""
        if row.status == AgentRunStatus.PAUSED.value:
            return row
        if row.status not in {
            AgentRunStatus.RUNNING.value,
            AgentRunStatus.WAITING_CONFIRMATION.value,
        }:
            raise ValueError("only_running_or_waiting_can_pause")
        stage = row.stage
        try:
            event_stage = AgentRunStage(stage)
        except ValueError:
            event_stage = AgentRunStage.ACCEPTED
        self.transition_status(row, AgentRunStatus.PAUSED)
        self.db.add(row)
        self.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=event_stage,
            label="运维已暂停任务",
            progress=int(row.progress or 0),
            event_key=f"ops-pause-{row.attempt}",
        )
        return row

    def resume_paused(self, row: AgentRun) -> AgentRun:
        """Move a paused run back to running; the runtime owns actual execution."""
        if row.status == AgentRunStatus.RUNNING.value:
            return row
        if row.status != AgentRunStatus.PAUSED.value:
            raise ValueError("only_paused_can_resume")
        self.transition_status(row, AgentRunStatus.RUNNING)
        self.db.add(row)
        self.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=AgentRunStage.EXECUTING,
            label="运维已恢复任务",
            progress=int(row.progress or 0),
            event_key=f"ops-resume-{row.attempt}",
        )
        return row

    def rollback_to_checkpoint(self, row: AgentRun) -> dict[str, Any]:
        """Restore internal state to a safe checkpoint without reversing side effects."""
        from .checkpoint_recovery import apply_checkpoint_on_retry, extract_safe_checkpoint

        checkpoint = extract_safe_checkpoint(self.db, row)
        if checkpoint is None:
            raise ValueError("safe_checkpoint_not_found")
        if row.status not in {
            AgentRunStatus.PAUSED.value,
            AgentRunStatus.RUNNING.value,
            AgentRunStatus.WAITING_CONFIRMATION.value,
        }:
            raise ValueError("only_active_run_can_rollback")
        if row.status != AgentRunStatus.PAUSED.value:
            self.pause(row)
        apply_checkpoint_on_retry(
            self,
            row,
            resume_source="ops_rollback",
            event_key_prefix="ops-rollback",
            event_label_prefix="运维回滚至 checkpoint",
        )
        self.db.add(row)
        return {
            "source": checkpoint.source,
            "sequence": checkpoint.sequence,
            "stage": checkpoint.stage,
            "progress": int(row.progress or 0),
            "resume_source": "ops_rollback",
            "payload": dict(row.checkpoint_json or {}),
        }

    def retry(self, row: AgentRun) -> AgentRun:
        if row.status not in {
            AgentRunStatus.FAILED.value,
            AgentRunStatus.CANCELLED.value,
        }:
            raise ValueError("only_failed_or_cancelled_can_retry")
        row.attempt = int(row.attempt or 1) + 1
        self.transition_status(row, AgentRunStatus.RETRYING)
        row.stage = AgentRunStage.ACCEPTED.value
        row.progress = 0
        row.cancel_requested = False
        row.error_code = ""
        row.error_message_safe = ""
        row.finished_at = None
        row.started_at = None
        self.db.add(row)
        self.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=AgentRunStage.ACCEPTED,
            label="任务准备重试",
            progress=0,
            event_key=f"retry-{row.attempt}",
        )
        # Restore stage/progress from last safe checkpoint when available
        try:
            from .checkpoint_recovery import apply_checkpoint_on_retry

            apply_checkpoint_on_retry(self, row)
        except Exception:
            pass
        return row

    def acquire_lease(
        self,
        run_id: str,
        worker_id: str,
        *,
        ttl_seconds: int = 30,
        now: datetime | None = None,
    ) -> int | None:
        """Atomically acquire an expired/unowned lease, or renew the caller's lease."""

        if not worker_id.strip():
            raise ValueError("worker_id_required")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds_must_be_positive")
        current_time = now or _utc_now()
        expires_at = current_time + timedelta(seconds=ttl_seconds)

        claimed = self.db.execute(
            update(AgentRun)
            .where(AgentRun.uuid == run_id)
            .where(
                or_(
                    AgentRun.lease_owner == "",
                    AgentRun.lease_expires_at.is_(None),
                    AgentRun.lease_expires_at <= current_time,
                )
            )
            .values(
                lease_owner=worker_id,
                lease_expires_at=expires_at,
                fencing_token=AgentRun.fencing_token + 1,
                state_revision=AgentRun.state_revision + 1,
            )
        )
        if claimed.rowcount:
            return self.db.scalar(
                select(AgentRun.fencing_token).where(
                    AgentRun.uuid == run_id,
                    AgentRun.lease_owner == worker_id,
                )
            )

        renewed = self.db.execute(
            update(AgentRun)
            .where(
                AgentRun.uuid == run_id,
                AgentRun.lease_owner == worker_id,
                AgentRun.lease_expires_at > current_time,
            )
            .values(
                lease_expires_at=expires_at,
                state_revision=AgentRun.state_revision + 1,
            )
        )
        if not renewed.rowcount:
            return None
        return self.db.scalar(
            select(AgentRun.fencing_token).where(
                AgentRun.uuid == run_id,
                AgentRun.lease_owner == worker_id,
            )
        )

    def release_lease(self, run_id: str, worker_id: str, fencing_token: int) -> bool:
        released = self.db.execute(
            update(AgentRun)
            .where(
                AgentRun.uuid == run_id,
                AgentRun.lease_owner == worker_id,
                AgentRun.fencing_token == fencing_token,
            )
            .values(
                lease_owner="",
                lease_expires_at=None,
                state_revision=AgentRun.state_revision + 1,
            )
        )
        return bool(released.rowcount)

    def renew_lease(
        self,
        run_id: str,
        worker_id: str,
        fencing_token: int,
        *,
        ttl_seconds: int = 30,
        now: datetime | None = None,
    ) -> bool:
        """Extend a still-valid lease without allowing an old worker to reclaim it."""

        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds_must_be_positive")
        current_time = now or _utc_now()
        renewed = self.db.execute(
            update(AgentRun)
            .where(
                AgentRun.uuid == run_id,
                AgentRun.lease_owner == worker_id,
                AgentRun.fencing_token == fencing_token,
                AgentRun.lease_expires_at > current_time,
            )
            .values(
                lease_expires_at=current_time + timedelta(seconds=ttl_seconds),
                state_revision=AgentRun.state_revision + 1,
            )
        )
        return bool(renewed.rowcount)

    def assert_lease(
        self,
        row: AgentRun,
        worker_id: str,
        fencing_token: int,
        *,
        now: datetime | None = None,
    ) -> None:
        current_time = now or _utc_now()
        held = self.db.scalar(
            select(AgentRun.id).where(
                AgentRun.uuid == row.uuid,
                AgentRun.lease_owner == worker_id,
                AgentRun.fencing_token == fencing_token,
                AgentRun.lease_expires_at > current_time,
            )
        )
        if held is None:
            raise LeaseLostError("agent_run_lease_lost")

    def transition_status(
        self,
        row: AgentRun,
        target: AgentRunStatus | str,
        *,
        worker_id: str | None = None,
        fencing_token: int | None = None,
        now: datetime | None = None,
    ) -> None:
        """Perform a lifecycle transition and advance its durable revision."""

        self._assert_bound_lease(row)
        if worker_id is not None or fencing_token is not None:
            if not worker_id or fencing_token is None:
                raise ValueError("worker_id_and_fencing_token_required_together")
            self.assert_lease(row, worker_id, fencing_token, now=now)

        target_value = target.value if isinstance(target, AgentRunStatus) else str(target)
        current_value = str(row.status or AgentRunStatus.CREATED.value)
        if current_value == target_value:
            return
        row.status = AgentRunStateMachine.transition(current_value, target_value)
        row.state_schema_version = "1.0"
        self.db.add(row)

    def persist_safe_checkpoint(
        self,
        row: AgentRun,
        *,
        checkpoint: dict[str, Any],
        stage: AgentRunStage | None = None,
        progress: int | None = None,
        result: dict[str, Any] | None = None,
        durable: bool = False,
    ) -> None:
        """Persist a versioned resume point under the currently bound lease.

        ``durable=True`` commits this safe point immediately.  Runtime
        executors use it at replay-safe boundaries so a process crash cannot
        roll the checkpoint back with the outer request transaction.
        Callers that need one larger transaction can retain the default.
        """

        from .run_state_contracts import (
            RUN_STATE_SCHEMA_VERSION,
            migrate_checkpoint_to_run_state_v1,
        )

        self._assert_bound_lease(row)
        payload = dict(checkpoint)
        state_source = dict(payload)
        state_source.pop("schema_version", None)
        state_source.pop("run_state", None)
        if stage is not None:
            payload["stage"] = stage.value
            row.stage = stage.value
        if progress is not None:
            normalized_progress = max(0, min(100, int(progress)))
            payload["progress"] = normalized_progress
            row.progress = normalized_progress
        payload["schema_version"] = RUN_STATE_SCHEMA_VERSION
        payload["run_state"] = migrate_checkpoint_to_run_state_v1(
            run_id=int(row.id),
            checkpoint=state_source,
            status=str(row.status),
            attempt=int(row.attempt or 0),
            revision=int(row.state_revision or 0) + 1,
        ).to_dict()
        row.state_schema_version = RUN_STATE_SCHEMA_VERSION
        row.checkpoint_json = payload
        if result is not None:
            row.result_json = result
        self.db.add(row)
        self.db.flush()
        if durable:
            self.db.commit()

    def persist_result(self, row: AgentRun, result: dict[str, Any]) -> None:
        """Persist a replayable result under the currently bound lease."""

        self._assert_bound_lease(row)
        row.result_json = dict(result)
        self.db.add(row)
        self.db.flush()

    def get_safe_checkpoint(self, row: AgentRun) -> dict[str, Any] | None:
        """Public helper for API / workers."""
        from .checkpoint_recovery import extract_safe_checkpoint

        cp = extract_safe_checkpoint(self.db, row)
        if cp is None:
            return None
        return {
            "run_id": cp.run_id,
            "source": cp.source,
            "sequence": cp.sequence,
            "stage": cp.stage,
            "progress": cp.progress,
            "payload": cp.payload,
            "step_type": cp.step_type,
            "role": cp.role,
        }

    @staticmethod
    def public_progress(row: AgentRun) -> int:
        """Return a bounded progress value suitable for public task payloads."""

        if _enum_value(row.status) in {
            AgentRunStatus.SUCCEEDED.value,
            AgentRunStatus.COMPLETED.value,
        } or _enum_value(row.stage) == AgentRunStage.COMPLETED.value:
            return 100
        if _enum_value(row.status) in {
            AgentRunStatus.CREATED.value,
            AgentRunStatus.QUEUED.value,
            AgentRunStatus.RETRYING.value,
        }:
            # These lifecycle states have not started meaningful execution.
            # Older rows may still contain the 75% draft checkpoint; it must
            # not be presented as current task progress.
            return 0
        try:
            progress = int(row.progress or 0)
        except (TypeError, ValueError):
            progress = 0
        return max(0, min(100, progress))

    def to_public_run(self, row: AgentRun) -> AgentRunContract:
        status = row.status
        # Map completed synonym if stored as succeeded
        try:
            status_enum = AgentRunStatus(status)
        except ValueError:
            status_enum = AgentRunStatus.RUNNING
        try:
            stage_enum = AgentRunStage(row.stage)
        except ValueError:
            stage_enum = AgentRunStage.ACCEPTED
        citations: list = []
        artifact = None
        result = row.result_json or {}
        if isinstance(result, dict):
            raw_cites = result.get("citations")
            if isinstance(raw_cites, list):
                from .agent_contracts import AgentCitationContract

                for item in raw_cites[:50]:
                    if not isinstance(item, dict):
                        continue
                    try:
                        citations.append(
                            AgentCitationContract.model_validate(
                                {
                                    "citation_id": str(
                                        item.get("citation_id") or item.get("file_uuid") or item.get("name") or "cite"
                                    )[:128],
                                    "name": str(item.get("name") or "资料")[:255],
                                    "location": str(item.get("location") or "")[:255],
                                    "source_type": str(item.get("source_type") or "")[:32],
                                    "document_version": str(item.get("document_version") or "")[:64],
                                    "page": item.get("page"),
                                    "section": str(item.get("section") or "")[:255],
                                    "is_inference": bool(item.get("is_inference")),
                                }
                            )
                        )
                    except Exception:
                        continue
            artifact = _artifact_from_result(result, fallback_title=str(row.title or "成果"))
        requires_user_action = status_enum in {
            AgentRunStatus.WAITING_USER,
            AgentRunStatus.WAITING_CONFIRMATION,
        }
        retry_allowed = status_enum in {
            AgentRunStatus.FAILED,
            AgentRunStatus.CANCELLED,
        }
        cancel_allowed = status_enum not in {
            AgentRunStatus.SUCCEEDED,
            AgentRunStatus.COMPLETED,
            AgentRunStatus.FAILED,
            AgentRunStatus.CANCELLED,
        }
        return AgentRunContract(
            run_id=row.uuid,
            conversation_id=str(row.conversation_id or "")[:64],
            title=str(row.title or "AI 任务")[:255],
            run_type=str(row.run_type or "chat")[:48],
            status=status_enum,
            stage=stage_enum,
            progress=self.public_progress(row),
            attempt=_safe_positive_int(row.attempt),
            requires_user_action=requires_user_action,
            next_action=_next_action_for_status(status_enum.value, row.checkpoint_json),
            error_code=str(row.error_code or "")[:64],
            error_message=str(row.error_message_safe or "")[:500],
            retry_allowed=retry_allowed,
            cancel_allowed=cancel_allowed,
            artifact=artifact,
            citations=citations,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def to_public_event(self, event: AgentRunEvent) -> AgentEventContract:
        source = None
        if event.source_json:
            from .agent_contracts import AgentCitationContract

            source = AgentCitationContract.model_validate(event.source_json)
        quality = None
        if event.quality_json:
            quality = AgentQualityContract.model_validate(event.quality_json)
        stage = None
        if event.stage:
            try:
                stage = AgentRunStage(event.stage)
            except ValueError:
                stage = None
        try:
            event_type = AgentEventType(event.event_type)
        except ValueError:
            event_type = AgentEventType.STAGE
        artifact_payload = event.artifact_json or {}
        artifact = _normalized_artifact(
            artifact_payload,
            fallback_title=str(event.label or "任务成果"),
        )
        if event_type is AgentEventType.ARTIFACT and artifact is None:
            # Historical rows may have used the artifact event name before the
            # public artifact contract existed. Keep those details readable.
            event_type = AgentEventType.STAGE
        next_action = str(artifact_payload.get("next_action") or "")[:500]
        if event_type is AgentEventType.WAITING_USER and not next_action:
            next_action = str(event.content or event.label or "请补充信息后继续")[:500]
        return AgentEventContract(
            event_id=event.uuid,
            run_id=event.run_id,
            sequence=event.sequence,
            event_type=event_type,
            stage=stage,
            label=event.label or "",
            progress=event.progress,
            content=event.content or "",
            source=source,
            artifact_id=str(artifact_payload.get("artifact_id") or "")[:128],
            artifact=artifact,
            next_action=next_action,
            quality=quality,
        )

    def to_public_step(self, step: AgentRunStep) -> AgentStepContract:
        summary = ""
        if isinstance(step.output_summary_json, dict):
            summary = str(step.output_summary_json.get("summary") or "")[:2000]
        return AgentStepContract(
            step_id=step.uuid,
            run_id=step.run_id,
            sequence=step.sequence,
            step_type=step.step_type,
            status=step.status,
            role=step.role or "",
            summary=summary,
            attempt=_safe_positive_int(step.attempt),
            retryable=step.status == "failed",
            error_code=str(step.error_code or "")[:64],
            error_message=str(step.error_message_safe or "")[:500],
        )

    def execute_faq_fast_path(self, row: AgentRun, input_text: str) -> bool:
        """Try FAQ zero-model path. Returns True if handled."""
        match = match_shared_faq(self.db, input_text)
        if match is None:
            return False

        self.mark_running(row, stage=AgentRunStage.ROUTING)
        self.add_step(
            row,
            step_type="faq_match",
            status="succeeded",
            role="system",
            input_summary={"match_type": match.match_type},
            output_summary={
                "faq_id": match.faq_id,
                "summary": "统一回复",
                "model_calls": 0,
            },
        )
        self.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=AgentRunStage.ROUTING,
            label="统一回复",
            progress=40,
            event_key=f"faq-route-{row.attempt}",
        )
        self.append_event(
            row,
            event_type=AgentEventType.DELTA,
            stage=AgentRunStage.EXECUTING,
            label="统一回复",
            progress=90,
            content=match.answer,
            event_key=f"faq-delta-{row.attempt}",
        )
        result = {
            "kind": "faq",
            "faq_id": match.faq_id,
            "match_type": match.match_type,
            "answer": match.answer,
            "model_calls": 0,
            "display_label": "统一回复",
        }
        self.mark_succeeded(row, result=result, progress=100)
        self.append_event(
            row,
            event_type=AgentEventType.COMPLETED,
            stage=AgentRunStage.COMPLETED,
            label="已完成",
            progress=100,
            quality={"passed": True, "issues": []},
            event_key=f"faq-completed-{row.attempt}",
        )
        return True
