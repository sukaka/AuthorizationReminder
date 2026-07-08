from sqlalchemy.orm import Session

from .agent_loop.task_analyzer import TaskAnalyzer
from .context.context_builder import ContextBuilder
from .crypto import ContentCipher
from .knowledge_search import RetrievedKnowledgeChunk, search_personal_reference_chunks
from .models import KnowledgeSearchLog
from .schemas import (
    PersonalReferenceGenerateIn,
    PersonalReferenceGenerateOut,
    PersonalReferenceSearchIn,
    PersonalReferenceSearchOut,
    PersonalReferenceSourceOut,
)


PERSONAL_REFERENCE_NOTICE = "该内容参考用户个人上传资料生成，仅供当前用户使用。"
SESSION_ATTACHMENT_NOTICE = "该内容参考当前会话附件生成，仅供本次会话使用。"
MIXED_REFERENCE_NOTICE = "该内容参考用户个人上传资料和当前会话附件生成；个人资料仅供当前用户使用，当前附件仅供本次会话使用。"
NO_REFERENCE_NOTICE = "当前未检索到个人参考资料或当前会话附件。"


def _source_out(chunk: RetrievedKnowledgeChunk) -> PersonalReferenceSourceOut:
    return PersonalReferenceSourceOut(
        source_kind=chunk.source_kind,
        file_id=chunk.file_uuid,
        file_name=chunk.file_name,
        chunk_id=chunk.chunk_id,
        page_number=chunk.page_number,
        section_title=chunk.section_title,
        chunk_index=chunk.chunk_index,
        score=chunk.score,
        snippet=chunk.chunk_text[:300],
    )


def _notice_for_chunks(chunks: list[RetrievedKnowledgeChunk]) -> str:
    if not chunks:
        return NO_REFERENCE_NOTICE
    source_kinds = {chunk.source_kind for chunk in chunks}
    if "personal_reference" in source_kinds and "session_attachment" in source_kinds:
        return MIXED_REFERENCE_NOTICE
    if "session_attachment" in source_kinds:
        return SESSION_ATTACHMENT_NOTICE
    return PERSONAL_REFERENCE_NOTICE


def _search_type_for_chunks(chunks: list[RetrievedKnowledgeChunk]) -> str:
    source_kinds = {chunk.source_kind for chunk in chunks}
    if source_kinds == {"session_attachment"}:
        return "session_attachment"
    return "personal_reference"


def search_personal_reference_sources(
    db: Session,
    *,
    sso_user_id: str,
    body: PersonalReferenceSearchIn,
    cipher: ContentCipher,
) -> PersonalReferenceSearchOut:
    chunks = search_personal_reference_chunks(
        db,
        sso_user_id=sso_user_id,
        query=body.question,
        cipher=cipher,
        conversation_id=body.conversation_id,
        file_ids=body.file_ids,
        top_k=body.top_k,
    )
    db.add(
        KnowledgeSearchLog(
            user_id=sso_user_id,
            question=body.question[:20_000],
            mode="personal_reference",
            search_type=_search_type_for_chunks(chunks),
            knowledge_base_ids_json=[],
            filters_json={
                "conversation_id": body.conversation_id or "",
                "file_ids": list(body.file_ids),
            },
            retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
            answer_message_id="",
        )
    )
    return PersonalReferenceSearchOut(
        sources=[_source_out(chunk) for chunk in chunks],
        total=len(chunks),
        notice=_notice_for_chunks(chunks),
    )


def prepare_personal_reference_generation(
    db: Session,
    *,
    sso_user_id: str,
    body: PersonalReferenceGenerateIn,
    cipher: ContentCipher,
) -> PersonalReferenceGenerateOut:
    analysis = TaskAnalyzer().analyze(body.question, body.mode)
    chunks = search_personal_reference_chunks(
        db,
        sso_user_id=sso_user_id,
        query=body.question,
        cipher=cipher,
        conversation_id=body.conversation_id,
        file_ids=body.file_ids,
        top_k=body.top_k,
    )
    messages = ContextBuilder().build_messages(
        mode=analysis.mode,
        current_user_message=body.question,
        knowledge_chunks=[],
        personal_reference_chunks=chunks,
        recent_messages=[],
        require_knowledge_evidence=False,
    )
    db.add(
        KnowledgeSearchLog(
            user_id=sso_user_id,
            question=body.question[:20_000],
            mode=analysis.mode,
            search_type=_search_type_for_chunks(chunks),
            knowledge_base_ids_json=[],
            filters_json={
                "conversation_id": body.conversation_id or "",
                "file_ids": list(body.file_ids),
            },
            retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
            answer_message_id="",
        )
    )
    return PersonalReferenceGenerateOut(
        answer="",
        messages=messages,
        sources=[_source_out(chunk) for chunk in chunks],
        notice=_notice_for_chunks(chunks),
    )
