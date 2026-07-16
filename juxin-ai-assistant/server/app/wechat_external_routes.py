from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import secrets
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .context.context_builder import ContextBuilder
from .crypto import ContentCipher
from .database import get_db
from .external_question_events import record_external_question
from .external_answer_safety import prepare_external_answer
from .external_support_tickets import create_handoff_ticket, decrypt_message, notify_assignees
from .knowledge_embedding import build_embedding_service
from .knowledge_routes import _content_disposition_for_download, _download_media_type, _stored_original_path
from .knowledge_search import search_knowledge_chunks
from .models import ExternalQuestionEvent, ExternalSupportTicket, ExternalSupportTicketMessage, KnowledgeFile, WechatExternalDownloadAudit, WechatExternalQuestionAudit, WechatExternalVisitor
from .server_model_client import generate_with_server_model
from .wechat_external_auth import COOKIE_NAME, consume_state, exchange_code, issue_session, openid_hash, read_session, safe_return_to, upsert_visitor
from .wechat_external_quota import SHANGHAI, WechatExternalQuota
from .wechat_external_schemas import ExternalDocumentOut, ExternalQuestionIn, ExternalSourceOut

router = APIRouter(prefix="/api/wechat/external", tags=["wechat-external"])


def _settings() -> Settings:
    settings = get_settings()
    if not settings.wechat_external_enabled:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return settings


def _visitor(request: Request, settings: Annotated[Settings, Depends(_settings)], db: Annotated[Session, Depends(get_db)]) -> WechatExternalVisitor:
    visitor = db.scalar(select(WechatExternalVisitor).where(WechatExternalVisitor.uuid == read_session(request, settings.wechat_external_session_secret)))
    if visitor is None or visitor.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="EXTERNAL_ACCESS_DENIED")
    return visitor


def _public_files():
    return (
        KnowledgeFile.status == "READY", KnowledgeFile.rag_enabled.is_(True), KnowledgeFile.deleted_at.is_(None), KnowledgeFile.archived_at.is_(None), KnowledgeFile.hard_deleted_at.is_(None),
        KnowledgeFile.usage_type == "official_knowledge", KnowledgeFile.review_status.in_(("approved", "official")),
        KnowledgeFile.external_public.is_(True),
    )


def _downloadable_files():
    return (*_public_files(), KnowledgeFile.external_download_allowed.is_(True))


@router.get("/oauth/login")
def oauth_login(return_to: str = "/", settings: Annotated[Settings, Depends(_settings)] = None):
    from .wechat_external_quota import redis
    if redis is None:
        raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE")
    state = secrets.token_urlsafe(32)
    try:
        client = redis.Redis.from_url(settings.knowledge_redis_url, decode_responses=True, socket_connect_timeout=0.3, socket_timeout=0.5)
        client.setex(f"{settings.wechat_external_redis_prefix}:oauth:{hashlib.sha256(state.encode()).hexdigest()}", 600, safe_return_to(return_to))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE") from exc
    query = urlencode({"appid": settings.wechat_official_account_app_id, "redirect_uri": settings.wechat_oauth_redirect_uri, "response_type": "code", "scope": "snsapi_base", "state": state})
    return RedirectResponse(f"https://open.weixin.qq.com/connect/oauth2/authorize?{query}#wechat_redirect", status_code=302)


@router.get("/oauth/callback")
async def oauth_callback(code: str, state: str, settings: Annotated[Settings, Depends(_settings)], db: Annotated[Session, Depends(get_db)]):
    from .wechat_external_quota import redis
    if redis is None:
        raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE")
    client = redis.Redis.from_url(settings.knowledge_redis_url, decode_responses=True, socket_connect_timeout=0.3, socket_timeout=0.5)
    return_to = consume_state(client, f"{settings.wechat_external_redis_prefix}:oauth:{hashlib.sha256(state.encode()).hexdigest()}")
    if not return_to or not code:
        raise HTTPException(status_code=401, detail="WECHAT_OAUTH_INVALID")
    raw_openid = await exchange_code(code=code, app_id=settings.wechat_official_account_app_id, app_secret=settings.wechat_official_account_app_secret)
    visitor = upsert_visitor(db, hashed_openid=openid_hash(raw_openid, settings.wechat_openid_hash_salt))
    if visitor.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="EXTERNAL_ACCESS_DENIED")
    response = RedirectResponse(f"{settings.wechat_external_h5_origin.rstrip('/')}{safe_return_to(return_to)}", status_code=302)
    response.set_cookie(COOKIE_NAME, issue_session(visitor.uuid, settings.wechat_external_session_secret), max_age=8 * 3600, httponly=True, secure=True, samesite="lax", path="/api/wechat/external")
    return response


