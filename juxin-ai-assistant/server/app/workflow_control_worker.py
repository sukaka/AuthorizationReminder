"""Local durable worker for workflow schedules, trigger events and Outbox.

This worker is intentionally provider-free.  It owns the durable control-plane
loop (claim, execute, ack/fail and recovery) while a real notification provider
can be injected later without changing the lease or idempotency contract.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .database import SessionLocal
from .feature_flags import load_feature_flags
from .models import WorkflowNotificationOutbox, WorkflowSchedule, WorkflowTriggerInbox
from .schemas import AuthScope, SessionPayload, UserPayload
from .enterprise_intelligence.access import EnterpriseAccessScope
from .enterprise_intelligence.insight_scan import (
    INSIGHT_SCAN_WORKFLOW_ID,
    scan_overdue_insights,
)
from .provider_reconciliation import (
    NotificationProvider,
    ProviderDeliveryResult,
    ProviderOutcome,
    ProviderOutcomeUnknown,
)
from .workflow_control import (
    ack_notification,
    claim_due_schedules,
    claim_notifications,
    claim_trigger_event,
    fail_notification,
    mark_trigger_processed,
    mark_notification_reconciliation_required,
    next_schedule_fire_at,
    recover_stuck_trigger_events,
    release_schedule_claim,
    resolve_notification_reconciliation,
)
from .workflow_run_service import WorkflowRunService

logger = logging.getLogger(__name__)

# A schedule that is only a few seconds late is treated as the current fire,
# not as a misfire.  This absorbs claim/DB jitter while keeping the policy
# behavior deterministic for a genuinely missed interval.
SCHEDULE_MISFIRE_GRACE_SECONDS = 60
# Catch-up is deliberately bounded per lease/tick.  If more occurrences are
# pending, the cursor remains due and the next tick continues from it.
MAX_CATCH_UP_FIRES = 10


def _utc_now(value: datetime | None = None) -> datetime:
    value = value or datetime.now(UTC)
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


@dataclass(slots=True)
class WorkerTick:
    """Machine-readable outcome of one polling tick."""

    recovered_events: int = 0
    schedules_claimed: int = 0
    schedules_dispatched: int = 0
    schedules_skipped: int = 0
    schedules_failed: int = 0
    events_claimed: int = 0
    events_processed: int = 0
    events_failed: int = 0
    notifications_claimed: int = 0
    notifications_sent: int = 0
    notifications_retried: int = 0
    notifications_reconciliation_required: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "recovered_events": self.recovered_events,
            "schedules": {
                "claimed": self.schedules_claimed,
                "dispatched": self.schedules_dispatched,
                "skipped": self.schedules_skipped,
                "failed": self.schedules_failed,
            },
            "events": {
                "claimed": self.events_claimed,
                "processed": self.events_processed,
                "failed": self.events_failed,
            },
            "notifications": {
                "claimed": self.notifications_claimed,
                "sent": self.notifications_sent,
                "retried": self.notifications_retried,
                "reconciliation_required": self.notifications_reconciliation_required,
            },
            "errors": list(self.errors),
        }


NotificationSender = Callable[[WorkflowNotificationOutbox], bool | None]


def local_notification_sink(_row: WorkflowNotificationOutbox) -> bool:
    """A deterministic local sink used until a provider is explicitly wired.

    No network call is made.  The Outbox row is still claimed and acknowledged,
    so local runs exercise exactly the same fencing and retry semantics as a
    future provider adapter.
    """

    return True


class WorkflowControlWorker:
    """One-worker control-plane poller with durable claim boundaries.

    ``tick`` commits every claim before executing it.  If the process stops
    after that commit, the persisted lease expires and another worker can
    reclaim the item.  Every completion path carries the lease token, so a
    stale worker cannot ack or advance a reclaimed item.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        worker_id: str | None = None,
        lease_ttl_seconds: int = 30,
        batch_size: int = 20,
        notification_sender: NotificationSender | None = None,
        notification_provider: NotificationProvider | None = None,
    ) -> None:
        self.settings = settings
        self.worker_id = worker_id or f"workflow-control-{uuid4().hex}"
        self.lease_ttl_seconds = max(5, int(lease_ttl_seconds))
        self.batch_size = max(1, min(int(batch_size), 500))
        self.notification_sender = notification_sender or local_notification_sink
        # ``notification_sender`` remains supported for the provider-free
        # rollout.  Once a provider is supplied, it owns outcome semantics.
        self.notification_provider = notification_provider

    def tick(self, db: Session, *, now: datetime | None = None) -> WorkerTick:
        current = _utc_now(now)
        result = WorkerTick()

        # Recovery is a separate transaction boundary.  It is safe to run on
        # every tick and makes SIGKILL/host-restart recovery deterministic.
        try:
            result.recovered_events = recover_stuck_trigger_events(
                db, now=current, limit=self.batch_size
            )
            db.commit()
        except Exception as exc:  # pragma: no cover - defensive DB boundary
            db.rollback()
            self._record_error(result, "recover_events", exc)

        self._tick_schedules(db, current, result)
        self._tick_events(db, current, result)
        self._tick_notifications(db, current, result)
        return result

    def _tick_schedules(self, db: Session, current: datetime, result: WorkerTick) -> None:
        try:
            rows = claim_due_schedules(
                db,
                worker_id=self.worker_id,
                now=current,
                lease_ttl_seconds=self.lease_ttl_seconds,
                limit=self.batch_size,
            )
            result.schedules_claimed = len(rows)
            # Persist the lease before any workflow code executes.
            db.commit()
        except Exception as exc:
            db.rollback()
            self._record_error(result, "claim_schedules", exc)
            return

        for row in rows:
            try:
                disposition = self._dispatch_schedule(db, row, current)
                if disposition == "skipped":
                    result.schedules_skipped += 1
                else:
                    result.schedules_dispatched += 1
            except Exception as exc:
                # Keep the committed lease.  On crash/error it expires and is
                # reclaimed on a later tick; rolling back here must not erase
                # the claim itself.
                db.rollback()
                result.schedules_failed += 1
                self._record_error(result, f"schedule:{row.uuid}", exc)

    def _dispatch_schedule(self, db: Session, row: WorkflowSchedule, current: datetime) -> str:
        scheduled_fire_at = row.next_fire_at or current
        current_aware = current.replace(tzinfo=UTC)
        scheduled_fire_aware = scheduled_fire_at.replace(tzinfo=UTC)
        lateness_seconds = max(0.0, (current - scheduled_fire_at).total_seconds())
        policy = "catch_up" if bool(row.catch_up) else str(row.misfire_policy or "skip")
        if policy not in {"skip", "fire_once", "catch_up"}:
            raise ValueError("invalid_misfire_policy")

        # A small amount of lateness is normal claim/transaction jitter and
        # should execute the due occurrence exactly once.
        is_misfire = lateness_seconds > SCHEDULE_MISFIRE_GRACE_SECONDS
        if is_misfire and policy == "skip":
            next_fire_at = next_schedule_fire_at(
                row.cron_expression, row.timezone, after=current_aware
            )
            released = release_schedule_claim(
                db,
                row.uuid,
                worker_id=self.worker_id,
                lease_token=int(row.lease_token or 0),
                fired_at=current,
                next_fire_at=next_fire_at,
            )
            if released is None:
                raise RuntimeError("schedule_lease_lost")
            db.commit()
            return "skipped"

        if is_misfire and policy == "catch_up":
            # Process each missed occurrence with its own idempotency key.  A
            # bounded loop prevents an abandoned schedule from monopolizing a
            # worker; when the cap is reached, the next cursor stays due.
            occurrence = scheduled_fire_at
            processed = 0
            while True:
                self._dispatch_schedule_occurrence(db, row, occurrence)
                processed += 1
                following = next_schedule_fire_at(
                    row.cron_expression,
                    row.timezone,
                    after=occurrence.replace(tzinfo=UTC),
                )
                if following > current or processed >= MAX_CATCH_UP_FIRES:
                    next_fire_at = following
                    break
                occurrence = following
        else:
            # ``fire_once`` executes the oldest missed occurrence once; an
            # on-time schedule follows the same path.  Both advance to the
            # first cron occurrence after the current wall clock.
            self._dispatch_schedule_occurrence(db, row, scheduled_fire_at)
            next_fire_at = next_schedule_fire_at(
                row.cron_expression, row.timezone, after=current_aware
            )

        released = release_schedule_claim(
            db,
            row.uuid,
            worker_id=self.worker_id,
            lease_token=int(row.lease_token or 0),
            fired_at=current,
            next_fire_at=next_fire_at,
        )
        if released is None:
            raise RuntimeError("schedule_lease_lost")
        db.commit()
        return "dispatched"

    def _dispatch_schedule_occurrence(
        self, db: Session, row: WorkflowSchedule, scheduled_fire_at: datetime
    ) -> None:
        """Execute one schedule occurrence while retaining durable idempotency."""
        metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
        enterprise_scan = metadata.get("enterprise_insight_scan")
        if enterprise_scan is not None:
            self._dispatch_enterprise_insight_scan(
                db,
                row,
                enterprise_scan,
                scheduled_fire_at,
            )
            return
        idempotency_key = (
            f"{row.idempotency_prefix or f'schedule:{row.uuid}'}:"
            f"{scheduled_fire_at.isoformat()}"
        )
        runtime_service = WorkflowRunService(
            db,
            self.settings,
            worker_id=self.worker_id,
            lease_ttl_seconds=self.lease_ttl_seconds,
        )
        existing = runtime_service.find_idempotent_run(
            db,
            owner_user_id=str(row.owner_user_id),
            workflow_id=str(row.workflow_id),
            idempotency_key=idempotency_key,
        )
        if existing is None:
            runtime_service.start_and_run(
                workflow_id=str(row.workflow_id),
                owner_user_id=str(row.owner_user_id),
                input_text=str(metadata.get("input_text") or f"定时执行：{row.name}"),
                context=metadata.get("context") if isinstance(metadata.get("context"), dict) else {},
                routing_summary={
                    "source": "schedule",
                    "schedule_uuid": row.uuid,
                    "scheduled_fire_at": scheduled_fire_at.isoformat(),
                    "idempotency_key": idempotency_key,
                    "concurrency_policy": row.concurrency_policy,
                },
            )

    def _dispatch_enterprise_insight_scan(
        self,
        db: Session,
        row: WorkflowSchedule,
        metadata: Any,
        scheduled_fire_at: datetime,
    ) -> None:
        """Run an insight scan from a schedule-bound, frozen access scope."""

        if row.workflow_id != INSIGHT_SCAN_WORKFLOW_ID:
            raise ValueError("enterprise_insight_scan_workflow_id_invalid")
        if not isinstance(metadata, dict):
            raise ValueError("enterprise_insight_scan_metadata_invalid")
        organization_id = metadata.get("organization_id")
        scope_payload = metadata.get("scope")
        if isinstance(organization_id, bool) or not isinstance(organization_id, int):
            raise ValueError("enterprise_insight_scan_organization_invalid")
        if not isinstance(scope_payload, dict):
            raise ValueError("enterprise_insight_scan_scope_missing")
        owner_user_id = str(row.owner_user_id)
        if str(scope_payload.get("user_id") or "") != owner_user_id:
            raise RuntimeError("enterprise_insight_scan_owner_mismatch")
        role = str(scope_payload.get("role") or "").strip()
        if not role:
            raise ValueError("enterprise_insight_scan_role_missing")
        session = SessionPayload(
            user=UserPayload(
                id=owner_user_id,
                username=owner_user_id,
                role=role,
            ),
            scope=AuthScope(
                department=scope_payload.get("department"),
                managed_departments=scope_payload.get("managed_departments", []),
            ),
            apps=["ai-assistant"],
        )
        scope = EnterpriseAccessScope.from_session(session)
        if (
            scope.policy_version != scope_payload.get("policy_version")
            or scope.scope_fingerprint != scope_payload.get("scope_fingerprint")
        ):
            raise RuntimeError("enterprise_insight_scope_changed")
        source_version = str(metadata.get("source_version") or "project-task-v1").strip()
        if not source_version:
            raise ValueError("enterprise_insight_scan_source_version_missing")
        scan_overdue_insights(
            db,
            scope,
            organization_id,
            cutoff=scheduled_fire_at,
            source_version=source_version,
        )

    def _tick_events(self, db: Session, current: datetime, result: WorkerTick) -> None:
        try:
            candidates = list(
                db.scalars(
                    select(WorkflowTriggerInbox)
                    .where(WorkflowTriggerInbox.status.in_(["pending", "failed"]))
                    .order_by(WorkflowTriggerInbox.received_at.asc())
                    .limit(self.batch_size)
                )
            )
        except Exception as exc:
            db.rollback()
            self._record_error(result, "list_events", exc)
            return
        for candidate in candidates:
            claimed = claim_trigger_event(
                db,
                candidate.uuid,
                owner_user_id=str(candidate.owner_user_id),
                worker_id=self.worker_id,
                now=current,
                lease_ttl_seconds=self.lease_ttl_seconds,
            )
            if claimed is None:
                db.rollback()
                continue
            event, lease_token = claimed
            result.events_claimed += 1
            db.commit()
            try:
                self._dispatch_event(db, event, lease_token)
                result.events_processed += 1
            except Exception as exc:
                db.rollback()
                # A failed envelope remains retryable.  If fencing was lost,
                # this no-op is intentional and the newer worker owns it.
                failed = mark_trigger_processed(
                    db,
                    event.uuid,
                    error=str(exc)[:500],
                    worker_id=self.worker_id,
                    lease_token=lease_token,
                )
                db.commit()
                if failed is not None:
                    result.events_failed += 1
                self._record_error(result, f"event:{event.uuid}", exc)

    def _dispatch_event(self, db: Session, event: WorkflowTriggerInbox, lease_token: int) -> None:
        payload = event.payload_json if isinstance(event.payload_json, dict) else {}
        idempotency_key = f"trigger:{event.uuid}"
        runtime_service = WorkflowRunService(
            db,
            self.settings,
            worker_id=self.worker_id,
            lease_ttl_seconds=self.lease_ttl_seconds,
        )
        existing = runtime_service.find_idempotent_run(
            db,
            owner_user_id=str(event.owner_user_id),
            workflow_id=str(event.workflow_id),
            idempotency_key=idempotency_key,
            source="trigger_inbox",
        )
        if existing is None:
            _result, run = runtime_service.start_and_run(
                workflow_id=str(event.workflow_id),
                owner_user_id=str(event.owner_user_id),
                input_text=str(payload.get("input_text") or event.event_type),
                context=payload.get("context") if isinstance(payload.get("context"), dict) else payload,
                routing_summary={
                    "source": "trigger_inbox",
                    "event_uuid": event.uuid,
                    "idempotency_key": idempotency_key,
                },
            )
            run_id = run.uuid
        else:
            run_id = existing.uuid
        # Enterprise recommendation events are enqueue-only at the 5.0
        # boundary.  Once the generic workflow run exists, record its durable
        # owner without introducing provider or business-side effects here.
        from .enterprise_intelligence.insight_service import bind_recommendation_workflow_run

        bind_recommendation_workflow_run(db, payload, run_id)
        marked = mark_trigger_processed(
            db,
            event.uuid,
            run_id=run_id,
            worker_id=self.worker_id,
            lease_token=lease_token,
        )
        if marked is None:
            raise RuntimeError("event_lease_lost")
        db.commit()

    def _tick_notifications(self, db: Session, current: datetime, result: WorkerTick) -> None:
        try:
            rows = claim_notifications(
                db,
                worker_id=self.worker_id,
                now=current,
                lease_ttl_seconds=self.lease_ttl_seconds,
                limit=self.batch_size,
            )
            result.notifications_claimed = len(rows)
            db.commit()
        except Exception as exc:
            db.rollback()
            self._record_error(result, "claim_notifications", exc)
            return
        for row in rows:
            token = int(row.lease_token or 0)
            if self.notification_provider is not None:
                self._deliver_with_provider(db, row, token, result)
                continue
            try:
                delivered = self.notification_sender(row)
                if delivered is False:
                    raise RuntimeError("notification_sender_rejected")
                if not ack_notification(
                    db,
                    row.uuid,
                    worker_id=self.worker_id,
                    lease_token=token,
                ):
                    raise RuntimeError("notification_lease_lost")
                db.commit()
                result.notifications_sent += 1
            except Exception as exc:
                db.rollback()
                failed = fail_notification(
                    db,
                    row.uuid,
                    worker_id=self.worker_id,
                    lease_token=token,
                    error=str(exc)[:500],
                )
                db.commit()
                if failed:
                    result.notifications_retried += 1
                refreshed = db.get(WorkflowNotificationOutbox, row.id)
                if failed and refreshed is not None and refreshed.status == "reconciliation_required":
                    result.notifications_reconciliation_required += 1
                self._record_error(result, f"notification:{row.uuid}", exc)

    def _deliver_with_provider(
        self,
        db: Session,
        row: WorkflowNotificationOutbox,
        token: int,
        result: WorkerTick,
    ) -> None:
        """Deliver through an injected provider with explicit unknown semantics."""

        provider = self.notification_provider
        assert provider is not None
        provider_key = str(getattr(provider, "provider_key", "provider"))[:128]
        try:
            outcome = provider.send(row)
            if isinstance(outcome, bool):
                outcome = (
                    ProviderDeliveryResult.success(provider_key)
                    if outcome
                    else ProviderDeliveryResult.failed(provider_key)
                )
            if not isinstance(outcome, ProviderDeliveryResult):
                raise TypeError("provider_result_invalid")
        except ProviderOutcomeUnknown as exc:
            outcome = ProviderDeliveryResult.unknown(
                provider_key,
                error_code="provider_outcome_unknown",
                error_message=str(exc),
            )
        except Exception as exc:
            # A transport exception can happen after the provider applied the
            # effect.  Treat it as unknown, never as a blind retry.
            outcome = ProviderDeliveryResult.unknown(
                provider_key,
                error_code="provider_exception",
                error_message=str(exc),
            )

        metadata = outcome.as_metadata()
        metadata["phase"] = "send"
        metadata["reconciliation_required"] = outcome.outcome is ProviderOutcome.UNKNOWN
        if outcome.outcome is ProviderOutcome.UNKNOWN:
            marked = mark_notification_reconciliation_required(
                db,
                row.uuid,
                worker_id=self.worker_id,
                lease_token=token,
                error=outcome.error_message or outcome.error_code,
                provider_metadata=metadata,
            )
            db.commit()
            if marked:
                result.notifications_reconciliation_required += 1
            return

        self._store_provider_metadata(row, metadata)
        if outcome.outcome is ProviderOutcome.SUCCEEDED:
            if not ack_notification(
                db,
                row.uuid,
                worker_id=self.worker_id,
                lease_token=token,
            ):
                db.rollback()
                self._record_error(result, f"notification:{row.uuid}", RuntimeError("notification_lease_lost"))
                return
            db.commit()
            result.notifications_sent += 1
            return

        failed = fail_notification(
            db,
            row.uuid,
            worker_id=self.worker_id,
            lease_token=token,
            error=outcome.error_message or outcome.error_code,
        )
        if failed:
            refreshed = db.get(WorkflowNotificationOutbox, row.id)
            if refreshed is not None and refreshed.status == "reconciliation_required":
                self._store_provider_metadata(
                    refreshed,
                    {"reconciliation_required": True, "phase": "send"},
                )
                result.notifications_reconciliation_required += 1
            result.notifications_retried += 1
        db.commit()

    @staticmethod
    def _store_provider_metadata(
        row: WorkflowNotificationOutbox,
        metadata: dict[str, Any],
    ) -> None:
        payload = dict(row.payload_json) if isinstance(row.payload_json, dict) else {}
        previous = payload.get("_provider_reconciliation")
        merged = dict(previous) if isinstance(previous, dict) else {}
        merged.update(metadata)
        payload["_provider_reconciliation"] = merged
        row.payload_json = payload

    def reconcile_notification(
        self,
        db: Session,
        notification_uuid: str,
    ) -> ProviderDeliveryResult:
        """Query an unknown provider result; this method never calls ``send``."""

        if self.notification_provider is None:
            raise RuntimeError("notification_provider_not_configured")
        row = db.scalar(
            select(WorkflowNotificationOutbox).where(
                WorkflowNotificationOutbox.uuid == notification_uuid,
            )
        )
        if row is None:
            raise LookupError("notification_not_found")
        provider = self.notification_provider
        provider_key = str(getattr(provider, "provider_key", "provider"))[:128]
        if row.status != "reconciliation_required":
            return ProviderDeliveryResult.unknown(
                provider_key,
                error_code="notification_not_reconciliation_required",
            )
        try:
            outcome = provider.reconcile(row)
            if not isinstance(outcome, ProviderDeliveryResult):
                raise TypeError("provider_result_invalid")
        except Exception as exc:
            outcome = ProviderDeliveryResult.unknown(
                provider_key,
                error_code="provider_reconciliation_exception",
                error_message=str(exc),
            )
        metadata = outcome.as_metadata()
        metadata["phase"] = "reconcile"
        metadata["reconciliation_required"] = outcome.outcome is not ProviderOutcome.SUCCEEDED
        resolve_notification_reconciliation(
            db,
            row.uuid,
            outcome=outcome.outcome.value,
            provider_metadata=metadata,
            error=outcome.error_message or outcome.error_code,
        )
        return outcome

    @staticmethod
    def _record_error(result: WorkerTick, scope: str, exc: Exception) -> None:
        message = f"{scope}:{str(exc)[:200]}"
        result.errors.append(message)
        logger.warning("workflow control worker tick error: %s", message)


