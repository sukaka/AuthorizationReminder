from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..database import get_db
from ..schemas import SessionPayload
from .assistant_modes import (
    create_mode,
    get_mode,
    list_modes,
    mode_out,
    rollback_mode,
    set_mode_status,
    test_mode,
    update_mode,
)
from .route_common import write_request_audit
from .schemas import (
    AssistantModeListOut,
    AssistantModeOut,
    AssistantModeRollbackIn,
    AssistantModeTestIn,
    AssistantModeTestOut,
    AssistantModeUpsertIn,
)


def create_assistant_mode_router() -> APIRouter:
    router = APIRouter(prefix="/admin/assistant-modes", tags=["assistant-modes"])

    async def require_admin(
        request: Request,
        session: SessionPayload,
        settings: Settings,
    ) -> None:
        await require_action("ai_assistant:admin", request, session, settings)

    @router.get("", response_model=AssistantModeListOut)
    async def modes(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeListOut:
        await require_admin(request, session, settings)
        rows = list_modes(db)
        db.commit()
        return AssistantModeListOut(items=[mode_out(db, row) for row in rows], total=len(rows))

    @router.get("/{mode_uuid}", response_model=AssistantModeOut)
    async def mode_detail(
        mode_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        await require_admin(request, session, settings)
        row = get_mode(db, mode_uuid)
        db.commit()
        return mode_out(db, row)

    @router.post("", response_model=AssistantModeOut, status_code=201)
    async def create(
        body: AssistantModeUpsertIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        await require_admin(request, session, settings)
        row = create_mode(db, body=body, actor_id=str(session.user.id))
        write_request_audit(
            db, session, request, settings,
            action="assistant_mode.create", entity_type="assistant_mode", entity_uuid=row.uuid,
            metadata={"code": row.code, "version": row.version},
        )
        db.commit()
        return mode_out(db, row)

    @router.put("/{mode_uuid}", response_model=AssistantModeOut)
    async def update(
        mode_uuid: str,
        body: AssistantModeUpsertIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        await require_admin(request, session, settings)
        row = update_mode(db, mode_uuid=mode_uuid, body=body, actor_id=str(session.user.id))
        write_request_audit(
            db, session, request, settings,
            action="assistant_mode.update", entity_type="assistant_mode", entity_uuid=row.uuid,
            metadata={"version": row.version},
        )
        db.commit()
        return mode_out(db, row)

    async def change_status(
        mode_uuid: str,
        status: str,
        action: str,
        request: Request,
        session: SessionPayload,
        settings: Settings,
        db: Session,
    ) -> AssistantModeOut:
        await require_admin(request, session, settings)
        row = set_mode_status(
            db, mode_uuid=mode_uuid, status=status, actor_id=str(session.user.id)
        )
        write_request_audit(
            db, session, request, settings,
            action=action, entity_type="assistant_mode", entity_uuid=row.uuid,
            metadata={"status": row.status, "version": row.version},
        )
        db.commit()
        return mode_out(db, row)

    @router.post("/{mode_uuid}/enable", response_model=AssistantModeOut)
    async def enable(
        mode_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        return await change_status(
            mode_uuid, "ACTIVE", "assistant_mode.enable", request, session, settings, db
        )

    @router.post("/{mode_uuid}/disable", response_model=AssistantModeOut)
    async def disable(
        mode_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        return await change_status(
            mode_uuid, "DISABLED", "assistant_mode.disable", request, session, settings, db
        )

    @router.post("/{mode_uuid}/test", response_model=AssistantModeTestOut)
    async def test_run(
        mode_uuid: str,
        body: AssistantModeTestIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeTestOut:
        await require_admin(request, session, settings)
        row = get_mode(db, mode_uuid)
        issues = test_mode(row, user_input=body.input)
        write_request_audit(
            db, session, request, settings,
            action="assistant_mode.test", entity_type="assistant_mode", entity_uuid=row.uuid,
            result="FAILED" if issues else "SUCCESS",
            metadata={"version": row.version, "issue_count": len(issues)},
        )
        db.commit()
        return AssistantModeTestOut(
            status="failed" if issues else "passed", issues=issues, persisted=False
        )

    @router.post("/{mode_uuid}/rollback", response_model=AssistantModeOut)
    async def rollback(
        mode_uuid: str,
        body: AssistantModeRollbackIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AssistantModeOut:
        await require_admin(request, session, settings)
        row = rollback_mode(
            db, mode_uuid=mode_uuid, version=body.version, actor_id=str(session.user.id)
        )
        write_request_audit(
            db, session, request, settings,
            action="assistant_mode.rollback", entity_type="assistant_mode", entity_uuid=row.uuid,
            metadata={"target_version": body.version, "version": row.version},
        )
        db.commit()
        return mode_out(db, row)

    return router
