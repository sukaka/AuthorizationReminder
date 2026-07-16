from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..admin.route_common import write_request_audit
from ..config import Settings, get_settings
from ..database import get_db
from ..schemas import SessionPayload
from .access import EnterpriseAccessScope
from .audit_service import EnterpriseAuditFilters, query_enterprise_audit_logs
from .insight_service import (
    acknowledge_insight,
    approve_recommendation_action,
    detect_overdue_task_insights,
    dismiss_insight,
    list_insights,
    propose_recommendation,
    queue_recommendation_workflow_event,
    record_recommendation_result,
)
from .capability_service import (
    create_capability_evaluation,
    create_optimization_proposal,
    list_capability_evaluations,
    list_optimization_proposals,
    record_capability_observation,
    transition_optimization_proposal,
)
from .insight_scan import create_insight_scan_schedule, scan_overdue_insights
from .notification_service import (
    list_enterprise_notifications,
    mark_enterprise_notification_read,
    notification_payload,
)
from ..enterprise_insight_models import (
    EnterpriseInsight,
    EnterpriseInsightEvidence,
    EnterpriseRecommendation,
    EnterpriseRecommendationAction,
)
from ..enterprise_capability_models import (
    EnterpriseCapabilityEvaluation,
    EnterpriseCapabilityObservation,
    EnterpriseOptimizationProposal,
)
from ..models import WorkflowSchedule
from .lineage_service import (
    create_project_remediation,
    create_service_occurrence,
    link_issue_asset,
    link_project_customer,
    link_remediation_evidence,
)
from .query_plan import QueryPlanIn, compile_query_plan, execute_query_plan, serialize_query_result_csv
from .service import (
    build_enterprise_data_quality_report,
    build_enterprise_operation_summary,
    build_enterprise_overview,
    list_enterprise_organizations,
)
from ..admin.schemas import AuditLogListOut


class EnterpriseScopeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    role: str
    department: str | None
    managed_departments: list[str]
    project_count: int
    project_uuids: list[str]
    policy_version: str
    scope_fingerprint: str


class EnterpriseMetricsOut(BaseModel):
    projects: int
    tasks: int
    deliverables: int
    open_issues: int
    artifacts: int


class EnterpriseFreshnessOut(BaseModel):
    as_of: str
    mode: str
    is_stale: bool


class EnterpriseDataQualityOut(BaseModel):
    status: str
    gaps: list[str]
    explanation: str


class EnterpriseMetricSnapshotOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_code: str
    definition_version: str
    scope: dict[str, object]
    scope_fingerprint: str
    policy_version: str
    period_start: str
    period_end: str
    data_cutoff_at: str
    data_version: str
    numerator: int
    denominator: int | None
    value: float | int | None
    freshness: str
    data_completeness: float
    suppressed: bool
    exclusions: list[str]
    evidence_refs: list[str]
    reason: str | None = None


class EnterpriseHealthDimensionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    label: str
    weight: int
    score: float | None
    data_completeness: float
    status: str
    evidence_refs: list[str]


class EnterpriseHealthDeductionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    points: int
    reason: str
    evidence_refs: list[str]


class EnterpriseProjectHealthOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_uuid: str
    project_name: str
    score: float | None
    status: str
    confidence: float
    rule_version: str
    as_of: str
    dimensions: list[EnterpriseHealthDimensionOut]
    deductions: list[EnterpriseHealthDeductionOut]


class EnterpriseOverviewOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: EnterpriseScopeOut
    metrics: EnterpriseMetricsOut
    metric_snapshots: list[EnterpriseMetricSnapshotOut]
    project_health: list[EnterpriseProjectHealthOut]
    freshness: EnterpriseFreshnessOut
    data_quality: EnterpriseDataQualityOut


class EnterpriseOrganizationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    uuid: str
    external_id: str
    name: str
    status: str
    project_count: int


class EnterpriseOrganizationListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[EnterpriseOrganizationOut]


class EnterpriseOperationSectionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    confirmed: int | None = None
    pending_confirmation: int | None = None
    occurrences: int | None = None
    completed_occurrences: int | None = None
    overdue_occurrences: int | None = None
    missing_occurrences: int | None = None
    open: int | None = None
    overdue: int | None = None
    approved: int | None = None
    pending: int | None = None
    open_high_or_critical: int | None = None
    overdue_remediations: int | None = None


class EnterpriseAutomationSummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    succeeded: int
    failed: int
    active: int
    success_rate: float | None
    scope_mode: str


class EnterpriseAttentionItemOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str
    severity: str
    title: str
    summary: str
    project_uuid: str
    project_name: str
    evidence_refs: list[str]
    status: str


class EnterpriseOperationSummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: EnterpriseScopeOut
    as_of: str
    contracts: EnterpriseOperationSectionOut
    services: EnterpriseOperationSectionOut
    tasks: EnterpriseOperationSectionOut
    deliverables: EnterpriseOperationSectionOut
    issues: EnterpriseOperationSectionOut
    automation: EnterpriseAutomationSummaryOut
    attention_items: list[EnterpriseAttentionItemOut]


class EnterpriseDataQualityIssueOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    entity_type: str
    entity_uuid: str
    project_uuid: str
    severity: str
    message: str
    resolution: str


class EnterpriseDataQualitySummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entities_scanned: int
    unresolved_count: int
    completeness: float


class EnterpriseDataQualityReportOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    as_of: str
    scope_fingerprint: str
    summary: EnterpriseDataQualitySummaryOut
    issues: list[EnterpriseDataQualityIssueOut]


class EnterpriseQueryPlanOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: str
    scope: dict[str, object]
    period: dict[str, str]
    metrics: list[str]
    filters: list[dict[str, object]]
    group_by: list[str]
    limit: int
    policy_version: str
    scope_fingerprint: str


class EnterpriseQueryResultOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan: EnterpriseQueryPlanOut
    rows: list[dict[str, object]]
    generated_at: str
    evidence_refs: list[str]


class EnterpriseInsightOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    insight_type: str
    title: str
    summary: str
    project_id: int | None
    status: str
    severity: str
    confidence: float
    scope_fingerprint: str
    policy_version: str
    data_cutoff_at: str
    data_version: str
    impact_scope: dict[str, object]
    evidence_fingerprint: str
    evidence_refs: list[str]
    acknowledged_by: str
    acknowledged_at: str | None
    resolved_at: str | None
    row_version: int


class EnterpriseInsightListOut(BaseModel):
    items: list[EnterpriseInsightOut]


class EnterpriseNotificationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_uuid: str
    insight_uuid: str
    insight_type: str
    title: str
    summary: str
    severity: str
    project_uuid: str
    task_uuid: str
    status: str
    delivery_status: str
    attempts: int
    unread: bool
    created_at: str | None
    sent_at: str | None
    read_at: str | None
    data_cutoff_at: str
    data_version: str
    last_error: str | None


class EnterpriseNotificationListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[EnterpriseNotificationOut]
    total: int
    unread_count: int


class EnterpriseNotificationReadOut(EnterpriseNotificationOut):
    replayed: bool


class EnterpriseInsightScanOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_id: int
    cutoff: str
    source_version: str
    detected_count: int
    notifications_enqueued: int
    notifications_replayed: int
    notification_uuids: list[str]


class EnterpriseInsightDetectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cutoff: datetime | None = None
    source_version: str = Field(default="project-task-v1", min_length=1, max_length=128)


class EnterpriseInsightScheduleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    cron_expression: str = Field(min_length=1, max_length=128)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    next_fire_at: datetime | None = None
    misfire_policy: str = Field(default="fire_once", min_length=1, max_length=24)
    catch_up: bool = False
    source_version: str = Field(default="project-task-v1", min_length=1, max_length=128)
    idempotency_prefix: str = Field(default="", max_length=128)


class EnterpriseInsightScheduleOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_uuid: str
    organization_id: int
    owner_user_id: str
    workflow_id: str
    name: str
    cron_expression: str
    timezone: str
    enabled: bool
    next_fire_at: str | None
    misfire_policy: str
    catch_up: bool
    idempotency_prefix: str
    source_version: str
    policy_version: str
    scope_fingerprint: str


class EnterpriseInsightScheduleListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[EnterpriseInsightScheduleOut]


class EnterpriseInsightFeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback: str = Field(default="", max_length=2000)


class EnterpriseRecommendationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendation_type: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)
    risk_level: str = Field(default="medium", min_length=1, max_length=16)


class EnterpriseRecommendationActionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    action_type: str
    risk_level: str
    status: str
    idempotency_key: str
    requires_approval: bool
    reconciliation_status: str
    executed_at: str | None
    result: dict[str, object]
    row_version: int


class EnterpriseRecommendationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    insight_uuid: str
    recommendation_type: str
    title: str
    payload: dict[str, object]
    risk_level: str
    status: str
    idempotency_key: str
    request_hash: str
    proposed_by: str
    approved_by: str
    approved_at: str | None
    action: EnterpriseRecommendationActionOut
    row_version: int


class EnterpriseRecommendationDispatchOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_uuid: str
    workflow_id: str
    status: str
    replayed: bool
    agent_run_id: str


class EnterpriseRecommendationResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(min_length=1, max_length=32)
    result: dict[str, Any] = Field(default_factory=dict)


class EnterpriseCapabilityEvaluationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability_type: str = Field(min_length=1, max_length=32)
    capability_key: str = Field(min_length=1, max_length=128)
    capability_version: str = Field(min_length=1, max_length=64)
    period_start: datetime
    period_end: datetime
    data_cutoff_at: datetime
    sample_size: int = Field(ge=0)
    success_count: int = Field(ge=0)
    quality_pass_count: int = Field(default=0, ge=0)
    quality_sample_size: int = Field(default=0, ge=0)
    human_modified_count: int = Field(default=0, ge=0)
    total_cost_micros: int = Field(default=0, ge=0)
    total_latency_ms: int = Field(default=0, ge=0)
    evidence_refs: list[str] = Field(default_factory=list)
    source_version: str = Field(default="runtime-ledger-v1", min_length=1, max_length=128)
    definition_version: str = Field(default="1.0.0", min_length=1, max_length=32)


class EnterpriseCapabilityEvaluationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    organization_id: int
    capability_type: str
    capability_key: str
    capability_version: str
    period_start: str
    period_end: str
    data_cutoff_at: str
    source_version: str
    definition_version: str
    scope_fingerprint: str
    policy_version: str
    idempotency_key: str
    request_hash: str
    sample_size: int
    success_count: int
    success_rate: float | None
    quality_pass_count: int
    quality_sample_size: int
    quality_pass_rate: float | None
    human_modified_count: int
    human_modification_rate: float | None
    total_cost_micros: int
    total_latency_ms: int
    average_latency_ms: float | None
    confidence_label: str
    status: str
    evidence_refs: list[str]
    row_version: int


class EnterpriseCapabilityEvaluationListOut(BaseModel):
    items: list[EnterpriseCapabilityEvaluationOut]


class EnterpriseOptimizationProposalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluation_uuid: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=255)
    rationale: str = Field(default="", max_length=4000)
    proposed_change: dict[str, Any] = Field(default_factory=dict)
    risk_level: str = Field(default="medium", min_length=1, max_length=16)


class EnterpriseOptimizationProposalOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    organization_id: int
    evaluation_uuid: str
    capability_type: str
    capability_key: str
    current_version: str
    title: str
    rationale: str
    proposed_change: dict[str, object]
    risk_level: str
    status: str
    scope_fingerprint: str
    policy_version: str
    idempotency_key: str
    request_hash: str
    proposed_by: str
    reviewed_by: str
    reviewed_at: str | None
    published_at: str | None
    rolled_back_at: str | None
    row_version: int


class EnterpriseOptimizationProposalListOut(BaseModel):
    items: list[EnterpriseOptimizationProposalOut]


class EnterpriseOptimizationTransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(min_length=1, max_length=32)
    comment: str = Field(default="", max_length=2000)


class EnterpriseOptimizationTransitionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal: EnterpriseOptimizationProposalOut
    event_uuid: str
    action: str
    from_status: str
    to_status: str
    replayed: bool


class EnterpriseCapabilityObservationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_version: str = Field(min_length=1, max_length=64)
    window_start: datetime
    window_end: datetime
    baseline_metrics: dict[str, Any] = Field(default_factory=dict)
    candidate_metrics: dict[str, Any] = Field(default_factory=dict)
    status: str = Field(default="pending", min_length=1, max_length=24)
    rollback_recommended: bool = False
    evidence_refs: list[str] = Field(default_factory=list)


class EnterpriseCapabilityObservationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uuid: str
    proposal_uuid: str
    observed_version: str
    window_start: str
    window_end: str
    baseline_metrics: dict[str, object]
    candidate_metrics: dict[str, object]
    idempotency_key: str
    request_hash: str
    status: str
    rollback_recommended: bool
    evidence_refs: list[str]


class ProjectCustomerLinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: int = Field(gt=0)
    relation_type: str = Field(default="primary", min_length=1, max_length=32)
    source: str = Field(default="manual", max_length=64)


class ServiceOccurrenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurrence_key: str = Field(min_length=1, max_length=192)
    period_start: date
    period_end: date
    due_at: datetime
    contract_id: int | None = Field(default=None, gt=0)
    service_scope_id: int | None = Field(default=None, gt=0)
    task_id: int | None = Field(default=None, gt=0)
    deliverable_id: int | None = Field(default=None, gt=0)
    workflow_run_id: str | None = Field(default=None, max_length=36)
    work_artifact_id: int | None = Field(default=None, gt=0)
    status: str = Field(default="scheduled", min_length=1, max_length=24)
    completion_evidence_type: str = Field(default="", max_length=48)
    completion_evidence_uuid: str = Field(default="", max_length=64)
    source_version: int = Field(default=1, ge=1)


class IssueAssetLinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: int = Field(gt=0)
    asset_id: int = Field(gt=0)
    relation_type: str = Field(default="affected", min_length=1, max_length=32)
    source: str = Field(default="manual", max_length=64)


class ProjectRemediationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=255)
    asset_id: int | None = Field(default=None, gt=0)
    description: str = Field(default="")
    owner_user_id: str = Field(default="", max_length=64)
    priority: str = Field(default="normal", min_length=1, max_length=16)
    status: str = Field(default="open", min_length=1, max_length=24)
    due_at: datetime | None = None
    verification_status: str = Field(default="pending", min_length=1, max_length=24)
    remediation_uuid: str | None = Field(default=None, min_length=1, max_length=36)


class RemediationEvidenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_type: str = Field(min_length=1, max_length=48)
    evidence_uuid: str = Field(min_length=1, max_length=64)
    source_table: str = Field(default="", max_length=128)
    source_version: int = Field(default=1, ge=1)
    relation_type: str = Field(default="supports", min_length=1, max_length=32)
    notes: str = Field(default="")


class EnterpriseLineageMutationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    id: int
    uuid: str
    organization_id: int
    project_id: int
    status: str | None = None
    row_version: int | None = None


def _require_idempotency_key(request: Request) -> str:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="缺少或无效的 Idempotency-Key")
    if len(key) > 128:
        raise HTTPException(status_code=400, detail="Idempotency-Key 不能超过 128 个字符")
    return key


async def _require_intelligence_manage(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> EnterpriseAccessScope:
    scope = await _require_intelligence_view(request, session, settings)
    if not scope.can("intelligence:manage"):
        raise HTTPException(status_code=403, detail="当前身份无企业智能管理权限")
    return scope


def _mutation_payload(
    row: Any,
    kind: str,
    *,
    project_id: int | None = None,
) -> EnterpriseLineageMutationOut:
    return EnterpriseLineageMutationOut(
        kind=kind,
        id=row.id,
        uuid=row.uuid,
        organization_id=row.organization_id,
        project_id=project_id if project_id is not None else row.project_id,
        status=getattr(row, "status", None),
        row_version=getattr(row, "row_version", None),
    )


def _write_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ValueError, TypeError)):
        return HTTPException(status_code=400, detail=str(exc))
    raise exc


