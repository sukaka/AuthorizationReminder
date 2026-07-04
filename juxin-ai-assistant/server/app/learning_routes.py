from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .models import (
    ExperienceLibrary,
    FailureCaseLibrary,
    FeedbackLog,
    TemplateLibrary,
    UserMemory,
)
from .schemas import (
    ExperienceCreateIn,
    ExperienceListOut,
    ExperienceOut,
    ExperiencePatchIn,
    FailureCaseCreateIn,
    FailureCaseListOut,
    FailureCaseOut,
    FailureCasePatchIn,
    LearningFeedbackIn,
    LearningFeedbackListOut,
    LearningFeedbackOut,
    MemoryCreateIn,
    MemoryListOut,
    MemoryOut,
    MemoryPatchIn,
    SessionPayload,
    TemplateCreateIn,
    TemplateListOut,
    TemplateOut,
    TemplatePatchIn,
)


router = APIRouter(prefix="/api/learning", tags=["learning"])


async def _require_use(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )


def _memory_out(row: UserMemory) -> MemoryOut:
    return MemoryOut(
        uuid=row.uuid,
        memory_type=row.memory_type,
        title=row.title,
        content=row.content,
        source=row.source,
        priority=row.priority,
        tags=list(row.tags_json or []),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _experience_out(row: ExperienceLibrary) -> ExperienceOut:
    return ExperienceOut(
        uuid=row.uuid,
        task_type=row.task_type,
        title=row.title,
        question=row.question,
        answer=row.answer,
        summary=row.summary,
        tags=list(row.tags_json or []),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _template_out(row: TemplateLibrary) -> TemplateOut:
    return TemplateOut(
        uuid=row.uuid,
        template_name=row.template_name,
        task_type=row.task_type,
        template_content=row.template_content,
        variables=dict(row.variables_json or {}),
        scope=row.scope,
        review_status=row.review_status,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _failure_case_out(row: FailureCaseLibrary) -> FailureCaseOut:
    return FailureCaseOut(
        uuid=row.uuid,
        task_type=row.task_type,
        wrong_answer=row.wrong_answer,
        correction=row.correction,
        prevention_rule=row.prevention_rule,
        tags=list(row.tags_json or []),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _feedback_out(row: FeedbackLog) -> LearningFeedbackOut:
    return LearningFeedbackOut(
        uuid=row.uuid,
        conversation_id=row.conversation_id,
        message_id=row.message_id,
        feedback_type=row.feedback_type,
        comment=row.comment,
        saved_as=row.saved_as,
        created_at=row.created_at,
    )


def _owned_experience(db: Session, *, user_id: str, item_id: str) -> ExperienceLibrary:
    row = db.scalar(
        select(ExperienceLibrary).where(
            ExperienceLibrary.uuid == item_id,
            ExperienceLibrary.user_id == user_id,
            ExperienceLibrary.status != "deleted",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="EXPERIENCE_NOT_FOUND")
    return row


def _owned_template(db: Session, *, user_id: str, item_id: str) -> TemplateLibrary:
    row = db.scalar(
        select(TemplateLibrary).where(
            TemplateLibrary.uuid == item_id,
            TemplateLibrary.user_id == user_id,
            TemplateLibrary.status != "deleted",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="TEMPLATE_NOT_FOUND")
    return row


def _owned_failure_case(db: Session, *, user_id: str, item_id: str) -> FailureCaseLibrary:
    row = db.scalar(
        select(FailureCaseLibrary).where(
            FailureCaseLibrary.uuid == item_id,
            FailureCaseLibrary.user_id == user_id,
            FailureCaseLibrary.status != "deleted",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="FAILURE_CASE_NOT_FOUND")
    return row


def _memory_priority_order():
    return case(
        (UserMemory.priority == "high", 0),
        (UserMemory.priority == "medium", 1),
        else_=2,
    )


@router.get("/memories", response_model=MemoryListOut)
async def list_memories(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    status: str = Query(default="active", pattern="^(active|disabled|all)$"),
    memory_type: str | None = Query(default=None, max_length=32),
) -> MemoryListOut:
    await _require_use(request, session_payload, current_settings)
    stmt = select(UserMemory).where(UserMemory.sso_user_id == str(session_payload.user.id))
    if status != "all":
        stmt = stmt.where(UserMemory.status == status)
    else:
        stmt = stmt.where(UserMemory.status != "deleted")
    if memory_type:
        stmt = stmt.where(UserMemory.memory_type == memory_type)
    rows = list(
        db.scalars(
            stmt.order_by(
                _memory_priority_order(),
                UserMemory.updated_at.desc(),
                UserMemory.id.desc(),
            )
        )
    )
    return MemoryListOut(items=[_memory_out(row) for row in rows], total=len(rows))


@router.post("/memories", response_model=MemoryOut, status_code=201)
async def create_memory(
    body: MemoryCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> MemoryOut:
    await _require_use(request, session_payload, current_settings)
    row = UserMemory(
        sso_user_id=str(session_payload.user.id),
        memory_type=body.memory_type,
        title=body.title,
        content=body.content,
        source=body.source,
        priority=body.priority,
        tags_json=body.tags,
        status="active",
        metadata_json={},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _memory_out(row)


@router.patch("/memories/{memory_id}", response_model=MemoryOut)
async def patch_memory(
    memory_id: str,
    body: MemoryPatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> MemoryOut:
    await _require_use(request, session_payload, current_settings)
    row = db.scalar(
        select(UserMemory).where(
            UserMemory.uuid == memory_id,
            UserMemory.sso_user_id == str(session_payload.user.id),
            UserMemory.status != "deleted",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="MEMORY_NOT_FOUND")
    patch = body.model_dump(exclude_unset=True)
    if "tags" in patch:
        row.tags_json = patch.pop("tags")
    for key, value in patch.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _memory_out(row)


@router.delete("/memories/{memory_id}", response_model=MemoryOut)
async def delete_memory(
    memory_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> MemoryOut:
    await _require_use(request, session_payload, current_settings)
    row = db.scalar(
        select(UserMemory).where(
            UserMemory.uuid == memory_id,
            UserMemory.sso_user_id == str(session_payload.user.id),
            UserMemory.status != "deleted",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="MEMORY_NOT_FOUND")
    row.status = "deleted"
    db.commit()
    db.refresh(row)
    return _memory_out(row)


@router.post("/experiences", response_model=ExperienceOut, status_code=201)
async def create_experience(
    body: ExperienceCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExperienceOut:
    await _require_use(request, session_payload, current_settings)
    row = ExperienceLibrary(
        user_id=str(session_payload.user.id),
        task_type=body.task_type,
        title=body.title,
        question=body.question,
        answer=body.answer,
        summary=body.summary,
        tags_json=body.tags,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _experience_out(row)


@router.get("/experiences", response_model=ExperienceListOut)
async def list_experiences(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExperienceListOut:
    await _require_use(request, session_payload, current_settings)
    rows = list(
        db.scalars(
            select(ExperienceLibrary)
            .where(
                ExperienceLibrary.user_id == str(session_payload.user.id),
                ExperienceLibrary.status == "active",
            )
            .order_by(ExperienceLibrary.updated_at.desc(), ExperienceLibrary.id.desc())
        )
    )
    return ExperienceListOut(items=[_experience_out(row) for row in rows], total=len(rows))


@router.patch("/experiences/{experience_id}", response_model=ExperienceOut)
async def patch_experience(
    experience_id: str,
    body: ExperiencePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExperienceOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_experience(db, user_id=str(session_payload.user.id), item_id=experience_id)
    patch = body.model_dump(exclude_unset=True)
    if "tags" in patch:
        row.tags_json = patch.pop("tags")
    for key, value in patch.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _experience_out(row)


@router.delete("/experiences/{experience_id}", response_model=ExperienceOut)
async def delete_experience(
    experience_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExperienceOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_experience(db, user_id=str(session_payload.user.id), item_id=experience_id)
    row.status = "deleted"
    db.commit()
    db.refresh(row)
    return _experience_out(row)


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(
    body: TemplateCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TemplateOut:
    await _require_use(request, session_payload, current_settings)
    row = TemplateLibrary(
        user_id=str(session_payload.user.id),
        template_name=body.template_name,
        task_type=body.task_type,
        template_content=body.template_content,
        variables_json=body.variables,
        scope=body.scope,
        review_status="pending" if body.scope == "company" else "draft",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.get("/templates", response_model=TemplateListOut)
async def list_templates(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TemplateListOut:
    await _require_use(request, session_payload, current_settings)
    rows = list(
        db.scalars(
            select(TemplateLibrary)
            .where(
                TemplateLibrary.user_id == str(session_payload.user.id),
                TemplateLibrary.status == "active",
            )
            .order_by(TemplateLibrary.updated_at.desc(), TemplateLibrary.id.desc())
        )
    )
    return TemplateListOut(items=[_template_out(row) for row in rows], total=len(rows))


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def patch_template(
    template_id: str,
    body: TemplatePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TemplateOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_template(db, user_id=str(session_payload.user.id), item_id=template_id)
    patch = body.model_dump(exclude_unset=True)
    if "variables" in patch:
        row.variables_json = patch.pop("variables")
    for key, value in patch.items():
        setattr(row, key, value)
    if row.scope == "personal":
        row.review_status = "draft"
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.post("/templates/{template_id}/submit-review", response_model=TemplateOut)
async def submit_template_review(
    template_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TemplateOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_template(db, user_id=str(session_payload.user.id), item_id=template_id)
    row.scope = "company"
    row.review_status = "pending"
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.delete("/templates/{template_id}", response_model=TemplateOut)
async def delete_template(
    template_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> TemplateOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_template(db, user_id=str(session_payload.user.id), item_id=template_id)
    row.status = "deleted"
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.post("/failure-cases", response_model=FailureCaseOut, status_code=201)
async def create_failure_case(
    body: FailureCaseCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> FailureCaseOut:
    await _require_use(request, session_payload, current_settings)
    row = FailureCaseLibrary(
        user_id=str(session_payload.user.id),
        task_type=body.task_type,
        wrong_answer=body.wrong_answer,
        correction=body.correction,
        prevention_rule=body.prevention_rule,
        tags_json=body.tags,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _failure_case_out(row)


@router.get("/failure-cases", response_model=FailureCaseListOut)
async def list_failure_cases(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> FailureCaseListOut:
    await _require_use(request, session_payload, current_settings)
    rows = list(
        db.scalars(
            select(FailureCaseLibrary)
            .where(
                FailureCaseLibrary.user_id == str(session_payload.user.id),
                FailureCaseLibrary.status == "active",
            )
            .order_by(FailureCaseLibrary.updated_at.desc(), FailureCaseLibrary.id.desc())
        )
    )
    return FailureCaseListOut(
        items=[_failure_case_out(row) for row in rows],
        total=len(rows),
    )


@router.patch("/failure-cases/{failure_case_id}", response_model=FailureCaseOut)
async def patch_failure_case(
    failure_case_id: str,
    body: FailureCasePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> FailureCaseOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_failure_case(db, user_id=str(session_payload.user.id), item_id=failure_case_id)
    patch = body.model_dump(exclude_unset=True)
    if "tags" in patch:
        row.tags_json = patch.pop("tags")
    for key, value in patch.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _failure_case_out(row)


@router.delete("/failure-cases/{failure_case_id}", response_model=FailureCaseOut)
async def delete_failure_case(
    failure_case_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> FailureCaseOut:
    await _require_use(request, session_payload, current_settings)
    row = _owned_failure_case(db, user_id=str(session_payload.user.id), item_id=failure_case_id)
    row.status = "deleted"
    db.commit()
    db.refresh(row)
    return _failure_case_out(row)


@router.get("/feedback", response_model=LearningFeedbackListOut)
async def list_learning_feedback(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
) -> LearningFeedbackListOut:
    await _require_use(request, session_payload, current_settings)
    rows = list(
        db.scalars(
            select(FeedbackLog)
            .where(FeedbackLog.user_id == str(session_payload.user.id))
            .order_by(FeedbackLog.created_at.desc(), FeedbackLog.id.desc())
            .limit(limit)
        )
    )
    return LearningFeedbackListOut(items=[_feedback_out(row) for row in rows], total=len(rows))


@router.post("/feedback", response_model=LearningFeedbackOut, status_code=201)
async def create_learning_feedback(
    body: LearningFeedbackIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LearningFeedbackOut:
    await _require_use(request, session_payload, current_settings)
    row = FeedbackLog(
        user_id=str(session_payload.user.id),
        conversation_id=body.conversation_id,
        message_id=body.message_id,
        feedback_type=body.feedback_type,
        comment=body.comment,
        saved_as=body.saved_as,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _feedback_out(row)
