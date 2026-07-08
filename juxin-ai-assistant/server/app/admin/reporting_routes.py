from datetime import date, datetime, time
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..database import get_db
from ..schemas import SessionPayload
from .audit_query import AuditFilters, query_audit_logs
from .schemas import AuditLogListOut, StatsOut, TaskReplayListOut
from .stats_service import build_stats, list_task_replays


def create_reporting_router() -> APIRouter:
    router = APIRouter()

    @router.get("/department-stats", response_model=StatsOut)
    async def department_stats(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> StatsOut:
        await require_action(
            "ai_assistant:department:stats",
            request,
            session,
            settings,
        )
        return build_stats(
            db,
            departments=session.scope.managed_departments,
            date_from=date_from,
            date_to=date_to,
        )

    @router.get("/admin/stats", response_model=StatsOut)
    async def admin_stats(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> StatsOut:
        await require_action("ai_assistant:admin", request, session, settings)
        return build_stats(
            db,
            departments=None,
            date_from=date_from,
            date_to=date_to,
        )

    @router.get("/admin/task-replays", response_model=TaskReplayListOut)
    async def admin_task_replays(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
    ) -> TaskReplayListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        return list_task_replays(db, offset=offset, limit=limit)

    @router.get("/admin/audit-logs", response_model=AuditLogListOut)
    async def admin_audit_logs(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        action: str | None = None,
        entity: str | None = None,
        entity_uuid: str | None = None,
        username: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ) -> AuditLogListOut:
        await require_action(
            "ai_assistant:audit:read",
            request,
            session,
            settings,
        )
        return query_audit_logs(
            db,
            AuditFilters(
                action=action,
                entity_type=entity,
                entity_uuid=entity_uuid,
                username=username,
                created_from=(
                    datetime.combine(date_from, time.min)
                    if date_from is not None
                    else None
                ),
                created_to=(
                    datetime.combine(date_to, time.max)
                    if date_to is not None
                    else None
                ),
            ),
            offset=offset,
            limit=limit,
        )

    return router
