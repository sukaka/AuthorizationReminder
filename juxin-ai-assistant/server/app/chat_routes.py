import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .admin.route_common import write_request_audit
from .chat_service import (
    archive_chat_session,
    bulk_archive_chat_sessions,
    bulk_soft_delete_chat_sessions,
    complete_chat_message,
    fail_chat_message,
    get_chat_session_detail,
    hard_delete_chat_session,
    list_chat_sessions,
    prepare_chat,
    rename_chat_session,
    restore_chat_session,
    save_knowledge_result_to_chat_history,
    soft_delete_chat_session,
)
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
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
from .sensitive import SensitiveDetector, derive_confirmation_key
from .user_model_profiles import decrypt_user_model_api_key, get_default_user_model_profile


router = APIRouter(prefix="/api/ai/chat", tags=["chat"])
conversations_router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def get_chat_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


def _ndjson_line(payload: dict) -> str:
    return f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n"


def _chat_model_config_for_user(
    db: Session,
    user_id: str,
    current_settings: Settings,
    cipher: ContentCipher,
) -> ModelRequestConfig:
    user_model_profile = get_default_user_model_profile(db, user_id)
    if user_model_profile is not None:
        return ModelRequestConfig(
            base_url=user_model_profile.base_url,
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
    )


@router.get("/sessions", response_model=ChatSessionListOut)
async def chat_sessions(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionListOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    items = list_chat_sessions(db, sso_user_id=str(session_payload.user.id))
    return ChatSessionListOut(items=items, total=len(items))


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
) -> ChatSessionDetailOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    return get_chat_session_detail(
        db,
        sso_user_id=str(session_payload.user.id),
        session_uuid=session_uuid,
        cipher=cipher,
    )


@router.delete("/sessions/{session_uuid}", status_code=204)
async def delete_chat_session(
    session_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        soft_delete_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=session_uuid,
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
    sensitive_detector = SensitiveDetector(
        derive_confirmation_key(current_settings.content_encryption_key)
    )
    sensitive_scan = sensitive_detector.scan({"question": body.question})
    if sensitive_scan.findings and not sensitive_detector.is_confirmed(
        sensitive_scan,
        body.sensitive_confirmation_digest,
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SENSITIVE_CONFIRMATION_REQUIRED",
                "message": "检测到敏感信息，请确认后继续",
                "findings": [
                    {
                        "code": finding.code,
                        "field": finding.field,
                        "preview": finding.preview,
                    }
                    for finding in sensitive_scan.findings
                ],
                "confirmation_digest": sensitive_scan.confirmation_digest,
            },
        )
    try:
        prepared = prepare_chat(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
            web_search_provider=current_settings.web_search_provider,
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
                "risk_confirmation": bool(body.sensitive_confirmation_digest),
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
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ChatMessageStatusOut(message_uuid=message.uuid, status=message.status)


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
    user_model_profile = get_default_user_model_profile(db, str(session_payload.user.id))
    if user_model_profile is not None:
        result = await generate_with_model_config(
            ModelRequestConfig(
                base_url=user_model_profile.base_url,
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
    config = _chat_model_config_for_user(db, user_id, current_settings, cipher)

    async def stream_events():
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
                    answer_parts.append(event.delta)
                    yield _ndjson_line({"type": "delta", "delta": event.delta})
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
            )
            db.commit()
            yield _ndjson_line({
                "type": "complete",
                "message_uuid": message.uuid,
                "status": message.status,
                "answer": answer,
                "model_display_name": complete_body.model_display_name,
                "model_id": complete_body.model_id,
                "usage": usage,
                "latency_ms": latency_ms,
            })
        except HTTPException as exc:
            db.rollback()
            yield _ndjson_line({"type": "error", "detail": exc.detail})
        except Exception:
            db.rollback()
            yield _ndjson_line({"type": "error", "detail": "SERVER_MODEL_FAILED"})

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
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    items = list_chat_sessions(db, sso_user_id=str(session_payload.user.id), status="active")
    return ChatSessionListOut(items=items, total=len(items))


@conversations_router.get("/archived", response_model=ChatSessionListOut)
async def archived_conversations(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    items = list_chat_sessions(db, sso_user_id=str(session_payload.user.id), status="archived")
    return ChatSessionListOut(items=items, total=len(items))


@conversations_router.get("/trash", response_model=ChatSessionListOut)
async def trashed_conversations(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionListOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    items = list_chat_sessions(db, sso_user_id=str(session_payload.user.id), status="deleted")
    return ChatSessionListOut(items=items, total=len(items))


@conversations_router.post("/{conversation_id}/archive", response_model=ConversationMutationOut)
async def archive_conversation(
    conversation_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        item = archive_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=conversation_id,
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
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        item = restore_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=conversation_id,
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
) -> ChatSessionItemOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        item = rename_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=conversation_id,
            title=body.title,
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
) -> ConversationMutationOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        item = soft_delete_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=conversation_id,
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
) -> Response:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        hard_delete_chat_session(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuid=conversation_id,
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
) -> ConversationBulkOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        affected = bulk_archive_chat_sessions(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuids=body.conversation_ids,
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
) -> ConversationBulkOut:
    await _require_ai_assistant_use(request, session_payload, current_settings)
    try:
        affected = bulk_soft_delete_chat_sessions(
            db,
            sso_user_id=str(session_payload.user.id),
            session_uuids=body.conversation_ids,
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
