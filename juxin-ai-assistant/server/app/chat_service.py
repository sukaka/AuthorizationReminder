import hashlib
import hmac
import secrets
import uuid as uuid_lib
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .agent_loop import LoopRunner
from .agent_loop.task_state import TaskStateStore
from .agent_loop.verifier import Verifier
from .context.context_builder import RecentChatMessage
from .crypto import ContentCipher, EncryptedPayload
from .knowledge_search import RetrievedKnowledgeChunk
from .models import AgentTaskState, ChatMessage, ChatMessageSource, ChatSession, ExportRecord, KnowledgeChunk, KnowledgeFile
from .models import KnowledgeSearchLog, WebSearchLog
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
from .web_sources import (
    SearchIntentDetector,
    UrlExtractor,
    WebContextBuilder,
    WebSearchResult,
    WebSearchService,
    create_search_provider,
)


NO_EVIDENCE_ANSWER = "当前知识库未找到明确依据"
CHAT_SESSION_ACTIVE = "active"
CHAT_SESSION_ARCHIVED = "archived"
CHAT_SESSION_DELETED = "deleted"
FILE_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "pdf": "application/pdf",
    "txt": "text/plain",
    "md": "text/markdown",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
IMAGE_FILE_TYPES = {key for key, value in FILE_MEDIA_TYPES.items() if value.startswith("image/")}


def _is_file_delivery_request(question: str) -> bool:
    normalized = "".join(question.lower().split())
    delivery_markers = ("发给我", "发送给我", "给我发", "传给我", "下载", "给我文件", "把文件给我")
    return any(marker in normalized for marker in delivery_markers)


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
        section_title=chunk.section_path or chunk.section_title,
        page_or_sheet=chunk.page_or_sheet,
        chunk_type=chunk.chunk_type,
        chunk_index=chunk.chunk_index,
        score=chunk.score,
    )


def _enrich_media_citations(db: Session, citations: list[ChatCitationOut]) -> list[ChatCitationOut]:
    file_uuids = {citation.file_uuid for citation in citations if citation.file_uuid}
    if not file_uuids:
        return citations
    files = db.scalars(select(KnowledgeFile).where(KnowledgeFile.uuid.in_(file_uuids)))
    file_type_by_uuid = {
        file.uuid: (file.file_type or "").strip().lower().lstrip(".")
        for file in files
    }
    for citation in citations:
        media_type = FILE_MEDIA_TYPES.get(file_type_by_uuid.get(citation.file_uuid, ""), "")
        if media_type:
            citation.media_type = media_type
            citation.asset_url = f"/api/knowledge/files/{citation.file_uuid}/download"
    return citations


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


def _citation_from_web_result(result: WebSearchResult, index: int) -> ChatCitationOut:
    return ChatCitationOut(
        source_type="web_search_context",
        file_uuid="",
        file_name=result.title or result.site_name or result.url,
        chunk_id=result.url,
        page_number=None,
        section_title=f"{result.site_name or '联网来源'} · {result.url}",
        page_or_sheet=result.fetched_at.isoformat() if result.fetched_at else "",
        chunk_type="web_search_result",
        chunk_index=index,
        score=max(1, 100 - index),
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
    sources = list(db.scalars(
        select(ChatMessageSource)
        .where(ChatMessageSource.message_id == message.id)
        .order_by(ChatMessageSource.id.asc())
    ))
    content = _decrypt_content(cipher, message)
    chunk_ids = [source.chunk_id for source in sources if source.chunk_id]
    chunk_metadata_by_id: dict[str, dict] = {}
    if chunk_ids:
        chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.chunk_id.in_(chunk_ids)))
        chunk_metadata_by_id = {
            chunk.chunk_id: chunk.metadata_json or {}
            for chunk in chunks
        }
    citations = _enrich_media_citations(db, [
        ChatCitationOut(
            source_type=source.source_type,
            file_uuid=source.source_uuid,
            file_name=source.file_name,
            chunk_id=source.chunk_id,
            page_number=source.page_number,
            section_title=source.section_title,
            page_or_sheet=str(chunk_metadata_by_id.get(source.chunk_id, {}).get("page_or_sheet") or ""),
            chunk_type=str(chunk_metadata_by_id.get(source.chunk_id, {}).get("chunk_type") or ""),
            chunk_index=source.chunk_index,
            score=source.score,
        )
        for source in sources
    ])
    return ChatMessageOut(
        message_uuid=message.uuid,
        role=message.role,  # type: ignore[arg-type]
        content=content,
        status=message.status,
        citations=citations,
        created_at=message.created_at,
    )


