from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from .config import Settings
from .embedding_config import (
    FIXED_EMBEDDING_BASE_URL,
    FIXED_EMBEDDING_DIMENSIONS,
    FIXED_EMBEDDING_MODEL_ID,
    FIXED_EMBEDDING_PROVIDER,
)
from .knowledge_search import EmbeddingService


@dataclass(frozen=True)
class EmbeddingModelConfig:
    provider: str
    base_url: str
    model_id: str
    api_key: str
    dimensions: int
    timeout_seconds: int


def load_embedding_model_config(
    _db: Session,
    settings: Settings,
) -> EmbeddingModelConfig:
    return EmbeddingModelConfig(
        provider=FIXED_EMBEDDING_PROVIDER,
        base_url=FIXED_EMBEDDING_BASE_URL,
        model_id=FIXED_EMBEDDING_MODEL_ID,
        api_key=settings.embedding_model_api_key.strip(),
        dimensions=FIXED_EMBEDDING_DIMENSIONS,
        timeout_seconds=settings.embedding_model_timeout_seconds,
    )


def _embeddings_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/embeddings"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/embeddings"
    return f"{normalized}/v1/embeddings"


class OpenAICompatibleEmbeddingService(EmbeddingService):
    def __init__(self, config: EmbeddingModelConfig):
        super().__init__(dimensions=config.dimensions or 1024)
        self.config = config
        self._local_fallback = EmbeddingService()
        self._local_fallback_vectors: set[tuple[float, ...]] = set()

    def embed(self, text: str) -> list[float]:
        try:
            headers = {"Content-Type": "application/json"}
            if self.config.api_key:
                headers["Authorization"] = f"Bearer {self.config.api_key}"
            with httpx.Client(timeout=self.config.timeout_seconds) as client:
                response = client.post(
                    _embeddings_url(self.config.base_url),
                    headers=headers,
                    json={
                        "model": self.config.model_id,
                        "input": text,
                        **({"dimensions": self.config.dimensions} if self.config.dimensions else {}),
                    },
                )
                response.raise_for_status()
                payload = response.json()
            embedding = payload["data"][0]["embedding"]
            if not isinstance(embedding, list):
                raise ValueError("embedding must be a list")
            return [float(value) for value in embedding]
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            vector = self._local_fallback.embed(text)
            self._local_fallback_vectors.add(tuple(vector))
            return vector

    def to_metadata(self, vector: list[float]) -> dict:
        if tuple(vector) in self._local_fallback_vectors:
            return self._local_fallback.to_metadata(vector)
        return {
            "provider": self.config.provider,
            "model_id": self.config.model_id,
            "dimensions": len(vector),
            "vector": vector,
        }

    def from_metadata(self, metadata: dict | None) -> list[float]:
        embedding = (metadata or {}).get("embedding")
        if not isinstance(embedding, dict):
            return []
        if embedding.get("provider") == "local-hash":
            return self._local_fallback.from_metadata(metadata)
        if embedding.get("provider") != self.config.provider:
            return []
        if embedding.get("model_id") != self.config.model_id:
            return []
        vector = embedding.get("vector")
        if not isinstance(vector, list):
            return []
        try:
            return [float(value) for value in vector]
        except (TypeError, ValueError):
            return []

    def embedding_id(self, chunk_id: str, vector: list[float]) -> str:
        base_id = super().embedding_id(chunk_id, vector).split(":", 1)[-1]
        return f"{self.config.provider}:{self.config.model_id}:{base_id}"[:128]


def build_embedding_service(db: Session, settings: Settings) -> EmbeddingService:
    config = load_embedding_model_config(db, settings)
    if config is None:
        return EmbeddingService()
    return OpenAICompatibleEmbeddingService(config)
