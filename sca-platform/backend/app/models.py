from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, BigInteger, func
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


class Component(Base):
    __tablename__ = "components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    package_name: Mapped[str] = mapped_column(String(160), nullable=False)
    package_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    package_manager: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    purl: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    cpe: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    group_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    artifact_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    version_normalized: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    scope: Mapped[str] = mapped_column(String(40), nullable=False, default="runtime")
    dependency_type: Mapped[str] = mapped_column(String(40), nullable=False, default="direct")
    source_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    source_file: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    evidence_level: Mapped[str] = mapped_column(String(40), nullable=False, default="manifest")
    evidence_file: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    evidence_line: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evidence_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    detected_by: Mapped[str] = mapped_column(String(80), nullable=False, default="manifest")
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    version_conflict: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conflict_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scan_mode: Mapped[str] = mapped_column(String(48), nullable=False, default="manifest_scan")
    detection_method: Mapped[str] = mapped_column(String(80), nullable=False, default="manifest")
    evidence_type: Mapped[str] = mapped_column(String(80), nullable=False, default="manifest")
    confidence_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Medium")
    need_manual_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version_detected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    need_manual_version_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    declared_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    resolved_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    version_lock_status: Mapped[str] = mapped_column(String(64), nullable=False, default="已锁定版本")
    version_risk_type: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    risk_explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    fix_recommendation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sha1: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    sha256: Mapped[str] = mapped_column(String(96), nullable=False, default="")
    component_file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    component_file_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    component_file_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    license_name: Mapped[str] = mapped_column(String(120), nullable=False, default="unknown")
    license_raw: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    license_source: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    license_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    license_needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    vulnerability_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    project: Mapped["Project"] = relationship(back_populates="components")


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
    components: Mapped[list["Component"]] = relationship(back_populates="project", cascade="all, delete-orphan")


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
    parent_task_id: Mapped[int | None] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    task_type: Mapped[str] = mapped_column(String(80), nullable=False, default="project_scan_task")
    engine_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_result_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    normalized_result_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project: Mapped[Project] = relationship(back_populates="scan_tasks")
    upload_file: Mapped[UploadFileRecord] = relationship(back_populates="scan_tasks")
    logs: Mapped[list["ScanLog"]] = relationship(back_populates="scan_task", cascade="all, delete-orphan")


class ScannerEngine(Base):
    __tablename__ = "scanner_engines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    engine_type: Mapped[str] = mapped_column(String(40), nullable=False, default="local_scanner")
    version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    last_health_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    last_health_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ScannerTaskResult(Base):
    __tablename__ = "scanner_task_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_task_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    engine_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    component_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    vulnerability_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    license_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    raw_result_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    normalized_result_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    html_report_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    stdout_log_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    stderr_log_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DependencyTrackProject(Base):
    __tablename__ = "dependency_track_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    local_project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    dependency_track_project_uuid: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    dependency_track_project_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    dependency_track_project_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    bom_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_fetch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_metrics_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    last_status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DependencyTrackLicense(Base):
    __tablename__ = "dependency_track_licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    license_id: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    osi_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fsf_libre: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deprecated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reference_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(80), nullable=False, default="dependency-track")
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PackageLicenseCache(Base):
    __tablename__ = "package_license_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ecosystem: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    package_name: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    package_version: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    license_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    license_raw: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    license_source: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    license_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    license_needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class RawScanArtifact(Base):
    __tablename__ = "raw_scan_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    engine_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    artifact_type: Mapped[str] = mapped_column(String(80), nullable=False, default="raw_json")
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sha256: Mapped[str] = mapped_column(String(96), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class NormalizedComponent(Base):
    __tablename__ = "normalized_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    source_engine: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    package_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(60), nullable=False, default="unknown")
    package_manager: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    version_normalized: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    purl: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    cpe: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    license: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    dependency_type: Mapped[str] = mapped_column(String(60), nullable=False, default="direct")
    scope: Mapped[str] = mapped_column(String(60), nullable=False, default="runtime")
    source_file: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    evidence_file: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    evidence_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class NormalizedVulnerability(Base):
    __tablename__ = "normalized_vulnerabilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    source_engine: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    vulnerability_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    cve_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ghsa_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    osv_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    cvss_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cvss_vector: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    affected_package: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    affected_version_range: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    current_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    fixed_versions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    references_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    has_poc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_exploit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    kev: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    match_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    raw_source: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MergedComponent(Base):
    __tablename__ = "merged_components"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    package_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(60), nullable=False, default="unknown")
    package_manager: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    purl: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    cpe: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    license: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    detected_by_engines: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    engine_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evidence_list_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    merged_confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    confidence_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Review")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MergedVulnerability(Base):
    __tablename__ = "merged_vulnerabilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scan_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("merged_components.id", ondelete="SET NULL"), nullable=True)
    vulnerability_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    cve_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ghsa_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    osv_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    cvss_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    affected_version_range: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    current_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    fixed_versions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    detected_by_engines: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    engine_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    vulnerability_sources_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    multi_engine_confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    confidence_level: Mapped[str] = mapped_column(String(32), nullable=False, default="Review")
    confidence_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    engine_agreement: Mapped[str] = mapped_column(String(40), nullable=False, default="single_source")
    disagreement_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    need_manual_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    manual_review_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    risk_priority: Mapped[str] = mapped_column(String(20), nullable=False, default="Review")
    ai_priority: Mapped[str] = mapped_column(String(20), nullable=False, default="Review")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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


