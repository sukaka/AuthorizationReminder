import hashlib
import hmac
import secrets
import uuid as uuid_lib
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .agent_loop import LoopRunner
from .context.context_builder import RecentChatMessage
from .crypto import ContentCipher, EncryptedPayload
from .knowledge_search import RetrievedKnowledgeChunk
from .models import ChatMessage, ChatMessageSource, ChatSession, ExportRecord
from .models import KnowledgeSearchLog
from .schemas import (
    ChatCitationOut,
    ChatCompleteIn,
    ChatFailIn,
    ChatKnowledgeResultIn,
    ChatKnowledgeResultOut,
    ChatMessageOut,
    ChatPrepareIn,
    ChatPrepareOut,
    ChatSessionDetailOut,
    ChatSessionItemOut,
    MessageOut,
)


NO_EVIDENCE_ANSWER = "当前知识库未找到明确依据"
CHAT_SESSION_ACTIVE = "active"
CHAT_SESSION_ARCHIVED = "archived"
CHAT_SESSION_DELETED = "deleted"


def _encrypt_content(
    cipher: ContentCipher,
    message_uuid: str,
    content: str,
) -> tuple[bytes, bytes]:
    encrypted = cipher.encrypt_json({"content": content}, message_uuid.encode())
    return encrypted.ciphertext, encrypted.nonce


def _decrypt_content(cipher: ContentCipher, message: ChatMessage) -> str:
    if message.content_ciphertext is None or message.content_nonce is None:
        return ""
    payload = cipher.decrypt_json(
        EncryptedPayload(
            ciphertext=message.content_ciphertext,
            nonce=message.content_nonce,
        ),
        message.uuid.encode(),
    )
    return str(payload.get("content", ""))


def _session_title(question: str) -> str:
    normalized = " ".join(question.split())
    return normalized[:40] or "新会话"


def _citation_from_chunk(chunk: RetrievedKnowledgeChunk) -> ChatCitationOut:
    return ChatCitationOut(
        source_type=chunk.source_kind,
        file_uuid=chunk.file_uuid,
        file_name=chunk.file_name,
        chunk_id=chunk.chunk_id,
        page_number=chunk.page_number,
        section_title=chunk.section_title,
        chunk_index=chunk.chunk_index,
        score=chunk.score,
    )


def _source_from_citation(message_id: int, citation: ChatCitationOut) -> ChatMessageSource:
    return ChatMessageSource(
        message_id=message_id,
        source_type=citation.source_type,
        source_uuid=citation.file_uuid,
        title=citation.file_name,
        file_name=citation.file_name,
        chunk_id=citation.chunk_id,
        page_number=citation.page_number,
        section_title=citation.section_title,
        chunk_index=citation.chunk_index,
        score=citation.score,
    )


def _source_from_knowledge_result(message_id: int, source) -> ChatMessageSource:
    return ChatMessageSource(
        message_id=message_id,
        source_type=source.source_kind,
        source_uuid=source.file_id,
        title=source.file_name,
        file_name=source.file_name,
        chunk_id=source.chunk_id,
        page_number=source.page_number,
        section_title=source.section_title,
        chunk_index=None,
        score=source.score or 0,
    )


def _recent_messages(
    db: Session,
    cipher: ContentCipher,
    *,
    session: ChatSession,
    limit: int = 8,
) -> list[RecentChatMessage]:
    if session.status != CHAT_SESSION_ACTIVE:
        return []
    rows = list(db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id, ChatMessage.status == "COMPLETED")
        .order_by(ChatMessage.id.desc())
        .limit(limit)
    ))
    return [
        RecentChatMessage(role=message.role, content=_decrypt_content(cipher, message))
        for message in reversed(rows)
    ]


