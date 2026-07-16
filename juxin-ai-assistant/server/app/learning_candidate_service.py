"""Learning candidates from run feedback (controlled growth, no auto-publish)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import LearningCandidate


class LearningCandidateService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(
        self,
        *,
        owner_user_id: str,
        source_run_id: str = "",
        candidate_type: str,
        title: str,
        payload: dict,
        actor: str,
    ) -> LearningCandidate:
        row = LearningCandidate(
            owner_user_id=owner_user_id,
            source_run_id=source_run_id or "",
            candidate_type=candidate_type,
            title=(title or "学习候选")[:255],
            status="draft",
            payload_json=payload or {},
            created_by=actor,
            updated_by=actor,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def list_for_owner(self, owner_user_id: str, *, limit: int = 50) -> list[LearningCandidate]:
        return list(
            self.db.scalars(
                select(LearningCandidate)
                .where(LearningCandidate.owner_user_id == owner_user_id)
                .order_by(LearningCandidate.updated_at.desc())
                .limit(limit)
            )
        )

    def transition(self, uuid: str, *, status: str, actor: str) -> LearningCandidate | None:
        allowed = {"draft", "evaluated", "staged", "published", "rolled_back", "superseded"}
        if status not in allowed:
            raise ValueError("invalid_status")
        row = self.db.scalar(select(LearningCandidate).where(LearningCandidate.uuid == uuid))
        if row is None:
            return None
        # Company rules cannot jump to published without evaluated/staged
        if status == "published" and row.status not in {"evaluated", "staged"}:
            raise ValueError("publish_requires_evaluation")
        row.status = status
        row.updated_by = actor
        self.db.add(row)
        self.db.flush()
        return row
