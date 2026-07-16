"""Owner-scoped read model for enterprise insight notifications."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import WorkflowNotificationOutbox
from .access import EnterpriseAccessScope


@dataclass(frozen=True)
class EnterpriseNotificationList:
    items: list[dict[str, object]]
    total: int
    unread_count: int


def _require_view(scope: EnterpriseAccessScope) -> None:
    if not scope.can("intelligence:view"):
        raise PermissionError("当前身份无企业智能中枢访问权限")


def _is_enterprise_insight(row: WorkflowNotificationOutbox) -> bool:
    payload = row.payload_json if isinstance(row.payload_json, dict) else {}
    return payload.get("source") == "enterprise_insight"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _payload(row: WorkflowNotificationOutbox) -> dict[str, object]:
    payload = row.payload_json if isinstance(row.payload_json, dict) else {}
    # Deliberately project a stable, non-provider-facing contract instead of
    # returning the entire workflow payload to the desktop client.
    return {
        "notification_uuid": row.uuid,
        "insight_uuid": str(payload.get("insight_uuid") or ""),
        "insight_type": str(payload.get("insight_type") or ""),
        "title": str(payload.get("title") or "企业智能提醒"),
        "summary": str(payload.get("summary") or ""),
        "severity": str(payload.get("severity") or "low"),
        "project_uuid": str(payload.get("project_uuid") or ""),
        "task_uuid": str(payload.get("task_uuid") or ""),
        "status": row.status,
        "delivery_status": row.status,
        "attempts": int(row.attempts or 0),
        "unread": row.read_at is None,
        "created_at": _iso(row.created_at),
        "sent_at": _iso(row.sent_at),
        "read_at": _iso(row.read_at),
        "data_cutoff_at": str(payload.get("data_cutoff_at") or ""),
        "data_version": str(payload.get("data_version") or ""),
        "last_error": row.last_error,
    }


def list_enterprise_notifications(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    unread_only: bool = False,
    limit: int = 20,
) -> EnterpriseNotificationList:
    _require_view(scope)
    limit = max(1, min(int(limit), 100))
    rows = list(
        db.scalars(
            select(WorkflowNotificationOutbox)
            .where(
                WorkflowNotificationOutbox.owner_user_id == scope.user_id,
                WorkflowNotificationOutbox.channel == "in_app",
                WorkflowNotificationOutbox.payload_json["source"].as_string()
                == "enterprise_insight",
            )
            .order_by(
                WorkflowNotificationOutbox.created_at.desc(),
                WorkflowNotificationOutbox.uuid.desc(),
            )
        )
    )
    if unread_only:
        rows = [row for row in rows if row.read_at is None]
    total = len(rows)
    unread_count = sum(row.read_at is None for row in rows)
    return EnterpriseNotificationList(
        items=[_payload(row) for row in rows[:limit]],
        total=total,
        unread_count=unread_count,
    )


def mark_enterprise_notification_read(
    db: Session,
    scope: EnterpriseAccessScope,
    notification_uuid: str,
) -> tuple[WorkflowNotificationOutbox, bool]:
    _require_view(scope)
    row = db.scalar(
        select(WorkflowNotificationOutbox).where(
            WorkflowNotificationOutbox.uuid == notification_uuid,
            WorkflowNotificationOutbox.owner_user_id == scope.user_id,
            WorkflowNotificationOutbox.channel == "in_app",
        )
    )
    if row is None or not _is_enterprise_insight(row):
        raise LookupError("企业通知不存在")
    if row.read_at is not None:
        return row, True
    row.read_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.read_by_user_id = scope.user_id
    db.flush()
    return row, False


def notification_payload(row: WorkflowNotificationOutbox) -> dict[str, object]:
    return _payload(row)
