from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import sanitize_metadata
from ..governance_models import AuditLog
from .schemas import AuditLogListOut, AuditLogOut


@dataclass(frozen=True, slots=True)
class AuditFilters:
    action: str | None = None
    entity_type: str | None = None
    entity_uuid: str | None = None
    username: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


def query_audit_logs(
    db: Session,
    filters: AuditFilters,
    *,
    offset: int,
    limit: int,
) -> AuditLogListOut:
    conditions = []
    if filters.action:
        conditions.append(AuditLog.action == filters.action)
    if filters.entity_type:
        conditions.append(AuditLog.entity_type == filters.entity_type)
    if filters.entity_uuid:
        conditions.append(AuditLog.entity_uuid == filters.entity_uuid)
    if filters.username:
        conditions.append(
            AuditLog.username_snapshot.ilike(f"%{filters.username}%")
        )
    if filters.created_from:
        conditions.append(AuditLog.created_at >= filters.created_from)
    if filters.created_to:
        conditions.append(AuditLog.created_at <= filters.created_to)

    total = db.scalar(
        select(func.count(AuditLog.id)).where(*conditions)
    ) or 0
    rows = db.scalars(
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return AuditLogListOut(
        items=[
            AuditLogOut(
                id=row.id,
                sso_user_id=row.sso_user_id,
                username_snapshot=row.username_snapshot,
                action=row.action,
                entity_type=row.entity_type,
                entity_uuid=row.entity_uuid,
                result=row.result,
                metadata_json=sanitize_metadata(row.metadata_json or {}),
                created_at=row.created_at,
            )
            for row in rows
        ],
        total=total,
    )
