"""Durable control-plane primitives for workflow schedules and side effects.

The module deliberately stops at local, auditable state transitions.  A real
provider worker can be attached later without changing the idempotency,
lease, or recovery contract.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import secrets
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Any

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import (
    WorkflowNotificationOutbox,
    WorkflowSchedule,
    WorkflowTriggerInbox,
    WorkflowWait,
)


def _now(value: datetime | None = None) -> datetime:
    value = value or datetime.now(UTC)
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _lease_available(owner: str, expires_at: datetime | None, now: datetime) -> bool:
    return not owner or expires_at is None or expires_at <= now


def _validate_timezone(value: str) -> str:
    timezone = str(value or "UTC").strip()
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("invalid_timezone") from exc
    return timezone


def _validate_cron_expression(value: str) -> str:
    """Validate the numeric five-field cron subset before persisting it.

    ``next_schedule_fire_at`` is intentionally a small, dependency-free
    parser.  Validating at write time prevents a malformed schedule from being
    accepted and then failing on every worker tick indefinitely.
    """

    expression = str(value or "").strip()
    fields = expression.split()
    if len(fields) != 5:
        raise ValueError("cron_expression_invalid")
    bounds = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
    for field, (minimum, maximum) in zip(fields, bounds, strict=True):
        for token in field.split(","):
            token = token.strip()
            if not token:
                raise ValueError("cron_expression_invalid")
            base, separator, step_text = token.partition("/")
            if separator:
                if not step_text.isdigit() or int(step_text) <= 0:
                    raise ValueError("cron_expression_invalid")
            if base == "*":
                continue
            if "-" in base:
                parts = base.split("-", 1)
                if len(parts) != 2 or not all(part.isdigit() for part in parts):
                    raise ValueError("cron_expression_invalid")
                start, end = (int(part) for part in parts)
            elif base.isdigit():
                start = end = int(base)
            else:
                raise ValueError("cron_expression_invalid")
            if not (minimum <= start <= maximum and minimum <= end <= maximum and start <= end):
                raise ValueError("cron_expression_invalid")
    return expression


def create_schedule(
    db: Session,
    *,
    owner_user_id: str,
    workflow_id: str,
    name: str,
    cron_expression: str,
    timezone: str = "UTC",
    next_fire_at: datetime | None = None,
    misfire_policy: str = "skip",
    catch_up: bool = False,
    concurrency_policy: str = "forbid",
    idempotency_prefix: str = "",
    metadata: dict | None = None,
) -> WorkflowSchedule:
    if not owner_user_id or not workflow_id or not name:
        raise ValueError("schedule_identity_required")
    if not cron_expression.strip():
        raise ValueError("cron_expression_required")
    cron_expression = _validate_cron_expression(cron_expression)
    timezone = _validate_timezone(timezone)
    if misfire_policy not in {"skip", "fire_once", "catch_up"}:
        raise ValueError("invalid_misfire_policy")
    if concurrency_policy not in {"forbid", "allow", "replace"}:
        raise ValueError("invalid_concurrency_policy")
    row = WorkflowSchedule(
        uuid=str(uuid4()),
        owner_user_id=str(owner_user_id),
        workflow_id=str(workflow_id),
        name=str(name).strip()[:128],
        cron_expression=str(cron_expression).strip()[:128],
        timezone=timezone,
        enabled=True,
        misfire_policy=misfire_policy,
        catch_up=bool(catch_up),
        concurrency_policy=concurrency_policy,
        next_fire_at=_now(next_fire_at) if next_fire_at else None,
        idempotency_prefix=(idempotency_prefix or f"schedule:{owner_user_id}:{workflow_id}")[:128],
        metadata_json=metadata if isinstance(metadata, dict) else {},
    )
    db.add(row)
    db.flush()
    return row


def update_schedule(
    db: Session,
    schedule_uuid: str,
    *,
    owner_user_id: str,
    changes: dict[str, Any],
) -> WorkflowSchedule | None:
    """Apply an owner-scoped, validated schedule patch.

    The helper accepts a sparse mapping so API callers can distinguish an
    omitted field from an explicit ``null`` (for example, clearing a stale
    ``next_fire_at`` while disabling a schedule).  Unknown fields fail closed.
    """

    row = db.scalar(select(WorkflowSchedule).where(
        WorkflowSchedule.uuid == schedule_uuid,
        WorkflowSchedule.owner_user_id == str(owner_user_id),
    ))
    if row is None:
        return None
    allowed = {
        "name",
        "cron_expression",
        "timezone",
        "next_fire_at",
        "misfire_policy",
        "catch_up",
        "concurrency_policy",
        "idempotency_prefix",
        "metadata",
    }
    unknown = set(changes) - allowed
    if unknown:
        raise ValueError("invalid_schedule_patch")
    if "name" in changes:
        name = str(changes["name"] or "").strip()
        if not name:
            raise ValueError("schedule_name_required")
        row.name = name[:128]
    if "cron_expression" in changes:
        expression = str(changes["cron_expression"] or "").strip()
        if not expression:
            raise ValueError("cron_expression_required")
        row.cron_expression = _validate_cron_expression(expression)[:128]
    if "timezone" in changes:
        row.timezone = _validate_timezone(str(changes["timezone"] or "UTC"))
    if "next_fire_at" in changes:
        value = changes["next_fire_at"]
        row.next_fire_at = _now(value) if isinstance(value, datetime) else None
    if "misfire_policy" in changes:
        value = str(changes["misfire_policy"] or "").strip()
        if value not in {"skip", "fire_once", "catch_up"}:
            raise ValueError("invalid_misfire_policy")
        row.misfire_policy = value
    if "catch_up" in changes:
        row.catch_up = bool(changes["catch_up"])
    if "concurrency_policy" in changes:
        value = str(changes["concurrency_policy"] or "").strip()
        if value not in {"forbid", "allow", "replace"}:
            raise ValueError("invalid_concurrency_policy")
        row.concurrency_policy = value
    if "idempotency_prefix" in changes:
        row.idempotency_prefix = str(changes["idempotency_prefix"] or "")[:128]
    if "metadata" in changes:
        value = changes["metadata"]
        if not isinstance(value, dict):
            raise ValueError("invalid_schedule_metadata")
        row.metadata_json = value
    db.flush()
    return row


def set_schedule_enabled(
    db: Session,
    schedule_uuid: str,
    *,
    owner_user_id: str,
    enabled: bool,
    now: datetime | None = None,
) -> WorkflowSchedule | None:
    """Enable/disable a schedule without bypassing owner isolation."""

    row = db.scalar(select(WorkflowSchedule).where(
        WorkflowSchedule.uuid == schedule_uuid,
        WorkflowSchedule.owner_user_id == str(owner_user_id),
    ))
    if row is None:
        return None
    row.enabled = bool(enabled)
    if row.enabled and row.next_fire_at is None:
        # Enabling a schedule with no cursor starts at the next valid cron
        # occurrence, never immediately at an arbitrary wall-clock instant.
        row.next_fire_at = next_schedule_fire_at(
            row.cron_expression,
            row.timezone,
            after=_now(now).replace(tzinfo=UTC),
        )
    db.flush()
    return row


def claim_due_schedules(
    db: Session,
    *,
    worker_id: str,
    owner_user_id: str | None = None,
    now: datetime | None = None,
    lease_ttl_seconds: int = 30,
    limit: int = 50,
) -> list[WorkflowSchedule]:
    if not worker_id:
        raise ValueError("worker_id_required")
    current = _now(now)
    rows = list(db.scalars(
        select(WorkflowSchedule)
        .where(
            WorkflowSchedule.enabled.is_(True),
            *([WorkflowSchedule.owner_user_id == owner_user_id] if owner_user_id else []),
            WorkflowSchedule.next_fire_at.is_not(None),
            WorkflowSchedule.next_fire_at <= current,
            or_(
                WorkflowSchedule.lease_owner == "",
                WorkflowSchedule.lease_expires_at.is_(None),
                WorkflowSchedule.lease_expires_at <= current,
            ),
        )
        .order_by(WorkflowSchedule.next_fire_at.asc())
        .limit(max(1, min(int(limit), 500)))
    ))
    claimed: list[WorkflowSchedule] = []
    for row in rows:
        # The conditional UPDATE is the actual fence.  Two workers may read
        # the same due row, but only one can change an available lease.
        updated = db.execute(
            update(WorkflowSchedule)
            .where(
                WorkflowSchedule.uuid == row.uuid,
                or_(
                    WorkflowSchedule.lease_owner == "",
                    WorkflowSchedule.lease_expires_at.is_(None),
                    WorkflowSchedule.lease_expires_at <= current,
                ),
            )
            .values(
                lease_owner=worker_id,
                lease_token=func.coalesce(WorkflowSchedule.lease_token, 0) + 1,
                lease_expires_at=current + timedelta(seconds=max(5, int(lease_ttl_seconds))),
            )
        ).rowcount
        if updated:
            db.refresh(row)
            claimed.append(row)
    return claimed


def _cron_field_matches(field: str, value: int, minimum: int, maximum: int) -> bool:
    """Match the bounded cron subset used by the durable scheduler."""
    for token in str(field).split(","):
        token = token.strip()
        if not token:
            continue
        if token == "*":
            return True
        base, _, step_text = token.partition("/")
        try:
            step = max(1, int(step_text)) if step_text else 1
        except ValueError:
            continue
        if base == "*":
            start, end = minimum, maximum
        elif "-" in base:
            left, right = base.split("-", 1)
            try:
                start, end = int(left), int(right)
            except ValueError:
                continue
        else:
            try:
                start = end = int(base)
            except ValueError:
                continue
        if minimum <= start <= maximum and start <= value <= min(end, maximum):
            if (value - start) % step == 0:
                return True
    return False


def next_schedule_fire_at(
    cron_expression: str,
    timezone: str,
    *,
    after: datetime | None = None,
    search_minutes: int = 366 * 24 * 60,
) -> datetime:
    """Return the next UTC fire time for a safe five-field cron subset.

    The parser intentionally supports only numeric values, ranges, lists and
    steps.  Rejecting unsupported expressions is safer than silently firing a
    schedule at the wrong time; a production scheduler may replace this
    helper while keeping the same durable lease contract.
    """
    fields = str(cron_expression or "").split()
    if len(fields) != 5:
        raise ValueError("cron_expression_invalid")
    tz_name = _validate_timezone(timezone)
    tz = ZoneInfo(tz_name)
    current = (after or datetime.now(UTC)).astimezone(UTC)
    local = current.astimezone(tz).replace(second=0, microsecond=0, tzinfo=None)
    dom_restricted = fields[2] != "*"
    dow_restricted = fields[4] != "*"
    for offset in range(1, max(1, int(search_minutes)) + 1):
        candidate = local + timedelta(minutes=offset)
        cron_dow = (candidate.weekday() + 1) % 7
        minute_ok = _cron_field_matches(fields[0], candidate.minute, 0, 59)
        hour_ok = _cron_field_matches(fields[1], candidate.hour, 0, 23)
        month_ok = _cron_field_matches(fields[3], candidate.month, 1, 12)
        dom_ok = _cron_field_matches(fields[2], candidate.day, 1, 31)
        dow_ok = _cron_field_matches(fields[4], cron_dow, 0, 7) or (
            cron_dow == 0 and _cron_field_matches(fields[4], 7, 0, 7)
        )
        day_ok = (dom_ok or dow_ok) if dom_restricted and dow_restricted else dom_ok and dow_ok
        if minute_ok and hour_ok and month_ok and day_ok:
            aware = candidate.replace(tzinfo=tz)
            return aware.astimezone(UTC).replace(tzinfo=None)
    raise ValueError("cron_next_fire_not_found")


def release_schedule_claim(
    db: Session,
    schedule_uuid: str,
    *,
    worker_id: str,
    lease_token: int | None = None,
    next_fire_at: datetime | None = None,
    fired_at: datetime | None = None,
) -> WorkflowSchedule | None:
    row = db.scalar(select(WorkflowSchedule).where(WorkflowSchedule.uuid == schedule_uuid))
    if row is None or row.lease_owner != worker_id:
        return None
    # A worker may lose and later reacquire the same schedule lease.  Keep the
    # token as a fencing boundary so an old in-flight dispatch cannot advance
    # the schedule after the lease has been reclaimed.
    if lease_token is not None and int(row.lease_token or 0) != int(lease_token):
        return None
    row.lease_owner = ""
    row.lease_expires_at = None
    if fired_at is not None:
        row.last_fire_at = _now(fired_at)
    if next_fire_at is not None:
        row.next_fire_at = _now(next_fire_at)
    db.flush()
    return row


def enqueue_trigger_event(
    db: Session,
    *,
    owner_user_id: str,
    workflow_id: str,
    event_type: str,
    event_key: str,
    payload: dict | None = None,
) -> tuple[WorkflowTriggerInbox, bool]:
    if not owner_user_id or not event_type or not event_key:
        raise ValueError("trigger_identity_required")
    existing = db.scalar(select(WorkflowTriggerInbox).where(
        WorkflowTriggerInbox.owner_user_id == owner_user_id,
        WorkflowTriggerInbox.event_type == event_type,
        WorkflowTriggerInbox.event_key == event_key,
    ))
    if existing is not None:
        return existing, True
    row = WorkflowTriggerInbox(
        uuid=str(uuid4()),
        owner_user_id=str(owner_user_id),
        workflow_id=str(workflow_id),
        event_type=str(event_type)[:96],
        event_key=str(event_key)[:128],
        payload_json=payload if isinstance(payload, dict) else {},
        status="pending",
        received_at=_now(),
    )
    try:
        # The unique key is the source of truth under concurrent requests;
        # the pre-read above is only a fast path.  A savepoint lets us recover
        # from a duplicate without poisoning the caller's transaction.
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        existing = db.scalar(select(WorkflowTriggerInbox).where(
            WorkflowTriggerInbox.owner_user_id == owner_user_id,
            WorkflowTriggerInbox.event_type == event_type,
            WorkflowTriggerInbox.event_key == event_key,
        ))
        if existing is not None:
            return existing, True
        raise
    return row, False


def claim_trigger_event(
    db: Session,
    event_uuid: str,
    *,
    owner_user_id: str,
    worker_id: str,
    now: datetime | None = None,
    lease_ttl_seconds: int = 30,
) -> tuple[WorkflowTriggerInbox, int] | None:
    """Claim a trigger envelope with a fenced, recoverable processing lease."""

    if not event_uuid or not owner_user_id:
        raise ValueError("trigger_identity_required")
    if not worker_id:
        raise ValueError("worker_id_required")
    current = _now(now)
    row = db.scalar(select(WorkflowTriggerInbox).where(
        WorkflowTriggerInbox.uuid == event_uuid,
        WorkflowTriggerInbox.owner_user_id == owner_user_id,
    ))
    if row is None:
        return None
    updated = db.execute(
        update(WorkflowTriggerInbox)
        .where(
            WorkflowTriggerInbox.uuid == event_uuid,
            WorkflowTriggerInbox.owner_user_id == owner_user_id,
            or_(
                WorkflowTriggerInbox.status.in_(["pending", "failed"]),
                and_(
                    WorkflowTriggerInbox.status == "processing",
                    WorkflowTriggerInbox.lease_expires_at.is_not(None),
                    WorkflowTriggerInbox.lease_expires_at <= current,
                ),
            ),
        )
        .values(
            status="processing",
            lease_owner=str(worker_id)[:128],
            lease_token=func.coalesce(WorkflowTriggerInbox.lease_token, 0) + 1,
            lease_expires_at=current + timedelta(seconds=max(5, int(lease_ttl_seconds))),
            error_message="",
            processed_at=None,
        )
    ).rowcount
    if not updated:
        return None
    db.refresh(row)
    return row, int(row.lease_token or 0)


def recover_stuck_trigger_events(
    db: Session,
    *,
    owner_user_id: str | None = None,
    now: datetime | None = None,
    limit: int = 100,
) -> int:
    """Return expired processing envelopes to pending for a later worker."""

    current = _now(now)
    rows = list(db.scalars(
        select(WorkflowTriggerInbox)
        .where(
            WorkflowTriggerInbox.status == "processing",
            WorkflowTriggerInbox.lease_expires_at.is_not(None),
            WorkflowTriggerInbox.lease_expires_at <= current,
            *([WorkflowTriggerInbox.owner_user_id == owner_user_id] if owner_user_id else []),
        )
        .order_by(WorkflowTriggerInbox.received_at.asc())
        .limit(max(1, min(int(limit), 500)))
    ))
    recovered = 0
    for row in rows:
        updated = db.execute(
            update(WorkflowTriggerInbox)
            .where(
                WorkflowTriggerInbox.uuid == row.uuid,
                WorkflowTriggerInbox.status == "processing",
                WorkflowTriggerInbox.lease_expires_at <= current,
            )
            .values(
                status="pending",
                lease_owner="",
                lease_expires_at=None,
                processed_at=None,
                error_message="recovered_stuck_processing",
            )
        ).rowcount
        recovered += int(updated or 0)
    return recovered


def mark_trigger_processed(
    db: Session,
    event_uuid: str,
    *,
    run_id: str = "",
    error: str = "",
    worker_id: str | None = None,
    lease_token: int | None = None,
) -> WorkflowTriggerInbox | None:
    row = db.scalar(select(WorkflowTriggerInbox).where(WorkflowTriggerInbox.uuid == event_uuid))
    if row is None:
        return None
    if worker_id is not None:
        if row.status != "processing" or row.lease_owner != worker_id:
            return None
        if lease_token is not None and int(row.lease_token or 0) != int(lease_token):
            return None
    row.run_id = str(run_id or "")
    row.status = "failed" if error else "processed"
    row.error_message = str(error or "")[:500]
    row.processed_at = _now()
    row.lease_owner = ""
    row.lease_expires_at = None
    db.flush()
    return row


def enqueue_notification(
    db: Session,
    *,
    owner_user_id: str,
    run_id: str,
    node_id: str,
    idempotency_key: str,
    channel: str,
    recipient: str,
    payload: dict | None = None,
) -> tuple[WorkflowNotificationOutbox, bool]:
    if not owner_user_id or not run_id or not node_id or not idempotency_key:
        raise ValueError("notification_identity_required")
    existing = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.run_id == run_id,
        WorkflowNotificationOutbox.node_id == node_id,
        WorkflowNotificationOutbox.idempotency_key == idempotency_key,
    ))
    if existing is not None:
        return existing, True
    row = WorkflowNotificationOutbox(
        uuid=str(uuid4()),
        owner_user_id=str(owner_user_id),
        run_id=str(run_id),
        node_id=str(node_id)[:48],
        idempotency_key=str(idempotency_key)[:128],
        channel=str(channel or "in_app")[:32],
        recipient=str(recipient or "")[:255],
        payload_json=payload if isinstance(payload, dict) else {},
        status="pending",
        next_attempt_at=_now(),
    )
    db.add(row)
    db.flush()
    return row, False


def claim_notifications(
    db: Session,
    *,
    worker_id: str,
    owner_user_id: str | None = None,
    now: datetime | None = None,
    lease_ttl_seconds: int = 30,
    limit: int = 50,
) -> list[WorkflowNotificationOutbox]:
    current = _now(now)
    rows = list(db.scalars(
        select(WorkflowNotificationOutbox)
        .where(
            WorkflowNotificationOutbox.status == "pending",
            *([WorkflowNotificationOutbox.owner_user_id == owner_user_id] if owner_user_id else []),
            or_(
                WorkflowNotificationOutbox.next_attempt_at.is_(None),
                WorkflowNotificationOutbox.next_attempt_at <= current,
            ),
            or_(
                WorkflowNotificationOutbox.lease_owner == "",
                WorkflowNotificationOutbox.lease_expires_at.is_(None),
                WorkflowNotificationOutbox.lease_expires_at <= current,
            ),
        )
        .order_by(WorkflowNotificationOutbox.created_at.asc())
        .limit(max(1, min(int(limit), 500)))
    ))
    claimed: list[WorkflowNotificationOutbox] = []
    for row in rows:
        updated = db.execute(
            update(WorkflowNotificationOutbox)
            .where(
                WorkflowNotificationOutbox.uuid == row.uuid,
                WorkflowNotificationOutbox.status == "pending",
                or_(
                    WorkflowNotificationOutbox.next_attempt_at.is_(None),
                    WorkflowNotificationOutbox.next_attempt_at <= current,
                ),
                or_(
                    WorkflowNotificationOutbox.lease_owner == "",
                    WorkflowNotificationOutbox.lease_expires_at.is_(None),
                    WorkflowNotificationOutbox.lease_expires_at <= current,
                ),
            )
            .values(
                lease_owner=worker_id,
                lease_token=func.coalesce(WorkflowNotificationOutbox.lease_token, 0) + 1,
                lease_expires_at=current + timedelta(seconds=max(5, int(lease_ttl_seconds))),
                attempts=func.coalesce(WorkflowNotificationOutbox.attempts, 0) + 1,
            )
        ).rowcount
        if updated:
            db.refresh(row)
            claimed.append(row)
    return claimed


def ack_notification(
    db: Session,
    notification_uuid: str,
    *,
    worker_id: str,
    lease_token: int | None = None,
) -> bool:
    row = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    if row is None or row.lease_owner != worker_id or row.status != "pending":
        return False
    if lease_token is not None and int(row.lease_token or 0) != int(lease_token):
        return False
    row.status = "sent"
    row.sent_at = _now()
    row.lease_owner = ""
    row.lease_expires_at = None
    db.flush()
    return True


def fail_notification(
    db: Session,
    notification_uuid: str,
    *,
    worker_id: str,
    lease_token: int | None = None,
    error: str,
    max_attempts: int = 3,
) -> bool:
    row = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    if row is None or row.lease_owner != worker_id or row.status != "pending":
        return False
    if lease_token is not None and int(row.lease_token or 0) != int(lease_token):
        return False
    row.last_error = str(error or "notification_failed")[:500]
    if int(row.attempts or 0) >= max(1, int(max_attempts)):
        row.status = "reconciliation_required"
        row.next_attempt_at = None
    else:
        row.status = "pending"
        row.next_attempt_at = _now() + timedelta(seconds=min(300, 2 ** max(0, int(row.attempts or 1))))
    row.lease_owner = ""
    row.lease_expires_at = None
    db.flush()
    return True


def _merge_provider_metadata(
    row: WorkflowNotificationOutbox,
    provider_metadata: dict | None,
) -> None:
    """Persist provider state without replacing the business payload."""

    if not isinstance(provider_metadata, dict):
        return
    payload = dict(row.payload_json) if isinstance(row.payload_json, dict) else {}
    existing = payload.get("_provider_reconciliation")
    merged = dict(existing) if isinstance(existing, dict) else {}
    # Provider adapters are untrusted boundaries; only a small JSON object is
    # retained in the Outbox so errors/receipts cannot grow without bound.
    for key, value in provider_metadata.items():
        if key in {"receipt", "error_message"} and isinstance(value, str):
            merged[key] = value[:500]
        elif key == "receipt" and isinstance(value, dict):
            merged[key] = {str(k)[:64]: str(v)[:500] for k, v in list(value.items())[:20]}
        elif isinstance(value, (str, int, float, bool)) or value is None:
            merged[str(key)[:64]] = value
    payload["_provider_reconciliation"] = merged
    row.payload_json = payload


def mark_notification_reconciliation_required(
    db: Session,
    notification_uuid: str,
    *,
    worker_id: str,
    lease_token: int | None = None,
    error: str = "provider_outcome_unknown",
    provider_metadata: dict | None = None,
) -> bool:
    """Stop retries when a provider cannot confirm whether it applied an effect."""

    row = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    if row is None or row.lease_owner != worker_id or row.status != "pending":
        return False
    if lease_token is not None and int(row.lease_token or 0) != int(lease_token):
        return False
    row.last_error = str(error or "provider_outcome_unknown")[:500]
    row.status = "reconciliation_required"
    row.next_attempt_at = None
    row.lease_owner = ""
    row.lease_expires_at = None
    _merge_provider_metadata(row, provider_metadata)
    db.flush()
    return True


def resolve_notification_reconciliation(
    db: Session,
    notification_uuid: str,
    *,
    outcome: str,
    provider_metadata: dict | None = None,
    error: str = "",
) -> bool:
    """Apply an explicit provider reconciliation answer.

    A failed or still-unknown query intentionally remains
    ``reconciliation_required``; only a confirmed success can mark an effect
    as sent.  This prevents a worker from guessing and issuing a duplicate.
    """

    row = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    if row is None or row.status != "reconciliation_required":
        return False
    normalized = str(outcome or "unknown").strip().lower()
    if normalized == "success":
        normalized = "succeeded"
    if normalized not in {"succeeded", "failed", "unknown"}:
        raise ValueError("invalid_provider_outcome")
    _merge_provider_metadata(row, provider_metadata)
    if normalized == "succeeded":
        row.status = "sent"
        row.sent_at = _now()
        row.last_error = ""
        row.next_attempt_at = None
        row.lease_owner = ""
        row.lease_expires_at = None
    else:
        row.status = "reconciliation_required"
        row.next_attempt_at = None
        if error:
            row.last_error = str(error)[:500]
    db.flush()
    return True


def create_wait(
    db: Session,
    *,
    owner_user_id: str,
    run_id: str,
    node_id: str,
    wait_key: str,
    signal_key: str = "",
    resume_at: datetime | None = None,
    resume_expires_at: datetime | None = None,
    resume_token: str | None = None,
    payload: dict | None = None,
) -> tuple[WorkflowWait, bool]:
    existing = db.scalar(select(WorkflowWait).where(
        WorkflowWait.run_id == run_id,
        WorkflowWait.node_id == node_id,
        WorkflowWait.wait_key == wait_key,
    ))
    if existing is not None:
        return existing, False
    token = str(resume_token or secrets.token_urlsafe(32))
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    row = WorkflowWait(
        uuid=str(uuid4()),
        owner_user_id=str(owner_user_id),
        run_id=str(run_id),
        node_id=str(node_id)[:48],
        wait_key=str(wait_key)[:128],
        signal_key=str(signal_key or "")[:128],
        status="waiting",
        resume_at=_now(resume_at) if resume_at else None,
        payload_json=payload if isinstance(payload, dict) else {},
        resume_token_hash=token_hash,
        resume_expires_at=_now(resume_expires_at) if resume_expires_at else _now() + timedelta(hours=24),
    )
    # The plaintext token is intentionally transient; route/list serializers
    # never read it from a persisted row.
    row._resume_token_plain = token
    row.resume_token = token
    db.add(row)
    db.flush()
    return row, True


def resume_wait(
    db: Session,
    wait_uuid: str,
    *,
    owner_user_id: str,
    resumed_by: str,
    payload: dict | None = None,
    resume_token: str = "",
    now: datetime | None = None,
) -> WorkflowWait | None:
    row = db.scalar(select(WorkflowWait).where(
        WorkflowWait.uuid == wait_uuid,
        WorkflowWait.owner_user_id == owner_user_id,
    ))
    if row is None or row.status != "waiting":
        return None
    current = _now(now)
    if row.resume_expires_at is not None and row.resume_expires_at <= current:
        return None
    # Keep pre-token clients replay-compatible during the rollout.  New
    # clients receive a token and can provide it to get explicit fencing;
    # expiry and the one-time status transition still apply to every wait.
    if row.resume_token_hash and resume_token:
        candidate = hashlib.sha256(str(resume_token or "").encode("utf-8")).hexdigest()
        if not hmac.compare_digest(candidate, row.resume_token_hash):
            return None
    row.status = "resumed"
    row.resumed_by = str(resumed_by)[:64]
    row.resumed_at = _now()
    row.payload_json = payload if isinstance(payload, dict) else (row.payload_json or {})
    db.flush()
    return row
