import hashlib
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from math import log, sqrt
from threading import Lock
from time import monotonic, perf_counter
from typing import TYPE_CHECKING

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, object_session

from .crypto import ContentCipher, EncryptedPayload
from .knowledge_vector_index import VectorSearchResult
from .models import KnowledgeBase, KnowledgeChunk, KnowledgeFile

if TYPE_CHECKING:
    from .knowledge_vector_index import QdrantKnowledgeIndex


EMBEDDING_PROVIDER = "local-hash"
EMBEDDING_VERSION = "v1"
DEFAULT_EMBEDDING_DIMENSIONS = 128
# Qwen3-Embedding GGUF cosine scores are typically lower than hosted dense
# embedding services; lexical reranking and relevance gates remove weak hits.
VECTOR_CANDIDATE_THRESHOLD = 0.30
MIN_HYBRID_CANDIDATE_LIMIT = 30
PRECISE_RETRIEVAL_LIMIT = 12
SUMMARY_RETRIEVAL_LIMIT = 18
EXHAUSTIVE_RETRIEVAL_LIMIT = 24
MIN_FILE_COVERAGE = 3
MIN_LEXICAL_MATCH_TERMS = 2
OFFICIAL_INDEX_CACHE_TTL_SECONDS = 60.0

EXHAUSTIVE_QUERY_MARKERS = (
    "全部", "完整", "所有", "全量", "逐项", "逐条", "一览", "不遗漏",
)
SUMMARY_QUERY_MARKERS = (
    "汇总", "总结", "概览", "综述", "主要内容", "包含什么", "有哪些",
    "列出", "整理", "清单", "归纳",
)

_official_rows_cache: OrderedDict[
    tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]],
    tuple[float, tuple[tuple[KnowledgeChunk, KnowledgeFile], ...]],
] = OrderedDict()
_official_rows_cache_lock = Lock()
_official_rows_cache_size = 8


def clear_knowledge_search_caches() -> None:
    with _official_rows_cache_lock:
        _official_rows_cache.clear()
    with HybridRetriever._document_cache_lock:
        HybridRetriever._document_cache.clear()
    with VectorStoreService._matrix_cache_lock:
        VectorStoreService._matrix_cache.clear()
    _cached_query_terms.cache_clear()


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


def resolve_retrieval_limit(query: str, top_k: int | None = None) -> int:
    """Resolve the final context size from query intent and caller preference."""
    normalized = "".join(query.lower().split())
    if any(marker in normalized for marker in EXHAUSTIVE_QUERY_MARKERS):
        intent_limit = EXHAUSTIVE_RETRIEVAL_LIMIT
    elif any(marker in normalized for marker in SUMMARY_QUERY_MARKERS):
        intent_limit = SUMMARY_RETRIEVAL_LIMIT
    else:
        intent_limit = PRECISE_RETRIEVAL_LIMIT

    requested_limit = max(1, int(top_k)) if top_k is not None else 0
    return min(max(intent_limit, requested_limit), EXHAUSTIVE_RETRIEVAL_LIMIT)


def max_chunks_per_file(limit: int) -> int:
    if limit <= PRECISE_RETRIEVAL_LIMIT:
        return 4
    if limit <= 20:
        return 6
    return 8


@lru_cache(maxsize=20_000)
def _cached_query_terms(query: str) -> tuple[str, ...]:
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
    return tuple(deduped)