def _message_out(
    db: Session,
    cipher: ContentCipher,
    message: ChatMessage,
) -> ChatMessageOut:
    citations = [
        ChatCitationOut(
            source_type=source.source_type,
            file_uuid=source.source_uuid,
            file_name=source.file_name,
            chunk_id=source.chunk_id,
            page_number=source.page_number,
            section_title=source.section_title,
            chunk_index=source.chunk_index,
            score=source.score,
        )
        for source in db.scalars(
            select(ChatMessageSource)
            .where(ChatMessageSource.message_id == message.id)
            .order_by(ChatMessageSource.id.asc())
        )
    ]
    return ChatMessageOut(
        message_uuid=message.uuid,
        role=message.role,  # type: ignore[arg-type]
        content=_decrypt_content(cipher, message),
        status=message.status,
        citations=citations,
        created_at=message.created_at,
    )


def _get_or_create_session(
    db: Session,
    *,
    sso_user_id: str,
    question: str,
    mode: str,
    session_uuid: str | None,
) -> ChatSession:
    if session_uuid:
        session = db.scalar(
            select(ChatSession).where(
                ChatSession.uuid == session_uuid,
                ChatSession.sso_user_id == sso_user_id,
            )
        )
        if session is None:
            raise HTTPException(status_code=404, detail="聊天会话不存在或无权访问")
        if session.status == CHAT_SESSION_ARCHIVED:
            raise HTTPException(status_code=409, detail="聊天会话已归档，请先恢复后继续")
        if session.status == CHAT_SESSION_DELETED:
            raise HTTPException(status_code=409, detail="聊天会话已删除，请从回收站恢复后继续")
        if session.status != CHAT_SESSION_ACTIVE:
            raise HTTPException(status_code=409, detail="聊天会话状态不可继续")
        return session
    session = ChatSession(
        uuid=str(uuid_lib.uuid4()),
        sso_user_id=sso_user_id,
        title=_session_title(question),
        mode=mode.upper(),
        status=CHAT_SESSION_ACTIVE,
    )
    db.add(session)
    db.flush()
    return session


def _ensure_session_active(session: ChatSession | None) -> None:
    if session is None:
        raise HTTPException(status_code=409, detail="聊天会话状态不可继续")
    if session.status == CHAT_SESSION_ARCHIVED:
        raise HTTPException(status_code=409, detail="聊天会话已归档，请先恢复后继续")
    if session.status == CHAT_SESSION_DELETED:
        raise HTTPException(status_code=409, detail="聊天会话已删除，请从回收站恢复后继续")
    if session.status != CHAT_SESSION_ACTIVE:
        raise HTTPException(status_code=409, detail="聊天会话状态不可继续")


def _create_message(
    db: Session,
    cipher: ContentCipher,
    *,
    session: ChatSession,
    sso_user_id: str,
    role: str,
    content: str,
    status: str,
    key_version: str,
    completion_token: str | None = None,
) -> ChatMessage:
    message_uuid = str(uuid_lib.uuid4())
    ciphertext, nonce = _encrypt_content(cipher, message_uuid, content)
    message = ChatMessage(
        uuid=message_uuid,
        session_id=session.id,
        sso_user_id=sso_user_id,
        role=role,
        content_ciphertext=ciphertext,
        content_nonce=nonce,
        key_version=key_version,
        status=status,
        completion_token_hash=(
            hashlib.sha256(completion_token.encode()).digest()
            if completion_token
            else None
        ),
        finished_at=datetime.now(UTC) if status in {"COMPLETED", "FAILED"} else None,
    )
    db.add(message)
    db.flush()
    return message


def _link_search_logs_to_answer(
    db: Session,
    *,
    search_log_ids: list[int],
    answer_message_uuid: str,
) -> None:
    if not search_log_ids:
        return
    logs = db.scalars(
        select(KnowledgeSearchLog).where(KnowledgeSearchLog.id.in_(search_log_ids))
    )
    for log in logs:
        log.answer_message_id = answer_message_uuid
    db.flush()