def message_citations(
    db: Session,
    cipher: ContentCipher,
    message: ChatMessage,
) -> list[ChatCitationOut]:
    """Return the verifier-approved sources persisted for a completed message."""
    return _message_out(db, cipher, message).citations


def _source_payloads_for_verifier(
    db: Session,
    cipher: ContentCipher,
    sources: list[ChatMessageSource],
) -> list[dict[str, object]]:
    chunk_ids = [source.chunk_id for source in sources if source.chunk_id]
    chunk_text_by_id: dict[str, str] = {}
    if chunk_ids:
        chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.chunk_id.in_(chunk_ids)))
        for chunk in chunks:
            try:
                payload = cipher.decrypt_json(
                    EncryptedPayload(
                        ciphertext=chunk.chunk_text_ciphertext,
                        nonce=chunk.chunk_text_nonce,
                    ),
                    chunk.chunk_id.encode(),
                )
            except Exception:
                continue
            chunk_text_by_id[chunk.chunk_id] = str(payload.get("text", ""))
    return [
        {
            "source_type": source.source_type,
            "source_uuid": source.source_uuid,
            "file_name": source.file_name,
            "title": source.title,
            "chunk_id": source.chunk_id,
            "page_number": source.page_number,
            "section_title": source.section_title,
            "chunk_index": source.chunk_index,
            "score": source.score,
            "chunk_text": chunk_text_by_id.get(source.chunk_id, ""),
        }
        for source in sources
    ]


def _delete_unmentioned_sources(
    db: Session,
    cipher: ContentCipher,
    message: ChatMessage,
    answer: str,
) -> dict[str, object]:
    sources = list(db.scalars(
        select(ChatMessageSource)
        .where(ChatMessageSource.message_id == message.id)
        .order_by(ChatMessageSource.id.asc())
    ))
    verification = Verifier().verify_references(
        answer,
        _source_payloads_for_verifier(db, cipher, sources),
    )
    kept_keys = {
        (
            str(source.get("source_uuid") or ""),
            str(source.get("chunk_id") or ""),
            str(source.get("file_name") or ""),
        )
        for source in verification.get("sources", [])
        if isinstance(source, dict)
    }
    source_file_uuids = {source.source_uuid for source in sources if source.source_uuid}
    image_file_uuids = {
        file.uuid
        for file in db.scalars(select(KnowledgeFile).where(KnowledgeFile.uuid.in_(source_file_uuids)))
        if (file.file_type or "").strip().lower().lstrip(".") in IMAGE_FILE_TYPES
    }
    for source in sources:
        key = (source.source_uuid, source.chunk_id, source.file_name)
        if key not in kept_keys and source.source_uuid not in image_file_uuids:
            db.delete(source)
    return verification


def _record_completed_answer_verification(
    db: Session,
    *,
    message: ChatMessage,
    session: ChatSession,
    answer: str,
    reference_result: dict[str, object],
) -> None:
    task_state = db.scalar(
        select(AgentTaskState)
        .where(
            AgentTaskState.user_id == message.sso_user_id,
            AgentTaskState.conversation_id == session.uuid,
            AgentTaskState.status == "active",
        )
        .order_by(AgentTaskState.id.desc())
    )
    if task_state is None:
        return
    store = TaskStateStore(db)
    store.update_stage(
        task_state.uuid,
        stage="quality_check",
        next_action="正在复核结果",
    )
    document_result = Verifier().verify_document_structure(answer, task_type=session.mode)
    issues = [
        *[str(item) for item in reference_result.get("suggestions", [])],
        *[str(item) for item in document_result.get("warnings", [])],
        *[str(item) for item in document_result.get("risks", [])],
    ]
    status = "passed"
    if document_result.get("status") == "risk":
        status = "risk"
    elif issues or reference_result.get("status") == "warning":
        status = "warning"
    store.record_verification(
        task_state.uuid,
        status=status,
        summary="回答已完成自检" if status == "passed" else "回答存在建议复核项",
        issues=issues,
        details={
            "reference": reference_result,
            "document": document_result,
        },
    )
    store.mark_completed(
        task_state.uuid,
        next_action="可以复制、导出或继续追问",
    )