def _query_terms(query: str) -> list[str]:
    return list(_cached_query_terms(query))


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

    def embed_query(self, text: str) -> list[float]:
        return self.embed(text)

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

    _matrix_cache: OrderedDict[tuple[str, ...], np.ndarray] = OrderedDict()
    _matrix_cache_lock = Lock()
    _matrix_cache_size = 6

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
        top_k: int = MIN_HYBRID_CANDIDATE_LIMIT,
    ) -> list[tuple[int, float]]:
        if not query_vector or not documents:
            return []
        cache_key = (
            f"dimensions:{len(query_vector)}",
            *(
                f"{document.chunk.chunk_id}:{document.chunk.embedding_id or ''}"
                for document in documents
            ),
        )
        with self._matrix_cache_lock:
            matrix = self._matrix_cache.get(cache_key)
            if matrix is not None:
                self._matrix_cache.move_to_end(cache_key)
        if matrix is None:
            vectors = [self.embedding_service.from_metadata(document.metadata) for document in documents]
            dimensions = len(query_vector)
            matrix = np.zeros((len(documents), dimensions), dtype=np.float32)
            for index, vector in enumerate(vectors):
                if len(vector) == dimensions:
                    matrix[index] = vector
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            np.divide(matrix, norms, out=matrix, where=norms > 0)
            matrix.setflags(write=False)
            with self._matrix_cache_lock:
                self._matrix_cache[cache_key] = matrix
                self._matrix_cache.move_to_end(cache_key)
                while len(self._matrix_cache) > self._matrix_cache_size:
                    self._matrix_cache.popitem(last=False)
        query_array = np.asarray(query_vector, dtype=np.float32)
        query_norm = float(np.linalg.norm(query_array))
        if query_norm <= 0:
            return []
        similarities = matrix @ (query_array / query_norm)
        scored = list(enumerate(float(value) for value in similarities))
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
        top_k: int = MIN_HYBRID_CANDIDATE_LIMIT,
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

    def rank(self, candidates: list[_HybridCandidate], *, limit: int) -> list[_HybridCandidate]:
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
        if not ranked:
            return []

        per_file_limit = max_chunks_per_file(limit)

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
            if file_counts.get(file_uuid, 0) >= per_file_limit:
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


def _has_lexical_relevance(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    matched = {term for term in terms if term and term in lowered}
    return (
        len(matched) >= MIN_LEXICAL_MATCH_TERMS
        or any(len(term) >= 6 for term in matched)
    )


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
    query_vector: list[float] | None = None,
    external_vector_scores: dict[str, float] | None = None,
) -> list[RetrievedKnowledgeChunk]:
    return HybridRetriever(cipher=cipher, embedding_service=embedding_service).retrieve(
        rows,
        query=query,
        terms=terms,
        source_kind_for_file=source_kind_for_file,
        top_k=top_k,
        query_vector=query_vector,
        external_vector_scores=external_vector_scores,
    )


