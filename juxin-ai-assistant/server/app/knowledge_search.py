import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import KnowledgeBase, KnowledgeChunk, KnowledgeFile


@dataclass(frozen=True)
class RetrievedKnowledgeChunk:
    chunk_id: str
    file_uuid: str
    file_name: str
    chunk_text: str
    page_number: int | None
    section_title: str
    chunk_index: int
    score: int
    source_kind: str = "official_knowledge"


def _clamp_top_k(top_k: int | None) -> int:
    if top_k is None:
        return 8
    return max(5, min(int(top_k), 10))


def _query_terms(query: str) -> list[str]:
    normalized = query.strip().lower()
    terms = [
        term.lower()
        for term in re.split(r"[\s,，。；;、]+", normalized)
        if term.strip()
    ]
    if normalized and re.search(r"[\u4e00-\u9fff]", normalized):
        terms.extend(
            normalized[index:index + 2]
            for index in range(0, max(len(normalized) - 1, 0))
        )
    deduped: list[str] = []
    for term in terms or ([normalized] if normalized else []):
        if term and term not in deduped:
            deduped.append(term)
    return deduped


def _score(text: str, terms: list[str]) -> int:
    lowered = text.lower()
    return sum(lowered.count(term) for term in terms if term)


def _mark_files_used(db: Session, chunks: list[RetrievedKnowledgeChunk]) -> None:
    file_uuids = sorted({chunk.file_uuid for chunk in chunks})
    if not file_uuids:
        return
    used_at = datetime.now(UTC)
    files = db.scalars(select(KnowledgeFile).where(KnowledgeFile.uuid.in_(file_uuids)))
    for file_record in files:
        file_record.usage_count = (file_record.usage_count or 0) + 1
        file_record.last_used_at = used_at
    db.flush()


def search_knowledge_chunks(
    db: Session,
    *,
    sso_user_id: str,
    query: str,
    cipher: ContentCipher,
    top_k: int | None = 8,
    knowledge_base_ids: list[str] | None = None,
    categories: list[str] | None = None,
    document_types: list[str] | None = None,
) -> list[RetrievedKnowledgeChunk]:
    terms = _query_terms(query)
    if not terms:
        return []
    conditions = [
        KnowledgeChunk.status == "READY",
        KnowledgeChunk.deleted_at.is_(None),
        KnowledgeFile.status == "READY",
        KnowledgeFile.usage_type == "official_knowledge",
        KnowledgeFile.rag_enabled.is_(True),
        KnowledgeFile.review_status.in_(("approved", "official")),
        KnowledgeFile.parse_status == "parsed",
        KnowledgeFile.index_status == "indexed",
        KnowledgeFile.archived_at.is_(None),
        KnowledgeFile.deleted_at.is_(None),
        KnowledgeFile.hard_deleted_at.is_(None),
        KnowledgeFile.rag_scope == "company",
        KnowledgeFile.permission_scope == "company",
    ]
    normalized_base_ids = [base_id.strip() for base_id in (knowledge_base_ids or []) if base_id.strip()]
    if normalized_base_ids:
        conditions.append(
            KnowledgeFile.knowledge_base_id.in_(
                select(KnowledgeBase.id).where(
                    KnowledgeBase.uuid.in_(normalized_base_ids),
                    KnowledgeBase.deleted_at.is_(None),
                )
            )
        )
    normalized_categories = [item.strip() for item in (categories or []) if item.strip()]
    if normalized_categories:
        conditions.append(KnowledgeFile.category.in_(normalized_categories))
    normalized_document_types = [item.strip() for item in (document_types or []) if item.strip()]
    if normalized_document_types:
        conditions.append(KnowledgeFile.document_type.in_(normalized_document_types))

    rows = db.execute(
        select(KnowledgeChunk, KnowledgeFile)
        .join(KnowledgeFile, KnowledgeFile.id == KnowledgeChunk.file_id)
        .where(*conditions)
    ).all()

    ranked: list[RetrievedKnowledgeChunk] = []
    for chunk, file_record in rows:
        payload = cipher.decrypt_json(
            EncryptedPayload(
                ciphertext=chunk.chunk_text_ciphertext,
                nonce=chunk.chunk_text_nonce,
            ),
            chunk.chunk_id.encode(),
        )
        chunk_text = str(payload.get("text", ""))
        haystack = "\n".join([
            file_record.file_name,
            chunk.section_title,
            chunk_text,
        ])
        score = _score(haystack, terms)
        if score <= 0:
            continue
        ranked.append(
            RetrievedKnowledgeChunk(
                chunk_id=chunk.chunk_id,
                file_uuid=file_record.uuid,
                file_name=file_record.file_name,
                chunk_text=chunk_text,
                page_number=chunk.page_number,
                section_title=chunk.section_title,
                chunk_index=chunk.chunk_index,
                score=score,
                source_kind="official_knowledge",
            )
        )

    ranked.sort(
        key=lambda item: (
            item.score,
            item.file_name,
            -item.chunk_index,
            item.chunk_id,
        ),
        reverse=True,
    )
    results = ranked[: _clamp_top_k(top_k)]
    _mark_files_used(db, results)
    return results


