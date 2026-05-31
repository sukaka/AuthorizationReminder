from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, BigInteger, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class AnalysisProject(Base):
    __tablename__ = "analysis_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    repository_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="initialized")
    owner: Mapped[str] = mapped_column(String(64), nullable=False, default="security")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    components: Mapped[list["Component"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Component(Base):
    __tablename__ = "components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("analysis_projects.id", ondelete="CASCADE"), nullable=False)
    package_name: Mapped[str] = mapped_column(String(160), nullable=False)
    package_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    scope: Mapped[str] = mapped_column(String(40), nullable=False, default="runtime")
    source_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    license_name: Mapped[str] = mapped_column(String(120), nullable=False, default="unknown")
    vulnerability_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    project: Mapped[AnalysisProject] = relationship(back_populates="components")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    scan_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner: Mapped[str] = mapped_column(String(64), nullable=False, default="security")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="created")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    upload_files: Mapped[list["UploadFileRecord"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    scan_tasks: Mapped[list["ScanTask"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class UploadFileRecord(Base):
    __tablename__ = "upload_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    upload_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    received_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploading")
    scan_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="upload_files")
    logs: Mapped[list["UploadLog"]] = relationship(back_populates="upload_file", cascade="all, delete-orphan")
    scan_tasks: Mapped[list["ScanTask"]] = relationship(back_populates="upload_file", cascade="all, delete-orphan")


class UploadLog(Base):
    __tablename__ = "upload_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    upload_file_id: Mapped[int] = mapped_column(ForeignKey("upload_files.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    upload_file: Mapped[UploadFileRecord] = relationship(back_populates="logs")


class ScanTask(Base):
    __tablename__ = "scan_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    upload_file_id: Mapped[int] = mapped_column(ForeignKey("upload_files.id", ondelete="CASCADE"), nullable=False)
    celery_task_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="scan_tasks")
    upload_file: Mapped[UploadFileRecord] = relationship(back_populates="scan_tasks")
    logs: Mapped[list["ScanLog"]] = relationship(back_populates="scan_task", cascade="all, delete-orphan")


class ScanLog(Base):
    __tablename__ = "scan_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_task_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    scan_task: Mapped[ScanTask] = relationship(back_populates="logs")


class ComponentDependency(Base):
    __tablename__ = "component_dependencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), nullable=True)
    child_component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(40), nullable=False, default="direct")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