def _rag_messages(question: str, chunks: list[RetrievedKnowledgeChunk]) -> list[MessageOut]:
    references = "\n\n".join(
        f"[{index}] 文件：{chunk.file_name}\n"
        f"章节：{chunk.section_title or '未识别章节'}\n"
        f"内容：{chunk.chunk_text}"
        for index, chunk in enumerate(chunks, start=1)
    )
    return [
        MessageOut(
            role="system",
            content=(
                "你是聚信内部知识库问答助手。你只能基于本次检索到的资料回答问题。"
                "不得使用未在资料中出现的信息补全、推测或编造。"
                f"如果检索资料无法明确回答问题，必须回答“{NO_EVIDENCE_ANSWER}”。"
                "回答中必须列出引用来源，引用来源至少包含文件名、页码或章节；不要输出内部片段编号。"
            ),
        ),
        MessageOut(
            role="user",
            content=f"用户问题：{question}\n\n检索资料：\n{references}",
        ),
    ]


def prepare_chat(
    db: Session,
    *,
    sso_user_id: str,
    body: ChatPrepareIn,
    cipher: ContentCipher,
    key_version: str,
) -> ChatPrepareOut:
    loop_runner = LoopRunner()
    analysis = loop_runner.task_analyzer.analyze(body.question, body.mode)
    mode = analysis.mode.upper()
    session = _get_or_create_session(
        db,
        sso_user_id=sso_user_id,
        question=body.question,
        mode=mode,
        session_uuid=body.session_uuid,
    )
    if session.mode != mode:
        session.mode = mode
    session.updated_at = datetime.now(UTC)
    recent_messages = _recent_messages(db, cipher, session=session)
    user_message = _create_message(
        db,
        cipher,
        session=session,
        sso_user_id=sso_user_id,
        role="user",
        content=body.question,
        status="COMPLETED",
        key_version=key_version,
    )
    loop_result = loop_runner.run_chat(
        db=db,
        sso_user_id=sso_user_id,
        question=body.question,
        mode=body.mode,
        cipher=cipher,
        recent_messages=recent_messages,
        top_k=body.top_k,
        conversation_id=session.uuid,
        attachment_file_ids=body.attachment_file_ids,
        include_personal_references=body.include_personal_references,
        include_session_attachments=body.include_session_attachments,
    )
    if loop_result.completed_answer:
        assistant = _create_message(
            db,
            cipher,
            session=session,
            sso_user_id=sso_user_id,
            role="assistant",
            content=loop_result.completed_answer,
            status="COMPLETED",
            key_version=key_version,
        )
        _link_search_logs_to_answer(
            db,
            search_log_ids=loop_result.search_log_ids,
            answer_message_uuid=assistant.uuid,
        )
        return ChatPrepareOut(
            session_uuid=session.uuid,
            user_message_uuid=user_message.uuid,
            assistant_message_uuid=assistant.uuid,
            completion_token="",
            completed=True,
            answer=loop_result.completed_answer,
            messages=[],
            citations=[],
            loop_trace=loop_result.loop_trace,
        )
    completion_token = secrets.token_urlsafe(32)
    assistant = _create_message(
        db,
        cipher,
        session=session,
        sso_user_id=sso_user_id,
        role="assistant",
        content="",
        status="PENDING",
        key_version=key_version,
        completion_token=completion_token,
    )
    _link_search_logs_to_answer(
        db,
        search_log_ids=loop_result.search_log_ids,
        answer_message_uuid=assistant.uuid,
    )
    citations = [_citation_from_chunk(chunk) for chunk in loop_result.chunks]
    for citation in citations:
        db.add(_source_from_citation(assistant.id, citation))
    return ChatPrepareOut(
        session_uuid=session.uuid,
        user_message_uuid=user_message.uuid,
        assistant_message_uuid=assistant.uuid,
        completion_token=completion_token,
        completed=False,
        answer="",
        messages=loop_result.messages,
        citations=citations,
        loop_trace=loop_result.loop_trace,
    )