def search_personal_reference_chunks(
    db: Session,
    *,
    sso_user_id: str,
    query: str,
    cipher: ContentCipher,
    conversation_id: str | None = None,
    file_ids: list[str] | None = None,
    include_personal_references: bool = True,
    include_session_attachments: bool = True,
    top_k: int | None = 8,
) -> list[RetrievedKnowledgeChunk]:
    terms = _query_terms(query)
    if not terms:
        return []
    normalized_conversation_id = (conversation_id or "").strip()
    usage_filters = []
    if include_personal_references:
        usage_filters.append(KnowledgeFile.usage_type == "personal_reference")
    if include_session_attachments and normalized_conversation_id:
        usage_filters.append(
            (KnowledgeFile.usage_type == "session_attachment")
            & (KnowledgeFile.conversation_id == normalized_conversation_id)
        )
    if not usage_filters:
        return []
    usage_filter = usage_filters[0] if len(usage_filters) == 1 else or_(*usage_filters)
    conditions = [
        KnowledgeChunk.status == "READY",
        KnowledgeChunk.deleted_at.is_(None),
        KnowledgeFile.status == "READY",
        usage_filter,
        KnowledgeFile.owner_user_id == sso_user_id,
        KnowledgeFile.reference_enabled.is_(True),
        KnowledgeFile.permission_scope == "private",
        KnowledgeFile.parse_status == "parsed",
        KnowledgeFile.index_status == "indexed",
        KnowledgeFile.deleted_at.is_(None),
        KnowledgeFile.hard_deleted_at.is_(None),
    ]
    normalized_file_ids = [file_id.strip() for file_id in (file_ids or []) if file_id.strip()]
    if normalized_file_ids:
        conditions.append(KnowledgeFile.uuid.in_(normalized_file_ids))
    rows = db.execute(
        select(KnowledgeChunk, KnowledgeFile)
        .join(KnowledgeFile, KnowledgeFile.id == KnowledgeChunk.file_id)
        .where(*conditions)
    ).all()

    ranked: list[RetrievedKnowledgeChunk] = []
    for chunk, file_record in rows:
        payload = cipher.decrypt_json(
            EncryptedPayload(
                ciphertext=chunk.chunk_text_ciphertext,
                nonce=chunk.chunk_text_nonce,
            ),
            chunk.chunk_id.encode(),
        )
        chunk_text = str(payload.get("text", ""))
        haystack = "\n".join([
            file_record.file_name,
            chunk.section_title,
            chunk_text,
        ])
        score = _score(haystack, terms)
        if score <= 0:
            continue
        ranked.append(
            RetrievedKnowledgeChunk(
                chunk_id=chunk.chunk_id,
                file_uuid=file_record.uuid,
                file_name=file_record.file_name,
                chunk_text=chunk_text,
                page_number=chunk.page_number,
                section_title=chunk.section_title,
                chunk_index=chunk.chunk_index,
                score=score,
                source_kind=file_record.usage_type,
            )
        )

    ranked.sort(
        key=lambda item: (
            item.score,
            item.file_name,
            -item.chunk_index,
            item.chunk_id,
        ),
        reverse=True,
    )
    results = ranked[: _clamp_top_k(top_k)]
    _mark_files_used(db, results)
    return results