class HybridRetriever:
    _document_cache: OrderedDict[tuple[str, ...], tuple[_SearchDocument, ...]] = OrderedDict()
    _document_cache_lock = Lock()
    _document_cache_size = 8

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
        query_vector: list[float] | None = None,
        external_vector_scores: dict[str, float] | None = None,
    ) -> list[RetrievedKnowledgeChunk]:
        source_kinds = [source_kind_for_file(file_record) for _, file_record in rows]
        cache_key = tuple(
            (
                f"{chunk.chunk_id}:{chunk.updated_at}:{file_record.uuid}:{file_record.updated_at}:"
                f"{hashlib.sha256(chunk.chunk_text_ciphertext).hexdigest()[:16]}:{source_kind}"
            )
            for (chunk, file_record), source_kind in zip(rows, source_kinds, strict=True)
        )
        with self._document_cache_lock:
            cached_documents = self._document_cache.get(cache_key)
            if cached_documents is not None:
                self._document_cache.move_to_end(cache_key)
        if cached_documents is not None:
            documents = list(cached_documents)
        else:
            documents = []
            for (chunk, file_record), source_kind in zip(rows, source_kinds, strict=True):
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
                        source_kind=source_kind,
                    )
                )
            with self._document_cache_lock:
                self._document_cache[cache_key] = tuple(documents)
                self._document_cache.move_to_end(cache_key)
                while len(self._document_cache) > self._document_cache_size:
                    self._document_cache.popitem(last=False)
        if not documents:
            return []

        result_limit = resolve_retrieval_limit(query, top_k)
        candidate_limit = max(MIN_HYBRID_CANDIDATE_LIMIT, result_limit * 3)
        if external_vector_scores is not None:
            vector_scores = {
                index: external_vector_scores[document.chunk.chunk_id]
                for index, document in enumerate(documents)
                if document.chunk.chunk_id in external_vector_scores
            }
        else:
            resolved_query_vector = query_vector or self.embedding_service.embed_query(query)
            vector_scores = dict(
                self.vector_store.rank(resolved_query_vector, documents, top_k=candidate_limit)
            )
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
            )[:candidate_limit]
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
            )[:candidate_limit]
        )

        candidate_indices = set(vector_scores) | set(bm25_scores) | set(keyword_top)
        candidates: list[_HybridCandidate] = []
        for index in candidate_indices:
            document = documents[index]
            keyword_score = keyword_scores.get(index, 0)
            bm25_score = bm25_scores_all[index] if index < len(bm25_scores_all) else 0.0
            vector_score = vector_scores.get(index, 0.0)
            bonus = _metadata_bonus(document.metadata, terms)
            semantic_relevant = vector_score >= VECTOR_CANDIDATE_THRESHOLD
            lexical_relevant = _has_lexical_relevance(document.haystack, terms)
            if not semantic_relevant and not lexical_relevant:
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

        ranked = self.rerank_service.rank(candidates, limit=result_limit)
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
    track_usage: bool = True,
    vector_index: "QdrantKnowledgeIndex | None" = None,
    keyword_index=None,
    knowledge_cache=None,
) -> list[RetrievedKnowledgeChunk]:
    request_started = perf_counter()
    embedding_ms = 0.0
    vector_search_ms = 0.0
    keyword_search_ms = 0.0
    cache_hit = False
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
    numeric_base_ids: list[int] = []
    if normalized_base_ids:
        numeric_base_ids = list(db.scalars(
            select(KnowledgeBase.id).where(
                KnowledgeBase.uuid.in_(normalized_base_ids),
                KnowledgeBase.deleted_at.is_(None),
            )
        ))
        conditions.append(
            KnowledgeFile.knowledge_base_id.in_(numeric_base_ids)
        )
    normalized_categories = [item.strip() for item in (categories or []) if item.strip()]
    if normalized_categories:
        conditions.append(KnowledgeFile.category.in_(normalized_categories))
    normalized_document_types = [item.strip() for item in (document_types or []) if item.strip()]
    if normalized_document_types:
        conditions.append(KnowledgeFile.document_type.in_(normalized_document_types))

    result_limit = resolve_retrieval_limit(query, top_k)
    candidate_limit = max(MIN_HYBRID_CANDIDATE_LIMIT, result_limit * 3)
    resolved_embedding_service = embedding_service or EmbeddingService()
    query_vector: list[float] | None = None
    external_vector_scores: dict[str, float] | None = None
    external_chunk_ids: list[str] = []
    if vector_index is None:
        from .config import get_settings
        from .knowledge_cache import RedisKnowledgeCache
        from .knowledge_keyword_index import TantivyKnowledgeIndex
        from .knowledge_vector_index import QdrantKnowledgeIndex

        current_settings = get_settings()
        vector_index = QdrantKnowledgeIndex.from_settings(
            current_settings,
            dimensions=getattr(resolved_embedding_service, "dimensions", 0),
        )
        if knowledge_cache is None:
            knowledge_cache = RedisKnowledgeCache.from_settings(current_settings)
        if keyword_index is None:
            keyword_index = TantivyKnowledgeIndex.from_settings(current_settings)
    if vector_index.enabled:
        scope = "|".join([
            ",".join(str(item) for item in numeric_base_ids),
            ",".join(normalized_categories),
            ",".join(normalized_document_types),
        ])
        cached_hits = (
            knowledge_cache.get_vector_hits(query, scope=scope, limit=candidate_limit)
            if knowledge_cache is not None
            else None
        )
        if cached_hits is not None and cached_hits.found:
            external_hits = cached_hits.hits
            cache_hit = True
        else:
            embedding_started = perf_counter()
            query_vector = resolved_embedding_service.embed_query(query)
            embedding_ms = (perf_counter() - embedding_started) * 1000
            expected_dimensions = getattr(vector_index, "dimensions", len(query_vector))
            if len(query_vector) != expected_dimensions:
                external_result = VectorSearchResult(available=False)
            else:
                vector_started = perf_counter()
                external_result = vector_index.search(
                    query_vector,
                    limit=candidate_limit,
                    knowledge_base_ids=numeric_base_ids,
                    categories=normalized_categories,
                    document_types=normalized_document_types,
                    score_threshold=VECTOR_CANDIDATE_THRESHOLD,
                )
                vector_search_ms = (perf_counter() - vector_started) * 1000
            external_hits = external_result.hits if external_result.available else ()
            if external_result.available and knowledge_cache is not None:
                knowledge_cache.set_vector_hits(
                    query,
                    scope=scope,
                    limit=candidate_limit,
                    hits=external_hits,
                )
        if external_hits:
            external_chunk_ids = [hit.chunk_id for hit in external_hits]
            external_vector_scores = {hit.chunk_id: hit.score for hit in external_hits}

    if keyword_index is not None and keyword_index.enabled:
        keyword_started = perf_counter()
        keyword_result = keyword_index.search(terms, limit=candidate_limit)
        keyword_search_ms = (perf_counter() - keyword_started) * 1000
        if keyword_result.available:
            seen_chunk_ids = set(external_chunk_ids)
            for hit in keyword_result.hits:
                if hit.chunk_id not in seen_chunk_ids:
                    external_chunk_ids.append(hit.chunk_id)
                    seen_chunk_ids.add(hit.chunk_id)

    cache_key = (
        tuple(normalized_base_ids),
        tuple(normalized_categories),
        tuple(normalized_document_types),
    )
    rows: list[tuple[KnowledgeChunk, KnowledgeFile]] | tuple[tuple[KnowledgeChunk, KnowledgeFile], ...]
    use_cache = db.get_bind().dialect.name != "sqlite" and not external_chunk_ids
    cached_rows: tuple[tuple[KnowledgeChunk, KnowledgeFile], ...] | None = None
    if use_cache:
        with _official_rows_cache_lock:
            cached = _official_rows_cache.get(cache_key)
            if cached and monotonic() - cached[0] < OFFICIAL_INDEX_CACHE_TTL_SECONDS:
                cached_rows = cached[1]
                _official_rows_cache.move_to_end(cache_key)
            elif cached:
                _official_rows_cache.pop(cache_key, None)
    if cached_rows is not None:
        rows = cached_rows
    else:
        row_query = (
            select(KnowledgeChunk, KnowledgeFile)
            .join(KnowledgeFile, KnowledgeFile.id == KnowledgeChunk.file_id)
            .where(*conditions)
        )
        if external_chunk_ids:
            row_query = row_query.where(KnowledgeChunk.chunk_id.in_(external_chunk_ids))
        rows = db.execute(row_query).all()
        if use_cache:
            cached_rows = tuple(rows)
            with _official_rows_cache_lock:
                _official_rows_cache[cache_key] = (monotonic(), cached_rows)
                _official_rows_cache.move_to_end(cache_key)
                while len(_official_rows_cache) > _official_rows_cache_size:
                    _official_rows_cache.popitem(last=False)
            rows = cached_rows

    rerank_started = perf_counter()
    results = _hybrid_rank_rows(
        rows,
        query=query,
        terms=terms,
        cipher=cipher,
        source_kind_for_file=lambda _file: "official_knowledge",
        top_k=top_k,
        embedding_service=resolved_embedding_service,
        query_vector=query_vector,
        external_vector_scores=external_vector_scores,
    )
    rerank_ms = (perf_counter() - rerank_started) * 1000
    if use_cache:
        cached_entities = {
            id(entity): entity
            for chunk, file_record in rows
            for entity in (chunk, file_record)
        }
        for entity in cached_entities.values():
            if object_session(entity) is db:
                db.expunge(entity)
    if track_usage:
        _mark_files_used(db, results)
    logging.getLogger(__name__).info(
        "knowledge_retrieval_metrics %s",
        json.dumps({
            "request_total_ms": round((perf_counter() - request_started) * 1000, 2),
            "embedding_ms": round(embedding_ms, 2),
            "vector_search_ms": round(vector_search_ms, 2),
            "keyword_search_ms": round(keyword_search_ms, 2),
            "rerank_ms": round(rerank_ms, 2),
            "cache_hit": cache_hit,
            "candidate_count": len(external_chunk_ids),
            "result_count": len(results),
        }, separators=(",", ":")),
    )
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
