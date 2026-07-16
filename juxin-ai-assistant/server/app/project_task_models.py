from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .project_workspace_models import ProjectTimestampMixin


primary_key_type = BigInteger().with_variant(Integer, "sqlite")
foreign_key_type = BigInteger().with_variant(Integer, "sqlite")


class ProjectTask(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_tasks"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="todo", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal", index=True)
    assignee_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    service_scope_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    execution_rule_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_execution_rules.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    workflow_run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ai_agent_runs.uuid", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[str] = mapped_column(String(64), index=True)


class ProjectDeliverable(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_deliverables"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    task_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    deliverable_type: Mapped[str] = mapped_column(String(48), default="document", index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    content_summary: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_ref: Mapped[str] = mapped_column(String(1024), default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    submitted_by: Mapped[str] = mapped_column(String(64), default="")
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    work_artifact_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
        index=True,
    )
    work_artifact_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
        index=True,
    )
    created_by: Mapped[str] = mapped_column(String(64), index=True)


class ProjectIssue(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_issues"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    assignee_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    resolution: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), index=True)
    resolved_by: Mapped[str] = mapped_column(String(64), default="")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ProjectActivity(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_activities"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(96), index=True)
    entity_type: Mapped[str] = mapped_column(String(48), index=True)
    entity_uuid: Mapped[str] = mapped_column(String(36), default="", index=True)
    summary: Mapped[str] = mapped_column(String(500), default="")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
