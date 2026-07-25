import json
import hashlib
import hmac
import logging
from dataclasses import replace
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .admin.route_common import write_request_audit
from .chat_service import (
    archive_chat_session,
    bulk_archive_chat_sessions,
    bulk_soft_delete_chat_sessions,
    complete_chat_message,
    create_chat_session,
    fail_chat_message,
    get_chat_session_detail,
    hard_delete_chat_session,
    list_chat_sessions,
    message_citations,
    message_generated_files,
    prepare_chat,
    rename_chat_session,
    restore_chat_session,
    save_knowledge_result_to_chat_history,
    soft_delete_chat_session,
)
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .models import ChatMessage, ChatSession
from .model_endpoint_security import validate_user_model_endpoint
from .project_access import require_project_access
from .schemas import (
    ChatCompleteIn,
    ChatFailIn,
    ChatGenerateIn,
    ChatGenerateOut,
    ChatKnowledgeResultIn,
    ChatKnowledgeResultOut,
    ChatMessageStatusOut,
    ChatPrepareIn,
    ChatPrepareOut,
    ChatSessionDetailOut,
    ChatSessionItemOut,
    ChatSessionListOut,
    ConversationBulkIn,
    ConversationBulkOut,
    ConversationMutationOut,
    ConversationRenameIn,
    SessionPayload,
    ServerModelStatusOut,
)
from .server_model_client import (
    ModelRequestConfig,
    generate_with_model_config,
    generate_with_server_model,
    is_server_model_configured,
    stream_with_model_config,
)
from .sensitive import derive_confirmation_key
from .user_model_profiles import decrypt_user_model_api_key, get_default_user_model_profile


router = APIRouter(prefix="/api/ai/chat", tags=["chat"])
conversations_router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _require_project_scope(
    db: Session,
    *,
    project_uuid: str | None,
    user_id: str,
) -> None:
    if project_uuid:
        require_project_access(db, project_uuid, user_id)


def get_chat_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


def _ndjson_line(payload: dict) -> str:
    return f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n"