def complete_chat_message(
    db: Session,
    *,
    sso_user_id: str,
    message_uuid: str,
    body: ChatCompleteIn,
    cipher: ContentCipher,
) -> ChatMessage:
    message = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.uuid == message_uuid)
        .with_for_update()
    )
    if message is None or message.sso_user_id != sso_user_id:
        raise HTTPException(status_code=404, detail="聊天消息不存在或无权访问")
    session = db.get(ChatSession, message.session_id)
    _ensure_session_active(session)
    if message.status != "PENDING":
        raise HTTPException(status_code=409, detail="聊天消息状态不可变更")
    expected = message.completion_token_hash
    actual = hashlib.sha256(body.completion_token.encode()).digest()
    if expected is None or not hmac.compare_digest(expected, actual):
        raise HTTPException(status_code=403, detail="聊天完成凭据无效")
    ciphertext, nonce = _encrypt_content(cipher, message.uuid, body.answer)
    message.content_ciphertext = ciphertext
    message.content_nonce = nonce
    message.status = "COMPLETED"
    message.model_display_name = body.model_display_name
    message.model_id = body.model_id
    message.usage_json = body.usage
    message.latency_ms = body.latency_ms
    message.error_code = ""
    message.error_message_safe = ""
    message.finished_at = datetime.now(UTC)
    db.flush()
    return message


def save_knowledge_result_to_chat_history(
    db: Session,
    *,
    sso_user_id: str,
    body: ChatKnowledgeResultIn,
    cipher: ContentCipher,
    key_version: str,
) -> ChatKnowledgeResultOut:
    session = _get_or_create_session(
        db,
        sso_user_id=sso_user_id,
        question=body.question,
        mode=body.mode,
        session_uuid=body.conversation_id,
    )
    user_message = _create_message(
        db,
        cipher,
        session=session,
        sso_user_id=sso_user_id,
        role="user",
        content=body.question,
        status="COMPLETED",
        key_version=key_version,
    )
    assistant_message = _create_message(
        db,
        cipher,
        session=session,
        sso_user_id=sso_user_id,
        role="assistant",
        content=body.answer,
        status="COMPLETED",
        key_version=key_version,
    )
    db.flush()
    for source in body.sources:
        db.add(_source_from_knowledge_result(assistant_message.id, source))
    db.flush()
    return ChatKnowledgeResultOut(
        session_uuid=session.uuid,
        user_message_uuid=user_message.uuid,
        assistant_message_uuid=assistant_message.uuid,
    )


def fail_chat_message(
    db: Session,
    *,
    sso_user_id: str,
    message_uuid: str,
    body: ChatFailIn,
) -> ChatMessage:
    message = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.uuid == message_uuid)
        .with_for_update()
    )
    if message is None or message.sso_user_id != sso_user_id:
        raise HTTPException(status_code=404, detail="聊天消息不存在或无权访问")
    session = db.get(ChatSession, message.session_id)
    _ensure_session_active(session)
    if message.status != "PENDING":
        raise HTTPException(status_code=409, detail="聊天消息状态不可变更")
    expected = message.completion_token_hash
    actual = hashlib.sha256(body.completion_token.encode()).digest()
    if expected is None or not hmac.compare_digest(expected, actual):
        raise HTTPException(status_code=403, detail="聊天完成凭据无效")
    message.status = "FAILED"
    message.error_code = body.error_code[:64]
    message.error_message_safe = (body.error_message or body.error_code)[:500]
    message.finished_at = datetime.now(UTC)
    db.flush()
    return message


def _session_item(row: ChatSession) -> ChatSessionItemOut:
    return ChatSessionItemOut(
        session_uuid=row.uuid,
        title=row.title,
        mode=row.mode,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_chat_sessions(
    db: Session,
    *,
    sso_user_id: str,
    status: str = CHAT_SESSION_ACTIVE,
) -> list[ChatSessionItemOut]:
    rows = list(db.scalars(
        select(ChatSession)
        .where(ChatSession.sso_user_id == sso_user_id, ChatSession.status == status)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
    ))
    return [_session_item(row) for row in rows]


def get_chat_session_detail(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
    cipher: ContentCipher,
) -> ChatSessionDetailOut:
    session = db.scalar(
        select(ChatSession).where(
            ChatSession.uuid == session_uuid,
            ChatSession.sso_user_id == sso_user_id,
            ChatSession.status.in_([CHAT_SESSION_ACTIVE, CHAT_SESSION_ARCHIVED]),
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="聊天会话不存在或无权访问")
    messages = list(db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.id.asc())
    ))
    return ChatSessionDetailOut(
        session_uuid=session.uuid,
        title=session.title,
        mode=session.mode,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[_message_out(db, cipher, message) for message in messages],
    )


