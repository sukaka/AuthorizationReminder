from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..admin.schemas import AuditLogListOut, AuditLogOut
from ..audit import sanitize_metadata
from ..governance_models import AuditLog
from .access import EnterpriseAccessScope


@dataclass(frozen=True, slots=True)
class EnterpriseAuditFilters:
    """Filters for the enterprise control-plane audit projection."""

    action: str | None = None
    entity_type: str | None = None
    entity_uuid: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


def query_enterprise_audit_logs(
    db: Session,
    scope: EnterpriseAccessScope,
    filters: EnterpriseAuditFilters,
    *,
    offset: int,
    limit: int,
) -> AuditLogListOut:
    """Return only enterprise audit events visible to the caller.

    The enterprise route is deliberately narrower than the platform audit
    route: it never exposes non-enterprise events, and non-admin operators can
    inspect only events written under their own identity.
    """

    conditions = [AuditLog.action.like("enterprise.%")]
    if filters.action:
        if not filters.action.startswith("enterprise."):
            raise ValueError("企业审计查询只允许 enterprise.* action")
        conditions.append(AuditLog.action == filters.action)
    if filters.entity_type:
        conditions.append(AuditLog.entity_type == filters.entity_type)
    if filters.entity_uuid:
        conditions.append(AuditLog.entity_uuid == filters.entity_uuid)
    if filters.created_from:
        conditions.append(AuditLog.created_at >= filters.created_from)
    if filters.created_to:
        conditions.append(AuditLog.created_at <= filters.created_to)
    if not scope.is_admin:
        conditions.append(AuditLog.sso_user_id == scope.user_id)

    total = int(db.scalar(select(func.count(AuditLog.id)).where(*conditions)) or 0)
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
