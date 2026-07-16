"""FAQ matcher for 6.0 unified Q&A.

Matching order (zero model calls on hit):
1. exact standard question
2. exact alias
3. whitespace / punctuation / full-width normalization match
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import SharedFaq

_PUNCT_RE = re.compile(r"[\s\u3000\W_]+", re.UNICODE)


def normalize_question(text: str) -> str:
    value = unicodedata.normalize("NFKC", str(text or "")).strip().lower()
    value = _PUNCT_RE.sub("", value)
    return value


@dataclass(frozen=True)
class FaqMatch:
    faq_id: str
    question: str
    answer: str
    match_type: str  # exact | alias | normalized
    model_calls: int = 0


def match_shared_faq(db: Session, question: str) -> FaqMatch | None:
    """Return a published/active FAQ match without invoking any model."""
    raw = str(question or "").strip()
    if not raw:
        return None

    normalized = normalize_question(raw)
    if not normalized:
        return None

    rows = list(
        db.scalars(
            select(SharedFaq).where(SharedFaq.status.in_(["active", "published"]))
        )
    )
    if not rows:
        return None

    # 1) exact question
    for row in rows:
        if str(row.question or "").strip() == raw:
            return _hit(db, row, "exact")

    # 2) exact alias
    for row in rows:
        aliases = row.aliases_json or []
        if not isinstance(aliases, list):
            continue
        for alias in aliases:
            if str(alias or "").strip() == raw:
                return _hit(db, row, "alias")

    # 3) normalized exact (question + aliases)
    for row in rows:
        if normalize_question(row.question) == normalized:
            return _hit(db, row, "normalized")
        aliases = row.aliases_json or []
        if not isinstance(aliases, list):
            continue
        for alias in aliases:
            if normalize_question(str(alias)) == normalized:
                return _hit(db, row, "normalized")

    return None


def _hit(db: Session, row: SharedFaq, match_type: str) -> FaqMatch:
    row.hit_count = int(row.hit_count or 0) + 1
    row.last_hit_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(row)
    return FaqMatch(
        faq_id=str(row.uuid),
        question=str(row.question),
        answer=str(row.answer),
        match_type=match_type,
        model_calls=0,
    )
