"""Rebuild persisted knowledge chunk vectors with the configured embedding model."""

from __future__ import annotations

import argparse
import json

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.crypto import ContentCipher, EncryptedPayload
from app.database import SessionLocal
from app.knowledge_embedding import (
    OpenAICompatibleEmbeddingService,
    _embeddings_url,
    load_embedding_model_config,
)
from app.knowledge_search import _metadata_text
from app.models import KnowledgeChunk


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-batch-chars", type=int, default=12_000)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    settings = get_settings()
    cipher = ContentCipher(settings.content_encryption_key)
    db = SessionLocal()
    try:
        config = load_embedding_model_config(db, settings)
        service = OpenAICompatibleEmbeddingService(config)
        chunks = list(db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.status == "READY", KnowledgeChunk.deleted_at.is_(None))
            .order_by(KnowledgeChunk.id)
        ))
        pending = [
            chunk
            for chunk in chunks
            if args.force
            or (chunk.metadata_json or {}).get("embedding", {}).get("provider") != config.provider
            or (chunk.metadata_json or {}).get("embedding", {}).get("model_id") != config.model_id
        ]
        pending.sort(key=lambda chunk: (
            chunk.token_count or chunk.token_estimate or 1_000_000,
            chunk.id,
        ))
        completed = 0
        with httpx.Client(timeout=max(config.timeout_seconds * 10, 300)) as client:
            cursor = 0
            while cursor < len(pending):
                batch: list[KnowledgeChunk] = []
                texts: list[str] = []
                batch_chars = 0
                while cursor < len(pending) and len(batch) < max(1, args.batch_size):
                    chunk = pending[cursor]
                    payload = cipher.decrypt_json(
                        EncryptedPayload(chunk.chunk_text_ciphertext, chunk.chunk_text_nonce),
                        chunk.chunk_id.encode(),
                    )
                    metadata = chunk.metadata_json or {}
                    text = "\n".join([
                        _metadata_text(metadata),
                        str(payload.get("text", "")),
                    ]).strip()
                    if batch and batch_chars + len(text) > max(1, args.max_batch_chars):
                        break
                    batch.append(chunk)
                    texts.append(text)
                    batch_chars += len(text)
                    cursor += 1
                response = client.post(
                    _embeddings_url(config.base_url),
                    headers={
                        "Content-Type": "application/json",
                        **({"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}),
                    },
                    json={
                        "model": config.model_id,
                        "input": texts,
                        "dimensions": config.dimensions,
                    },
                )
                response.raise_for_status()
                vectors = [item["embedding"] for item in response.json()["data"]]
                if len(vectors) != len(batch):
                    raise RuntimeError("embedding response count mismatch")
                for chunk, vector in zip(batch, vectors, strict=True):
                    numeric = [float(value) for value in vector]
                    chunk.metadata_json = {
                        **(chunk.metadata_json or {}),
                        "embedding": service.to_metadata(numeric),
                    }
                    chunk.embedding_id = service.embedding_id(chunk.chunk_id, numeric)
                db.commit()
                completed += len(batch)
                print(json.dumps({"completed": completed, "total": len(pending)}), flush=True)
        print(json.dumps({"status": "complete", "updated": completed, "scanned": len(chunks)}))
    finally:
        db.close()


if __name__ == "__main__":
    main()
