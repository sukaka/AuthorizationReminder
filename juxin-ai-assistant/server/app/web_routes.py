from datetime import UTC, datetime
import hashlib
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .direct_action_service import DirectActionReplay, DirectActionService
from .knowledge_embedding import build_embedding_service
from .knowledge_files import create_knowledge_file_from_bytes
from .models import KnowledgeFile, WebCapture
from .schemas import (
    SessionPayload,
    WebCaptureConfirmIn,
    WebCaptureConfirmOut,
    WebCapturePreviewIn,
    WebCapturePreviewOut,
)
from .web_sources import (
    CategorySuggester,
    ContentExtractor,
    WebFetcher,
    build_web_capture_markdown,
)


router = APIRouter(prefix="/api/web", tags=["web"])


def _content_cipher(current_settings: Settings) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


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


def _safe_web_file_name(title: str) -> str:
    normalized = re.sub(r"[\\/:*?\"<>|\r\n\t]+", " ", title).strip()
    normalized = re.sub(r"\s+", " ", normalized)[:80].strip()
    return f"{normalized or '网页资料'}.md"


def _preview_out(capture: WebCapture) -> WebCapturePreviewOut:
    return WebCapturePreviewOut(
        capture_id=capture.uuid,
        title=capture.title,
        site_name=capture.site_name,
        url=capture.url,
        final_url=capture.final_url,
        fetched_at=capture.fetched_at or capture.created_at,
        published_at=capture.published_at_text,
        word_count=capture.word_count,
        summary=capture.summary,
        suggested_category=capture.suggested_category,
        suggested_document_type=capture.suggested_document_type,
        validity="已完成安全校验，仅提取正文文本",
        scope="确认前仅本次预览，不会写入正式知识库",
    )


def _idempotency_key(request: Request) -> str:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key 请求头不能为空")
    if len(key) > 128:
        raise HTTPException(status_code=400, detail="Idempotency-Key 不能超过 128 个字符")
    return key


def _replay_or_raise(replay: DirectActionReplay) -> dict:
    if replay.payload is not None:
        return replay.payload
    raise HTTPException(status_code=replay.status_code, detail={
        "code": replay.error_code,
        "message": replay.error_message_safe,
    })


