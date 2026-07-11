"""Synchronize eligible official knowledge vectors into Qdrant."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.config import get_settings
from app.crypto import ContentCipher, EncryptedPayload
from app.database import SessionLocal
from app.knowledge_embedding import build_embedding_service
from app.knowledge_keyword_index import TantivyKnowledgeIndex
from app.knowledge_search import _query_terms
from app.knowledge_vector_index import QdrantKnowledgeIndex
from app.models import KnowledgeChunk, KnowledgeFile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("--batch-size", type=int, default=128)
    args = parser.parse_args()

    settings = get_settings()
    with SessionLocal() as db:
        embedding_service = build_embedding_service(db, settings)
        index = QdrantKnowledgeIndex.from_settings(
            settings,
            dimensions=getattr(embedding_service, "dimensions", 0),
        )
        rows = db.execute(
            select(KnowledgeChunk, KnowledgeFile)
            .join(KnowledgeFile, KnowledgeFile.id == KnowledgeChunk.file_id)
            .where(
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
            )
            .order_by(KnowledgeChunk.id)
        ).all()
        written = 0
        if index.enabled:
            index.ensure_collection(recreate=args.recreate)
            written = index.upsert_rows(
                rows,
                embedding_service=embedding_service,
                batch_size=args.batch_size,
            )

        cipher = ContentCipher(settings.content_encryption_key)
        keyword_rows: list[tuple[str, str, str]] = []
        for chunk, file_record in rows:
            payload = cipher.decrypt_json(
                EncryptedPayload(
                    ciphertext=chunk.chunk_text_ciphertext,
                    nonce=chunk.chunk_text_nonce,
                ),
                chunk.chunk_id.encode(),
            )
            haystack = "\n".join([
                file_record.file_name,
                chunk.section_title,
                str(payload.get("text", "")),
            ])
            keyword_rows.append((
                chunk.chunk_id,
                file_record.uuid,
                " ".join(_query_terms(haystack)),
            ))
        keyword_written = TantivyKnowledgeIndex.from_settings(settings).rebuild(keyword_rows)
        print(json.dumps({
            "status": "complete",
            "scanned": len(rows),
            "vector_written": written,
            "keyword_written": keyword_written,
        }))


if __name__ == "__main__":
    main()
