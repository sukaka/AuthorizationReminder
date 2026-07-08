from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .models import SkillReview, SkillRunLog
from .schemas import SessionPayload
from .skill_definition import SkillDefinition
from .skill_registry import SkillRegistry, get_default_skill_registry
from .skill_runner import SkillRunner


router = APIRouter(prefix="/api")


def get_skill_registry() -> SkillRegistry:
    return get_default_skill_registry()


class SkillOut(BaseModel):
    id: str
    name: str
    description: str
    category: str
    version: str
    status: str
    scope: str
    owner: str
    requires_attachment: bool
    allowed_tools: list[str]
    input_types: list[str]
    output_types: list[str]
    permissions: dict[str, bool]
    review: dict[str, Any]
    tags: list[str]


class SkillListOut(BaseModel):
    items: list[SkillOut]
    total: int


class SkillRunIn(BaseModel):
    task_id: str = ""
    input: dict[str, Any] = Field(default_factory=dict)


class SkillRunOut(BaseModel):
    run_id: str
    skill_id: str
    skill_version: str
    status: str
    tools_used: list[str]
    result: dict[str, Any]
    artifacts: list[dict[str, str]]


class SkillRunLogOut(BaseModel):
    run_id: str
    skill_id: str
    skill_version: str
    task_id: str
    user_id: str
    status: str
    tools_used: list[str]
    input_summary: dict[str, Any]
    output_summary: dict[str, Any]
    error_message: str
    started_at: str
    finished_at: str | None


class SkillRunLogListOut(BaseModel):
    items: list[SkillRunLogOut]
    total: int


class SkillReviewIn(BaseModel):
    status: str = Field(pattern="^(approved|rejected|changes_requested)$")
    comment: str = ""


class SkillReviewOut(BaseModel):
    skill_id: str
    version: str
    submitter_id: str
    reviewer_id: str
    status: str
    comment: str
    reviewed_at: str


def _skill_out(skill: SkillDefinition) -> SkillOut:
    manifest = skill.manifest
    return SkillOut(
        id=manifest.id,
        name=manifest.name,
        description=manifest.description,
        category=manifest.category,
        version=manifest.version,
        status=manifest.status,
        scope=manifest.scope,
        owner=manifest.owner,
        requires_attachment=manifest.requires_attachment,
        allowed_tools=manifest.allowed_tools,
        input_types=manifest.input_types,
        output_types=manifest.output_types,
        permissions=manifest.permissions.model_dump(),
        review=manifest.review.model_dump(),
        tags=manifest.tags,
    )


def _run_log_out(row: SkillRunLog) -> SkillRunLogOut:
    return SkillRunLogOut(
        run_id=row.uuid,
        skill_id=row.skill_id,
        skill_version=row.skill_version,
        task_id=row.task_id,
        user_id=row.user_id,
        status=row.status,
        tools_used=row.tools_used_json or [],
        input_summary=row.input_summary_json or {},
        output_summary=row.output_summary_json or {},
        error_message=row.error_message,
        started_at=row.started_at.isoformat() if row.started_at else "",
        finished_at=row.finished_at.isoformat() if row.finished_at else None,
    )


async def _require_use(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action("ai_assistant:use", request, session_payload, current_settings)


async def _require_admin(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action("ai_assistant:admin", request, session_payload, current_settings)


@router.get("/skills", response_model=SkillListOut)
async def list_skills(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillListOut:
    await _require_use(request, session_payload, current_settings)
    items = [_skill_out(item) for item in registry.list_skills(include_unpublished=False)]
    return SkillListOut(items=items, total=len(items))


@router.get("/skills/runs", response_model=SkillRunLogListOut)
async def list_my_skill_runs(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> SkillRunLogListOut:
    await _require_use(request, session_payload, current_settings)
    rows = list(db.scalars(
        select(SkillRunLog)
        .where(SkillRunLog.user_id == str(session_payload.user.id))
        .order_by(SkillRunLog.created_at.desc(), SkillRunLog.id.desc())
    ))
    return SkillRunLogListOut(items=[_run_log_out(row) for row in rows], total=len(rows))


@router.get("/skills/{skill_id}", response_model=SkillOut)
async def get_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_use(request, session_payload, current_settings)
    try:
        skill = registry.get(skill_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    if skill.status != "published" and session_payload.user.role.strip().lower() != "admin":
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    return _skill_out(skill)


@router.post("/skills/{skill_id}/run", response_model=SkillRunOut)
async def run_skill(
    skill_id: str,
    body: SkillRunIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillRunOut:
    await _require_use(request, session_payload, current_settings)
    try:
        skill = registry.get(skill_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    result = SkillRunner(db=db).run(
        skill=skill,
        session=session_payload,
        task_id=body.task_id,
        user_input=body.input,
    )
    return SkillRunOut(**result)


@router.get("/admin/skills", response_model=SkillListOut)
async def list_admin_skills(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillListOut:
    await _require_admin(request, session_payload, current_settings)
    items = [_skill_out(item) for item in registry.list_skills(include_unpublished=True)]
    return SkillListOut(items=items, total=len(items))


@router.post("/admin/skills/{skill_id}/publish", response_model=SkillOut)
async def publish_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_admin(request, session_payload, current_settings)
    try:
        skill = registry.get(skill_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    manifest = skill.manifest.model_copy(update={"status": "published"})
    return _skill_out(skill.model_copy(update={"manifest": manifest}))


@router.post("/admin/skills/{skill_id}/disable", response_model=SkillOut)
async def disable_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_admin(request, session_payload, current_settings)
    try:
        skill = registry.get(skill_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    manifest = skill.manifest.model_copy(update={"status": "disabled"})
    return _skill_out(skill.model_copy(update={"manifest": manifest}))


@router.post("/admin/skills/{skill_id}/review", response_model=SkillReviewOut)
async def review_skill(
    skill_id: str,
    body: SkillReviewIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillReviewOut:
    await _require_admin(request, session_payload, current_settings)
    try:
        skill = registry.get(skill_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    reviewed_at = datetime.now(UTC).replace(tzinfo=None)
    row = SkillReview(
        skill_id=skill.id,
        version=skill.version,
        submitter_id=skill.manifest.owner,
        reviewer_id=str(session_payload.user.id),
        status=body.status,
        comment=body.comment,
        reviewed_at=reviewed_at,
    )
    db.add(row)
    db.commit()
    return SkillReviewOut(
        skill_id=row.skill_id,
        version=row.version,
        submitter_id=row.submitter_id,
        reviewer_id=row.reviewer_id,
        status=row.status,
        comment=row.comment,
        reviewed_at=reviewed_at.isoformat(),
    )
