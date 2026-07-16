"""Shared FAQ lifecycle service (draft / publish / disable / rollback)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .faq_matcher import normalize_question
from .models import SharedFaq

PUBLISHABLE = frozenset({"draft", "disabled", "published", "active"})
MATCHABLE = frozenset({"published", "active"})


@dataclass(frozen=True)
class FaqRecord:
    uuid: str
    question: str
    aliases: list[str]
    answer: str
    previous_answer: str
    version: int
    status: str
    hit_count: int


class FaqServiceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FaqService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_faqs(self, *, status: str | None = None) -> list[SharedFaq]:
        stmt = select(SharedFaq).order_by(SharedFaq.updated_at.desc())
        if status:
            stmt = stmt.where(SharedFaq.status == status)
        return list(self.db.scalars(stmt))

    def get(self, faq_uuid: str) -> SharedFaq | None:
        return self.db.scalar(select(SharedFaq).where(SharedFaq.uuid == faq_uuid))

    def create(
        self,
        *,
        question: str,
        answer: str,
        aliases: list[str] | None = None,
        actor: str,
        status: str = "draft",
    ) -> SharedFaq:
        q = str(question or "").strip()
        a = str(answer or "").strip()
        if not q or not a:
            raise FaqServiceError("INVALID_FAQ", "问题和答案不能为空")
        if status not in PUBLISHABLE:
            raise FaqServiceError("INVALID_STATUS", "非法 FAQ 状态")
        normalized = normalize_question(q)
        existing = self.db.scalar(
            select(SharedFaq).where(SharedFaq.question_normalized == normalized)
        )
        if existing is not None:
            raise FaqServiceError("DUPLICATE_QUESTION", "已存在相同规范化问题")
        row = SharedFaq(
            question=q,
            question_normalized=normalized,
            aliases_json=list(aliases or []),
            answer=a,
            previous_answer="",
            version=1,
            status=status,
            created_by=actor,
            updated_by=actor,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def update(
        self,
        faq_uuid: str,
        *,
        question: str | None = None,
        answer: str | None = None,
        aliases: list[str] | None = None,
        actor: str,
    ) -> SharedFaq:
        row = self.get(faq_uuid)
        if row is None:
            raise FaqServiceError("NOT_FOUND", "FAQ 不存在")
        if question is not None:
            q = question.strip()
            if not q:
                raise FaqServiceError("INVALID_FAQ", "问题不能为空")
            normalized = normalize_question(q)
            clash = self.db.scalar(
                select(SharedFaq).where(
                    SharedFaq.question_normalized == normalized,
                    SharedFaq.uuid != row.uuid,
                )
            )
            if clash is not None:
                raise FaqServiceError("DUPLICATE_QUESTION", "已存在相同规范化问题")
            row.question = q
            row.question_normalized = normalized
        if answer is not None:
            a = answer.strip()
            if not a:
                raise FaqServiceError("INVALID_FAQ", "答案不能为空")
            if a != row.answer:
                row.previous_answer = row.answer
                row.version = int(row.version or 1) + 1
                row.answer = a
        if aliases is not None:
            row.aliases_json = list(aliases)
        row.updated_by = actor
        self.db.add(row)
        self.db.flush()
        return row

    def publish(self, faq_uuid: str, *, actor: str) -> SharedFaq:
        row = self.get(faq_uuid)
        if row is None:
            raise FaqServiceError("NOT_FOUND", "FAQ 不存在")
        if not str(row.answer or "").strip():
            raise FaqServiceError("EMPTY_ANSWER", "发布前答案不能为空")
        row.status = "published"
        row.updated_by = actor
        self.db.add(row)
        self.db.flush()
        return row

    def disable(self, faq_uuid: str, *, actor: str) -> SharedFaq:
        row = self.get(faq_uuid)
        if row is None:
            raise FaqServiceError("NOT_FOUND", "FAQ 不存在")
        row.status = "disabled"
        row.updated_by = actor
        self.db.add(row)
        self.db.flush()
        return row

    def rollback(self, faq_uuid: str, *, actor: str) -> SharedFaq:
        """Restore previous_answer into answer (unpublish content change)."""
        row = self.get(faq_uuid)
        if row is None:
            raise FaqServiceError("NOT_FOUND", "FAQ 不存在")
        prev = str(row.previous_answer or "").strip()
        if not prev:
            raise FaqServiceError("NO_PREVIOUS", "没有可回滚的历史答案")
        current = row.answer
        row.answer = prev
        row.previous_answer = current
        row.version = int(row.version or 1) + 1
        row.updated_by = actor
        # Keep published/active so matching continues with restored answer
        if row.status not in MATCHABLE:
            row.status = "published"
        self.db.add(row)
        self.db.flush()
        return row

    @staticmethod
    def to_record(row: SharedFaq) -> FaqRecord:
        aliases = row.aliases_json if isinstance(row.aliases_json, list) else []
        return FaqRecord(
            uuid=str(row.uuid),
            question=str(row.question),
            aliases=[str(a) for a in aliases],
            answer=str(row.answer),
            previous_answer=str(row.previous_answer or ""),
            version=int(row.version or 1),
            status=str(row.status),
            hit_count=int(row.hit_count or 0),
        )
