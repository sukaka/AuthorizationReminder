from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Iterable

import httpx

from .config import Settings
from .models import KnowledgeChunk, KnowledgeFile

if TYPE_CHECKING:
    from .knowledge_search import EmbeddingService


@dataclass(frozen=True)
class VectorSearchHit:
    chunk_id: str
    score: float


@dataclass(frozen=True)
class VectorSearchResult:
    available: bool
    hits: tuple[VectorSearchHit, ...] = ()
    error: str = ""


class QdrantKnowledgeIndex:
    def __init__(
        self,
        *,
        url: str,
        collection: str,
        dimensions: int,
        api_key: str = "",
        timeout_seconds: float = 3.0,
        enabled: bool = True,
    ) -> None:
        self.url = url.rstrip("/")
        self.collection = collection.strip()
        self.dimensions = int(dimensions)
        self.api_key = api_key.strip()
        self.timeout_seconds = float(timeout_seconds)
        self.enabled = bool(enabled and self.url and self.collection and self.dimensions > 0)

    @classmethod
    def from_settings(cls, settings: Settings, *, dimensions: int) -> "QdrantKnowledgeIndex":
        return cls(
            url=settings.qdrant_url,
            collection=settings.qdrant_collection,
            dimensions=dimensions,
            api_key=settings.qdrant_api_key,
            timeout_seconds=settings.qdrant_timeout_seconds,
            enabled=settings.qdrant_enabled,
        )

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            **({"api-key": self.api_key} if self.api_key else {}),
        }

    def ensure_collection(self, *, recreate: bool = False) -> None:
        if not self.enabled:
            return
        collection_url = f"{self.url}/collections/{self.collection}"
        with httpx.Client(timeout=self.timeout_seconds) as client:
            if recreate:
                delete_response = client.delete(collection_url, headers=self.headers)
                if delete_response.status_code not in {200, 404}:
                    delete_response.raise_for_status()
            response = client.get(collection_url, headers=self.headers)
            if response.status_code == 200:
                return
            if response.status_code != 404:
                response.raise_for_status()
            create_response = client.put(
                collection_url,
                headers=self.headers,
                json={
                    "vectors": {"size": self.dimensions, "distance": "Cosine"},
                    "hnsw_config": {"m": 16, "ef_construct": 128},
                },
            )
            create_response.raise_for_status()

    def upsert_rows(
        self,
        rows: Iterable[tuple[KnowledgeChunk, KnowledgeFile]],
        *,
        embedding_service: EmbeddingService,
        batch_size: int = 128,
    ) -> int:
        if not self.enabled:
            return 0
        self.ensure_collection()
        points: list[dict] = []
        written = 0
        for chunk, file_record in rows:
            vector = embedding_service.from_metadata(chunk.metadata_json or {})
            if len(vector) != self.dimensions:
                continue
            metadata = chunk.metadata_json or {}
            points.append({
                "id": chunk.chunk_id,
                "vector": vector,
                "payload": {
                    "chunk_id": chunk.chunk_id,
                    "file_uuid": file_record.uuid,
                    "file_name": file_record.file_name,
                    "knowledge_base_id": file_record.knowledge_base_id,
                    "category": file_record.category,
                    "document_type": file_record.document_type,
                    "section_title": chunk.section_title,
                    "section_path": str(metadata.get("section_path") or chunk.section_title or ""),
                    "page_or_sheet": str(metadata.get("page_or_sheet") or ""),
                    "source_kind": "official_knowledge",
                    "permission_scope": file_record.permission_scope,
                    "rag_scope": file_record.rag_scope,
                    "embedding_id": chunk.embedding_id,
                },
            })
            if len(points) >= max(1, batch_size):
                self._upsert_points(points)
                written += len(points)
                points = []
        if points:
            self._upsert_points(points)
            written += len(points)
        return written

    def _upsert_points(self, points: list[dict]) -> None:
        response = httpx.put(
            f"{self.url}/collections/{self.collection}/points",
            headers=self.headers,
            params={"wait": "true"},
            json={"points": points},
            timeout=max(self.timeout_seconds, 30.0),
        )
        response.raise_for_status()

    def delete_file(self, file_uuid: str) -> None:
        if not self.enabled or not file_uuid.strip():
            return
        response = httpx.post(
            f"{self.url}/collections/{self.collection}/points/delete",
            headers=self.headers,
            params={"wait": "true"},
            json={
                "filter": {
                    "must": [{"key": "file_uuid", "match": {"value": file_uuid.strip()}}]
                }
            },
            timeout=max(self.timeout_seconds, 10.0),
        )
        if response.status_code != 404:
            response.raise_for_status()

    def search(
        self,
        vector: list[float],
        *,
        limit: int,
        knowledge_base_ids: list[int] | None = None,
        categories: list[str] | None = None,
        document_types: list[str] | None = None,
        score_threshold: float | None = None,
    ) -> VectorSearchResult:
        if not self.enabled or len(vector) != self.dimensions:
            return VectorSearchResult(available=False, error="VECTOR_INDEX_DISABLED_OR_DIMENSION_MISMATCH")
        must: list[dict] = [
            {"key": "source_kind", "match": {"value": "official_knowledge"}},
            {"key": "permission_scope", "match": {"value": "company"}},
            {"key": "rag_scope", "match": {"value": "company"}},
        ]
        if knowledge_base_ids:
            must.append({"key": "knowledge_base_id", "match": {"any": knowledge_base_ids}})
        if categories:
            must.append({"key": "category", "match": {"any": categories}})
        if document_types:
            must.append({"key": "document_type", "match": {"any": document_types}})
        body: dict = {
            "vector": vector,
            "limit": max(1, int(limit)),
            "with_payload": False,
            "with_vector": False,
            "filter": {"must": must},
        }
        if score_threshold is not None:
            body["score_threshold"] = float(score_threshold)
        try:
            response = httpx.post(
                f"{self.url}/collections/{self.collection}/points/search",
                headers=self.headers,
                json=body,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            raw_hits = payload.get("result") if isinstance(payload, dict) else []
            hits = tuple(
                VectorSearchHit(
                    chunk_id=str(item.get("id") or ""),
                    score=float(item.get("score") or 0.0),
                )
                for item in (raw_hits if isinstance(raw_hits, list) else [])
                if str(item.get("id") or "")
            )
            return VectorSearchResult(available=True, hits=hits)
        except (httpx.HTTPError, TypeError, ValueError) as exc:
            return VectorSearchResult(available=False, error=exc.__class__.__name__)