@router.post("/session/logout", status_code=204)
def logout(_visitor: Annotated[WechatExternalVisitor, Depends(_visitor)]):
    response = Response(status_code=204)
    response.delete_cookie(COOKIE_NAME, path="/api/wechat/external")
    return response


@router.get("/bootstrap")
def bootstrap(visitor: Annotated[WechatExternalVisitor, Depends(_visitor)], settings: Annotated[Settings, Depends(_settings)]):
    hour, day = WechatExternalQuota.from_settings(settings).remaining(visitor.uuid)
    now = datetime.now(SHANGHAI)
    reset_at = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat()
    return {"hour_remaining": hour, "hour_limit": settings.wechat_external_hourly_question_limit, "day_remaining": day, "day_limit": settings.wechat_external_daily_question_limit, "timezone": "Asia/Shanghai", "day_reset_at": reset_at}


@router.post("/questions")
async def ask_question(body: ExternalQuestionIn, visitor: Annotated[WechatExternalVisitor, Depends(_visitor)], settings: Annotated[Settings, Depends(_settings)], db: Annotated[Session, Depends(get_db)]):
    question = " ".join(body.question.split())
    if not question:
        raise HTTPException(status_code=422, detail="question 不能为空")
    quota = WechatExternalQuota.from_settings(settings)
    reservation = quota.reserve(visitor.uuid)
    audit = WechatExternalQuestionAudit(visitor_id=visitor.id, quota_event_id=reservation.event_id, question_hash=hashlib.sha256(question.encode()).hexdigest())
    cipher = ContentCipher(settings.content_encryption_key)
    db.add(audit)
    event = record_external_question(
        db,
        cipher=cipher,
        source_channel="wechat_official",
        external_identity_hash=visitor.openid_hash,
        conversation_key=visitor.uuid,
        external_message_id=reservation.event_id,
        question=question,
    )
    db.commit()
    try:
        chunks = search_knowledge_chunks(db, sso_user_id="wechat-external", query=question, cipher=cipher, top_k=8, embedding_service=build_embedding_service(db, settings), track_usage=False, external_public_only=True)
        if not chunks:
            quota.refund(visitor.uuid, reservation)
            completed_at = datetime.now(UTC)
            audit.status = "REFUNDED"; audit.completed_at = completed_at
            ticket = create_handoff_ticket(
                db, cipher=cipher, event=event, reason_code="NO_EVIDENCE",
            )
            db.commit()
            notify_assignees(settings=settings, ticket=ticket)
            return {"answer": "当前公开资料中未找到明确依据，已转交人工处理。请稍后在本页面查看回复。", "sources": [], "ticket_uuid": ticket.uuid, "hour_remaining": min(settings.wechat_external_hourly_question_limit, reservation.hour_remaining + 1), "day_remaining": min(settings.wechat_external_daily_question_limit, reservation.day_remaining + 1)}
        messages = ContextBuilder().build_messages(mode="knowledge", current_user_message=question, knowledge_chunks=chunks, personal_reference_chunks=[], recent_messages=[], require_knowledge_evidence=True, external_customer=True)
        result = await generate_with_server_model(
            settings, messages, 0.2,
            max_output_tokens=settings.wechat_external_model_max_output_tokens,
        )
    except Exception as exc:
        quota.refund(visitor.uuid, reservation)
        completed_at = datetime.now(UTC)
        audit.status = "REFUNDED"; audit.failure_code = getattr(exc, "detail", "EXTERNAL_QUESTION_FAILED") if isinstance(getattr(exc, "detail", ""), str) else "EXTERNAL_QUESTION_FAILED"; audit.completed_at = completed_at
        event.status = "FAILED"; event.completed_at = completed_at
        db.commit()
        raise
    answer = prepare_external_answer(
        result.output,
        source_file_names=[chunk.file_name for chunk in chunks],
    )
    if answer is None:
        quota.refund(visitor.uuid, reservation)
        completed_at = datetime.now(UTC)
        audit.status = "REFUNDED"; audit.failure_code = "UNSAFE_MODEL_OUTPUT"; audit.completed_at = completed_at
        ticket = create_handoff_ticket(db, cipher=cipher, event=event, reason_code="UNSAFE_MODEL_OUTPUT")
        db.commit()
        notify_assignees(settings=settings, ticket=ticket)
        return {"answer": "当前无法安全地根据公开资料生成回复，已转交人工处理。请稍后在本页面查看回复。", "sources": [], "ticket_uuid": ticket.uuid, "hour_remaining": min(settings.wechat_external_hourly_question_limit, reservation.hour_remaining + 1), "day_remaining": min(settings.wechat_external_daily_question_limit, reservation.day_remaining + 1)}
    completed_at = datetime.now(UTC)
    source_file_ids = [chunk.file_uuid for chunk in chunks]
    audit.status = "SUCCEEDED"; audit.model_id = result.model_id; audit.latency_ms = result.latency_ms; audit.source_file_ids_json = source_file_ids; audit.completed_at = completed_at
    event.status = "ANSWERED"; event.source_file_ids_json = source_file_ids; event.completed_at = completed_at
    db.commit()
    return {"answer": answer, "sources": [ExternalSourceOut(file_uuid=item.file_uuid, file_name=item.file_name, section_title=item.section_title, page_number=item.page_number).model_dump() for item in chunks], "hour_remaining": reservation.hour_remaining, "day_remaining": reservation.day_remaining}


