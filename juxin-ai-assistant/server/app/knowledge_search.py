import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from math import log, sqrt

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import KnowledgeBase, KnowledgeChunk, KnowledgeFile


EMBEDDING_PROVIDER = "local-hash"
EMBEDDING_VERSION = "v1"
DEFAULT_EMBEDDING_DIMENSIONS = 128
VECTOR_CANDIDATE_THRESHOLD = 0.35
HYBRID_CANDIDATE_LIMIT = 30
MAX_CHUNKS_PER_FILE = 3
MIN_FILE_COVERAGE = 3


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
    section_path: str = ""
    page_or_sheet: str = ""
    chunk_type: str = "text"


def _clamp_top_k(top_k: int | None) -> int:
    if top_k is None:
        return 8
    return max(1, min(int(top_k), 8))


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


def _term_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for term in _query_terms(text):
        counts[term] = counts.get(term, 0) + 1
    return counts


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(left_value * right_value for left_value, right_value in zip(left, right, strict=True))
    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _embedding_terms(text: str) -> list[str]:
    normalized = " ".join(text.lower().split())
    terms = _query_terms(normalized)
    if normalized and re.search(r"[\u4e00-\u9fff]", normalized):
        terms.extend(
            normalized[index:index + 3]
            for index in range(0, max(len(normalized) - 2, 0))
        )
    deduped: list[str] = []
    for term in terms:
        if term and term not in deduped:
            deduped.append(term)
    return deduped