def _latest_task_state_payload(
    db: Session,
    *,
    user_id: str,
    conversation_id: str,
) -> dict[str, object]:
    task_state = db.scalar(
        select(AgentTaskState)
        .where(
            AgentTaskState.user_id == user_id,
            AgentTaskState.conversation_id == conversation_id,
        )
        .order_by(AgentTaskState.id.desc())
    )
    if task_state is None:
        return {}
    return TaskStateStore.public_payload(task_state)


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


def _link_web_search_log_to_answer(
    db: Session,
    *,
    log_id: int | None,
    answer_message_uuid: str,
) -> None:
    if not log_id:
        return
    log = db.get(WebSearchLog, log_id)
    if log is None:
        return
    log.answer_message_id = answer_message_uuid
    db.flush()


def _append_chat_web_search_task_state(
    db: Session,
    task_state: dict[str, object],
    *,
    status: str,
    summary: str,
    error_code: str = "",
    source_count: int | None = None,
) -> dict[str, object]:
    task_state_id = str(task_state.get("task_state_id") or "")
    if not task_state_id:
        return task_state
    store = TaskStateStore(db)
    store.append_tool_call(
        task_state_id,
        tool_name="web_search",
        status=status,
        summary=summary,
        error_code=error_code,
        source_count=source_count,
    )
    return store.public_payload_by_id(task_state_id)


