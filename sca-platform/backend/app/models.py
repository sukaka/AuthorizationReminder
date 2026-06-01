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
    license_name: Mapped[str] = mapped_column(String(120), nullable=False, default="unknown")
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


class VulnerabilityRecord(Base):
    __tablename__ = "vulnerabilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="osv")
    advisory_id: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    cve_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    package_name: Mapped[str] = mapped_column(String(160), nullable=False)
    package_version: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    ecosystem: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    cvss_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
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
