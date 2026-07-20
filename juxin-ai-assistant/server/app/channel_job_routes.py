"""Admin APIs for durable channel jobs."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .auth import get_session, is_platform_admin_role, require_action
from .channel_job_service import ChannelJobService
from .channel_queue import channel_dispatcher
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/channels/jobs", tags=["channel-jobs"])


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if not is_platform_admin_role(session.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可管理通道任务")
    await require_action("ai_assistant:admin", request, session, settings)


@router.get("")
async def list_jobs(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    status: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    rows = ChannelJobService(db).list_recent(limit=limit, status=status)
    return {
        "items": [ChannelJobService(db).to_public(r) for r in rows],
        "total": len(rows),
        "pending_async": channel_dispatcher.pending_count(),
    }


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    row = ChannelJobService(db).get(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    return ChannelJobService(db).to_public(row)


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    service = ChannelJobService(db)
    row = service.get(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    if row.status == "succeeded":
        return service.to_public(row)
    # reset for immediate retry
    row.status = "queued"
    row.next_retry_at = None
    if int(row.attempt) >= int(row.max_attempts):
        row.max_attempts = int(row.attempt) + 1
    db.add(row)
    db.commit()
    channel_dispatcher.enqueue_job_retry(row.uuid)
    return {**service.to_public(row), "scheduled": True}


@router.post("/drain")
async def drain_retry_queue(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    ids = channel_dispatcher.drain_retries(limit=20)
    return {"scheduled": ids, "count": len(ids)}