async def workflow_control_scheduler(settings: Settings) -> None:
    """Continuously run the local worker while its feature flag is enabled."""

    worker = WorkflowControlWorker(settings)
    while True:
        try:
            await workflow_control_scheduler_step(settings, worker=worker)
            flags = load_feature_flags(settings)
            interval = max(1, min(int(flags.get("workflow_worker_interval_seconds") or 5), 300))
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("workflow control worker tick failed")
            await asyncio.sleep(1)


async def workflow_control_scheduler_step(
    settings: Settings,
    *,
    worker: WorkflowControlWorker | None = None,
) -> bool:
    """Run one feature-flagged poll, returning whether a tick was executed.

    Keeping the switch at this boundary makes the disabled path deterministic:
    no database session is opened and no worker tick is dispatched until the
    operator explicitly enables ``workflow_control_worker``.
    """

    flags = load_feature_flags(settings)
    if not bool(flags.get("workflow_control_worker", False)):
        return False
    active_worker = worker or WorkflowControlWorker(settings)
    active_worker.batch_size = max(1, min(int(flags.get("workflow_worker_batch") or 20), 500))
    with SessionLocal() as db:
        await asyncio.to_thread(active_worker.tick, db)
    return True


__all__ = [
    "WorkerTick",
    "WorkflowControlWorker",
    "local_notification_sink",
    "workflow_control_scheduler",
    "workflow_control_scheduler_step",
]
