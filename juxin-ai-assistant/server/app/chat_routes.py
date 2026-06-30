from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from .auth import get_session, require_action
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
)


router = APIRouter(prefix="/api/ai/chat", tags=["chat"])
conversations_router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def get_chat_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


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
    try:
        prepared = prepare_chat(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return prepared


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
