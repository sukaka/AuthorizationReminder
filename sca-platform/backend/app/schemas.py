from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserPayload(BaseModel):
    id: int | str | None = None
    username: str = "demo"
    role: str = "admin"
    app_access: list[str] = ["sca"]


class ComponentOut(BaseModel):
    id: int
    project_id: int
    package_name: str
    package_version: str
    normalized_name: str = ""
    package_manager: str = ""
    purl: str = ""
    cpe: str = ""
    group_id: str = ""
    artifact_id: str = ""
    version_normalized: str = ""
    ecosystem: str = "unknown"
    scope: str = "runtime"
    dependency_type: str = "direct"
    source_path: str = ""
    source_file: str = ""
    evidence_level: str = "manifest"
    evidence_file: str = ""
    evidence_line: int = 0
    evidence_text: str = ""
    detected_by: str = "manifest"
    confidence_score: float = 0
    version_conflict: bool = False
    conflict_reason: str = ""
    license_name: str
    vulnerability_status: str

    model_config = ConfigDict(from_attributes=True)


class ProjectOut(BaseModel):
    id: int
    name: str
    repository_url: str
    risk_level: str
    status: str
    owner: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OverviewOut(BaseModel):
    project_count: int
    component_count: int
    high_risk_count: int
    pending_component_count: int
    recent_projects: list[ProjectOut]
    user: UserPayload


class UploadSessionCreate(BaseModel):
    project_name: str
    scan_note: str = ""
    filename: str
    total_size: int
    total_chunks: int


class UploadFileOut(BaseModel):
    id: int
    upload_id: str
    project_id: int
    project_name: str
    original_filename: str
    file_size: int
    received_bytes: int
    total_chunks: int
    status: str
    scan_note: str
    created_by: str
    created_at: datetime


class UploadListOut(BaseModel):
    total: int
    items: list[UploadFileOut]


class ProjectListItem(BaseModel):
    id: int
    name: str
    scan_note: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScanTaskOut(BaseModel):
    id: int
    project_id: int
    upload_file_id: int
    celery_task_id: str
    status: str
    summary: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ScanLogOut(BaseModel):
    id: int
    scan_task_id: int
    level: str
    message: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DependencyTreeNode(BaseModel):
    id: str
    label: str
    ecosystem: str = ""
    version: str = ""
    children: list["DependencyTreeNode"] = Field(default_factory=list)


class VulnerabilityOut(BaseModel):
    id: int
    project_id: int
    component_id: int | None = None
    source: str
    advisory_id: str
    cve_id: str
    package_name: str
    package_version: str
    ecosystem: str
    cvss_score: float
    severity: str
    epss_score: float = 0
    cisa_kev: bool = False
    confidence_score: float = 0.7
    match_status: str = "affected"
    matched_by: str = ""
    match_reason: str = ""
    version_range: str = ""
    needs_human_review: bool = False
    false_positive_possibility: str = "medium"
    risk_priority: str = "Review"
    risk_score: float = 0
    priority_reason: str = ""
    suggested_deadline: str = "人工确认后排期"
    remediation_type: str = "人工确认"
    business_impact: str = ""
    description: str
    fixed_version: str
    published_at_text: str
    has_poc: bool
    exploited_in_wild: bool
    detail_url: str

    model_config = ConfigDict(from_attributes=True)


class VulnerabilityListOut(BaseModel):
    total: int
    items: list[VulnerabilityOut]


class VulnerabilityStatsOut(BaseModel):
    total: int
    by_severity: dict[str, int]
    poc_count: int
    exploited_count: int
    average_cvss: float


class VulnerabilityTrendItem(BaseModel):
    month: str
    total: int
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0


class VulnerabilityTrendOut(BaseModel):
    items: list[VulnerabilityTrendItem]


class CveQueryIn(BaseModel):
    cve_id: str


class ReportCreateIn(BaseModel):
    format: str = Field(pattern="^(docx|pdf|xlsx)$")


class ReportOut(BaseModel):
    id: int
    project_id: int
    format: str
    filename: str
    status: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SbomCreateIn(BaseModel):
    format: str = Field(default="cyclonedx", pattern="^(cyclonedx|spdx)$")


class SbomOut(BaseModel):
    id: int
    project_id: int
    format: str
    filename: str
    component_count: int
    status: str
    source: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImageScanCreateIn(BaseModel):
    image_ref: str = ""
    scanner: str = Field(default="trivy", pattern="^(trivy|grype)$")


class ImageScanOut(BaseModel):
    id: int
    image_ref: str
    tar_path: str
    scanner: str
    status: str
    risk_score: float
    summary: str
    created_at: datetime
    finished_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ImageScanFindingOut(BaseModel):
    id: int
    image_scan_id: int
    package_name: str
    package_version: str
    vulnerability_id: str
    severity: str
    fixed_version: str
    description: str

    model_config = ConfigDict(from_attributes=True)


