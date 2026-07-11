from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from .config import Settings
from .knowledge_vector_index import VectorSearchHit

try:
    import redis
except ImportError:  # pragma: no cover - optional in minimal local environments
    redis = None


@dataclass(frozen=True)
class CachedVectorHits:
    found: bool
    hits: tuple[VectorSearchHit, ...] = ()


class RedisKnowledgeCache:
    def __init__(
        self,
        *,
        url: str,
        prefix: str,
        enabled: bool,
        embedding_ttl_seconds: int,
        vector_ttl_seconds: int,
        client: Any | None = None,
    ) -> None:
        self.prefix = prefix.strip(":") or "juxin:ai:knowledge"
        self.embedding_ttl_seconds = int(embedding_ttl_seconds)
        self.vector_ttl_seconds = int(vector_ttl_seconds)
        self.enabled = bool(enabled and (client is not None or redis is not None))
        self.client = client
        if self.enabled and self.client is None and redis is not None:
            self.client = redis.Redis.from_url(
                url,
                socket_connect_timeout=0.3,
                socket_timeout=0.5,
                decode_responses=True,
            )

    @classmethod
    def from_settings(cls, settings: Settings) -> "RedisKnowledgeCache":
        return cls(
            url=settings.knowledge_redis_url,
            prefix=settings.knowledge_cache_prefix,
            enabled=settings.knowledge_redis_enabled,
            embedding_ttl_seconds=settings.query_embedding_cache_ttl_seconds,
            vector_ttl_seconds=settings.vector_result_cache_ttl_seconds,
        )

    @staticmethod
    def query_hash(query: str) -> str:
        normalized = " ".join(query.lower().split())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _get(self, key: str) -> str | None:
        if not self.enabled or self.client is None:
            return None
        try:
            value = self.client.get(key)
            return str(value) if value is not None else None
        except Exception:
            return None

    def _set(self, key: str, value: str, ttl: int) -> None:
        if not self.enabled or self.client is None:
            return
        try:
            self.client.setex(key, ttl, value)
        except Exception:
            return

    def knowledge_version(self) -> int:
        raw = self._get(f"{self.prefix}:version")
        try:
            return max(1, int(raw or 1))
        except ValueError:
            return 1

    def bump_knowledge_version(self) -> int:
        if not self.enabled or self.client is None:
            return 1
        try:
            value = int(self.client.incr(f"{self.prefix}:version"))
            if value <= 1:
                value = int(self.client.incr(f"{self.prefix}:version"))
            return max(1, value)
        except Exception:
            return self.knowledge_version()

    def get_query_embedding(self, query: str, *, model_id: str, dimensions: int) -> list[float] | None:
        key = (
            f"{self.prefix}:embedding:{model_id}:{dimensions}:"
            f"{self.query_hash(query)}"
        )
        raw = self._get(key)
        if raw is None:
            return None
        try:
            vector = json.loads(raw)
            if not isinstance(vector, list) or len(vector) != dimensions:
                return None
            return [float(value) for value in vector]
        except (TypeError, ValueError, json.JSONDecodeError):
            return None

    def set_query_embedding(
        self,
        query: str,
        vector: list[float],
        *,
        model_id: str,
        dimensions: int,
    ) -> None:
        if len(vector) != dimensions:
            return
        key = (
            f"{self.prefix}:embedding:{model_id}:{dimensions}:"
            f"{self.query_hash(query)}"
        )
        self._set(
            key,
            json.dumps(vector, separators=(",", ":")),
            self.embedding_ttl_seconds,
        )

    def _vector_key(self, query: str, *, scope: str, limit: int) -> str:
        scope_hash = hashlib.sha256(scope.encode("utf-8")).hexdigest()[:20]
        return (
            f"{self.prefix}:vectors:v{self.knowledge_version()}:{scope_hash}:"
            f"{limit}:{self.query_hash(query)}"
        )

    def get_vector_hits(self, query: str, *, scope: str, limit: int) -> CachedVectorHits:
        raw = self._get(self._vector_key(query, scope=scope, limit=limit))
        if raw is None:
            return CachedVectorHits(found=False)
        try:
            items = json.loads(raw)
            hits = tuple(
                VectorSearchHit(str(item["chunk_id"]), float(item["score"]))
                for item in items
                if isinstance(item, dict) and item.get("chunk_id")
            )
            return CachedVectorHits(found=True, hits=hits)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return CachedVectorHits(found=False)

    def set_vector_hits(
        self,
        query: str,
        *,
        scope: str,
        limit: int,
        hits: tuple[VectorSearchHit, ...],
    ) -> None:
        self._set(
            self._vector_key(query, scope=scope, limit=limit),
            json.dumps(
                [{"chunk_id": hit.chunk_id, "score": hit.score} for hit in hits],
                separators=(",", ":"),
            ),
            self.vector_ttl_seconds,
        )