class VulnerabilityRecord(Base):
    __tablename__ = "vulnerabilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="osv")
    advisory_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    cve_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    cwe_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    package_name: Mapped[str] = mapped_column(String(160), nullable=False)
    package_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    cvss_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    epss_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cisa_kev: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    match_status: Mapped[str] = mapped_column(String(32), nullable=False, default="affected")
    matched_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    match_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version_range: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    needs_human_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    false_positive_possibility: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    risk_priority: Mapped[str] = mapped_column(String(16), nullable=False, default="Review")
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    priority_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    suggested_deadline: Mapped[str] = mapped_column(String(80), nullable=False, default="人工确认后排期")
    remediation_type: Mapped[str] = mapped_column(String(40), nullable=False, default="人工确认")
    business_impact: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reachability_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    reachability_evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    entry_points: Mapped[str] = mapped_column(Text, nullable=False, default="")
    related_files: Mapped[str] = mapped_column(Text, nullable=False, default="")
    call_path_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    fixed_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    published_at_text: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    has_poc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    exploited_in_wild: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    detail_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    component: Mapped[Component | None] = relationship()


class VulnerabilityQueryLog(Base):
    __tablename__ = "vulnerability_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ReportExport(Base):
    __tablename__ = "report_exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    format: Mapped[str] = mapped_column(String(12), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="generated")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SbomDocument(Base):
    __tablename__ = "sbom_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    format: Mapped[str] = mapped_column(String(24), nullable=False, default="cyclonedx")
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    component_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="generated")
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="database")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ImageScan(Base):
    __tablename__ = "image_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    image_ref: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    tar_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    scanner: Mapped[str] = mapped_column(String(40), nullable=False, default="trivy")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImageScanFinding(Base):
    __tablename__ = "image_scan_findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    image_scan_id: Mapped[int] = mapped_column(ForeignKey("image_scans.id", ondelete="CASCADE"), nullable=False, index=True)
    package_name: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    package_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    vulnerability_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    fixed_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class RiskMonitorRun(Base):
    __tablename__ = "risk_monitor_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    checked_projects: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_components: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RiskMonitorSnapshot(Base):
    __tablename__ = "risk_monitor_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    component_name: Mapped[str] = mapped_column(String(160), nullable=False)
    current_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    latest_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    latest_source: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    update_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version_delta: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    current_version_published_at: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    component_age_years: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    eol_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    eol_date: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    vulnerability_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="low")
    recommendation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RiskChangeRecord(Base):
    __tablename__ = "risk_change_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    change_type: Mapped[str] = mapped_column(String(40), nullable=False)
    before_value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    after_value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RiskAlert(Base):
    __tablename__ = "risk_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    notification_channel: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    email_to: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AiTriageResult(Base):
    __tablename__ = "ai_triage_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    vulnerability_id: Mapped[int] = mapped_column(ForeignKey("vulnerabilities.id", ondelete="CASCADE"), nullable=False, index=True)
    ai_risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="Review")
    noise_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    immediate_fix: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    suspected_false_positive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    remediation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    fix_deadline: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    risk_explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    human_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    exposure_context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    token_prompt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_completion: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ai_schema_version: Mapped[str] = mapped_column(String(32), nullable=False, default="ai-triage-v2")
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ai_priority: Mapped[str] = mapped_column(String(20), nullable=False, default="Review")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    is_likely_false_positive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    business_impact: Mapped[str] = mapped_column(Text, nullable=False, default="")
    fix_advice: Mapped[str] = mapped_column(Text, nullable=False, default="")
    temporary_mitigation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    need_manual_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manual_review_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RemediationTicket(Base):
    __tablename__ = "remediation_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    vulnerability_id: Mapped[int] = mapped_column(ForeignKey("vulnerabilities.id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    assignee: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="P2")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="未处理")
    due_date: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    fix_version: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    verification_result: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    overdue_notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RemediationEvent(Base):
    __tablename__ = "remediation_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("remediation_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    to_status: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    actor: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VulnerabilityWhitelist(Base):
    __tablename__ = "vulnerability_whitelist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    vulnerability_id: Mapped[int] = mapped_column(ForeignKey("vulnerabilities.id", ondelete="CASCADE"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expires_at: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    created_by: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DevopsScanEvent(Base):
    __tablename__ = "devops_scan_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="gitlab")
    pipeline_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    ref: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    commit_sha: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received")
    decision: Mapped[str] = mapped_column(String(32), nullable=False, default="passed")
    block_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    report_id: Mapped[int | None] = mapped_column(ForeignKey("report_exports.id", ondelete="SET NULL"), nullable=True)
    raw_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class BackupJob(Base):
    __tablename__ = "backup_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[str] = mapped_column(String(40), nullable=False, default="database")
    target: Mapped[str] = mapped_column(String(120), nullable=False, default="local")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="planned")
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class AIModelConfig(Base):
    __tablename__ = "ai_model_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="openai")
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    api_base_url: Mapped[str] = mapped_column(String(512), nullable=False, default="https://api.openai.com/v1")
    model_name: Mapped[str] = mapped_column(String(120), nullable=False, default="gpt-4o-mini")
    timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=30000)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
