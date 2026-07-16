"""User artifact APIs."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .artifact_service import ArtifactService
from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .models import AgentRun
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/artifacts", tags=["artifacts"])


class ArtifactOut(BaseModel):
    artifact_id: str
    run_id: str = ""
    artifact_type: str
    title: str
    status: str
    version: int
    content_markdown: str = ""
    quality: dict[str, Any] | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class ArtifactListOut(BaseModel):
    items: list[ArtifactOut]
    total: int


class ArtifactCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(default="", max_length=64)
    title: str = Field(default="成果", max_length=255)
    content_markdown: str = Field(min_length=1, max_length=500_000)
    artifact_type: str = Field(default="markdown", max_length=48)
    template_code: str = Field(default="", max_length=96)
    audience: str = Field(default="", max_length=255)
    style: str = Field(default="", max_length=64)
    materials: list[str] = Field(default_factory=list, max_length=100)


class ArtifactReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewer_type: str = Field(pattern="^(ai|human)$")
    decision: str = Field(pattern="^(approved|changes_requested|rejected)$")
    comment: str = Field(default="", max_length=4000)
    findings: list[str] = Field(default_factory=list, max_length=100)


class ArtifactReviewOut(BaseModel):
    review_id: str
    version: int
    reviewer_type: str
    reviewer_id: str
    decision: str
    comment: str = ""
    findings: list[str] = Field(default_factory=list)


class ArtifactReviewListOut(BaseModel):
    artifact_id: str
    items: list[ArtifactReviewOut]
    total: int


class ArtifactVersionOut(BaseModel):
    version: int
    change_summary: str = ""
    created_by: str = ""
    content_preview: str = ""
    is_active: bool = False


class ArtifactVersionListOut(BaseModel):
    artifact_id: str
    active_version: int
    items: list[ArtifactVersionOut]
    total: int


class ArtifactVersionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_markdown: str = Field(min_length=1, max_length=500_000)
    change_summary: str = Field(default="", max_length=500)


class ArtifactVersionActivateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


async def _require_use(request: Request, session: SessionPayload, settings: Settings) -> None:
    await require_action("ai_assistant:use", request, session, settings)


def _out(row) -> ArtifactOut:
    return ArtifactOut(
        artifact_id=row.uuid,
        run_id=row.run_id or "",
        artifact_type=row.artifact_type,
        title=row.title,
        status=row.status,
        version=int(row.version or 1),
        content_markdown=row.content_markdown or "",
        quality=row.quality_json,
        context=dict((row.metadata_json or {}).get("context") or {}),
    )


@router.get("", response_model=ArtifactListOut)
async def list_artifacts(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactListOut:
    await _require_use(request, session, settings)
    rows = ArtifactService(db).list_owned(str(session.user.id))
    return ArtifactListOut(items=[_out(r) for r in rows], total=len(rows))


@router.post("", response_model=ArtifactOut, status_code=201)
async def create_artifact(
    body: ArtifactCreateIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactOut:
    await _require_use(request, session, settings)
    owner_user_id = str(session.user.id)
    if body.run_id and db.scalar(
        select(AgentRun.uuid).where(
            AgentRun.uuid == body.run_id,
            AgentRun.owner_user_id == owner_user_id,
        )
    ) is None:
        raise HTTPException(status_code=404, detail="关联任务不存在或无权访问")
    row = ArtifactService(db).create_from_run(
        owner_user_id=owner_user_id,
        run_id=body.run_id,
        title=body.title,
        content_markdown=body.content_markdown,
        artifact_type=body.artifact_type,
        context={
            "template_code": body.template_code,
            "audience": body.audience,
            "style": body.style,
            "materials": body.materials,
        },
        actor=str(session.user.id),
    )
    db.commit()
    db.refresh(row)
    return _out(row)


def _review_out(row) -> ArtifactReviewOut:
    return ArtifactReviewOut(
        review_id=row.uuid,
        version=int(row.version),
        reviewer_type=row.reviewer_type,
        reviewer_id=row.reviewer_id or "",
        decision=row.decision,
        comment=row.comment or "",
        findings=list(row.findings_json or []),
    )


@router.get("/{artifact_id}/reviews", response_model=ArtifactReviewListOut)
async def list_artifact_reviews(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactReviewListOut:
    await _require_use(request, session, settings)
    service = ArtifactService(db)
    if service.get_owned(artifact_id, str(session.user.id)) is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    rows = service.list_reviews(artifact_id, str(session.user.id))
    return ArtifactReviewListOut(artifact_id=artifact_id, items=[_review_out(row) for row in rows], total=len(rows))


@router.post("/{artifact_id}/reviews", response_model=ArtifactReviewOut, status_code=201)
async def create_artifact_review(
    artifact_id: str,
    body: ArtifactReviewIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactReviewOut:
    await _require_use(request, session, settings)
    review = ArtifactService(db).create_review(
        artifact_id,
        str(session.user.id),
        reviewer_type=body.reviewer_type,
        decision=body.decision,
        comment=body.comment,
        findings=body.findings,
        reviewer_id=str(session.user.id),
    )
    if review is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    db.commit()
    db.refresh(review)
    return _review_out(review)


@router.get("/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactOut:
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _out(row)


@router.get("/{artifact_id}/versions", response_model=ArtifactVersionListOut)
async def list_artifact_versions(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactVersionListOut:
    await _require_use(request, session, settings)
    owner = str(session.user.id)
    service = ArtifactService(db)
    row = service.get_owned(artifact_id, owner)
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    versions = service.list_versions(artifact_id, owner)
    active = int(row.version or 1)
    items = [
        ArtifactVersionOut(
            version=int(v.version),
            change_summary=v.change_summary or "",
            created_by=v.created_by or "",
            content_preview=(v.content_markdown or "")[:240],
            is_active=int(v.version) == active,
        )
        for v in versions
    ]
    return ArtifactVersionListOut(
        artifact_id=artifact_id,
        active_version=active,
        items=items,
        total=len(items),
    )


@router.post("/{artifact_id}/versions", response_model=ArtifactOut, status_code=201)
async def create_artifact_version(
    artifact_id: str,
    body: ArtifactVersionCreateIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactOut:
    await _require_use(request, session, settings)
    owner = str(session.user.id)
    row = ArtifactService(db).create_version(
        artifact_id,
        owner,
        content_markdown=body.content_markdown,
        change_summary=body.change_summary,
        actor=owner,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    db.commit()
    db.refresh(row)
    return _out(row)


@router.post("/{artifact_id}/versions/activate", response_model=ArtifactOut)
async def activate_artifact_version(
    artifact_id: str,
    body: ArtifactVersionActivateIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ArtifactOut:
    await _require_use(request, session, settings)
    owner = str(session.user.id)
    row = ArtifactService(db).activate_version(
        artifact_id,
        owner,
        version=body.version,
        actor=owner,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    db.commit()
    db.refresh(row)
    return _out(row)


def _export_response(artifact_id: str, title: str, markdown: str, fmt: str):
    from urllib.parse import quote

    from fastapi.responses import Response

    from .artifact_export import export_artifact_bytes

    try:
        payload, media_type, ext = export_artifact_bytes(
            title=title or "任务成果",
            markdown=markdown or "",
            fmt=fmt,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"EXPORT_FAILED:{fmt}") from exc
    ascii_name = f"artifact-{artifact_id[:8]}.{ext}"
    utf8_name = quote(f"{(title or 'artifact')[:40]}.{ext}")
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_name}'
            )
        },
    )


@router.get("/{artifact_id}/export.docx")
async def export_artifact_docx(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    """Export artifact markdown as company-styled Word document."""
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _export_response(artifact_id, row.title, row.content_markdown or "", "docx")


@router.get("/{artifact_id}/export.xlsx")
async def export_artifact_xlsx(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _export_response(artifact_id, row.title, row.content_markdown or "", "xlsx")


@router.get("/{artifact_id}/export.pptx")
async def export_artifact_pptx(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _export_response(artifact_id, row.title, row.content_markdown or "", "pptx")


@router.get("/{artifact_id}/export.pdf")
async def export_artifact_pdf(
    artifact_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _export_response(artifact_id, row.title, row.content_markdown or "", "pdf")


@router.get("/{artifact_id}/export/{fmt}")
async def export_artifact_format(
    artifact_id: str,
    fmt: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    """Generic multi-format export: docx | xlsx | pptx | pdf | md."""
    await _require_use(request, session, settings)
    row = ArtifactService(db).get_owned(artifact_id, str(session.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    return _export_response(artifact_id, row.title, row.content_markdown or "", fmt)
