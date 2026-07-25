from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, is_platform_admin_role, require_action
from .config import Settings, get_settings
from .database import get_db
from .dashi_ppt_runtime import (
    DashiPptRuntimeError,
    HTML_PACKAGE_FILE_NAME,
    HTML_PACKAGE_MIME_TYPE,
    SUPPORTED_FORMATS,
    dashi_ppt_artifact_path,
    dashi_ppt_theme_preview_path,
)
from .models import SkillReview, SkillRunLog, UploadedSkill
from .schemas import SessionPayload
from .skill_definition import SkillDefinition
from .skill_registry import SkillRegistry, get_default_skill_registry
from .skill_runner import SkillRunner
from .skill_uploads import (
    SkillUploadError,
    load_uploaded_skill,
    persist_skill_archive,
    remove_skill_archive,
    validate_skill_archive,
)


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
    source: str = "builtin"
    upload_id: str | None = None
    uploaded_by: str | None = None


class SkillListOut(BaseModel):
    items: list[SkillOut]
    total: int


class SkillRunIn(BaseModel):
    task_id: str = ""
    input: dict[str, Any] = Field(default_factory=dict)


class SkillArtifactOut(BaseModel):
    artifact_id: str
    artifact_type: str
    kind: str
    title: str
    status: str
    version: int
    format: str
    mime_type: str
    download_url: str | None = None
    download_ref: str = ""
    downloadable: bool = False
    editable: bool = False
    file_name: str = ""
    content: str = ""


class SkillRunOut(BaseModel):
    run_id: str
    skill_id: str
    skill_version: str
    status: str
    tools_used: list[str]
    result: dict[str, Any]
    artifacts: list[SkillArtifactOut]


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


def _skill_out(
    skill: SkillDefinition,
    *,
    source: str = "builtin",
    upload_id: str | None = None,
    uploaded_by: str | None = None,
) -> SkillOut:
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
        source=source,
        upload_id=upload_id,
        uploaded_by=uploaded_by,
    )


def _uploaded_skill_out(row: UploadedSkill, current_settings: Settings) -> SkillOut:
    return _skill_out(
        load_uploaded_skill(row, current_settings),
        source="uploaded",
        upload_id=row.uuid,
        uploaded_by=row.uploaded_by,
    )


def _uploaded_rows(db: Session) -> list[UploadedSkill]:
    return list(db.scalars(select(UploadedSkill).order_by(UploadedSkill.created_at.desc())))


def _catalog_items(
    *,
    db: Session,
    registry: SkillRegistry,
    current_settings: Settings,
    user_id: str,
    include_unpublished: bool,
    admin: bool = False,
    mine: bool = False,
) -> list[tuple[SkillDefinition, str, str | None, str | None]]:
    items: list[tuple[SkillDefinition, str, str | None, str | None]] = [
        (item, "builtin", None, None)
        for item in registry.list_skills(include_unpublished=include_unpublished)
    ]
    for row in _uploaded_rows(db):
        if mine:
            visible = row.scope == "personal" and row.uploaded_by == user_id
        elif admin:
            visible = True
        else:
            visible = row.status == "published" and (
                row.scope == "company" or row.uploaded_by == user_id
            )
        if not visible:
            continue
        items.append((load_uploaded_skill(row, current_settings), "uploaded", row.uuid, row.uploaded_by))
    return sorted(items, key=lambda item: (item[0].manifest.category, item[0].name))


def _find_uploaded_row(db: Session, skill_id: str) -> UploadedSkill | None:
    return db.scalar(select(UploadedSkill).where(UploadedSkill.skill_id == skill_id))


def _find_skill(
    *,
    skill_id: str,
    db: Session,
    registry: SkillRegistry,
    current_settings: Settings,
    user_id: str,
    admin: bool = False,
) -> tuple[SkillDefinition, UploadedSkill | None]:
    try:
        skill = registry.get(skill_id)
        if skill.status != "published" and not admin:
            raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
        return skill, None
    except KeyError:
        row = _find_uploaded_row(db, skill_id)
        if row is None:
            raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
        visible = admin or (
            row.status == "published"
            and (row.scope == "company" or row.uploaded_by == user_id)
        )
        if not visible:
            raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
        return load_uploaded_skill(row, current_settings), row


