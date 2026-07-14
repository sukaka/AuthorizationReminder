from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .project_workspace_models import ProjectTimestampMixin


primary_key_type = BigInteger().with_variant(Integer, "sqlite")
foreign_key_type = BigInteger().with_variant(Integer, "sqlite")


class ProjectMemory(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_memories"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    memory_type: Mapped[str] = mapped_column(String(48), index=True)
    title: Mapped[str] = mapped_column(String(160))
    content: Mapped[str] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(default=0, index=True)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source: Mapped[str] = mapped_column(String(32), default="human", index=True)
    confirmation_status: Mapped[str] = mapped_column(
        String(32), default="active", index=True
    )
    created_by: Mapped[str] = mapped_column(String(64), index=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ProjectFile(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_files"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "knowledge_file_id",
            name="uq_ai_project_files_project_file",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    knowledge_file_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_files.id", ondelete="CASCADE"),
        index=True,
    )
    category: Mapped[str] = mapped_column(String(64), default="项目资料", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    linked_by: Mapped[str] = mapped_column(String(64), index=True)


class ProjectArtifact(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "artifact_id",
            name="uq_ai_project_artifacts_project_artifact",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    artifact_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    linked_by: Mapped[str] = mapped_column(String(64), index=True)
