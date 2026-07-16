"""Admin FAQ lifecycle routes."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..database import get_db
from ..faq_service import FaqService, FaqServiceError
from ..schemas import SessionPayload
from .route_common import CipherDependency


class FaqOut(BaseModel):
    uuid: str
    question: str
    aliases: list[str] = Field(default_factory=list)
    answer: str
    previous_answer: str = ""
    version: int = 1
    status: str
    hit_count: int = 0


class FaqListOut(BaseModel):
    items: list[FaqOut]
    total: int


class FaqCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=100_000)
    aliases: list[str] = Field(default_factory=list, max_length=50)
    status: Literal["draft", "published", "active", "disabled"] = "draft"


class FaqUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str | None = Field(default=None, min_length=1, max_length=500)
    answer: str | None = Field(default=None, min_length=1, max_length=100_000)
    aliases: list[str] | None = Field(default=None, max_length=50)


def _out(row) -> FaqOut:
    rec = FaqService.to_record(row)
    return FaqOut(
        uuid=rec.uuid,
        question=rec.question,
        aliases=rec.aliases,
        answer=rec.answer,
        previous_answer=rec.previous_answer,
        version=rec.version,
        status=rec.status,
        hit_count=rec.hit_count,
    )


def _http(exc: FaqServiceError) -> HTTPException:
    status = 404 if exc.code == "NOT_FOUND" else 400
    return HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message})


def create_faq_admin_router(_cipher_dependency: CipherDependency | None = None) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/faqs", response_model=FaqListOut)
    async def list_faqs(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        status: str | None = None,
    ) -> FaqListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        rows = FaqService(db).list_faqs(status=status)
        return FaqListOut(items=[_out(r) for r in rows], total=len(rows))

    @router.post("/admin/faqs", response_model=FaqOut, status_code=201)
    async def create_faq(
        body: FaqCreateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> FaqOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            row = FaqService(db).create(
                question=body.question,
                answer=body.answer,
                aliases=body.aliases,
                actor=str(session.user.id),
                status=body.status,
            )
            db.commit()
            db.refresh(row)
            return _out(row)
        except FaqServiceError as exc:
            db.rollback()
            raise _http(exc) from exc

    @router.put("/admin/faqs/{faq_uuid}", response_model=FaqOut)
    async def update_faq(
        faq_uuid: str,
        body: FaqUpdateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> FaqOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            row = FaqService(db).update(
                faq_uuid,
                question=body.question,
                answer=body.answer,
                aliases=body.aliases,
                actor=str(session.user.id),
            )
            db.commit()
            db.refresh(row)
            return _out(row)
        except FaqServiceError as exc:
            db.rollback()
            raise _http(exc) from exc

    @router.post("/admin/faqs/{faq_uuid}/publish", response_model=FaqOut)
    async def publish_faq(
        faq_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> FaqOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            row = FaqService(db).publish(faq_uuid, actor=str(session.user.id))
            db.commit()
            db.refresh(row)
            return _out(row)
        except FaqServiceError as exc:
            db.rollback()
            raise _http(exc) from exc

    @router.post("/admin/faqs/{faq_uuid}/disable", response_model=FaqOut)
    async def disable_faq(
        faq_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> FaqOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            row = FaqService(db).disable(faq_uuid, actor=str(session.user.id))
            db.commit()
            db.refresh(row)
            return _out(row)
        except FaqServiceError as exc:
            db.rollback()
            raise _http(exc) from exc

    @router.post("/admin/faqs/{faq_uuid}/rollback", response_model=FaqOut)
    async def rollback_faq(
        faq_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> FaqOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            row = FaqService(db).rollback(faq_uuid, actor=str(session.user.id))
            db.commit()
            db.refresh(row)
            return _out(row)
        except FaqServiceError as exc:
            db.rollback()
            raise _http(exc) from exc

    return router