def _ensure_new_skill_id(skill_id: str, db: Session, registry: SkillRegistry) -> None:
    try:
        registry.get(skill_id)
    except KeyError:
        if _find_uploaded_row(db, skill_id) is None:
            return
    raise HTTPException(status_code=409, detail="SKILL_ID_ALREADY_EXISTS")


async def _read_skill_upload(file: UploadFile) -> tuple[bytes, str]:
    filename = file.filename or "skill.zip"
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="SKILL_PACKAGE_MUST_BE_ZIP")
    data = await file.read()
    return data, filename


def _upload_error(exc: SkillUploadError) -> HTTPException:
    return HTTPException(status_code=400, detail=exc.code)


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
    # The local development bypass intentionally skips the auth service, but it
    # must not turn an employee test session into an administrator session.
    if current_settings.auth_dev_bypass and not is_platform_admin_role(session_payload.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可执行")


@router.get("/skills", response_model=SkillListOut)
async def list_skills(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillListOut:
    await _require_use(request, session_payload, current_settings)
    catalog = _catalog_items(
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        include_unpublished=False,
    )
    items = [
        _skill_out(item, source=source, upload_id=upload_id, uploaded_by=uploaded_by)
        for item, source, upload_id, uploaded_by in catalog
    ]
    return SkillListOut(items=items, total=len(items))


@router.get("/skills/mine", response_model=SkillListOut)
async def list_my_skills(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillListOut:
    await _require_use(request, session_payload, current_settings)
    catalog = _catalog_items(
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        include_unpublished=True,
        mine=True,
    )
    uploaded = [item for item in catalog if item[1] == "uploaded"]
    return SkillListOut(
        items=[
            _skill_out(item, source=source, upload_id=upload_id, uploaded_by=uploaded_by)
            for item, source, upload_id, uploaded_by in uploaded
        ],
        total=len(uploaded),
    )


@router.post("/skills/uploads", response_model=SkillOut, status_code=201)
async def upload_personal_skill(
    request: Request,
    file: Annotated[UploadFile, File(...)],
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_use(request, session_payload, current_settings)
    data, source_name = await _read_skill_upload(file)
    try:
        manifest, _ = validate_skill_archive(data)
        _ensure_new_skill_id(manifest.id, db, registry)
        row = persist_skill_archive(
            data,
            settings=current_settings,
            uploaded_by=str(session_payload.user.id),
            scope="personal",
            owner=str(session_payload.user.id),
            source_name=source_name,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    except SkillUploadError as exc:
        db.rollback()
        raise _upload_error(exc)
    except IntegrityError as exc:
        db.rollback()
        if "row" in locals():
            remove_skill_archive(current_settings, row.storage_key)
        raise HTTPException(status_code=409, detail="SKILL_ID_ALREADY_EXISTS") from exc
    except Exception:
        db.rollback()
        if "row" in locals():
            remove_skill_archive(current_settings, row.storage_key)
        raise
    return _uploaded_skill_out(row, current_settings)


@router.post("/skills/mine/{skill_id}/disable", response_model=SkillOut)
async def disable_my_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> SkillOut:
    await _require_use(request, session_payload, current_settings)
    row = _find_uploaded_row(db, skill_id)
    if row is None or row.scope != "personal" or row.uploaded_by != str(session_payload.user.id):
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND")
    row.status = "disabled"
    db.commit()
    db.refresh(row)
    return _uploaded_skill_out(row, current_settings)


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


@router.get("/skills/dashi-ppt/theme-preview")
async def get_dashi_ppt_theme_preview(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> FileResponse:
    await _require_use(request, session_payload, current_settings)
    try:
        preview_path = dashi_ppt_theme_preview_path(current_settings)
    except DashiPptRuntimeError as exc:
        raise HTTPException(status_code=503, detail="DASHI_PPT_THEME_PREVIEW_UNAVAILABLE") from exc
    return FileResponse(preview_path, media_type="image/png")


@router.get("/skills/dashi-ppt/runs/{run_id}/download/{artifact_format}")
async def download_dashi_ppt_artifact(
    run_id: str,
    artifact_format: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    await _require_use(request, session_payload, current_settings)
    artifact_format = artifact_format.lower()
    if artifact_format not in SUPPORTED_FORMATS:
        raise HTTPException(status_code=404, detail="SKILL_ARTIFACT_NOT_FOUND")
    row = db.scalar(
        select(SkillRunLog).where(
            SkillRunLog.uuid == run_id,
            SkillRunLog.skill_id == "dashi-ppt",
            SkillRunLog.user_id == str(session_payload.user.id),
            SkillRunLog.status == "completed",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="SKILL_ARTIFACT_NOT_FOUND")
    path = dashi_ppt_artifact_path(
        current_settings,
        user_id=row.user_id,
        run_id=row.uuid,
        artifact_format=artifact_format,
    )
    if not path.is_file():
        raise HTTPException(status_code=404, detail="SKILL_ARTIFACT_NOT_FOUND")
    media_type = {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf": "application/pdf",
        "html": "text/html; charset=utf-8",
    }[artifact_format]
    filename = f"presentation.{artifact_format}"
    if artifact_format == "html" and path.name == HTML_PACKAGE_FILE_NAME:
        media_type = HTML_PACKAGE_MIME_TYPE
        filename = HTML_PACKAGE_FILE_NAME
    return FileResponse(path, media_type=media_type, filename=filename)


@router.get("/skills/{skill_id}", response_model=SkillOut)
async def get_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_use(request, session_payload, current_settings)
    skill, row = _find_skill(
        skill_id=skill_id,
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        admin=is_platform_admin_role(session_payload.user.role),
    )
    return _skill_out(
        skill,
        source="uploaded" if row else "builtin",
        upload_id=row.uuid if row else None,
        uploaded_by=row.uploaded_by if row else None,
    )


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
    skill, _ = _find_skill(
        skill_id=skill_id,
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        admin=is_platform_admin_role(session_payload.user.role),
    )
    result = SkillRunner(db=db, settings=current_settings).run(
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
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillListOut:
    await _require_admin(request, session_payload, current_settings)
    catalog = _catalog_items(
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        include_unpublished=True,
        admin=True,
    )
    items = [
        _skill_out(item, source=source, upload_id=upload_id, uploaded_by=uploaded_by)
        for item, source, upload_id, uploaded_by in catalog
    ]
    return SkillListOut(items=items, total=len(items))


@router.post("/admin/skills/uploads", response_model=SkillOut, status_code=201)
async def upload_company_skill(
    request: Request,
    file: Annotated[UploadFile, File(...)],
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_admin(request, session_payload, current_settings)
    data, source_name = await _read_skill_upload(file)
    try:
        manifest, _ = validate_skill_archive(data)
        _ensure_new_skill_id(manifest.id, db, registry)
        row = persist_skill_archive(
            data,
            settings=current_settings,
            uploaded_by=str(session_payload.user.id),
            scope="company",
            owner="system",
            source_name=source_name,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    except SkillUploadError as exc:
        db.rollback()
        raise _upload_error(exc)
    except IntegrityError as exc:
        db.rollback()
        if "row" in locals():
            remove_skill_archive(current_settings, row.storage_key)
        raise HTTPException(status_code=409, detail="SKILL_ID_ALREADY_EXISTS") from exc
    except Exception:
        db.rollback()
        if "row" in locals():
            remove_skill_archive(current_settings, row.storage_key)
        raise
    return _uploaded_skill_out(row, current_settings)


@router.post("/admin/skills/{skill_id}/publish", response_model=SkillOut)
async def publish_skill(
    skill_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_admin(request, session_payload, current_settings)
    row = _find_uploaded_row(db, skill_id)
    if row is not None:
        row.status = "published"
        db.commit()
        db.refresh(row)
        return _uploaded_skill_out(row, current_settings)
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
    db: Annotated[Session, Depends(get_db)],
    registry: Annotated[SkillRegistry, Depends(get_skill_registry)],
) -> SkillOut:
    await _require_admin(request, session_payload, current_settings)
    row = _find_uploaded_row(db, skill_id)
    if row is not None:
        row.status = "disabled"
        db.commit()
        db.refresh(row)
        return _uploaded_skill_out(row, current_settings)
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
    skill, uploaded_row = _find_skill(
        skill_id=skill_id,
        db=db,
        registry=registry,
        current_settings=current_settings,
        user_id=str(session_payload.user.id),
        admin=True,
    )
    reviewed_at = datetime.now(UTC).replace(tzinfo=None)
    row = SkillReview(
        skill_id=skill.id,
        version=skill.version,
        submitter_id=uploaded_row.owner if uploaded_row else skill.manifest.owner,
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