@router.get("/support-tickets")
def support_tickets(
    visitor: Annotated[WechatExternalVisitor, Depends(_visitor)],
    settings: Annotated[Settings, Depends(_settings)],
    db: Annotated[Session, Depends(get_db)],
):
    """Return only this H5 visitor's tickets and human replies."""
    cipher = ContentCipher(settings.content_encryption_key)
    rows = list(db.scalars(select(ExternalSupportTicket).join(
        ExternalQuestionEvent,
        ExternalSupportTicket.external_question_event_id == ExternalQuestionEvent.id,
    ).where(
        ExternalSupportTicket.source_channel == "wechat_official",
        ExternalQuestionEvent.conversation_key == visitor.uuid,
    ).order_by(ExternalSupportTicket.created_at.desc())))
    return {"items": [{
        "uuid": ticket.uuid,
        "status": ticket.status,
        "created_at": ticket.created_at.isoformat(),
        "replied_at": ticket.replied_at.isoformat() if ticket.replied_at else None,
        "messages": [{
            "message": decrypt_message(cipher, message),
            "created_at": message.created_at.isoformat(),
        } for message in db.scalars(select(ExternalSupportTicketMessage).where(
            ExternalSupportTicketMessage.ticket_id == ticket.id,
        ).order_by(ExternalSupportTicketMessage.created_at.asc()))],
    } for ticket in rows]}


@router.get("/documents", response_model=list[ExternalDocumentOut])
def documents(_visitor: Annotated[WechatExternalVisitor, Depends(_visitor)], db: Annotated[Session, Depends(get_db)]):
    rows = db.scalars(select(KnowledgeFile).where(*_downloadable_files()).order_by(KnowledgeFile.updated_at.desc()).limit(50)).all()
    return [ExternalDocumentOut(file_uuid=row.uuid, file_name=row.file_name, summary=row.summary, file_type=row.file_type, file_size=row.file_size, updated_at=row.updated_at.isoformat()) for row in rows]


@router.post("/documents/{file_uuid}/download-token")
def issue_download_token(file_uuid: str, visitor: Annotated[WechatExternalVisitor, Depends(_visitor)], settings: Annotated[Settings, Depends(_settings)], db: Annotated[Session, Depends(get_db)]):
    file_record = db.scalar(select(KnowledgeFile).where(KnowledgeFile.uuid == file_uuid, *_downloadable_files()))
    if file_record is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    token = secrets.token_urlsafe(32)
    db.add(WechatExternalDownloadAudit(visitor_id=visitor.id, file_id=file_record.id, download_token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.now(UTC) + timedelta(seconds=settings.wechat_external_download_token_ttl_seconds)))
    db.commit()
    return {"download_url": f"/api/wechat/external/downloads/{token}"}


@router.get("/downloads/{token}")
def download(token: str, visitor: Annotated[WechatExternalVisitor, Depends(_visitor)], settings: Annotated[Settings, Depends(_settings)], db: Annotated[Session, Depends(get_db)]):
    audit = db.scalar(select(WechatExternalDownloadAudit).where(WechatExternalDownloadAudit.download_token_hash == hashlib.sha256(token.encode()).hexdigest(), WechatExternalDownloadAudit.visitor_id == visitor.id, WechatExternalDownloadAudit.status == "ISSUED"))
    if audit is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    expires_at = audit.expires_at if audit.expires_at.tzinfo else audit.expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        audit.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    file_record = db.scalar(select(KnowledgeFile).where(KnowledgeFile.id == audit.file_id, *_downloadable_files()))
    if file_record is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    stored_path = _stored_original_path(file_record, storage_root=settings.knowledge_storage_dir)
    audit.status = "DOWNLOADED"; audit.downloaded_at = datetime.now(UTC); db.commit()
    return Response(stored_path.read_bytes(), media_type=_download_media_type(file_record.file_type), headers={"Content-Disposition": _content_disposition_for_download(file_record.original_file_name or file_record.file_name), "Cache-Control": "no-store"})
