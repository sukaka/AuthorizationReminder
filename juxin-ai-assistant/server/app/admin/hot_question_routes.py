from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher, EncryptedPayload
from ..database import get_db
from ..models import ExternalHotQuestionReportItem, HotQuestionReportItem
from ..schemas import SessionPayload
from .route_common import CipherDependency


class HotQuestionOut(BaseModel):
    uuid: str
    period_type: str
    period_start: datetime
    period_end: datetime
    rank: int
    question_count: int
    representative_question: str
    sample_questions: list[str]
    suggested_reply: str
    analysis_summary: str
    status: str
    reviewed_by: str
    reviewed_at: datetime | None


class HotQuestionListOut(BaseModel):
    items: list[HotQuestionOut]
    total: int


class ExternalHotQuestionOut(BaseModel):
    uuid: str
    period_start: datetime
    period_end: datetime
    source_channel: str
    rank: int
    question_count: int
    direct_answer_count: int
    handoff_count: int
    representative_question: str
    sample_questions: list[str]
    source_file_ids: list[str]
    analysis_summary: str


class ExternalHotQuestionListOut(BaseModel):
    items: list[ExternalHotQuestionOut]
    total: int


class HotQuestionReviewIn(BaseModel):
    status: Literal["approved", "rejected", "pending"]
    suggested_reply: str | None = Field(default=None, max_length=100_000)


class HotQuestionToFaqOut(BaseModel):
    faq_uuid: str
    question: str
    answer: str
    status: str
    hot_question_uuid: str


def _decrypt(cipher: ContentCipher, item: HotQuestionReportItem) -> HotQuestionOut:
    question = cipher.decrypt_json(EncryptedPayload(
        ciphertext=item.question_ciphertext, nonce=item.question_nonce,
    ), item.uuid.encode())
    samples = cipher.decrypt_json(EncryptedPayload(
        ciphertext=item.samples_ciphertext, nonce=item.samples_nonce,
    ), f"{item.uuid}:samples".encode())
    reply = cipher.decrypt_json(EncryptedPayload(
        ciphertext=item.reply_ciphertext, nonce=item.reply_nonce,
    ), f"{item.uuid}:reply".encode())
    return HotQuestionOut(
        uuid=item.uuid,
        period_type=item.period_type,
        period_start=item.period_start,
        period_end=item.period_end,
        rank=item.rank,
        question_count=item.question_count,
        representative_question=str(question.get("text") or ""),
        sample_questions=[str(value) for value in samples.get("items", [])],
        suggested_reply=str(reply.get("text") or ""),
        analysis_summary=item.analysis_summary,
        status=item.status,
        reviewed_by=item.reviewed_by,
        reviewed_at=item.reviewed_at,
    )


def _decrypt_external(cipher: ContentCipher, item: ExternalHotQuestionReportItem) -> ExternalHotQuestionOut:
    question = cipher.decrypt_json(EncryptedPayload(
        ciphertext=item.question_ciphertext, nonce=item.question_nonce,
    ), item.uuid.encode())
    samples = cipher.decrypt_json(EncryptedPayload(
        ciphertext=item.samples_ciphertext, nonce=item.samples_nonce,
    ), f"{item.uuid}:samples".encode())
    return ExternalHotQuestionOut(
        uuid=item.uuid,
        period_start=item.period_start,
        period_end=item.period_end,
        source_channel=item.source_channel,
        rank=item.rank,
        question_count=item.question_count,
        direct_answer_count=item.direct_answer_count,
        handoff_count=item.handoff_count,
        representative_question=str(question.get("text") or ""),
        sample_questions=[str(value) for value in samples.get("items", [])],
        source_file_ids=[str(value) for value in item.source_file_ids_json or []],
        analysis_summary=item.analysis_summary,
    )


