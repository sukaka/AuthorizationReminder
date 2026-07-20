"""Admin APIs for controlled learning candidates (Phase 5)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .auth import get_session, is_platform_admin_role, require_action
from .config import Settings, get_settings
from .database import get_db
from .learning_candidate_service import LearningCandidateService
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/learning-candidates", tags=["learning-candidates"])


class CandidateOut(BaseModel):
    candidate_id: str
    owner_user_id: str
    source_run_id: str = ""
    candidate_type: str
    title: str
    status: str
    payload: dict[str, Any] | None = None


class CandidateListOut(BaseModel):
    items: list[CandidateOut]
    total: int


class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(
        ...,
        pattern="^(draft|evaluated|staged|published|rolled_back|superseded)$",
    )


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if not is_platform_admin_role(session.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可管理学习候选")
    await require_action("ai_assistant:admin", request, session, settings)


def _out(row) -> CandidateOut:
    return CandidateOut(
        candidate_id=row.uuid,
        owner_user_id=row.owner_user_id,
        source_run_id=row.source_run_id or "",
        candidate_type=row.candidate_type,
        title=row.title,
        status=row.status,
        payload=row.payload_json,
    )


@router.get("", response_model=CandidateListOut)
async def list_candidates(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CandidateListOut:
    """普通用户看自己的候选；管理员看全部（学习闭环审核入口）。"""
    await require_action("ai_assistant:use", request, session, settings)
    from sqlalchemy import select
    from .models import LearningCandidate

    is_admin = is_platform_admin_role(session.user.role)
    if is_admin:
        rows = list(
            db.scalars(
                select(LearningCandidate).order_by(LearningCandidate.updated_at.desc()).limit(100)
            )
        )
    else:
        rows = LearningCandidateService(db).list_for_owner(str(session.user.id), limit=100)
    return CandidateListOut(items=[_out(r) for r in rows], total=len(rows))


@router.post("/{candidate_id}/transition", response_model=CandidateOut)
async def transition_candidate(
    candidate_id: str,
    body: TransitionIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CandidateOut:
    await _require_admin(request, session, settings)
    try:
        row = LearningCandidateService(db).transition(
            candidate_id,
            status=body.status,
            actor=str(session.user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="学习候选不存在")
    db.commit()
    db.refresh(row)
    return _out(row)
