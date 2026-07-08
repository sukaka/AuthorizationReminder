from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.models import ExperienceLibrary, FailureCaseLibrary, TemplateLibrary, UserMemory


@dataclass(frozen=True)
class LearningContext:
    long_term_memories: list[str]
    related_experiences: list[str]
    related_templates: list[str]
    related_failure_cases: list[str]


class LearningRetriever:
    """Retrieve user-approved learning assets for prompt context."""

    def collect(
        self,
        db: Session,
        *,
        sso_user_id: str,
        question: str,
        task_type: str,
        mode: str = "",
    ) -> LearningContext:
        terms = self.query_terms(question, task_type=task_type, mode=mode)
        return LearningContext(
            long_term_memories=self.related_memories(db, sso_user_id=sso_user_id, terms=terms),
            related_experiences=self.related_experiences(
                db,
                sso_user_id=sso_user_id,
                task_type=task_type,
                terms=terms,
            ),
            related_templates=self.related_templates(
                db,
                sso_user_id=sso_user_id,
                task_type=task_type,
                terms=terms,
            ),
            related_failure_cases=self.related_failure_cases(
                db,
                sso_user_id=sso_user_id,
                task_type=task_type,
                terms=terms,
            ),
        )

    def query_terms(self, question: str, *, task_type: str = "", mode: str = "") -> list[str]:
        raw_terms = re.findall(r"[A-Za-z0-9_.:-]{2,}|[\u4e00-\u9fff]{2,}", question or "")
        expanded: list[str] = []
        for term in [*raw_terms, task_type, mode]:
            value = str(term or "").strip()
            if not value:
                continue
            expanded.append(value)
            if re.fullmatch(r"[\u4e00-\u9fff]{4,}", value):
                expanded.extend(value[index : index + 2] for index in range(0, len(value) - 1))
                expanded.extend(value[index : index + 3] for index in range(0, len(value) - 2))
        if not expanded and question.strip():
            expanded = [question.strip()[:20]]
        seen: set[str] = set()
        unique_terms: list[str] = []
        for term in expanded:
            term = term[:80]
            if term in seen:
                continue
            seen.add(term)
            unique_terms.append(term)
        return unique_terms[:16]

    def related_memories(
        self,
        db: Session,
        *,
        sso_user_id: str,
        terms: list[str],
        limit: int = 8,
    ) -> list[str]:
        stmt = select(UserMemory).where(
            UserMemory.sso_user_id == sso_user_id,
            UserMemory.status == "active",
        )
        if terms:
            stmt = stmt.where(
                or_(
                    UserMemory.priority == "high",
                    *[UserMemory.title.contains(term) for term in terms],
                    *[UserMemory.content.contains(term) for term in terms],
                    *[UserMemory.memory_type.contains(term) for term in terms],
                )
            )
        rows = list(db.scalars(
            stmt.order_by(
                case(
                    (UserMemory.priority == "high", 0),
                    (UserMemory.priority == "medium", 1),
                    else_=2,
                ),
                UserMemory.updated_at.desc(),
                UserMemory.id.desc(),
            ).limit(max(limit * 4, limit))
        ))
        ranked = self._rank(
            rows,
            terms,
            text_getter=lambda row: " ".join([
                row.memory_type or "",
                row.title or "",
                row.content or "",
                " ".join(str(tag) for tag in (row.tags_json or [])),
            ]),
            base_score=lambda row: 120 if row.priority == "high" else 20 if row.priority == "medium" else 0,
        )
        return [
            "｜".join(
                part
                for part in [
                    row.priority,
                    row.memory_type,
                    row.title,
                    row.content[:500],
                ]
                if part
            )
            for row in ranked[:limit]
        ]

    def related_experiences(
        self,
        db: Session,
        *,
        sso_user_id: str,
        task_type: str,
        terms: list[str],
        limit: int = 5,
    ) -> list[str]:
        stmt = select(ExperienceLibrary).where(
            ExperienceLibrary.user_id == sso_user_id,
            ExperienceLibrary.status == "active",
        )
        rows = list(
            db.scalars(
                stmt.order_by(
                    ExperienceLibrary.updated_at.desc(),
                    ExperienceLibrary.id.desc(),
                ).limit(80)
            )
        )
        ranked = self._rank(
            rows,
            terms,
            text_getter=lambda row: " ".join([
                row.task_type or "",
                row.title or "",
                row.question or "",
                row.summary or "",
                " ".join(str(tag) for tag in (row.tags_json or [])),
            ]),
            base_score=lambda row: 60 if task_type and row.task_type == task_type else 0,
        )
        return [
            f"{row.task_type}｜{row.title}｜{row.summary or row.answer[:300]}"
            for row in ranked[:limit]
        ]

    def related_templates(
        self,
        db: Session,
        *,
        sso_user_id: str,
        task_type: str,
        terms: list[str],
        limit: int = 5,
    ) -> list[str]:
        stmt = select(TemplateLibrary).where(
            TemplateLibrary.status == "active",
            or_(
                (
                    (TemplateLibrary.user_id == sso_user_id)
                    & (TemplateLibrary.scope == "personal")
                ),
                (
                    (TemplateLibrary.scope == "company")
                    & (TemplateLibrary.review_status == "official")
                ),
            ),
        )
        rows = list(db.scalars(
            stmt.order_by(
                case((TemplateLibrary.user_id == sso_user_id, 0), else_=1),
                TemplateLibrary.updated_at.desc(),
                TemplateLibrary.id.desc(),
            ).limit(80)
        ))
        ranked = self._rank(
            rows,
            terms,
            text_getter=lambda row: " ".join([
                row.task_type or "",
                row.template_name or "",
                row.template_content or "",
            ]),
            base_score=lambda row: (
                (70 if task_type and row.task_type == task_type else 0)
                + (30 if row.user_id == sso_user_id else 10)
            ),
        )
        return [
            f"{row.scope}｜{row.task_type}｜{row.template_name}｜{row.template_content[:500]}"
            for row in ranked[:limit]
        ]

    def related_failure_cases(
        self,
        db: Session,
        *,
        sso_user_id: str,
        task_type: str,
        terms: list[str],
        limit: int = 5,
    ) -> list[str]:
        stmt = select(FailureCaseLibrary).where(
            FailureCaseLibrary.user_id == sso_user_id,
            FailureCaseLibrary.status == "active",
        )
        rows = list(
            db.scalars(
                stmt.order_by(
                    FailureCaseLibrary.updated_at.desc(),
                    FailureCaseLibrary.id.desc(),
                ).limit(80)
            )
        )
        ranked = self._rank(
            rows,
            terms,
            text_getter=lambda row: " ".join([
                row.task_type or "",
                row.wrong_answer or "",
                row.correction or "",
                row.prevention_rule or "",
                " ".join(str(tag) for tag in (row.tags_json or [])),
            ]),
            base_score=lambda row: 80 if task_type and row.task_type == task_type else 0,
        )
        return [
            f"{row.task_type}｜错误：{row.wrong_answer[:180]}"
            f"｜修正：{row.correction[:180]}｜防复发：{row.prevention_rule[:220]}"
            for row in ranked[:limit]
        ]

    def _rank(
        self,
        rows: Iterable,
        terms: list[str],
        *,
        text_getter,
        base_score,
    ) -> list:
        scored: list[tuple[int, object]] = []
        for row in rows:
            text = text_getter(row)
            score = int(base_score(row))
            score += sum(self._term_weight(term, text) for term in terms)
            if score > 0:
                scored.append((score, row))
        scored.sort(
            key=lambda item: (
                item[0],
                getattr(item[1], "updated_at", None) or datetime.min,
                getattr(item[1], "id", 0),
            ),
            reverse=True,
        )
        return [row for _, row in scored]

    @staticmethod
    def _term_weight(term: str, text: str) -> int:
        if not term or not text:
            return 0
        if term in text:
            return 18 if len(term) >= 4 else 8
        lowered_term = term.lower()
        lowered_text = text.lower()
        if lowered_term in lowered_text:
            return 12
        return 0