class RiskMonitorRunOut(BaseModel):
    id: int
    status: str
    summary: str
    checked_projects: int
    updated_components: int
    started_at: datetime
    finished_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class RiskMonitorSnapshotOut(BaseModel):
    id: int
    project_id: int
    component_id: int | None = None
    component_name: str
    current_version: str
    latest_version: str
    latest_source: str
    update_available: bool
    version_delta: str
    eol_status: str
    eol_date: str
    vulnerability_count: int
    risk_level: str
    recommendation: str
    checked_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RiskChangeOut(BaseModel):
    id: int
    project_id: int
    component_id: int | None = None
    change_type: str
    before_value: str
    after_value: str
    message: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RiskAlertOut(BaseModel):
    id: int
    project_id: int
    component_id: int | None = None
    level: str
    title: str
    message: str
    status: str
    notification_channel: str
    email_to: str
    created_at: datetime
    acknowledged_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class RiskTrendItem(BaseModel):
    day: str
    total: int
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0


class RiskTrendOut(BaseModel):
    items: list[RiskTrendItem]


class AiTriageContext(BaseModel):
    internet_exposed: bool = False
    core_business: bool = False
    actually_called: bool = False
    runtime_path: bool = False
    has_waf_ips: bool = False
    fix_complexity: str = "medium"
    extra: dict[str, object] = Field(default_factory=dict)


class AiTriageAnalyzeIn(BaseModel):
    vulnerability_ids: list[int]
    context: AiTriageContext = Field(default_factory=AiTriageContext)


class AiTriageConfirmIn(BaseModel):
    human_status: str = Field(pattern="^(accepted|false_positive|deferred|ignored)$")


class AiTriageOut(BaseModel):
    id: int
    project_id: int
    vulnerability_id: int
    ai_risk_level: str
    noise_reason: str
    immediate_fix: bool
    suspected_false_positive: bool
    remediation: str
    fix_deadline: str
    risk_explanation: str
    priority_score: float
    human_status: str
    token_prompt: int
    token_completion: int
    token_total: int
    model: str
    created_at: datetime
    confirmed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AssetDashboardOut(BaseModel):
    project_total: int
    component_total: int
    vulnerability_total: int
    high_risk_total: int
    eol_total: int
    license_risk_total: int
    by_ecosystem: dict[str, int]
    by_severity: dict[str, int]


class AssetComponentOut(BaseModel):
    package_name: str
    ecosystem: str
    project_count: int
    version_count: int
    vulnerability_count: int
    highest_severity: str
    eol_status: str = "unknown"
    license_name: str = "unknown"


class AssetComponentListOut(BaseModel):
    total: int
    items: list[AssetComponentOut]


class AssetGraphNode(BaseModel):
    id: str
    label: str
    type: str
    risk: str = "low"


class AssetGraphEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class AssetGraphOut(BaseModel):
    nodes: list[AssetGraphNode]
    edges: list[AssetGraphEdge]


class RemediationTicketCreateIn(BaseModel):
    vulnerability_id: int
    assignee: str
    due_date: str
    priority: str = "P2"
    fix_version: str = ""


class RemediationTransitionIn(BaseModel):
    status: str = Field(pattern="^(未处理|修复中|已修复|已忽略|待确认)$")
    comment: str = ""


class RemediationVerifyIn(BaseModel):
    verification_result: str = Field(pattern="^(pass|fail)$")
    comment: str = ""


class RemediationTicketOut(BaseModel):
    id: int
    project_id: int
    vulnerability_id: int
    ticket_no: str
    assignee: str
    priority: str
    status: str
    due_date: str
    fix_version: str
    verification_result: str
    overdue_notified: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class RemediationTicketListOut(BaseModel):
    total: int
    items: list[RemediationTicketOut]


class RemediationEventOut(BaseModel):
    id: int
    ticket_id: int
    from_status: str
    to_status: str
    actor: str
    comment: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WhitelistCreateIn(BaseModel):
    vulnerability_id: int
    reason: str
    expires_at: str = ""


class WhitelistOut(BaseModel):
    id: int
    project_id: int
    vulnerability_id: int
    reason: str
    expires_at: str
    created_by: str
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DevopsWebhookIn(BaseModel):
    project_id: int | None = None
    project_name: str = ""
    pipeline_id: str = ""
    ref: str = ""
    commit_sha: str = ""
    source: str = "gitlab"


class DevopsEventOut(BaseModel):
    id: int
    project_id: int | None = None
    source: str
    pipeline_id: str
    ref: str
    commit_sha: str
    status: str
    decision: str
    block_reason: str
    report_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DevopsEventListOut(BaseModel):
    total: int
    items: list[DevopsEventOut]


class DevopsDashboardOut(BaseModel):
    total: int
    blocked_count: int
    passed_count: int
    by_source: dict[str, int]


class BackupCreateIn(BaseModel):
    scope: str = "database"
    target: str = "local"


class BackupJobOut(BaseModel):
    id: int
    scope: str
    target: str
    status: str
    storage_path: str
    summary: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackupJobListOut(BaseModel):
    total: int
    items: list[BackupJobOut]


class OpsConfigOut(BaseModel):
    https_enabled: bool
    jwt_secure: bool
    reverse_proxy: str
    backup_root: str
    optimizations: list[str]
    monitoring: list[str]