def _verify_prepared_message_context(
    *,
    completion_token: str,
    messages: list,
    user_id: str,
    current_settings: Settings,
) -> None:
    """Reject any client mutation of the model context prepared by the server."""
    nonce, separator, received_signature = completion_token.partition(".")
    if not nonce or not separator or len(received_signature) != 64:
        raise HTTPException(status_code=403, detail="CHAT_MESSAGE_CONTEXT_INVALID")
    canonical_messages = json.dumps(
        [message.model_dump() for message in messages],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    payload = f"{user_id}\n{nonce}\n{canonical_messages}".encode("utf-8")
    expected_signature = hmac.new(
        derive_confirmation_key(current_settings.content_encryption_key),
        payload,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(received_signature, expected_signature):
        raise HTTPException(status_code=403, detail="CHAT_MESSAGE_CONTEXT_INVALID")


def _chat_model_config_for_user(
    db: Session,
    user_id: str,
    current_settings: Settings,
    cipher: ContentCipher,
) -> ModelRequestConfig:
    user_model_profile = get_default_user_model_profile(db, user_id)
    if user_model_profile is not None:
        base_url = validate_user_model_endpoint(user_model_profile.base_url, current_settings)
        return ModelRequestConfig(
            base_url=base_url,
            api_key=decrypt_user_model_api_key(cipher, user_model_profile),
            model_id=user_model_profile.model_id,
            display_name=user_model_profile.display_name,
            timeout_seconds=user_model_profile.timeout_seconds,
            max_output_tokens=user_model_profile.max_output_tokens,
        )
    if not is_server_model_configured(current_settings):
        raise HTTPException(status_code=409, detail="SERVER_MODEL_NOT_CONFIGURED")
    return ModelRequestConfig(
        base_url=current_settings.server_model_base_url,
        api_key=current_settings.server_model_api_key,
        model_id=current_settings.server_model_id,
        display_name=current_settings.server_model_display_name or current_settings.server_model_id,
        timeout_seconds=current_settings.server_model_timeout_seconds,
        max_output_tokens=current_settings.server_model_max_output_tokens,
        disable_thinking=True,
    )


def _route_model_config(
    config: ModelRequestConfig,
    messages,
) -> ModelRequestConfig:
    user_text = ""
    for message in reversed(messages):
        if message.role == "user":
            user_text = message.content.strip().lower()
            break
    long_markers = ("完整", "全部", "所有", "详细方案", "报告", "总结", "汇总", "分析")
    if any(marker in user_text for marker in long_markers) or len(user_text) > 300:
        routed_limit = min(config.max_output_tokens, 4096)
        disable_thinking = False
    else:
        routed_limit = min(config.max_output_tokens, 1536)
        disable_thinking = config.disable_thinking
    return replace(
        config,
        max_output_tokens=routed_limit,
        disable_thinking=disable_thinking,
    )


@router.get("/sessions", response_model=ChatSessionListOut)
async def chat_sessions(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=40, ge=1, le=100),
) -> ChatSessionListOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    items, total = list_chat_sessions(
        db,
        sso_user_id=user_id,
        project_uuid=project_uuid,
        page=page,
        page_size=page_size,
    )
    return ChatSessionListOut(items=items, total=total, page=page, page_size=page_size)


async def _require_ai_assistant_use(
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


@router.get("/sessions/{session_uuid}", response_model=ChatSessionDetailOut)
async def chat_session_detail(
    session_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ChatSessionDetailOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    return get_chat_session_detail(
        db,
        sso_user_id=user_id,
        session_uuid=session_uuid,
        cipher=cipher,
        project_uuid=project_uuid,
    )


@router.delete("/sessions/{session_uuid}", status_code=204)
async def delete_chat_session(
    session_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> Response:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        soft_delete_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=session_uuid,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return Response(status_code=204)


@router.post("/prepare", response_model=ChatPrepareOut, status_code=201)
async def chat_prepare(
    body: ChatPrepareIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
) -> ChatPrepareOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    _require_project_scope(
        db,
        project_uuid=body.project_uuid,
        user_id=str(session_payload.user.id),
    )
    try:
        prepared = prepare_chat(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
            web_search_provider=current_settings.web_search_provider,
            settings=current_settings,
        )
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="chat.prepare",
            entity_type="chat_session",
            entity_uuid=prepared.session_uuid,
            metadata={
                "status": "PREPARED",
                "risk_confirmation": False,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return prepared


@router.get("/model/status", response_model=ServerModelStatusOut)
async def chat_model_status(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ServerModelStatusOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    configured = is_server_model_configured(current_settings)
    return ServerModelStatusOut(
        configured=configured,
        model_display_name=current_settings.server_model_display_name if configured else "",
        model_id=current_settings.server_model_id if configured else "",
        message="服务端模型已配置" if configured else "服务端模型未配置，请联系管理员在服务器环境变量中配置。",
    )


@router.post(
    "/messages/{message_uuid}/complete",
    response_model=ChatMessageStatusOut,
)
async def chat_message_complete(
    message_uuid: str,
    body: ChatCompleteIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
) -> ChatMessageStatusOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        message = complete_chat_message(
            db,
            sso_user_id=str(session_payload.user.id),
            message_uuid=message_uuid,
            body=body,
            cipher=cipher,
            session_payload=session_payload,
            settings=current_settings,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ChatMessageStatusOut(
        message_uuid=message.uuid,
        status=message.status,
        citations=message_citations(db, cipher, message),
        generated_files=message_generated_files(message),
    )


@router.post(
    "/messages/{message_uuid}/generate",
    response_model=ChatGenerateOut,
)
async def chat_message_generate(
    message_uuid: str,
    body: ChatGenerateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
) -> ChatGenerateOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    _verify_prepared_message_context(
        completion_token=body.completion_token,
        messages=body.messages,
        user_id=str(session_payload.user.id),
        current_settings=current_settings,
    )
    user_model_profile = get_default_user_model_profile(db, str(session_payload.user.id))
    if user_model_profile is not None:
        base_url = validate_user_model_endpoint(user_model_profile.base_url, current_settings)
        result = await generate_with_model_config(
            ModelRequestConfig(
                base_url=base_url,
                api_key=decrypt_user_model_api_key(cipher, user_model_profile),
                model_id=user_model_profile.model_id,
                display_name=user_model_profile.display_name,
                timeout_seconds=user_model_profile.timeout_seconds,
                max_output_tokens=user_model_profile.max_output_tokens,
            ),
            [message.model_dump() for message in body.messages],
            body.temperature,
        )
    else:
        result = await generate_with_server_model(
            current_settings,
            [message.model_dump() for message in body.messages],
            body.temperature,
        )
    complete_body = ChatCompleteIn(
        completion_token=body.completion_token,
        answer=result.output,
        model_display_name=result.model_display_name,
        model_id=result.model_id,
        usage=result.usage,
        latency_ms=result.latency_ms,
    )
    try:
        message = complete_chat_message(
            db,
            sso_user_id=str(session_payload.user.id),
            message_uuid=message_uuid,
            body=complete_body,
            cipher=cipher,
            session_payload=session_payload,
            settings=current_settings,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ChatGenerateOut(
        message_uuid=message.uuid,
        status=message.status,
        answer=result.output,
        model_display_name=complete_body.model_display_name,
        model_id=complete_body.model_id,
        usage=result.usage,
        latency_ms=result.latency_ms,
        citations=message_citations(db, cipher, message),
        generated_files=message_generated_files(message),
    )


@router.post("/messages/{message_uuid}/generate/stream")
async def chat_message_generate_stream(
    message_uuid: str,
    body: ChatGenerateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
) -> StreamingResponse:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    user_id = str(session_payload.user.id)
    _verify_prepared_message_context(
        completion_token=body.completion_token,
        messages=body.messages,
        user_id=user_id,
        current_settings=current_settings,
    )
    config = _route_model_config(
        _chat_model_config_for_user(db, user_id, current_settings, cipher),
        body.messages,
    )
    conversation_id = db.scalar(
        select(ChatSession.uuid)
        .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(
            ChatMessage.uuid == message_uuid,
            ChatMessage.sso_user_id == user_id,
            ChatSession.sso_user_id == user_id,
        )
    )
    if not conversation_id:
        raise HTTPException(status_code=404, detail="聊天消息不存在或无权访问")

    async def stream_events():
        stream_started = perf_counter()
        first_token_ms: float | None = None
        answer_parts: list[str] = []
        usage: dict = {}
        latency_ms: int | None = None
        try:
            async for event in stream_with_model_config(
                config,
                [message.model_dump() for message in body.messages],
                body.temperature,
            ):
                if event.delta:
                    if first_token_ms is None:
                        first_token_ms = (perf_counter() - stream_started) * 1000
                    answer_parts.append(event.delta)
                    yield _ndjson_line({
                        "conversation_id": conversation_id,
                        "message_id": message_uuid,
                        "request_id": message_uuid,
                        "type": "delta",
                        "delta": event.delta,
                    })
                if event.usage is not None:
                    usage = event.usage
                if event.latency_ms is not None:
                    latency_ms = event.latency_ms
            answer = "".join(answer_parts)
            if not answer.strip():
                raise HTTPException(status_code=502, detail="SERVER_MODEL_EMPTY_OUTPUT")
            complete_body = ChatCompleteIn(
                completion_token=body.completion_token,
                answer=answer,
                model_display_name=config.display_name,
                model_id=config.model_id,
                usage=usage,
                latency_ms=latency_ms,
            )
            message = complete_chat_message(
                db,
                sso_user_id=user_id,
                message_uuid=message_uuid,
                body=complete_body,
                cipher=cipher,
                session_payload=session_payload,
                settings=current_settings,
            )
            db.commit()
            yield _ndjson_line({
                "conversation_id": conversation_id,
                "message_id": message.uuid,
                "request_id": message_uuid,
                "type": "complete",
                "message_uuid": message.uuid,
                "status": message.status,
                "answer": answer,
                "model_display_name": complete_body.model_display_name,
                "model_id": complete_body.model_id,
                "usage": usage,
                "latency_ms": latency_ms,
                "citations": [
                    citation.model_dump()
                    for citation in message_citations(db, cipher, message)
                ],
                "generated_files": [
                    generated_file.model_dump()
                    for generated_file in message_generated_files(message)
                ],
            })
            logging.getLogger(__name__).info(
                "model_generation_metrics %s",
                json.dumps({
                    "conversation_id": conversation_id,
                    "message_id": message.uuid,
                    "model_first_token_ms": round(first_token_ms or 0.0, 2),
                    "model_total_ms": round((perf_counter() - stream_started) * 1000, 2),
                }, separators=(",", ":")),
            )
        except HTTPException as exc:
            db.rollback()
            yield _ndjson_line({
                "conversation_id": conversation_id,
                "message_id": message_uuid,
                "request_id": message_uuid,
                "type": "error",
                "detail": exc.detail,
            })
        except Exception:
            db.rollback()
            yield _ndjson_line({
                "conversation_id": conversation_id,
                "message_id": message_uuid,
                "request_id": message_uuid,
                "type": "error",
                "detail": "SERVER_MODEL_FAILED",
            })

    return StreamingResponse(
        stream_events(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )


@router.post("/knowledge-result", response_model=ChatKnowledgeResultOut, status_code=201)
async def chat_knowledge_result(
    body: ChatKnowledgeResultIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_chat_content_cipher)],
) -> ChatKnowledgeResultOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        result = save_knowledge_result_to_chat_history(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@conversations_router.get("", response_model=ChatSessionListOut)
async def active_conversations(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=40, ge=1, le=100),
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    items, total = list_chat_sessions(
        db,
        sso_user_id=user_id,
        status="active",
        project_uuid=project_uuid,
        page=page,
        page_size=page_size,
    )
    return ChatSessionListOut(items=items, total=total, page=page, page_size=page_size)


@conversations_router.post("", response_model=ChatSessionItemOut, status_code=201)
async def create_conversation(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ChatSessionItemOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        item = create_chat_session(
            db,
            sso_user_id=user_id,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return item


@conversations_router.get("/archived", response_model=ChatSessionListOut)
async def archived_conversations(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=40, ge=1, le=100),
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    items, total = list_chat_sessions(
        db,
        sso_user_id=user_id,
        status="archived",
        project_uuid=project_uuid,
        page=page,
        page_size=page_size,
    )
    return ChatSessionListOut(items=items, total=total, page=page, page_size=page_size)


@conversations_router.get("/trash", response_model=ChatSessionListOut)
async def trashed_conversations(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=40, ge=1, le=100),
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    items, total = list_chat_sessions(
        db,
        sso_user_id=user_id,
        status="deleted",
        project_uuid=project_uuid,
        page=page,
        page_size=page_size,
    )
    return ChatSessionListOut(items=items, total=total, page=page, page_size=page_size)


@conversations_router.post("/{conversation_id}/archive", response_model=ConversationMutationOut)
async def archive_conversation(
    conversation_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        item = archive_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=conversation_id,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ConversationMutationOut(session_uuid=item.session_uuid, status=item.status)  # type: ignore[arg-type]


@conversations_router.post("/{conversation_id}/restore", response_model=ConversationMutationOut)
async def restore_conversation(
    conversation_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        item = restore_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=conversation_id,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ConversationMutationOut(session_uuid=item.session_uuid, status=item.status)  # type: ignore[arg-type]


@conversations_router.post("/{conversation_id}/rename", response_model=ChatSessionItemOut)
async def rename_conversation(
    conversation_id: str,
    body: ConversationRenameIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ChatSessionItemOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        item = rename_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=conversation_id,
            title=body.title,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return item


@conversations_router.post("/{conversation_id}/delete", response_model=ConversationMutationOut)
async def delete_conversation(
    conversation_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        item = soft_delete_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=conversation_id,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ConversationMutationOut(session_uuid=item.session_uuid, status=item.status)  # type: ignore[arg-type]


@conversations_router.delete("/{conversation_id}/hard-delete", status_code=204)
async def hard_delete_conversation(
    conversation_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> Response:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        hard_delete_chat_session(
            db,
            sso_user_id=user_id,
            session_uuid=conversation_id,
            project_uuid=project_uuid,
            storage_root=current_settings.knowledge_storage_dir,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return Response(status_code=204)


@conversations_router.post("/bulk-archive", response_model=ConversationBulkOut)
async def bulk_archive_conversations(
    body: ConversationBulkIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ConversationBulkOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        affected = bulk_archive_chat_sessions(
            db,
            sso_user_id=user_id,
            session_uuids=body.conversation_ids,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ConversationBulkOut(affected=affected)


@conversations_router.post("/bulk-delete", response_model=ConversationBulkOut)
async def bulk_delete_conversations(
    body: ConversationBulkIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    project_uuid: str | None = Query(default=None, max_length=64),
) -> ConversationBulkOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    _require_project_scope(db, project_uuid=project_uuid, user_id=user_id)
    try:
        affected = bulk_soft_delete_chat_sessions(
            db,
            sso_user_id=user_id,
            session_uuids=body.conversation_ids,
            project_uuid=project_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ConversationBulkOut(affected=affected)


@router.post(
    "/messages/{message_uuid}/fail",
    response_model=ChatMessageStatusOut,
)
async def chat_message_fail(
    message_uuid: str,
    body: ChatFailIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatMessageStatusOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        message = fail_chat_message(
            db,
            sso_user_id=str(session_payload.user.id),
            message_uuid=message_uuid,
            body=body,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ChatMessageStatusOut(message_uuid=message.uuid, status=message.status)