def create_hot_question_router(cipher_dependency: CipherDependency) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/hot-questions", response_model=HotQuestionListOut)
    async def list_hot_questions(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
        period_type: Literal["daily", "weekly", "monthly"] = "daily",
    ) -> HotQuestionListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        latest_end = db.scalar(select(HotQuestionReportItem.period_end).where(
            HotQuestionReportItem.period_type == period_type,
        ).order_by(HotQuestionReportItem.period_end.desc()).limit(1))
        if latest_end is None:
            return HotQuestionListOut(items=[], total=0)
        rows = list(db.scalars(select(HotQuestionReportItem).where(
            HotQuestionReportItem.period_type == period_type,
            HotQuestionReportItem.period_end == latest_end,
        ).order_by(HotQuestionReportItem.rank.asc())))
        return HotQuestionListOut(items=[_decrypt(cipher, item) for item in rows], total=len(rows))

    @router.get("/admin/external-hot-questions", response_model=ExternalHotQuestionListOut)
    async def list_external_hot_questions(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
        source_channel: Literal["wechat_official", "wecom_kf", "all"] = "all",
    ) -> ExternalHotQuestionListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        latest_end = db.scalar(select(ExternalHotQuestionReportItem.period_end).where(
            ExternalHotQuestionReportItem.period_type == "daily",
            ExternalHotQuestionReportItem.source_channel == source_channel,
        ).order_by(ExternalHotQuestionReportItem.period_end.desc()).limit(1))
        if latest_end is None:
            return ExternalHotQuestionListOut(items=[], total=0)
        rows = list(db.scalars(select(ExternalHotQuestionReportItem).where(
            ExternalHotQuestionReportItem.period_type == "daily",
            ExternalHotQuestionReportItem.source_channel == source_channel,
            ExternalHotQuestionReportItem.period_end == latest_end,
        ).order_by(ExternalHotQuestionReportItem.rank.asc())))
        return ExternalHotQuestionListOut(
            items=[_decrypt_external(cipher, item) for item in rows], total=len(rows)
        )

    @router.put("/admin/hot-questions/{item_uuid}", response_model=HotQuestionOut)
    async def review_hot_question(
        item_uuid: str,
        body: HotQuestionReviewIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> HotQuestionOut:
        await require_action("ai_assistant:admin", request, session, settings)
        item = db.scalar(select(HotQuestionReportItem).where(HotQuestionReportItem.uuid == item_uuid))
        if item is None:
            raise HTTPException(status_code=404, detail="热点问题不存在")
        if body.suggested_reply is not None:
            payload = cipher.encrypt_json({"text": body.suggested_reply.strip()}, f"{item.uuid}:reply".encode())
            item.reply_ciphertext = payload.ciphertext
            item.reply_nonce = payload.nonce
        item.status = body.status
        item.reviewed_by = str(session.user.id)
        item.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        db.refresh(item)
        return _decrypt(cipher, item)

    @router.post(
        "/admin/hot-questions/{item_uuid}/to-faq",
        response_model=HotQuestionToFaqOut,
        status_code=201,
    )
    async def convert_hot_question_to_faq(
        item_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> HotQuestionToFaqOut:
        """Create a draft SharedFaq candidate from a hot-question report item."""
        await require_action("ai_assistant:admin", request, session, settings)
        from ..faq_service import FaqService, FaqServiceError

        item = db.scalar(select(HotQuestionReportItem).where(HotQuestionReportItem.uuid == item_uuid))
        if item is None:
            raise HTTPException(status_code=404, detail="热点问题不存在")
        out = _decrypt(cipher, item)
        question = (out.representative_question or "").strip()
        answer = (out.suggested_reply or "").strip() or "（待管理员补充统一回复）"
        aliases = [s for s in out.sample_questions if s and s != question][:20]
        if not question:
            raise HTTPException(status_code=400, detail="热点问题内容为空，无法转 FAQ")
        try:
            row = FaqService(db).create(
                question=question,
                answer=answer,
                aliases=aliases,
                actor=str(session.user.id),
                status="draft",
            )
            item.status = "converted_to_faq"
            item.reviewed_by = str(session.user.id)
            item.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
            db.commit()
            db.refresh(row)
            return HotQuestionToFaqOut(
                faq_uuid=row.uuid,
                question=row.question,
                answer=row.answer,
                status=row.status,
                hot_question_uuid=item.uuid,
            )
        except FaqServiceError as exc:
            db.rollback()
            status = 400
            if exc.code == "DUPLICATE_QUESTION":
                status = 409
            raise HTTPException(
                status_code=status,
                detail={"code": exc.code, "message": exc.message},
            ) from exc

    return router
