"""Knowledge document version timeline APIs."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .knowledge_routes import _can_view_file, _is_admin, _require_admin_access
from .knowledge_version_service import set_effective_version, version_timeline
from .models import KnowledgeFile
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/knowledge/files", tags=["knowledge-versions"])


class ActivateVersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # target is the path file_uuid itself; body reserved for future notes
    note: str = Field(default="", max_length=500)


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if not _is_admin(session):
        raise HTTPException(status_code=403, detail="仅管理员可切换生效版本")
    await require_action("ai_assistant:admin", request, session, settings)


@router.get("/{file_uuid}/versions")
async def get_file_version_timeline(
    file_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_uuid,
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="文档不存在或无权访问")
    admin_access_granted = False
    if file_record.permission_scope.strip().lower() == "admin":
        await _require_admin_access(request, session, settings)
        admin_access_granted = True
    if not _can_view_file(
        file_record,
        user_id=str(session.user.id),
        is_admin=_is_admin(session),
        db=db,
        session_payload=session,
        admin_access_granted=admin_access_granted,
    ):
        raise HTTPException(status_code=404, detail="文档不存在或无权访问")
    data = version_timeline(db, file_uuid)
    if not data.get("items"):
        raise HTTPException(status_code=404, detail="文档不存在或无版本记录")
    return data


@router.post("/{file_uuid}/versions/activate")
async def activate_file_version(
    file_uuid: str,
    body: ActivateVersionIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    row = set_effective_version(db, file_uuid, actor=str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    db.commit()
    return version_timeline(db, file_uuid)
