from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import KnowledgeItem, KnowledgeTaskLink


@dataclass(frozen=True)
class RetrievedKnowledge:
    uuid: str
    title: str
    content: str
    score: int
    priority: int
    matched_keywords: tuple[str, ...]
    clipped: bool
    original_characters: int
    tags: tuple[str, ...]
    created_by: str
    updated_by: str


class KnowledgeRetriever:
    def __init__(self, cipher: ContentCipher):
        self._cipher = cipher

    def retrieve(
        self,
        db: Session,
        task_id: int,
        inputs: dict[str, object],
        limit: int | None = 8,
        max_chars: int | None = None,
    ) -> list[RetrievedKnowledge]:
        query_text = " ".join(str(value) for value in inputs.values()).lower()
        rows = db.scalars(
            select(KnowledgeItem)
            .join(
                KnowledgeTaskLink,
                KnowledgeTaskLink.knowledge_id == KnowledgeItem.id,
            )
            .where(
                KnowledgeTaskLink.task_id == task_id,
                KnowledgeItem.status == "ACTIVE",
            )
        ).all()
        ranked: list[RetrievedKnowledge] = []
        for row in rows:
            tags = row.tags_json
            if not isinstance(tags, list) or not all(
                isinstance(tag, str) for tag in tags
            ):
                continue
            keywords = [
                str(item).strip().lower()
                for item in row.keywords_json or []
                if str(item).strip()
            ]
            matched_keywords = tuple(
                keyword
                for keyword in keywords
                if keyword in query_text
            )
            score = len(matched_keywords)
            payload = self._cipher.decrypt_json(
                EncryptedPayload(
                    ciphertext=row.content_ciphertext,
                    nonce=row.content_nonce,
                ),
                row.uuid.encode(),
            )
            content = str(payload.get("content", ""))
            original_characters = len(content)
            clipped = False
            if max_chars is not None and max_chars >= 0 and len(content) > max_chars:
                content = content[:max_chars]
                clipped = True
            ranked.append(
                RetrievedKnowledge(
                    uuid=row.uuid,
                    title=row.title,
                    content=content,
                    score=score,
                    priority=row.priority,
                    matched_keywords=matched_keywords,
                    clipped=clipped,
                    original_characters=original_characters,
                    tags=tuple(tags),
                    created_by=row.created_by,
                    updated_by=row.updated_by,
                )
            )
        ranked.sort(
            key=lambda item: (item.score, item.priority, item.uuid),
            reverse=True,
        )
        if limit is None:
            return ranked
        return ranked[: max(0, min(limit, 20))]