def _audit_enterprise_write(
    db: Session,
    session: SessionPayload,
    request: Request,
    settings: Settings,
    *,
    action: str,
    entity_type: str,
    entity_uuid: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Record a body-free audit event in the same transaction as the write."""

    write_request_audit(
        db,
        session,
        request,
        settings,
        action=action,
        entity_type=entity_type,
        entity_uuid=entity_uuid,
        metadata=metadata,
    )


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _insight_schedule_payload(
    row: WorkflowSchedule,
    *,
    fallback_scope: EnterpriseAccessScope,
) -> EnterpriseInsightScheduleOut:
    metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    scan_metadata = metadata.get("enterprise_insight_scan")
    scan_metadata = scan_metadata if isinstance(scan_metadata, dict) else {}
    frozen_scope = scan_metadata.get("scope")
    frozen_scope = frozen_scope if isinstance(frozen_scope, dict) else {}
    organization_id = int(scan_metadata.get("organization_id") or 0)
    return EnterpriseInsightScheduleOut(
        schedule_uuid=row.uuid,
        organization_id=organization_id,
        owner_user_id=str(row.owner_user_id),
        workflow_id=str(row.workflow_id),
        name=row.name,
        cron_expression=row.cron_expression,
        timezone=row.timezone,
        enabled=bool(row.enabled),
        next_fire_at=_iso(row.next_fire_at),
        misfire_policy=row.misfire_policy,
        catch_up=bool(row.catch_up),
        idempotency_prefix=row.idempotency_prefix,
        source_version=str(scan_metadata.get("source_version") or "project-task-v1"),
        policy_version=str(frozen_scope.get("policy_version") or fallback_scope.policy_version),
        scope_fingerprint=str(
            frozen_scope.get("scope_fingerprint") or fallback_scope.scope_fingerprint
        ),
    )


def _insight_payload(db: Session, insight: Any) -> EnterpriseInsightOut:
    evidence = db.scalars(
        select(EnterpriseInsightEvidence).where(EnterpriseInsightEvidence.insight_id == insight.id).order_by(EnterpriseInsightEvidence.id)
    ).all()
    return EnterpriseInsightOut(
        uuid=insight.uuid,
        insight_type=insight.insight_type,
        title=insight.title,
        summary=insight.summary,
        project_id=insight.project_id,
        status=insight.status,
        severity=insight.severity,
        confidence=float(insight.confidence),
        scope_fingerprint=insight.scope_fingerprint,
        policy_version=insight.policy_version,
        data_cutoff_at=insight.data_cutoff_at.isoformat(),
        data_version=insight.data_version,
        impact_scope=insight.impact_scope_json or {},
        evidence_fingerprint=insight.evidence_fingerprint,
        evidence_refs=[f"{row.evidence_type}:{row.evidence_uuid}@v{row.source_version}" for row in evidence],
        acknowledged_by=insight.acknowledged_by,
        acknowledged_at=_iso(insight.acknowledged_at),
        resolved_at=_iso(insight.resolved_at),
        row_version=insight.row_version,
    )


def _recommendation_payload(
    db: Session,
    recommendation: EnterpriseRecommendation,
    action: EnterpriseRecommendationAction,
) -> EnterpriseRecommendationOut:
    insight = db.get(EnterpriseInsight, recommendation.insight_id)
    if insight is None:
        raise LookupError("建议关联的洞察不存在")
    return EnterpriseRecommendationOut(
        uuid=recommendation.uuid,
        insight_uuid=insight.uuid,
        recommendation_type=recommendation.recommendation_type,
        title=recommendation.title,
        payload=recommendation.payload_json or {},
        risk_level=recommendation.risk_level,
        status=recommendation.status,
        idempotency_key=recommendation.idempotency_key,
        request_hash=recommendation.request_hash,
        proposed_by=recommendation.proposed_by,
        approved_by=recommendation.approved_by,
        approved_at=_iso(recommendation.approved_at),
        action=EnterpriseRecommendationActionOut(
            uuid=action.uuid,
            action_type=action.action_type,
            risk_level=action.risk_level,
            status=action.status,
            idempotency_key=action.idempotency_key,
            requires_approval=bool(action.requires_approval),
            reconciliation_status=action.reconciliation_status,
            executed_at=_iso(action.executed_at),
            result=action.result_json or {},
            row_version=action.row_version,
        ),
        row_version=recommendation.row_version,
    )


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


def _capability_evaluation_payload(row: EnterpriseCapabilityEvaluation) -> EnterpriseCapabilityEvaluationOut:
    return EnterpriseCapabilityEvaluationOut(
        uuid=row.uuid,
        organization_id=row.organization_id,
        capability_type=row.capability_type,
        capability_key=row.capability_key,
        capability_version=row.capability_version,
        period_start=row.period_start.isoformat(),
        period_end=row.period_end.isoformat(),
        data_cutoff_at=row.data_cutoff_at.isoformat(),
        source_version=row.source_version,
        definition_version=row.definition_version,
        scope_fingerprint=row.scope_fingerprint,
        policy_version=row.policy_version,
        idempotency_key=row.idempotency_key,
        request_hash=row.request_hash,
        sample_size=row.sample_size,
        success_count=row.success_count,
        success_rate=_rate(row.success_count, row.sample_size),
        quality_pass_count=row.quality_pass_count,
        quality_sample_size=row.quality_sample_size,
        quality_pass_rate=_rate(row.quality_pass_count, row.quality_sample_size),
        human_modified_count=row.human_modified_count,
        human_modification_rate=_rate(row.human_modified_count, row.sample_size),
        total_cost_micros=row.total_cost_micros,
        total_latency_ms=row.total_latency_ms,
        average_latency_ms=round(row.total_latency_ms / row.sample_size, 3) if row.sample_size else None,
        confidence_label=row.confidence_label,
        status=row.status,
        evidence_refs=list(row.evidence_refs_json or []),
        row_version=row.row_version,
    )


def _optimization_proposal_payload(
    db: Session,
    row: EnterpriseOptimizationProposal,
) -> EnterpriseOptimizationProposalOut:
    evaluation = db.get(EnterpriseCapabilityEvaluation, row.evaluation_id)
    if evaluation is None:
        raise LookupError("优化提案的评估快照不存在")
    return EnterpriseOptimizationProposalOut(
        uuid=row.uuid,
        organization_id=row.organization_id,
        evaluation_uuid=evaluation.uuid,
        capability_type=row.capability_type,
        capability_key=row.capability_key,
        current_version=row.current_version,
        title=row.title,
        rationale=row.rationale,
        proposed_change=row.proposed_change_json or {},
        risk_level=row.risk_level,
        status=row.status,
        scope_fingerprint=row.scope_fingerprint,
        policy_version=row.policy_version,
        idempotency_key=row.idempotency_key,
        request_hash=row.request_hash,
        proposed_by=row.proposed_by,
        reviewed_by=row.reviewed_by,
        reviewed_at=_iso(row.reviewed_at),
        published_at=_iso(row.published_at),
        rolled_back_at=_iso(row.rolled_back_at),
        row_version=row.row_version,
    )


def _capability_observation_payload(
    db: Session,
    row: EnterpriseCapabilityObservation,
) -> EnterpriseCapabilityObservationOut:
    proposal = db.get(EnterpriseOptimizationProposal, row.proposal_id)
    if proposal is None:
        raise LookupError("观测关联的优化提案不存在")
    return EnterpriseCapabilityObservationOut(
        uuid=row.uuid,
        proposal_uuid=proposal.uuid,
        observed_version=row.observed_version,
        window_start=row.window_start.isoformat(),
        window_end=row.window_end.isoformat(),
        baseline_metrics=row.baseline_metrics_json or {},
        candidate_metrics=row.candidate_metrics_json or {},
        idempotency_key=row.idempotency_key,
        request_hash=row.request_hash,
        status=row.status,
        rollback_recommended=bool(row.rollback_recommended),
        evidence_refs=list(row.evidence_refs_json or []),
    )


router = APIRouter(prefix="/api/ai/intelligence", tags=["enterprise-intelligence"])


async def _require_intelligence_view(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> EnterpriseAccessScope:
    await require_action("ai_assistant:use", request, session, settings)
    scope = EnterpriseAccessScope.from_session(session)
    if not scope.can("intelligence:view"):
        raise HTTPException(status_code=403, detail="当前身份无企业智能中枢访问权限")
    return scope


@router.get("/overview", response_model=EnterpriseOverviewOut)
async def get_enterprise_overview(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseOverviewOut:
    scope = await _require_intelligence_view(request, session, settings)
    return EnterpriseOverviewOut.model_validate(build_enterprise_overview(db, scope))


@router.get("/data-quality", response_model=EnterpriseDataQualityReportOut)
async def get_enterprise_data_quality(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseDataQualityReportOut:
    scope = await _require_intelligence_view(request, session, settings)
    return EnterpriseDataQualityReportOut.model_validate(
        build_enterprise_data_quality_report(db, scope)
    )


@router.get("/operation-summary", response_model=EnterpriseOperationSummaryOut)
async def get_enterprise_operation_summary(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    attention_limit: int = 100,
) -> EnterpriseOperationSummaryOut:
    """Return the read-only first-phase cockpit and scoped attention feed."""

    scope = await _require_intelligence_view(request, session, settings)
    try:
        result = build_enterprise_operation_summary(
            db,
            scope,
            attention_limit=attention_limit,
        )
    except Exception as exc:
        raise _write_error(exc) from exc
    # Keep the response scope contract identical to /overview so clients can
    # safely switch between the two read-only projections.
    result["scope"]["department"] = scope.department
    result["scope"]["managed_departments"] = list(scope.managed_departments)
    return EnterpriseOperationSummaryOut.model_validate(result)


@router.get("/notifications", response_model=EnterpriseNotificationListOut)
async def get_enterprise_notifications(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    unread_only: bool = False,
    limit: int = Query(default=20, ge=1, le=100),
) -> EnterpriseNotificationListOut:
    """Return only the caller's enterprise insight notifications."""

    scope = await _require_intelligence_view(request, session, settings)
    try:
        result = list_enterprise_notifications(
            db,
            scope,
            unread_only=unread_only,
            limit=limit,
        )
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseNotificationListOut(
        items=[EnterpriseNotificationOut.model_validate(item) for item in result.items],
        total=result.total,
        unread_count=result.unread_count,
    )


@router.post(
    "/notifications/{notification_uuid}/read",
    response_model=EnterpriseNotificationReadOut,
)
async def mark_enterprise_notification_read_route(
    notification_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseNotificationReadOut:
    """Mark one owned notification as read; repeating the request is safe."""

    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_view(request, session, settings)
    try:
        row, replayed = mark_enterprise_notification_read(
            db,
            scope,
            notification_uuid,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.notification.read",
            entity_type="enterprise_notification",
            entity_uuid=row.uuid,
            metadata={"event": "read", "replayed": replayed, "idempotency_key": idempotency_key},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise _write_error(exc) from exc
    payload = notification_payload(row)
    payload["replayed"] = replayed
    return EnterpriseNotificationReadOut.model_validate(payload)


@router.get("/organizations", response_model=EnterpriseOrganizationListOut)
async def get_enterprise_organizations(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseOrganizationListOut:
    """Return the caller's safe organization selector options."""

    scope = await _require_intelligence_manage(request, session, settings)
    try:
        items = list_enterprise_organizations(db, scope)
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseOrganizationListOut(
        items=[EnterpriseOrganizationOut.model_validate(item) for item in items]
    )


@router.get("/audit-logs", response_model=AuditLogListOut)
async def get_enterprise_audit_logs(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    action: str | None = None,
    entity_type: str | None = None,
    entity_uuid: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> AuditLogListOut:
    """Return the scoped, body-free audit projection for the control plane."""

    scope = await _require_intelligence_manage(request, session, settings)
    try:
        return query_enterprise_audit_logs(
            db,
            scope,
            EnterpriseAuditFilters(
                action=action,
                entity_type=entity_type,
                entity_uuid=entity_uuid,
                created_from=created_from,
                created_to=created_to,
            ),
            offset=offset,
            limit=limit,
        )
    except Exception as exc:
        raise _write_error(exc) from exc


@router.post("/management/query-plan", response_model=EnterpriseQueryPlanOut)
async def compile_enterprise_query_plan(
    body: QueryPlanIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseQueryPlanOut:
    scope = await _require_intelligence_view(request, session, settings)
    try:
        plan = compile_query_plan(db, scope, body)
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseQueryPlanOut.model_validate(plan.as_dict())


@router.post("/management/query", response_model=EnterpriseQueryResultOut)
async def execute_enterprise_query(
    body: QueryPlanIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseQueryResultOut:
    scope = await _require_intelligence_view(request, session, settings)
    try:
        plan = compile_query_plan(db, scope, body)
        result = execute_query_plan(db, scope, plan)
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseQueryResultOut.model_validate(result)


@router.post("/management/export")
async def export_enterprise_query(
    body: QueryPlanIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Export the same scope-bound management query as a fixed, safe CSV."""

    scope = await _require_intelligence_view(request, session, settings)
    try:
        plan = compile_query_plan(db, scope, body)
        result = execute_query_plan(db, scope, plan)
        payload = serialize_query_result_csv(result)
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.management.export",
            entity_type="enterprise_query_export",
            entity_uuid=plan.scope_fingerprint,
            metadata={
                "event": "query_exported",
                "record_count": len(result["rows"]),
                "media_type": "text/csv",
                "size_bytes": len(payload),
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise _write_error(exc) from exc

    file_name = f"juxin-enterprise-query-{plan.period_start.isoformat()}-{plan.period_end.isoformat()}.csv"
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f"attachment; filename=enterprise-query.csv; filename*=UTF-8''{quote(file_name)}",
        },
    )


@router.get(
    "/organizations/{organization_id}/capability-evaluations",
    response_model=EnterpriseCapabilityEvaluationListOut,
)
async def get_capability_evaluations(
    organization_id: int,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    capability_type: str | None = None,
    capability_key: str | None = None,
    limit: int = 100,
) -> EnterpriseCapabilityEvaluationListOut:
    scope = await _require_intelligence_view(request, session, settings)
    try:
        rows = list_capability_evaluations(
            db,
            scope,
            organization_id,
            capability_type=capability_type,
            capability_key=capability_key,
            limit=limit,
        )
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseCapabilityEvaluationListOut(items=[_capability_evaluation_payload(row) for row in rows])


@router.post(
    "/organizations/{organization_id}/capability-evaluations",
    response_model=EnterpriseCapabilityEvaluationOut,
    status_code=201,
)
async def create_capability_evaluation_route(
    organization_id: int,
    body: EnterpriseCapabilityEvaluationIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseCapabilityEvaluationOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row, _ = create_capability_evaluation(
            db,
            scope,
            organization_id,
            idempotency_key=idempotency_key,
            **body.model_dump(),
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.capability_evaluation.create",
            entity_type="enterprise_capability_evaluation",
            entity_uuid=row.uuid,
            metadata={"event": "create", "status": row.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _capability_evaluation_payload(row)


@router.get(
    "/organizations/{organization_id}/optimization-proposals",
    response_model=EnterpriseOptimizationProposalListOut,
)
async def get_optimization_proposals(
    organization_id: int,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    limit: int = 100,
) -> EnterpriseOptimizationProposalListOut:
    scope = await _require_intelligence_view(request, session, settings)
    try:
        rows = list_optimization_proposals(db, scope, organization_id, status=status, limit=limit)
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseOptimizationProposalListOut(items=[_optimization_proposal_payload(db, row) for row in rows])


@router.post(
    "/organizations/{organization_id}/optimization-proposals",
    response_model=EnterpriseOptimizationProposalOut,
    status_code=201,
)
async def create_optimization_proposal_route(
    organization_id: int,
    body: EnterpriseOptimizationProposalIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseOptimizationProposalOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row, _ = create_optimization_proposal(
            db,
            scope,
            organization_id,
            idempotency_key=idempotency_key,
            **body.model_dump(),
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.optimization_proposal.create",
            entity_type="enterprise_optimization_proposal",
            entity_uuid=row.uuid,
            metadata={"event": "create", "status": row.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _optimization_proposal_payload(db, row)


@router.post(
    "/organizations/{organization_id}/optimization-proposals/{proposal_uuid}/transition",
    response_model=EnterpriseOptimizationTransitionOut,
)
async def transition_optimization_proposal_route(
    organization_id: int,
    proposal_uuid: str,
    body: EnterpriseOptimizationTransitionIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseOptimizationTransitionOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row, event, replayed = transition_optimization_proposal(
            db,
            scope,
            organization_id,
            proposal_uuid,
            action=body.action,
            idempotency_key=idempotency_key,
            comment=body.comment,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.optimization_proposal.transition",
            entity_type="enterprise_optimization_proposal",
            entity_uuid=row.uuid,
            metadata={"event": event.action, "status": event.to_status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseOptimizationTransitionOut(
        proposal=_optimization_proposal_payload(db, row),
        event_uuid=event.uuid,
        action=event.action,
        from_status=event.from_status,
        to_status=event.to_status,
        replayed=replayed,
    )


@router.post(
    "/organizations/{organization_id}/optimization-proposals/{proposal_uuid}/observations",
    response_model=EnterpriseCapabilityObservationOut,
    status_code=201,
)
async def record_capability_observation_route(
    organization_id: int,
    proposal_uuid: str,
    body: EnterpriseCapabilityObservationIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseCapabilityObservationOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = record_capability_observation(
            db,
            scope,
            organization_id,
            proposal_uuid,
            idempotency_key=idempotency_key,
            **body.model_dump(),
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.capability_observation.create",
            entity_type="enterprise_capability_observation",
            entity_uuid=row.uuid,
            metadata={"event": "create", "status": row.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _capability_observation_payload(db, row)


@router.get("/insights", response_model=EnterpriseInsightListOut)
async def get_enterprise_insights(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    status: str | None = None,
    limit: int = 100,
) -> EnterpriseInsightListOut:
    scope = await _require_intelligence_view(request, session, settings)
    try:
        rows = list_insights(db, scope, status=status, limit=limit)
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseInsightListOut(items=[_insight_payload(db, row) for row in rows])


@router.post("/organizations/{organization_id}/insights/detect-overdue", response_model=EnterpriseInsightListOut)
async def detect_enterprise_overdue_insights(
    organization_id: int,
    body: EnterpriseInsightDetectIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightListOut:
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        rows = detect_overdue_task_insights(
            db,
            scope,
            organization_id,
            cutoff=body.cutoff or datetime.now(UTC),
            source_version=body.source_version,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.insights.detect_overdue",
            entity_type="enterprise_organization",
            entity_uuid=str(organization_id),
            metadata={"event": "detect", "record_count": len(rows)},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseInsightListOut(items=[_insight_payload(db, row) for row in rows])


@router.get(
    "/organizations/{organization_id}/insights/schedules",
    response_model=EnterpriseInsightScheduleListOut,
)
async def get_enterprise_insight_schedules(
    organization_id: int,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightScheduleListOut:
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        # The frozen metadata is the authorization boundary for a schedule;
        # only schedules owned by this operator are manageable here.
        rows = db.scalars(
            select(WorkflowSchedule)
            .where(
                WorkflowSchedule.owner_user_id == scope.user_id,
                WorkflowSchedule.workflow_id == "__enterprise_insight_scan__",
            )
            .order_by(WorkflowSchedule.created_at.desc())
        ).all()
        items = []
        for row in rows:
            metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
            scan_metadata = metadata.get("enterprise_insight_scan")
            if not isinstance(scan_metadata, dict):
                continue
            if int(scan_metadata.get("organization_id") or 0) != organization_id:
                continue
            items.append(_insight_schedule_payload(row, fallback_scope=scope))
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseInsightScheduleListOut(items=items)


@router.post(
    "/organizations/{organization_id}/insights/schedules",
    response_model=EnterpriseInsightScheduleOut,
    status_code=201,
)
async def create_enterprise_insight_schedule_route(
    organization_id: int,
    body: EnterpriseInsightScheduleIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightScheduleOut:
    """Register a durable, permission-bound recurring insight scan."""

    scope = await _require_intelligence_manage(request, session, settings)
    idempotency_key = _require_idempotency_key(request)
    try:
        row = create_insight_scan_schedule(
            db,
            scope,
            organization_id,
            idempotency_key=idempotency_key,
            **body.model_dump(),
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.insight_schedule.create",
            entity_type="workflow_schedule",
            entity_uuid=row.uuid,
            metadata={
                "event": "create",
                "status": "enabled" if row.enabled else "disabled",
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise _write_error(exc) from exc
    return _insight_schedule_payload(row, fallback_scope=scope)


@router.post(
    "/organizations/{organization_id}/insights/scan-overdue",
    response_model=EnterpriseInsightScanOut,
    status_code=202,
)
async def scan_enterprise_overdue_insights(
    organization_id: int,
    body: EnterpriseInsightDetectIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightScanOut:
    """Run the bounded detector and enqueue durable in-app attention items."""

    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        result = scan_overdue_insights(
            db,
            scope,
            organization_id,
            cutoff=body.cutoff or datetime.now(UTC),
            source_version=body.source_version,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.insights.scan_overdue",
            entity_type="enterprise_organization",
            entity_uuid=str(organization_id),
            metadata={
                "event": "scan",
                "detected_count": len(result.insights),
                "notifications_enqueued": result.notifications_enqueued,
            },
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseInsightScanOut(
        organization_id=result.organization_id,
        cutoff=result.cutoff.isoformat(),
        source_version=result.source_version,
        detected_count=len(result.insights),
        notifications_enqueued=result.notifications_enqueued,
        notifications_replayed=result.notifications_replayed,
        notification_uuids=[item.uuid for item in result.notifications],
    )


@router.post("/insights/{insight_uuid}/acknowledge", response_model=EnterpriseInsightOut)
async def acknowledge_enterprise_insight(
    insight_uuid: str,
    body: EnterpriseInsightFeedbackIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightOut:
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = acknowledge_insight(db, scope, insight_uuid, feedback=body.feedback)
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.insight.acknowledge",
            entity_type="enterprise_insight",
            entity_uuid=row.uuid,
            metadata={"event": "acknowledge"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _insight_payload(db, row)


@router.post("/insights/{insight_uuid}/dismiss", response_model=EnterpriseInsightOut)
async def dismiss_enterprise_insight(
    insight_uuid: str,
    body: EnterpriseInsightFeedbackIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseInsightOut:
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = dismiss_insight(db, scope, insight_uuid, feedback=body.feedback)
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.insight.dismiss",
            entity_type="enterprise_insight",
            entity_uuid=row.uuid,
            metadata={"event": "dismiss"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _insight_payload(db, row)


@router.post("/insights/{insight_uuid}/recommendations", response_model=EnterpriseRecommendationOut, status_code=201)
async def propose_enterprise_recommendation(
    insight_uuid: str,
    body: EnterpriseRecommendationIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseRecommendationOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        recommendation, action = propose_recommendation(
            db,
            scope,
            insight_uuid,
            recommendation_type=body.recommendation_type,
            title=body.title,
            payload=body.payload,
            risk_level=body.risk_level,
            idempotency_key=idempotency_key,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.recommendation.create",
            entity_type="enterprise_recommendation",
            entity_uuid=recommendation.uuid,
            metadata={"event": "create", "status": recommendation.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _recommendation_payload(db, recommendation, action)


@router.post("/recommendations/{recommendation_uuid}/approve", response_model=EnterpriseRecommendationOut)
async def approve_enterprise_recommendation(
    recommendation_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseRecommendationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        action = approve_recommendation_action(db, scope, recommendation_uuid)
        recommendation = db.get(EnterpriseRecommendation, action.recommendation_id)
        if recommendation is None:
            raise LookupError("建议不存在或不可访问")
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.recommendation.approve",
            entity_type="enterprise_recommendation",
            entity_uuid=recommendation.uuid,
            metadata={"event": "approve", "status": recommendation.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _recommendation_payload(db, recommendation, action)


@router.post(
    "/recommendations/{recommendation_uuid}/dispatch",
    response_model=EnterpriseRecommendationDispatchOut,
    status_code=202,
)
async def dispatch_enterprise_recommendation(
    recommendation_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseRecommendationDispatchOut:
    idempotency_key = _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        event, replayed = queue_recommendation_workflow_event(
            db,
            scope,
            recommendation_uuid,
            idempotency_key=idempotency_key,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.recommendation.dispatch",
            entity_type="enterprise_recommendation",
            entity_uuid=recommendation_uuid,
            metadata={"event": "dispatch", "status": event.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return EnterpriseRecommendationDispatchOut(
        event_uuid=event.uuid,
        workflow_id=event.workflow_id,
        status=event.status,
        replayed=replayed,
        agent_run_id=event.run_id,
    )


@router.post("/recommendations/{recommendation_uuid}/result", response_model=EnterpriseRecommendationOut)
async def record_enterprise_recommendation_result(
    recommendation_uuid: str,
    body: EnterpriseRecommendationResultIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseRecommendationOut:
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        action = record_recommendation_result(
            db,
            scope,
            recommendation_uuid,
            status=body.status,
            result=body.result,
        )
        recommendation = db.get(EnterpriseRecommendation, action.recommendation_id)
        if recommendation is None:
            raise LookupError("建议不存在或不可访问")
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.recommendation.result",
            entity_type="enterprise_recommendation",
            entity_uuid=recommendation.uuid,
            metadata={"event": "result", "status": action.status},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _recommendation_payload(db, recommendation, action)


@router.post(
    "/projects/{project_id}/customers",
    response_model=EnterpriseLineageMutationOut,
    status_code=201,
)
async def create_project_customer_link(
    project_id: int,
    body: ProjectCustomerLinkIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseLineageMutationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = link_project_customer(
            db,
            scope,
            project_id,
            body.customer_id,
            relation_type=body.relation_type,
            source=body.source,
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.project_customer.link",
            entity_type="enterprise_project_customer_link",
            entity_uuid=row.uuid,
            metadata={"event": "create"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _mutation_payload(row, "project_customer_link")


@router.post(
    "/projects/{project_id}/service-occurrences",
    response_model=EnterpriseLineageMutationOut,
    status_code=201,
)
async def create_project_service_occurrence(
    project_id: int,
    body: ServiceOccurrenceIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseLineageMutationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = create_service_occurrence(db, scope, project_id, **body.model_dump())
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.service_occurrence.create",
            entity_type="enterprise_service_occurrence",
            entity_uuid=row.uuid,
            metadata={"event": "create"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _mutation_payload(row, "service_occurrence")


@router.post(
    "/projects/{project_id}/issue-assets",
    response_model=EnterpriseLineageMutationOut,
    status_code=201,
)
async def create_issue_asset_link(
    project_id: int,
    body: IssueAssetLinkIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseLineageMutationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = link_issue_asset(db, scope, project_id, **body.model_dump())
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.issue_asset.link",
            entity_type="enterprise_issue_asset_link",
            entity_uuid=row.uuid,
            metadata={"event": "create"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _mutation_payload(row, "issue_asset_link")


@router.post(
    "/projects/{project_id}/remediations",
    response_model=EnterpriseLineageMutationOut,
    status_code=201,
)
async def create_project_remediation_route(
    project_id: int,
    body: ProjectRemediationIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseLineageMutationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = create_project_remediation(db, scope, project_id, **body.model_dump())
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.project_remediation.create",
            entity_type="enterprise_project_remediation",
            entity_uuid=row.uuid,
            metadata={"event": "create"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _mutation_payload(row, "project_remediation")


@router.post(
    "/projects/{project_id}/remediations/{remediation_id}/evidence",
    response_model=EnterpriseLineageMutationOut,
    status_code=201,
)
async def create_remediation_evidence_link(
    project_id: int,
    remediation_id: int,
    body: RemediationEvidenceIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> EnterpriseLineageMutationOut:
    _require_idempotency_key(request)
    scope = await _require_intelligence_manage(request, session, settings)
    try:
        row = link_remediation_evidence(
            db,
            scope,
            project_id,
            remediation_id,
            **body.model_dump(),
        )
        _audit_enterprise_write(
            db,
            session,
            request,
            settings,
            action="enterprise.remediation_evidence.link",
            entity_type="enterprise_remediation_evidence_link",
            entity_uuid=row.uuid,
            metadata={"event": "create"},
        )
        db.commit()
    except Exception as exc:
        raise _write_error(exc) from exc
    return _mutation_payload(row, "remediation_evidence_link", project_id=project_id)
