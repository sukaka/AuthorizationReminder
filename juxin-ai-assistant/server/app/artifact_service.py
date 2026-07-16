"""Artifact create/list for 6.0 deliverable center (markdown first)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AgentArtifact, AgentArtifactReview, AgentArtifactVersion


class ArtifactService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_from_run(
        self,
        *,
        owner_user_id: str,
        run_id: str,
        title: str,
        content_markdown: str,
        artifact_type: str = "markdown",
        quality: dict | None = None,
        context: dict | None = None,
        actor: str = "",
    ) -> AgentArtifact:
        row = AgentArtifact(
            owner_user_id=owner_user_id,
            run_id=run_id or "",
            artifact_type=artifact_type or "markdown",
            title=(title or "成果")[:255],
            status="ready",
            version=1,
            content_markdown=content_markdown or "",
            quality_json=quality,
            metadata_json={"context": context or {}},
        )
        self.db.add(row)
        self.db.flush()
        self.db.add(
            AgentArtifactVersion(
                artifact_id=row.uuid,
                version=1,
                content_markdown=content_markdown or "",
                change_summary="初始版本",
                created_by=actor or owner_user_id,
            )
        )
        self.db.flush()
        return row

    def create_review(
        self,
        artifact_id: str,
        owner_user_id: str,
        *,
        reviewer_type: str,
        decision: str,
        comment: str = "",
        findings: list | None = None,
        reviewer_id: str = "",
    ) -> AgentArtifactReview | None:
        artifact = self.get_owned(artifact_id, owner_user_id)
        if artifact is None:
            return None
        review = AgentArtifactReview(
            artifact_id=artifact.uuid,
            version=int(artifact.version or 1),
            reviewer_type=reviewer_type,
            reviewer_id=reviewer_id or owner_user_id,
            decision=decision,
            comment=comment or "",
            findings_json=findings or [],
        )
        artifact.status = "reviewed" if decision == "approved" else "changes_requested"
        self.db.add_all([review, artifact])
        self.db.flush()
        return review

    def list_reviews(self, artifact_id: str, owner_user_id: str) -> list[AgentArtifactReview]:
        if self.get_owned(artifact_id, owner_user_id) is None:
            return []
        return list(
            self.db.scalars(
                select(AgentArtifactReview)
                .where(AgentArtifactReview.artifact_id == artifact_id)
                .order_by(AgentArtifactReview.created_at.desc(), AgentArtifactReview.id.desc())
            )
        )

    def get_owned(self, artifact_id: str, owner_user_id: str) -> AgentArtifact | None:
        row = self.db.scalar(select(AgentArtifact).where(AgentArtifact.uuid == artifact_id))
        if row is None or str(row.owner_user_id) != str(owner_user_id):
            return None
        return row

    def list_owned(self, owner_user_id: str, *, limit: int = 50) -> list[AgentArtifact]:
        return list(
            self.db.scalars(
                select(AgentArtifact)
                .where(AgentArtifact.owner_user_id == owner_user_id)
                .order_by(AgentArtifact.updated_at.desc())
                .limit(limit)
            )
        )

    def list_versions(self, artifact_id: str, owner_user_id: str) -> list[AgentArtifactVersion]:
        if self.get_owned(artifact_id, owner_user_id) is None:
            return []
        return list(
            self.db.scalars(
                select(AgentArtifactVersion)
                .where(AgentArtifactVersion.artifact_id == artifact_id)
                .order_by(AgentArtifactVersion.version.desc())
            )
        )

    def create_version(
        self,
        artifact_id: str,
        owner_user_id: str,
        *,
        content_markdown: str,
        change_summary: str = "",
        actor: str = "",
    ) -> AgentArtifact | None:
        row = self.get_owned(artifact_id, owner_user_id)
        if row is None:
            return None
        next_version = int(row.version or 1) + 1
        row.version = next_version
        row.content_markdown = content_markdown or ""
        row.status = "ready"
        self.db.add(row)
        self.db.add(
            AgentArtifactVersion(
                artifact_id=row.uuid,
                version=next_version,
                content_markdown=content_markdown or "",
                change_summary=(change_summary or f"版本 {next_version}")[:500],
                created_by=actor or owner_user_id,
            )
        )
        self.db.flush()
        return row

    def activate_version(
        self,
        artifact_id: str,
        owner_user_id: str,
        *,
        version: int,
        actor: str = "",
    ) -> AgentArtifact | None:
        row = self.get_owned(artifact_id, owner_user_id)
        if row is None:
            return None
        ver = self.db.scalar(
            select(AgentArtifactVersion).where(
                AgentArtifactVersion.artifact_id == artifact_id,
                AgentArtifactVersion.version == int(version),
            )
        )
        if ver is None:
            return None
        row.version = int(ver.version)
        row.content_markdown = ver.content_markdown or ""
        meta = dict(row.metadata_json or {})
        meta["activated_version"] = int(ver.version)
        meta["activated_by"] = actor or owner_user_id
        row.metadata_json = meta
        self.db.add(row)
        self.db.flush()
        return row