class EmbeddingService:
    """Local deterministic dense embedding service.

    It gives the RAG pipeline a real stored vector contract without requiring
    secrets or an external model gateway in local/test environments. A remote
    embedding provider can later replace this class behind the same methods.
    """

    def __init__(self, *, dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS):
        self.dimensions = max(64, int(dimensions))

    def embed(self, text: str) -> list[float]:
        vector = [0.0 for _ in range(self.dimensions)]
        for term in _embedding_terms(text):
            digest = hashlib.sha256(term.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            weight = 1.0 + min(len(term), 16) / 16
            vector[index] += sign * weight
        norm = sqrt(sum(value * value for value in vector))
        if not norm:
            return vector
        return [round(value / norm, 6) for value in vector]

    def embed_chunk(self, chunk_text: str, metadata: dict | None = None) -> list[float]:
        return self.embed("\n".join([_metadata_text(metadata), chunk_text]).strip())

    def to_metadata(self, vector: list[float]) -> dict:
        return {
            "provider": EMBEDDING_PROVIDER,
            "version": EMBEDDING_VERSION,
            "dimensions": self.dimensions,
            "vector": vector,
        }

    def from_metadata(self, metadata: dict | None) -> list[float]:
        embedding = (metadata or {}).get("embedding")
        if not isinstance(embedding, dict):
            return []
        if embedding.get("provider") != EMBEDDING_PROVIDER:
            return []
        if embedding.get("version") != EMBEDDING_VERSION:
            return []
        dimensions = int(embedding.get("dimensions") or 0)
        vector = embedding.get("vector")
        if dimensions <= 0 or not isinstance(vector, list) or len(vector) != dimensions:
            return []
        numeric_vector: list[float] = []
        for value in vector:
            if not isinstance(value, (int, float)):
                return []
            numeric_vector.append(float(value))
        return numeric_vector

    def embedding_id(self, chunk_id: str, vector: list[float]) -> str:
        digest = hashlib.sha256(
            f"{chunk_id}:{','.join(f'{value:.6f}' for value in vector)}".encode("utf-8")
        ).hexdigest()[:32]
        return f"local-hash-v1:{digest}"


@dataclass(frozen=True)
class _SearchDocument:
    chunk: KnowledgeChunk
    file_record: KnowledgeFile
    chunk_text: str
    haystack: str
    metadata: dict
    source_kind: str


@dataclass(frozen=True)
class _HybridCandidate:
    document: _SearchDocument
    keyword_score: int
    bm25_score: float
    vector_score: float
    metadata_bonus: int
    final_score: int


class VectorStoreService:
    """JSON-backed vector store over `KnowledgeChunk.metadata_json`.

    The storage is intentionally database-native for the first complete version:
    vectors are persisted with chunks and scored by cosine similarity at query
    time. This keeps the service usable without adding an external vector DB.
    """

    def __init__(self, embedding_service: EmbeddingService | None = None):
        self.embedding_service = embedding_service or EmbeddingService()

    def score(self, query_vector: list[float], metadata: dict | None) -> float:
        chunk_vector = self.embedding_service.from_metadata(metadata)
        if not query_vector or not chunk_vector:
            return 0.0
        return _cosine_similarity(query_vector, chunk_vector)

    def rank(
        self,
        query_vector: list[float],
        documents: list[_SearchDocument],
        *,
        top_k: int = HYBRID_CANDIDATE_LIMIT,
    ) -> list[tuple[int, float]]:
        scored = [
            (index, self.score(query_vector, document.metadata))
            for index, document in enumerate(documents)
        ]
        return [
            item for item in sorted(scored, key=lambda value: value[1], reverse=True)
            if item[1] >= VECTOR_CANDIDATE_THRESHOLD
        ][:top_k]


class BM25Retriever:
    def __init__(self, *, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def score_documents(self, query: str, documents: list[str]) -> list[float]:
        query_terms = _query_terms(query)
        if not query_terms or not documents:
            return [0.0 for _ in documents]
        tokenized = [_query_terms(document) for document in documents]
        average_length = sum(len(tokens) for tokens in tokenized) / max(len(tokenized), 1)
        if average_length <= 0:
            return [0.0 for _ in documents]
        unique_query_terms = list(dict.fromkeys(query_terms))
        document_frequencies = {
            term: sum(1 for tokens in tokenized if term in tokens)
            for term in unique_query_terms
        }
        scores: list[float] = []
        total_documents = len(documents)
        for tokens in tokenized:
            length = len(tokens) or 1
            score = 0.0
            for term in unique_query_terms:
                frequency = tokens.count(term)
                if frequency <= 0:
                    continue
                df = document_frequencies.get(term, 0)
                idf = log(1 + (total_documents - df + 0.5) / (df + 0.5))
                denominator = frequency + self.k1 * (1 - self.b + self.b * length / average_length)
                score += idf * (frequency * (self.k1 + 1)) / denominator
            scores.append(score)
        return scores

    def rank(
        self,
        query: str,
        documents: list[str],
        *,
        top_k: int = HYBRID_CANDIDATE_LIMIT,
    ) -> list[tuple[int, float]]:
        scored = [
            (index, score)
            for index, score in enumerate(self.score_documents(query, documents))
            if score > 0
        ]
        return sorted(scored, key=lambda value: value[1], reverse=True)[:top_k]


class KeywordIndexService:
    @staticmethod
    def score(text: str, terms: list[str]) -> int:
        return _score(text, terms)


class RerankService:
    @staticmethod
    def score(
        *,
        keyword_score: int,
        vector_score: float,
        metadata_bonus: int,
        bm25_score: float = 0.0,
    ) -> int:
        hybrid_bonus = 15 if vector_score > 0 and bm25_score > 0 else 0
        return (
            keyword_score * 10
            + int(vector_score * 100)
            + int(bm25_score * 25)
            + metadata_bonus
            + hybrid_bonus
        )

    def rank(self, candidates: list[_HybridCandidate], *, top_k: int | None) -> list[_HybridCandidate]:
        ranked = sorted(
            candidates,
            key=lambda item: (
                item.final_score,
                item.bm25_score,
                item.vector_score,
                item.keyword_score,
                item.document.file_record.file_name,
                -item.document.chunk.chunk_index,
            ),
            reverse=True,
        )
        limit = _clamp_top_k(top_k)
        if not ranked:
            return []

        selected: list[_HybridCandidate] = []
        selected_ids: set[int] = set()
        file_counts: dict[str, int] = {}
        distinct_files = list(dict.fromkeys(
            item.document.file_record.uuid
            for item in ranked
        ))
        coverage_target = min(MIN_FILE_COVERAGE, len(distinct_files), limit)

        # Reserve the first slots for the strongest chunk from different files.
        for candidate in ranked:
            file_uuid = candidate.document.file_record.uuid
            if file_uuid in file_counts:
                continue
            selected.append(candidate)
            selected_ids.add(id(candidate))
            file_counts[file_uuid] = 1
            if len(file_counts) >= coverage_target:
                break

        # Fill remaining slots by score while preventing one large document
        # from occupying the entire context window.
        for candidate in ranked:
            if len(selected) >= limit:
                break
            if id(candidate) in selected_ids:
                continue
            file_uuid = candidate.document.file_record.uuid
            if file_counts.get(file_uuid, 0) >= MAX_CHUNKS_PER_FILE:
                continue
            selected.append(candidate)
            selected_ids.add(id(candidate))
            file_counts[file_uuid] = file_counts.get(file_uuid, 0) + 1

        return selected


def _metadata_text(metadata: dict | None) -> str:
    if not metadata:
        return ""
    parts = []
    for key in ("section_path", "page_or_sheet", "chunk_type"):
        value = metadata.get(key)
        if value:
            parts.append(str(value))
    keywords = metadata.get("keywords") or []
    if isinstance(keywords, list):
        parts.extend(str(item) for item in keywords if item)
    return "\n".join(parts)


def _metadata_bonus(metadata: dict | None, terms: list[str]) -> int:
    text = _metadata_text(metadata).lower()
    return sum(5 for term in terms if term and term in text)


def _retrieved_from_row(
    *,
    chunk: KnowledgeChunk,
    file_record: KnowledgeFile,
    chunk_text: str,
    source_kind: str,
    score: int,
) -> RetrievedKnowledgeChunk:
    metadata = chunk.metadata_json or {}
    section_path = str(metadata.get("section_path") or chunk.section_title or "")
    page_or_sheet = str(metadata.get("page_or_sheet") or "")
    chunk_type = str(metadata.get("chunk_type") or "text")
    metadata_source_kind = str(metadata.get("source_type") or "").strip()
    return RetrievedKnowledgeChunk(
        chunk_id=chunk.chunk_id,
        file_uuid=file_record.uuid,
        file_name=file_record.file_name,
        chunk_text=chunk_text,
        page_number=chunk.page_number,
        section_title=chunk.section_title,
        chunk_index=chunk.chunk_index,
        score=score,
        source_kind=metadata_source_kind or source_kind,
        section_path=section_path,
        page_or_sheet=page_or_sheet,
        chunk_type=chunk_type,
    )


def _hybrid_rank_rows(
    rows: list[tuple[KnowledgeChunk, KnowledgeFile]],
    *,
    query: str,
    terms: list[str],
    cipher: ContentCipher,
    source_kind_for_file,
    top_k: int | None,
    embedding_service: EmbeddingService | None = None,
) -> list[RetrievedKnowledgeChunk]:
    return HybridRetriever(cipher=cipher, embedding_service=embedding_service).retrieve(
        rows,
        query=query,
        terms=terms,
        source_kind_for_file=source_kind_for_file,
        top_k=top_k,
    )


class HybridRetriever:
    def __init__(
        self,
        *,
        cipher: ContentCipher,
        embedding_service: EmbeddingService | None = None,
        vector_store: VectorStoreService | None = None,
        bm25_retriever: BM25Retriever | None = None,
        rerank_service: RerankService | None = None,
    ):
        self.cipher = cipher
        self.embedding_service = embedding_service or EmbeddingService()
        self.vector_store = vector_store or VectorStoreService(self.embedding_service)
        self.bm25_retriever = bm25_retriever or BM25Retriever()
        self.keyword_service = KeywordIndexService()
        self.rerank_service = rerank_service or RerankService()

    def retrieve(
        self,
        rows: list[tuple[KnowledgeChunk, KnowledgeFile]],
        *,
        query: str,
        terms: list[str],
        source_kind_for_file,
        top_k: int | None,
    ) -> list[RetrievedKnowledgeChunk]:
        documents: list[_SearchDocument] = []
        for chunk, file_record in rows:
            payload = self.cipher.decrypt_json(
                EncryptedPayload(
                    ciphertext=chunk.chunk_text_ciphertext,
                    nonce=chunk.chunk_text_nonce,
                ),
                chunk.chunk_id.encode(),
            )
            chunk_text = str(payload.get("text", ""))
            metadata = chunk.metadata_json or {}
            haystack = "\n".join([
                file_record.file_name,
                chunk.section_title,
                _metadata_text(metadata),
                chunk_text,
            ])
            documents.append(
                _SearchDocument(
                    chunk=chunk,
                    file_record=file_record,
                    chunk_text=chunk_text,
                    haystack=haystack,
                    metadata=metadata,
                    source_kind=source_kind_for_file(file_record),
                )
            )
        if not documents:
            return []

        query_vector = self.embedding_service.embed(query)
        vector_scores = dict(self.vector_store.rank(query_vector, documents, top_k=HYBRID_CANDIDATE_LIMIT))
        bm25_scores_all = self.bm25_retriever.score_documents(query, [document.haystack for document in documents])
        bm25_scores = dict(
            sorted(
                [
                    (index, score)
                    for index, score in enumerate(bm25_scores_all)
                    if score > 0
                ],
                key=lambda item: item[1],
                reverse=True,
            )[:HYBRID_CANDIDATE_LIMIT]
        )
        keyword_scores = {
            index: self.keyword_service.score(document.haystack, terms)
            for index, document in enumerate(documents)
        }
        keyword_top = dict(
            sorted(
                [
                    (index, score)
                    for index, score in keyword_scores.items()
                    if score > 0
                ],
                key=lambda item: item[1],
                reverse=True,
            )[:HYBRID_CANDIDATE_LIMIT]
        )

        candidate_indices = set(vector_scores) | set(bm25_scores) | set(keyword_top)
        candidates: list[_HybridCandidate] = []
        for index in candidate_indices:
            document = documents[index]
            keyword_score = keyword_scores.get(index, 0)
            bm25_score = bm25_scores_all[index] if index < len(bm25_scores_all) else 0.0
            vector_score = vector_scores.get(index, 0.0)
            bonus = _metadata_bonus(document.metadata, terms)
            if keyword_score <= 0 and bm25_score <= 0 and vector_score <= 0 and bonus <= 0:
                continue
            final_score = self.rerank_service.score(
                keyword_score=keyword_score,
                vector_score=vector_score,
                bm25_score=bm25_score,
                metadata_bonus=bonus,
            )
            candidates.append(
                _HybridCandidate(
                    document=document,
                    keyword_score=keyword_score,
                    bm25_score=bm25_score,
                    vector_score=vector_score,
                    metadata_bonus=bonus,
                    final_score=final_score,
                )
            )

        ranked = self.rerank_service.rank(candidates, top_k=top_k)
        return [
            _retrieved_from_row(
                chunk=candidate.document.chunk,
                file_record=candidate.document.file_record,
                chunk_text=candidate.document.chunk_text,
                source_kind=candidate.document.source_kind,
                score=candidate.final_score,
            )
            for candidate in ranked
        ]


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
    embedding_service: EmbeddingService | None = None,
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

    results = _hybrid_rank_rows(
        rows,
        query=query,
        terms=terms,
        cipher=cipher,
        source_kind_for_file=lambda _file: "official_knowledge",
        top_k=top_k,
        embedding_service=embedding_service,
    )
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
    embedding_service: EmbeddingService | None = None,
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

    results = _hybrid_rank_rows(
        rows,
        query=query,
        terms=terms,
        cipher=cipher,
        source_kind_for_file=lambda file_record: file_record.usage_type,
        top_k=top_k,
        embedding_service=embedding_service,
    )
    _mark_files_used(db, results)
    return results