@router.post("/captures/preview", response_model=WebCapturePreviewOut, status_code=201)
async def preview_web_capture(
    body: WebCapturePreviewIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> WebCapturePreviewOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    action_service = DirectActionService(db)
    invocation, replay = action_service.begin(
        user_id=user_id,
        action_name="web_capture_preview",
        idempotency_key=_idempotency_key(request),
        request_payload={"url": body.url, "conversation_id": body.conversation_id.strip()},
        timeout_seconds=30,
    )
    if replay is not None:
        return WebCapturePreviewOut.model_validate(_replay_or_raise(replay))
    assert invocation is not None

    try:
        fetch_result = WebFetcher().fetch(body.url)
        extracted = ContentExtractor().extract(fetch_result)
        suggester = CategorySuggester()
        suggestion_text = "\n".join([extracted.title, extracted.summary, extracted.text[:2000]])
        capture = WebCapture(
            user_id=user_id,
            conversation_id=body.conversation_id.strip(),
            url=fetch_result.url,
            final_url=fetch_result.final_url,
            site_name=extracted.site_name,
            title=extracted.title,
            summary=extracted.summary,
            extracted_text=extracted.text,
            content_hash=hashlib.sha256(extracted.text.encode("utf-8")).hexdigest(),
            published_at_text=extracted.published_at,
            fetched_at=fetch_result.fetched_at.replace(tzinfo=None),
            word_count=extracted.word_count,
            suggested_category=suggester.suggest_category(suggestion_text),
            suggested_document_type=suggester.suggest_document_type(suggestion_text),
            status="previewed",
            review_status="none",
        )
        db.add(capture)
        db.flush()
        payload = _preview_out(capture).model_dump(mode="json")
        action_service.succeed(invocation, status_code=201, payload=payload)
        return WebCapturePreviewOut.model_validate(payload)
    except Exception as exc:
        action_service.fail(
            invocation,
            error_code="WEB_CAPTURE_PREVIEW_FAILED",
            error_message_safe="网页采集预览失败，请使用新的幂等键重试",
        )
        raise exc


@router.post("/captures/{capture_id}/confirm", response_model=WebCaptureConfirmOut)
async def confirm_web_capture(
    capture_id: str,
    body: WebCaptureConfirmIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> WebCaptureConfirmOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    idempotency_key = _idempotency_key(request)
    request_payload = {
        "capture_id": capture_id,
        "save_target": body.save_target,
        "category": body.category.strip(),
        "document_type": body.document_type.strip(),
        "tags": [tag.strip() for tag in body.tags],
        "conversation_id": body.conversation_id.strip(),
    }
    action_service = DirectActionService(db)
    invocation, replay = action_service.begin(
        user_id=user_id,
        action_name="web_capture_confirm",
        idempotency_key=idempotency_key,
        request_payload=request_payload,
        timeout_seconds=120,
    )
    if replay is not None:
        return WebCaptureConfirmOut.model_validate(_replay_or_raise(replay))
    assert invocation is not None
    capture = db.scalar(
        select(WebCapture).where(
            WebCapture.uuid == capture_id,
            WebCapture.user_id == user_id,
        )
    )
    if capture is None:
        action_service.fail(invocation, error_code="WEB_CAPTURE_NOT_FOUND", error_message_safe="网页采集记录不存在")
        raise HTTPException(status_code=404, detail="网页采集记录不存在")
    if capture.status == "saved":
        if capture.save_target != body.save_target or capture.knowledge_file_id is None:
            action_service.fail(invocation, error_code="WEB_CAPTURE_ALREADY_SAVED", error_message_safe="网页采集记录已保存，不能更换保存目标")
            raise HTTPException(status_code=409, detail="网页采集记录已保存，不能更换保存目标")
        file_record = db.scalar(select(KnowledgeFile).where(KnowledgeFile.id == capture.knowledge_file_id))
        if file_record is None:
            action_service.fail(invocation, error_code="WEB_CAPTURE_RECONCILIATION_REQUIRED", error_message_safe="已保存记录缺少知识文件，必须先对账")
            raise HTTPException(status_code=409, detail="已保存记录缺少知识文件，必须先对账")
        payload = WebCaptureConfirmOut(
            capture_id=capture.uuid,
            status=capture.status,
            save_target=capture.save_target,
            knowledge_file_uuid=file_record.uuid,
            message="网页内容已按原保存目标处理",
        ).model_dump(mode="json")
        action_service.succeed(invocation, status_code=200, payload=payload)
        return WebCaptureConfirmOut.model_validate(payload)
    if capture.status != "previewed":
        action_service.fail(invocation, error_code="WEB_CAPTURE_STATE_CONFLICT", error_message_safe="网页采集记录状态不可操作")
        raise HTTPException(status_code=409, detail="网页采集记录状态不可操作")

    if body.save_target == "cancel":
        capture.status = "cancelled"
        capture.save_target = "cancel"
        capture.review_status = "none"
        payload = WebCaptureConfirmOut(
            capture_id=capture.uuid,
            status=capture.status,
            save_target=capture.save_target,
            message="已取消网页采集",
        ).model_dump(mode="json")
        action_service.succeed(invocation, status_code=200, payload=payload)
        return WebCaptureConfirmOut.model_validate(payload)

    conversation_id = body.conversation_id.strip() or capture.conversation_id
    if body.save_target == "temporary" and not conversation_id:
        action_service.fail(invocation, error_code="WEB_CAPTURE_CONVERSATION_REQUIRED", error_message_safe="仅本次使用必须关联当前会话")
        raise HTTPException(status_code=422, detail="仅本次使用必须关联当前会话")

    category = body.category.strip() or capture.suggested_category or "个人素材"
    document_type = body.document_type.strip() or capture.suggested_document_type or "其他"
    content = build_web_capture_markdown(
        url=capture.url,
        final_url=capture.final_url,
        content=type(
            "_SavedWebContent",
            (),
            {
                "title": capture.title,
                "site_name": capture.site_name,
                "published_at": capture.published_at_text,
                "summary": capture.summary,
                "text": capture.extracted_text,
            },
        )(),
    ).encode("utf-8")

    if body.save_target == "temporary":
        usage_type = "session_attachment"
        review_status = "draft"
        source_kind = "current_web_capture"
        rag_scope = "session"
        permission_scope = "private"
        visibility = "PRIVATE"
        reference_enabled = True
        message = "网页内容已保存为当前会话资料"
    elif body.save_target == "official_knowledge_candidate":
        usage_type = "personal_reference"
        review_status = "pending"
        source_kind = "official_knowledge_candidate"
        rag_scope = "personal"
        permission_scope = "private"
        visibility = "PRIVATE"
        reference_enabled = True
        message = "网页内容已提交管理员审核"
    else:
        usage_type = "personal_reference"
        review_status = "draft"
        source_kind = "personal_reference"
        rag_scope = "personal"
        permission_scope = "private"
        visibility = "PRIVATE"
        reference_enabled = True
        message = "网页内容已保存到我的资料"

    try:
        file_record, _chunks = create_knowledge_file_from_bytes(
            db,
            sso_user_id=user_id,
            file_name=_safe_web_file_name(capture.title),
            content=content,
            content_type="text/markdown; charset=utf-8",
            cipher=_content_cipher(current_settings),
            key_version=current_settings.content_encryption_key_version,
            visibility=visibility,
            source_type="web_capture",
            source_origin="web_capture",
            web_capture_id=capture.uuid,
            source_url=capture.final_url or capture.url,
            usage_type=usage_type,
            review_status=review_status,
            rag_enabled=False,
            reference_enabled=reference_enabled,
            rag_scope=rag_scope,
            permission_scope=permission_scope,
            owner_user_id=user_id,
            conversation_id=conversation_id,
            category=category[:64],
            document_type=document_type[:64],
            tags=[tag.strip()[:64] for tag in body.tags if tag.strip()],
            uploaded_by=user_id,
            storage_root=current_settings.knowledge_storage_dir,
            file_type_override="webpage",
            embedding_service=build_embedding_service(db, current_settings),
            extra_metadata={
                "source_origin": "web_capture",
                "web_capture_id": capture.uuid,
                "source_url": capture.final_url or capture.url,
                "original_url": capture.url,
                "site_name": capture.site_name,
                "fetched_at": capture.fetched_at.isoformat() if capture.fetched_at else "",
                "published_at": capture.published_at_text,
                "content_hash": capture.content_hash,
                "category_id": category[:64],
                "document_type_id": document_type[:64],
                "source_type": source_kind,
            },
        )
        capture.status = "saved"
        capture.save_target = body.save_target
        capture.review_status = "pending" if body.save_target == "official_knowledge_candidate" else "none"
        capture.knowledge_file_id = file_record.id
        db.refresh(file_record)
        payload = WebCaptureConfirmOut(
            capture_id=capture.uuid,
            status=capture.status,
            save_target=capture.save_target,
            knowledge_file_uuid=file_record.uuid,
            message=message,
        ).model_dump(mode="json")
        action_service.succeed(invocation, status_code=200, payload=payload)
        return WebCaptureConfirmOut.model_validate(payload)
    except Exception:
        action_service.fail(
            invocation,
            error_code="WEB_CAPTURE_CONFIRM_FAILED",
            error_message_safe="网页采集保存失败，请使用新的幂等键重试",
        )
        raise


@router.get("/captures/{capture_id}", response_model=WebCapturePreviewOut)
async def get_web_capture(
    capture_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> WebCapturePreviewOut:
    await _require_use(request, session_payload, current_settings)
    capture = db.scalar(
        select(WebCapture).where(
            WebCapture.uuid == capture_id,
            WebCapture.user_id == str(session_payload.user.id),
        )
    )
    if capture is None:
        raise HTTPException(status_code=404, detail="网页采集记录不存在")
    return _preview_out(capture)