def _rag_messages(question: str, chunks: list[RetrievedKnowledgeChunk]) -> list[MessageOut]:
    def source_location(chunk: RetrievedKnowledgeChunk) -> tuple[str, str]:
        section = chunk.section_path or chunk.section_title or "引用片段"
        location = chunk.page_or_sheet
        if not location and chunk.page_number is not None:
            location = f"第 {chunk.page_number} 页"
        return section, location or "引用片段"

    references = "\n\n".join(
        (
            f"[{index}] 文件：{chunk.file_name}\n"
            f"章节：{source_location(chunk)[0]}\n"
            f"位置：{source_location(chunk)[1]}\n"
            f"内容：{chunk.chunk_text}"
        )
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
    web_search_provider: str = "duckduckgo-html",
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
        personal_reference_file_ids=body.personal_reference_file_ids,
        include_personal_references=body.include_personal_references,
        include_session_attachments=body.include_session_attachments,
    )
    prepared_messages = loop_result.messages
    task_state_payload = dict(loop_result.task_state or {})
    if _is_file_delivery_request(body.question) and loop_result.chunks:
        strongest_by_file: dict[str, RetrievedKnowledgeChunk] = {}
        for chunk in loop_result.chunks:
            current = strongest_by_file.get(chunk.file_uuid)
            if current is None or chunk.score > current.score:
                strongest_by_file[chunk.file_uuid] = chunk
        delivery_chunks = sorted(
            strongest_by_file.values(),
            key=lambda chunk: (chunk.score, chunk.file_name),
            reverse=True,
        )[:5]
        citations = _enrich_media_citations(
            db,
            [_citation_from_chunk(chunk) for chunk in delivery_chunks],
        )
        answer = "已找到文件：\n" + "\n".join(
            f"- 《{citation.file_name}》" for citation in citations
        )
        assistant = _create_message(
            db,
            cipher,
            session=session,
            sso_user_id=sso_user_id,
            role="assistant",
            content=answer,
            status="COMPLETED",
            key_version=key_version,
        )
        for citation in citations:
            db.add(_source_from_citation(assistant.id, citation))
        return ChatPrepareOut(
            session_uuid=session.uuid,
            user_message_uuid=user_message.uuid,
            assistant_message_uuid=assistant.uuid,
            completion_token="",
            completed=True,
            answer=answer,
            messages=[],
            citations=citations,
            loop_trace=loop_result.loop_trace,
            task_state=task_state_payload,
        )
    web_results: list[WebSearchResult] = []
    web_log_id: int | None = None
    should_search_web = (
        SearchIntentDetector().should_search(body.question)
        and not UrlExtractor().extract_first(body.question)
    )
    if should_search_web:
        try:
            web_results = WebSearchService(
                provider=create_search_provider(web_search_provider),
            ).search(
                body.question,
                limit=5,
                db=db,
                user_id=sso_user_id,
            )
            log = WebSearchLog(
                user_id=sso_user_id,
                conversation_id=session.uuid,
                query=body.question,
                provider="duckduckgo-html",
                status="ok" if web_results else "no_results",
                result_count=len(web_results),
                result_urls_json=[result.url for result in web_results],
                used_urls_json=[result.url for result in web_results],
            )
            db.add(log)
            db.flush()
            web_log_id = log.id
            task_state_payload = _append_chat_web_search_task_state(
                db,
                task_state_payload,
                status="success",
                summary=f"公开来源 {len(web_results)} 条",
                source_count=len(web_results),
            )
            prepared_messages = [
                MessageOut(role="system", content=WebContextBuilder().build(web_results)),
                *prepared_messages,
            ]
        except Exception as exc:
            error_message = str(exc)[:500]
            log = WebSearchLog(
                user_id=sso_user_id,
                conversation_id=session.uuid,
                query=body.question,
                provider="duckduckgo-html",
                status="failed",
                result_count=0,
                result_urls_json=[],
                used_urls_json=[],
                error_message=error_message,
            )
            db.add(log)
            db.flush()
            web_log_id = log.id
            task_state_payload = _append_chat_web_search_task_state(
                db,
                task_state_payload,
                status="failed",
                summary="联网搜索暂时不可用，已降级为普通回答",
                error_code="WEB_SEARCH_FAILED",
                source_count=0,
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
        _link_web_search_log_to_answer(
            db,
            log_id=web_log_id,
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
            task_state=task_state_payload,
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
    _link_web_search_log_to_answer(
        db,
        log_id=web_log_id,
        answer_message_uuid=assistant.uuid,
    )
    citations = [_citation_from_chunk(chunk) for chunk in loop_result.chunks]
    citations.extend(
        _citation_from_web_result(result, index)
        for index, result in enumerate(web_results)
    )
    _enrich_media_citations(db, citations)
    for citation in citations:
        db.add(_source_from_citation(assistant.id, citation))
    return ChatPrepareOut(
        session_uuid=session.uuid,
        user_message_uuid=user_message.uuid,
        assistant_message_uuid=assistant.uuid,
        completion_token=completion_token,
        completed=False,
        answer="",
        messages=prepared_messages,
        citations=citations,
        loop_trace=loop_result.loop_trace,
        task_state=task_state_payload,
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
    reference_result = _delete_unmentioned_sources(db, cipher, message, body.answer)
    _record_completed_answer_verification(
        db,
        message=message,
        session=session,
        answer=body.answer,
        reference_result=reference_result,
    )
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
    _delete_unmentioned_sources(db, cipher, assistant_message, body.answer)
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
    if session is not None:
        task_state = db.scalar(
            select(AgentTaskState)
            .where(
                AgentTaskState.user_id == sso_user_id,
                AgentTaskState.conversation_id == session.uuid,
                AgentTaskState.status == "active",
            )
            .order_by(AgentTaskState.id.desc())
        )
        if task_state is not None:
            TaskStateStore(db).mark_failed(
                task_state.uuid,
                reason=message.error_message_safe or body.error_code,
                retry_suggestion="请稍后重试或切换模型",
            )
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
        task_state=_latest_task_state_payload(
            db,
            user_id=sso_user_id,
            conversation_id=session.uuid,
        ),
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