def _get_owned_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
) -> ChatSession:
    session = db.scalar(
        select(ChatSession).where(
            ChatSession.uuid == session_uuid,
            ChatSession.sso_user_id == sso_user_id,
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="聊天会话不存在或无权访问")
    return session


def archive_chat_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
) -> ChatSessionItemOut:
    session = _get_owned_session(db, sso_user_id=sso_user_id, session_uuid=session_uuid)
    now = datetime.now(UTC)
    session.status = CHAT_SESSION_ARCHIVED
    session.archived_at = now
    session.deleted_at = None
    session.updated_at = now
    db.flush()
    return _session_item(session)


def restore_chat_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
) -> ChatSessionItemOut:
    session = _get_owned_session(db, sso_user_id=sso_user_id, session_uuid=session_uuid)
    now = datetime.now(UTC)
    session.status = CHAT_SESSION_ACTIVE
    session.archived_at = None
    session.deleted_at = None
    session.updated_at = now
    db.flush()
    return _session_item(session)


def rename_chat_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
    title: str,
) -> ChatSessionItemOut:
    session = _get_owned_session(db, sso_user_id=sso_user_id, session_uuid=session_uuid)
    normalized = " ".join(title.split())
    if not normalized:
        raise HTTPException(status_code=422, detail="会话标题不能为空")
    session.title = normalized[:80]
    session.updated_at = datetime.now(UTC)
    db.flush()
    return _session_item(session)


def soft_delete_chat_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
) -> ChatSessionItemOut:
    session = _get_owned_session(db, sso_user_id=sso_user_id, session_uuid=session_uuid)
    now = datetime.now(UTC)
    session.status = CHAT_SESSION_DELETED
    session.deleted_at = now
    session.updated_at = now
    db.flush()
    return _session_item(session)


def hard_delete_chat_session(
    db: Session,
    *,
    sso_user_id: str,
    session_uuid: str,
) -> None:
    session = _get_owned_session(db, sso_user_id=sso_user_id, session_uuid=session_uuid)
    db.execute(
        delete(ChatMessageSource).where(
            ChatMessageSource.message_id.in_(
                select(ChatMessage.id).where(ChatMessage.session_id == session.id)
            )
        )
    )
    db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    db.execute(delete(ExportRecord).where(ExportRecord.conversation_id == session.uuid))
    db.delete(session)
    db.flush()


def bulk_archive_chat_sessions(
    db: Session,
    *,
    sso_user_id: str,
    session_uuids: list[str],
) -> int:
    affected = 0
    for session_uuid in dict.fromkeys(session_uuids):
        session = db.scalar(
            select(ChatSession).where(
                ChatSession.uuid == session_uuid,
                ChatSession.sso_user_id == sso_user_id,
            )
        )
        if session is None:
            continue
        now = datetime.now(UTC)
        session.status = CHAT_SESSION_ARCHIVED
        session.archived_at = now
        session.deleted_at = None
        session.updated_at = now
        affected += 1
    db.flush()
    return affected


def bulk_soft_delete_chat_sessions(
    db: Session,
    *,
    sso_user_id: str,
    session_uuids: list[str],
) -> int:
    affected = 0
    for session_uuid in dict.fromkeys(session_uuids):
        session = db.scalar(
            select(ChatSession).where(
                ChatSession.uuid == session_uuid,
                ChatSession.sso_user_id == sso_user_id,
            )
        )
        if session is None:
            continue
        now = datetime.now(UTC)
        session.status = CHAT_SESSION_DELETED
        session.deleted_at = now
        session.updated_at = now
        affected += 1
    db.flush()
    return affected
