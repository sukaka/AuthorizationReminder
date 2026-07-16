from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
import hashlib
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..enterprise_business_lineage_models import ProjectRemediation, ProjectServiceOccurrence
from ..enterprise_metrics_models import (
    EnterpriseDataQualityIssue,
    EnterpriseMetricSnapshot,
    EnterpriseProjectHealthSnapshot,
)
from ..enterprise_intelligence_models import EnterpriseOrganization
from ..models import AgentRun, WorkArtifact
from ..project_initialization_models import ProjectContract, ProjectServiceScope
from ..project_task_models import ProjectDeliverable, ProjectIssue, ProjectTask
from ..project_workspace_models import Project, ProjectMember
from .access import EnterpriseAccessScope


METRIC_DEFINITION_VERSION = "1.0.0"
HEALTH_RULE_VERSION = "project-health/1.0.0"
_COMPLETED_TASK_STATUSES = frozenset(
    {"done", "completed", "approved", "delivered", "cancelled", "canceled"}
)
_COMPLETED_DELIVERABLE_STATUSES = frozenset({"approved", "delivered", "completed"})
_COMPLETED_SERVICE_OCCURRENCE_STATUSES = frozenset(
    {"completed", "delivered", "approved", "cancelled", "canceled"}
)
_ISSUE_DEDUCTIONS = {"critical": 50, "high": 30, "medium": 15, "low": 5}


def list_enterprise_organizations(
    db: Session,
    scope: EnterpriseAccessScope,
) -> list[dict[str, object]]:
    """Return only active organizations backed by projects in the caller scope.

    The management UI must never ask an operator to type an arbitrary internal
    organization id.  Admins can see active organizations with zero projects;
    other users only see organizations with at least one active project they
    can access through project membership.
    """

    statement = (
        select(
            EnterpriseOrganization,
            func.count(func.distinct(Project.id)).label("project_count"),
        )
        .outerjoin(
            Project,
            (Project.organization_id == EnterpriseOrganization.id)
            & (Project.status == "active"),
        )
        .where(EnterpriseOrganization.status == "active")
    )
    if not scope.is_admin:
        statement = statement.join(
            ProjectMember,
            (ProjectMember.project_id == Project.id)
            & (ProjectMember.user_id == scope.user_id)
            & (ProjectMember.status == "active"),
        )
    rows = db.execute(
        statement.group_by(EnterpriseOrganization.id)
        .order_by(EnterpriseOrganization.name.asc(), EnterpriseOrganization.id.asc())
    ).all()
    return [
        {
            "id": int(organization.id),
            "uuid": organization.uuid,
            "external_id": organization.external_id,
            "name": organization.name,
            "status": organization.status,
            "project_count": int(project_count or 0),
        }
        for organization, project_count in rows
    ]


def _before_or_at(value: datetime | None, cutoff: datetime) -> bool:
    if value is None:
        return False
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return normalized <= cutoff


def _count_for_projects(db: Session, model, project_ids: list[int], *conditions) -> int:
    if not project_ids:
        return 0
    statement = select(func.count(model.id)).where(
        model.project_id.in_(project_ids),
        *conditions,
    )
    return int(db.scalar(statement) or 0)


def _metric_snapshot(
    *,
    scope: EnterpriseAccessScope,
    project_uuids: list[str],
    metric_code: str,
    numerator: int,
    denominator: int | None,
    value: float | int | None,
    cutoff: datetime,
    data_completeness: float,
    data_version: str,
    exclusions: list[str] | None = None,
    reason: str | None = None,
) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "metric_code": metric_code,
        "definition_version": METRIC_DEFINITION_VERSION,
        "scope": {
            "type": "project_membership",
            "user_id": scope.user_id,
            "project_uuids": project_uuids,
        },
        "scope_fingerprint": scope.scope_fingerprint,
        "policy_version": scope.policy_version,
        "period_start": cutoff.isoformat(),
        "period_end": cutoff.isoformat(),
        "data_cutoff_at": cutoff.isoformat(),
        "data_version": data_version,
        "numerator": numerator,
        "denominator": denominator,
        "value": value,
        "freshness": "fresh",
        "data_completeness": round(max(0.0, min(1.0, data_completeness)), 4),
        "suppressed": False,
        "exclusions": exclusions or [],
        "evidence_refs": project_uuids,
    }
    if reason:
        snapshot["reason"] = reason
    return snapshot


def _project_health(
    db: Session,
    projects: list[Project],
    cutoff: datetime,
) -> list[dict[str, object]]:
    """Calculate explainable health without pretending missing domains are healthy."""

    project_ids = [project.id for project in projects]
    if not project_ids:
        return []

    tasks_by_project: dict[int, list[ProjectTask]] = defaultdict(list)
    for row in db.scalars(select(ProjectTask).where(ProjectTask.project_id.in_(project_ids))).all():
        tasks_by_project[row.project_id].append(row)
    deliverables_by_project: dict[int, list[ProjectDeliverable]] = defaultdict(list)
    for row in db.scalars(
        select(ProjectDeliverable).where(ProjectDeliverable.project_id.in_(project_ids))
    ).all():
        deliverables_by_project[row.project_id].append(row)
    issues_by_project: dict[int, list[ProjectIssue]] = defaultdict(list)
    for row in db.scalars(select(ProjectIssue).where(ProjectIssue.project_id.in_(project_ids))).all():
        issues_by_project[row.project_id].append(row)

    results: list[dict[str, object]] = []
    for project in projects:
        tasks = tasks_by_project[project.id]
        deliverables = deliverables_by_project[project.id]
        issues = issues_by_project[project.id]
        due_tasks = [row for row in tasks if _before_or_at(row.due_at, cutoff)]
        overdue_tasks = [
            row
            for row in due_tasks
            if row.status.lower() not in _COMPLETED_TASK_STATUSES
        ]
        missing_due_dates = [row for row in tasks if row.due_at is None]
        task_score = max(0, 100 - min(100, len(overdue_tasks) * 25))
        task_completeness = 0.8 if missing_due_dates else 1.0

        completed_deliverables = [
            row
            for row in deliverables
            if row.status.lower() in _COMPLETED_DELIVERABLE_STATUSES
        ]
        deliverable_score = (
            100
            if not deliverables
            else round(100 * len(completed_deliverables) / len(deliverables), 2)
        )
        deliverable_completeness = 0.65 if not deliverables else 0.8

        open_issues = [
            row
            for row in issues
            if row.status.lower() not in {"closed", "resolved"}
        ]
        issue_score = max(
            0,
            100
            - min(
                100,
                sum(_ISSUE_DEDUCTIONS.get(row.severity.lower(), 15) for row in open_issues),
            ),
        )
        critical_issue = any(row.severity.lower() == "critical" for row in open_issues)
        high_issue = any(row.severity.lower() == "high" for row in open_issues)

        dimensions = [
            {
                "code": "service_delivery",
                "label": "合同与服务履约",
                "weight": 25,
                "score": None,
                "data_completeness": 0.0,
                "status": "missing",
                "evidence_refs": [],
            },
            {
                "code": "task_progress",
                "label": "计划与任务进度",
                "weight": 20,
                "score": task_score,
                "data_completeness": task_completeness,
                "status": "available",
                "evidence_refs": [project.uuid],
            },
            {
                "code": "deliverable_delivery",
                "label": "成果交付",
                "weight": 20,
                "score": deliverable_score,
                "data_completeness": deliverable_completeness,
                "status": "available",
                "evidence_refs": [project.uuid],
            },
            {
                "code": "quality",
                "label": "质量",
                "weight": 15,
                "score": None,
                "data_completeness": 0.0,
                "status": "missing",
                "evidence_refs": [],
            },
            {
                "code": "issues_remediation",
                "label": "问题与整改",
                "weight": 10,
                "score": issue_score,
                "data_completeness": 0.8,
                "status": "available",
                "evidence_refs": [project.uuid],
            },
            {
                "code": "workflow_reliability",
                "label": "自动流程可靠性",
                "weight": 10,
                "score": None,
                "data_completeness": 0.0,
                "status": "missing",
                "evidence_refs": [],
            },
        ]
        applicable_weight = sum(item["weight"] for item in dimensions if item["score"] is not None)
        weighted_score = sum(
            item["score"] * item["weight"]
            for item in dimensions
            if item["score"] is not None
        )
        score = round(weighted_score / applicable_weight, 2) if applicable_weight else None
        confidence = round(
            sum(item["weight"] * item["data_completeness"] for item in dimensions) / 100,
            4,
        )
        deductions: list[dict[str, object]] = []
        if overdue_tasks:
            deductions.append(
                {
                    "code": "OVERDUE_TASK",
                    "points": min(100, len(overdue_tasks) * 25),
                    "reason": f"有 {len(overdue_tasks)} 个任务超过截止时间且未完成",
                    "evidence_refs": [project.uuid],
                }
            )
        if missing_due_dates:
            deductions.append(
                {
                    "code": "TASK_DUE_DATE_MISSING",
                    "points": 0,
                    "reason": f"有 {len(missing_due_dates)} 个任务缺少截止时间，无法判断是否超期",
                    "evidence_refs": [project.uuid],
                }
            )
        if critical_issue:
            deductions.append(
                {
                    "code": "OPEN_CRITICAL_ISSUE",
                    "points": 50,
                    "reason": "存在未关闭的高危问题",
                    "evidence_refs": [project.uuid],
                }
            )
        elif high_issue:
            deductions.append(
                {
                    "code": "OPEN_HIGH_ISSUE",
                    "points": 30,
                    "reason": "存在未关闭的高风险问题",
                    "evidence_refs": [project.uuid],
                }
            )

        if confidence < 0.8:
            status = "data_incomplete"
        elif critical_issue or (score is not None and score < 60):
            status = "high_risk"
        elif high_issue or (score is not None and score < 80):
            status = "attention"
        else:
            status = "healthy"
        results.append(
            {
                "project_uuid": project.uuid,
                "project_name": project.name,
                "score": score,
                "status": status,
                "confidence": confidence,
                "rule_version": HEALTH_RULE_VERSION,
                "as_of": cutoff.isoformat(),
                "dimensions": dimensions,
                "deductions": deductions,
            }
        )
    return results


def _visible_projects(db: Session, scope: EnterpriseAccessScope) -> list[Project]:
    """Return active projects visible to the request-local enterprise scope."""

    project_query = select(Project).where(Project.status == "active")
    if not scope.is_admin:
        project_query = project_query.join(
            ProjectMember, ProjectMember.project_id == Project.id
        ).where(
            ProjectMember.user_id == scope.user_id,
            ProjectMember.status == "active",
        )
    return db.scalars(
        project_query.order_by(Project.updated_at.desc(), Project.id.desc())
    ).unique().all()


def _quality_issue(
    *,
    code: str,
    entity_type: str,
    entity_uuid: str,
    project_uuid: str,
    severity: str,
    message: str,
) -> dict[str, str]:
    return {
        "code": code,
        "entity_type": entity_type,
        "entity_uuid": entity_uuid,
        "project_uuid": project_uuid,
        "severity": severity,
        "message": message,
        # A report must never silently merge or mutate master data.
        "resolution": "manual_review",
    }


def build_enterprise_data_quality_report(
    db: Session,
    scope: EnterpriseAccessScope,
) -> dict[str, object]:
    """Build a scoped, read-only report of identity and lineage gaps.

    The report intentionally returns unresolved findings instead of attempting
    to repair rows.  This makes it safe to expose to operators while the
    organization/customer canonicalization workflow is still being built.
    """

    projects = _visible_projects(db, scope)
    project_ids = [project.id for project in projects]
    project_by_id = {project.id: project for project in projects}
    if not project_ids:
        return {
            "status": "complete",
            "as_of": datetime.now(UTC).isoformat(),
            "scope_fingerprint": scope.scope_fingerprint,
            "summary": {
                "entities_scanned": 0,
                "unresolved_count": 0,
                "completeness": 1.0,
            },
            "issues": [],
        }

    contracts = db.scalars(
        select(ProjectContract).where(ProjectContract.project_id.in_(project_ids))
    ).all()
    service_scopes = db.scalars(
        select(ProjectServiceScope).where(
            ProjectServiceScope.project_id.in_(project_ids),
            ProjectServiceScope.status.not_in(("archived", "cancelled", "canceled")),
        )
    ).all()
    deliverables = db.scalars(
        select(ProjectDeliverable).where(ProjectDeliverable.project_id.in_(project_ids))
    ).all()
    service_scope_ids = [row.id for row in service_scopes]
    occurrence_scope_ids = set(
        db.scalars(
            select(ProjectServiceOccurrence.service_scope_id).where(
                ProjectServiceOccurrence.service_scope_id.in_(service_scope_ids),
                ProjectServiceOccurrence.status.not_in(("cancelled", "canceled")),
            )
        ).all()
    ) if service_scope_ids else set()

    issues: list[dict[str, str]] = []
    for project in projects:
        if project.organization_id is None:
            issues.append(
                _quality_issue(
                    code="PROJECT_ORGANIZATION_MISSING",
                    entity_type="project",
                    entity_uuid=project.uuid,
                    project_uuid=project.uuid,
                    severity="high",
                    message="项目尚未绑定组织主数据。",
                )
            )
        if project.owner_department_id is None:
            issues.append(
                _quality_issue(
                    code="PROJECT_DEPARTMENT_MISSING",
                    entity_type="project",
                    entity_uuid=project.uuid,
                    project_uuid=project.uuid,
                    severity="medium",
                    message="项目尚未绑定负责部门。",
                )
            )
        if project.primary_customer_id is None:
            issues.append(
                _quality_issue(
                    code="PROJECT_CUSTOMER_MISSING",
                    entity_type="project",
                    entity_uuid=project.uuid,
                    project_uuid=project.uuid,
                    severity="high",
                    message="项目尚未绑定主客户。",
                )
            )

    for contract in contracts:
        project = project_by_id[contract.project_id]
        if contract.organization_id is None:
            issues.append(
                _quality_issue(
                    code="CONTRACT_ORGANIZATION_MISSING",
                    entity_type="contract",
                    entity_uuid=contract.uuid,
                    project_uuid=project.uuid,
                    severity="medium",
                    message="合同尚未绑定所属组织。",
                )
            )
        if contract.customer_name.strip() and contract.customer_id is None:
            issues.append(
                _quality_issue(
                    code="CONTRACT_CUSTOMER_UNRESOLVED",
                    entity_type="contract",
                    entity_uuid=contract.uuid,
                    project_uuid=project.uuid,
                    severity="high",
                    message="合同有客户名称，但尚未解析到客户主数据。",
                )
            )
        if contract.extraction_status != "confirmed" or contract.confirmed_at is None:
            issues.append(
                _quality_issue(
                    code="CONTRACT_EXTRACTION_UNCONFIRMED",
                    entity_type="contract",
                    entity_uuid=contract.uuid,
                    project_uuid=project.uuid,
                    severity="medium",
                    message="合同抽取结果尚未人工确认。",
                )
            )

    for service_scope in service_scopes:
        if service_scope.confirmation_status == "confirmed" and service_scope.id not in occurrence_scope_ids:
            project = project_by_id[service_scope.project_id]
            issues.append(
                _quality_issue(
                    code="SERVICE_OCCURRENCE_MISSING",
                    entity_type="service_scope",
                    entity_uuid=service_scope.uuid,
                    project_uuid=project.uuid,
                    severity="high",
                    message="已确认的服务范围尚未生成履约发生记录。",
                )
            )

    for deliverable in deliverables:
        if (
            deliverable.status.lower() not in {"cancelled", "canceled"}
            and deliverable.work_artifact_id is None
            and deliverable.work_artifact_version_id is None
        ):
            project = project_by_id[deliverable.project_id]
            issues.append(
                _quality_issue(
                    code="DELIVERABLE_ARTIFACT_UNMAPPED",
                    entity_type="deliverable",
                    entity_uuid=deliverable.uuid,
                    project_uuid=project.uuid,
                    severity="medium",
                    message="正式成果尚未映射到工作成果版本。",
                )
            )

    entities_scanned = len(projects) + len(contracts) + len(service_scopes) + len(deliverables)
    quality_checks = len(projects) * 3 + len(contracts) * 3 + len(service_scopes) + len(deliverables)
    completeness = round(
        max(0.0, 1.0 - len(issues) / max(1, quality_checks)),
        4,
    )
    return {
        "status": "partial" if issues else "complete",
        "as_of": datetime.now(UTC).isoformat(),
        "scope_fingerprint": scope.scope_fingerprint,
        "summary": {
            "entities_scanned": entities_scanned,
            "unresolved_count": len(issues),
            "completeness": completeness,
        },
        "issues": issues,
    }


def build_enterprise_overview(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    cutoff: datetime | None = None,
) -> dict[str, object]:
    """Build a read-only overview from existing project/work tables."""

    projects = _visible_projects(db, scope)
    project_ids = [project.id for project in projects]
    project_uuids = [project.uuid for project in projects]

    cutoff = cutoff or datetime.now(UTC)
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=UTC)
    metrics = {
        "projects": len(projects),
        "tasks": _count_for_projects(db, ProjectTask, project_ids),
        "deliverables": _count_for_projects(db, ProjectDeliverable, project_ids),
        "open_issues": _count_for_projects(
            db,
            ProjectIssue,
            project_ids,
            ProjectIssue.status.not_in(("closed", "resolved")),
        ),
        "artifacts": _count_for_projects(
            db,
            WorkArtifact,
            project_ids,
            WorkArtifact.record_status == "active",
        ),
    }
    tasks = db.scalars(
        select(ProjectTask).where(ProjectTask.project_id.in_(project_ids))
    ).all() if project_ids else []
    due_tasks = [row for row in tasks if _before_or_at(row.due_at, cutoff)]
    overdue_tasks = [
        row for row in due_tasks if row.status.lower() not in _COMPLETED_TASK_STATUSES
    ]
    deliverables = db.scalars(
        select(ProjectDeliverable).where(ProjectDeliverable.project_id.in_(project_ids))
    ).all() if project_ids else []
    approved_deliverables = [
        row
        for row in deliverables
        if row.status.lower() in _COMPLETED_DELIVERABLE_STATUSES
    ]
    metric_snapshots = [
        _metric_snapshot(
            scope=scope,
            project_uuids=project_uuids,
            metric_code="active_project_count",
            numerator=len(projects),
            denominator=None,
            value=len(projects),
            cutoff=cutoff,
            data_completeness=0.6,
            data_version="live:ai_projects/v1",
            reason="数量指标不使用分母；组织和客户主数据尚未纳入完整度。",
        ),
        _metric_snapshot(
            scope=scope,
            project_uuids=project_uuids,
            metric_code="overdue_task_rate",
            numerator=len(overdue_tasks),
            denominator=len(due_tasks),
            value=(len(overdue_tasks) / len(due_tasks)) if due_tasks else None,
            cutoff=cutoff,
            data_completeness=(len(due_tasks) / len(tasks)) if tasks else 0.0,
            data_version="live:ai_project_tasks/v1",
            exclusions=sorted(_COMPLETED_TASK_STATUSES),
            reason="没有带截止时间的任务时不返回比例。" if not due_tasks else None,
        ),
        _metric_snapshot(
            scope=scope,
            project_uuids=project_uuids,
            metric_code="approved_deliverable_rate",
            numerator=len(approved_deliverables),
            denominator=len(deliverables),
            value=(len(approved_deliverables) / len(deliverables)) if deliverables else None,
            cutoff=cutoff,
            data_completeness=0.8 if deliverables else 0.0,
            data_version="live:ai_project_deliverables/v1",
            exclusions=["未建立正式成果映射"],
            reason="没有交付物记录时不返回比例。" if not deliverables else None,
        ),
    ]
    return {
        "scope": {
            "user_id": scope.user_id,
            "role": scope.role,
            "department": scope.department,
            "managed_departments": list(scope.managed_departments),
            "project_count": len(projects),
            "project_uuids": project_uuids,
            "policy_version": scope.policy_version,
            "scope_fingerprint": scope.scope_fingerprint,
        },
        "metrics": metrics,
        "metric_snapshots": metric_snapshots,
        "project_health": _project_health(db, projects, cutoff),
        "freshness": {
            "as_of": cutoff.isoformat(),
            "mode": "live_query",
            "is_stale": False,
        },
        "data_quality": {
            "status": "partial",
            "gaps": [
                "organization_master_data",
                "customer_master_data",
                "historical_metric_snapshots",
            ],
            "explanation": "当前总览仅使用现有项目工作表；组织、客户和历史指标主数据尚未迁移。",
        },
    }


def _attention_item(
    *,
    item_type: str,
    severity: str,
    title: str,
    summary: str,
    project: Project,
    evidence_refs: list[str],
) -> dict[str, object]:
    """Create the stable, read-only shape used by the management attention feed."""

    return {
        "type": item_type,
        "severity": severity,
        "title": title,
        "summary": summary,
        "project_uuid": project.uuid,
        "project_name": project.name,
        "evidence_refs": evidence_refs,
        "status": "open",
    }


def build_enterprise_operation_summary(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    cutoff: datetime | None = None,
    attention_limit: int = 100,
) -> dict[str, object]:
    """Build the first-phase operational cockpit from authoritative tables.

    The summary deliberately remains a read-only projection.  Every project
    row is selected through ``_visible_projects`` first, and all downstream
    queries use those project ids.  Missing mappings are surfaced as attention
    items instead of being guessed or repaired automatically.
    """

    if attention_limit < 1 or attention_limit > 500:
        raise ValueError("attention_limit must be between 1 and 500")
    cutoff = cutoff or datetime.now(UTC)
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=UTC)
    projects = _visible_projects(db, scope)
    project_ids = [project.id for project in projects]
    project_by_id = {project.id: project for project in projects}
    project_uuids = [project.uuid for project in projects]

    contracts = (
        db.scalars(select(ProjectContract).where(ProjectContract.project_id.in_(project_ids))).all()
        if project_ids
        else []
    )
    service_scopes = (
        db.scalars(
            select(ProjectServiceScope).where(
                ProjectServiceScope.project_id.in_(project_ids),
                ProjectServiceScope.status.not_in(("archived", "cancelled", "canceled")),
            )
        ).all()
        if project_ids
        else []
    )
    occurrences = (
        db.scalars(
            select(ProjectServiceOccurrence).where(
                ProjectServiceOccurrence.project_id.in_(project_ids),
                ProjectServiceOccurrence.status.not_in(("cancelled", "canceled")),
            )
        ).all()
        if project_ids
        else []
    )
    tasks = (
        db.scalars(select(ProjectTask).where(ProjectTask.project_id.in_(project_ids))).all()
        if project_ids
        else []
    )
    deliverables = (
        db.scalars(select(ProjectDeliverable).where(ProjectDeliverable.project_id.in_(project_ids))).all()
        if project_ids
        else []
    )
    issues = (
        db.scalars(select(ProjectIssue).where(ProjectIssue.project_id.in_(project_ids))).all()
        if project_ids
        else []
    )
    remediations = (
        db.scalars(select(ProjectRemediation).where(ProjectRemediation.project_id.in_(project_ids))).all()
        if project_ids
        else []
    )

    occurrences_by_scope: dict[int, list[ProjectServiceOccurrence]] = defaultdict(list)
    for occurrence in occurrences:
        if occurrence.service_scope_id is not None:
            occurrences_by_scope[occurrence.service_scope_id].append(occurrence)
    completed_occurrences = [
        row for row in occurrences if row.status.lower() in _COMPLETED_SERVICE_OCCURRENCE_STATUSES
    ]
    overdue_occurrences = [
        row
        for row in occurrences
        if _before_or_at(row.due_at, cutoff)
        and row.status.lower() not in _COMPLETED_SERVICE_OCCURRENCE_STATUSES
    ]
    confirmed_scopes = [row for row in service_scopes if row.confirmation_status == "confirmed"]
    missing_occurrence_scopes = [
        row
        for row in confirmed_scopes
        if not occurrences_by_scope.get(row.id)
    ]

    overdue_tasks = [
        row
        for row in tasks
        if _before_or_at(row.due_at, cutoff)
        and row.status.lower() not in _COMPLETED_TASK_STATUSES
    ]
    open_issues = [row for row in issues if row.status.lower() not in {"closed", "resolved"}]
    high_or_critical_issues = [
        row for row in open_issues if row.severity.lower() in {"high", "critical"}
    ]
    open_remediations = [
        row for row in remediations if row.status.lower() not in {"closed", "resolved", "cancelled", "canceled"}
    ]
    overdue_remediations = [
        row
        for row in open_remediations
        if _before_or_at(row.due_at, cutoff)
    ]

    run_query = select(AgentRun)
    if not scope.is_admin:
        # Runs do not yet carry a normalized project scope.  Until that
        # migration exists, exposing only the caller-owned runs is the safe
        # privacy-preserving fallback.
        run_query = run_query.where(AgentRun.owner_user_id == scope.user_id)
    runs = db.scalars(run_query).all()
    succeeded_runs = [row for row in runs if row.status.lower() in {"succeeded", "completed"}]
    failed_runs = [row for row in runs if row.status.lower() in {"failed", "cancelled"}]
    active_runs = [
        row for row in runs if row.status.lower() in {"queued", "running", "waiting_user"}
    ]

    attention: list[dict[str, object]] = []
    for row in overdue_tasks:
        project = project_by_id[row.project_id]
        attention.append(
            _attention_item(
                item_type="overdue_task",
                severity="high" if row.priority.lower() in {"urgent", "high"} else "medium",
                title=row.title,
                summary="任务已超过截止时间且尚未完成。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )
    for row in missing_occurrence_scopes:
        project = project_by_id[row.project_id]
        attention.append(
            _attention_item(
                item_type="service_occurrence_missing",
                severity="high",
                title=f"服务履约记录缺失：{row.name}",
                summary="已确认的合同服务范围尚未生成可追踪的履约发生记录。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )
    for row in overdue_occurrences:
        project = project_by_id[row.project_id]
        attention.append(
            _attention_item(
                item_type="overdue_service_occurrence",
                severity="high",
                title=f"服务履约逾期：{row.occurrence_key}",
                summary="服务履约发生记录已到期，但尚未标记为完成。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )
    for row in high_or_critical_issues:
        project = project_by_id[row.project_id]
        attention.append(
            _attention_item(
                item_type="open_critical_issue" if row.severity.lower() == "critical" else "open_high_issue",
                severity=row.severity.lower(),
                title=row.title,
                summary="存在未关闭的高风险问题，需要负责人确认处置路径。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )
    for row in overdue_remediations:
        project = project_by_id[row.project_id]
        attention.append(
            _attention_item(
                item_type="overdue_remediation",
                severity="high" if row.priority.lower() in {"urgent", "high"} else "medium",
                title=row.title,
                summary="整改项已超过截止时间且尚未关闭。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )
    for row in failed_runs[:attention_limit]:
        metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
        project_uuid = str(metadata.get("project_uuid") or "")
        project = next((item for item in projects if item.uuid == project_uuid), None)
        if project is None:
            continue
        attention.append(
            _attention_item(
                item_type="automation_failed",
                severity="high",
                title=row.title or "自动流程失败",
                summary=row.error_message_safe or "自动流程执行失败，需要检查运行日志。",
                project=project,
                evidence_refs=[row.uuid, project.uuid],
            )
        )

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    attention.sort(key=lambda item: (severity_order.get(str(item["severity"]), 9), str(item["title"])))
    confirmed_contracts = [
        row
        for row in contracts
        if row.extraction_status.lower() == "confirmed" and row.confirmed_at is not None
    ]
    return {
        "scope": {
            "user_id": scope.user_id,
            "role": scope.role,
            "project_count": len(projects),
            "project_uuids": project_uuids,
            "policy_version": scope.policy_version,
            "scope_fingerprint": scope.scope_fingerprint,
        },
        "as_of": cutoff.isoformat(),
        "contracts": {
            "total": len(contracts),
            "confirmed": len(confirmed_contracts),
            "pending_confirmation": len(contracts) - len(confirmed_contracts),
        },
        "services": {
            "total": len(service_scopes),
            "confirmed": len(confirmed_scopes),
            "pending_confirmation": len(service_scopes) - len(confirmed_scopes),
            "occurrences": len(occurrences),
            "completed_occurrences": len(completed_occurrences),
            "overdue_occurrences": len(overdue_occurrences),
            "missing_occurrences": len(missing_occurrence_scopes),
        },
        "tasks": {
            "total": len(tasks),
            "open": sum(1 for row in tasks if row.status.lower() not in _COMPLETED_TASK_STATUSES),
            "overdue": len(overdue_tasks),
        },
        "deliverables": {
            "total": len(deliverables),
            "approved": sum(1 for row in deliverables if row.status.lower() in _COMPLETED_DELIVERABLE_STATUSES),
            "pending": sum(1 for row in deliverables if row.status.lower() not in _COMPLETED_DELIVERABLE_STATUSES),
        },
        "issues": {
            "total": len(issues),
            "open": len(open_issues),
            "open_high_or_critical": len(high_or_critical_issues),
            "overdue_remediations": len(overdue_remediations),
        },
        "automation": {
            "total": len(runs),
            "succeeded": len(succeeded_runs),
            "failed": len(failed_runs),
            "active": len(active_runs),
            "success_rate": round(len(succeeded_runs) / len(runs), 4) if runs else None,
            "scope_mode": "all_runs_for_admin" if scope.is_admin else "caller_owned_runs_until_project_scope_migration",
        },
        "attention_items": attention[:attention_limit],
    }


def _parse_snapshot_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _snapshot_source_hash(payload: object) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _quality_issue_fingerprint(
    *,
    scope_fingerprint: str,
    issue: dict[str, str],
    source_version: int,
) -> str:
    """Build the immutable identity of one scoped quality finding."""

    return _snapshot_source_hash(
        {
            "scope_fingerprint": scope_fingerprint,
            "code": issue["code"],
            "entity_type": issue["entity_type"],
            "entity_uuid": issue["entity_uuid"],
            "project_uuid": issue["project_uuid"],
            "source_version": source_version,
        }
    )


def persist_enterprise_data_quality_issues(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    detected_at: datetime | None = None,
    source_version: int = 1,
) -> dict[str, int]:
    """Append unresolved data-quality findings to the scoped review queue.

    Existing rows are never rewritten, including rows that an operator has
    resolved.  This makes repeated scans safe and preserves the audit trail;
    a changed rule must use a new ``source_version`` to produce a new finding.
    """

    if source_version < 1:
        raise ValueError("source_version must be positive")
    report = build_enterprise_data_quality_report(db, scope)
    detected = detected_at or datetime.now(UTC)
    if detected.tzinfo is None:
        detected = detected.replace(tzinfo=UTC)
    issues_created = 0
    for issue in report["issues"]:
        fingerprint = _quality_issue_fingerprint(
            scope_fingerprint=scope.scope_fingerprint,
            issue=issue,
            source_version=source_version,
        )
        existing = db.scalar(
            select(EnterpriseDataQualityIssue.id).where(
                EnterpriseDataQualityIssue.issue_fingerprint == fingerprint
            )
        )
        if existing is not None:
            continue
        db.add(
            EnterpriseDataQualityIssue(
                scope_fingerprint=scope.scope_fingerprint,
                project_uuid=issue["project_uuid"],
                entity_type=issue["entity_type"],
                entity_uuid=issue["entity_uuid"],
                code=issue["code"],
                severity=issue["severity"],
                message=issue["message"],
                resolution=issue["resolution"],
                status="unresolved",
                issue_fingerprint=fingerprint,
                detected_at=detected,
                source_version=source_version,
            )
        )
        issues_created += 1
    db.flush()
    return {
        "issues_scanned": len(report["issues"]),
        "issues_created": issues_created,
    }


def persist_enterprise_overview_snapshots(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    cutoff: datetime | None = None,
) -> dict[str, int]:
    """Persist a cutoff-bound overview without updating an existing snapshot.

    A snapshot's natural key is checked before insert.  Re-running a worker for
    the same scope/cutoff is therefore a no-op, and later changes to live
    project rows cannot rewrite the historical value.
    """

    overview = build_enterprise_overview(db, scope, cutoff=cutoff)
    projects = _visible_projects(db, scope)
    projects_by_uuid = {project.uuid: project for project in projects}
    organization_ids = {project.organization_id for project in projects if project.organization_id is not None}
    organization_id = next(iter(organization_ids)) if len(organization_ids) == 1 else None
    metric_snapshots_created = 0
    health_snapshots_created = 0

    for item in overview["metric_snapshots"]:
        period_start = _parse_snapshot_datetime(item["period_start"])
        period_end = _parse_snapshot_datetime(item["period_end"])
        data_cutoff_at = _parse_snapshot_datetime(item["data_cutoff_at"])
        existing = db.scalar(
            select(EnterpriseMetricSnapshot.id).where(
                EnterpriseMetricSnapshot.scope_fingerprint == item["scope_fingerprint"],
                EnterpriseMetricSnapshot.metric_code == item["metric_code"],
                EnterpriseMetricSnapshot.definition_version == item["definition_version"],
                EnterpriseMetricSnapshot.period_start == period_start,
                EnterpriseMetricSnapshot.period_end == period_end,
                EnterpriseMetricSnapshot.data_cutoff_at == data_cutoff_at,
                EnterpriseMetricSnapshot.data_version == item["data_version"],
            )
        )
        if existing is not None:
            continue
        db.add(
            EnterpriseMetricSnapshot(
                organization_id=organization_id,
                scope_fingerprint=item["scope_fingerprint"],
                policy_version=item["policy_version"],
                scope_type=item["scope"]["type"],
                scope_id=item["scope"]["user_id"],
                metric_code=item["metric_code"],
                definition_version=item["definition_version"],
                period_start=period_start,
                period_end=period_end,
                data_cutoff_at=data_cutoff_at,
                data_version=item["data_version"],
                numerator=item["numerator"],
                denominator=item["denominator"],
                value=item["value"],
                freshness=item["freshness"],
                data_completeness=item["data_completeness"],
                suppressed=item["suppressed"],
                exclusions_json=item["exclusions"],
                evidence_refs_json=item["evidence_refs"],
                reason=item.get("reason", ""),
                source_hash=_snapshot_source_hash(item),
            )
        )
        metric_snapshots_created += 1

    for item in overview["project_health"]:
        project = projects_by_uuid.get(item["project_uuid"])
        if project is None:
            continue
        as_of = _parse_snapshot_datetime(item["as_of"])
        existing = db.scalar(
            select(EnterpriseProjectHealthSnapshot.id).where(
                EnterpriseProjectHealthSnapshot.project_id == project.id,
                EnterpriseProjectHealthSnapshot.scope_fingerprint == scope.scope_fingerprint,
                EnterpriseProjectHealthSnapshot.rule_version == item["rule_version"],
                EnterpriseProjectHealthSnapshot.as_of == as_of,
            )
        )
        if existing is not None:
            continue
        db.add(
            EnterpriseProjectHealthSnapshot(
                organization_id=project.organization_id,
                project_id=project.id,
                project_uuid=item["project_uuid"],
                scope_fingerprint=scope.scope_fingerprint,
                score=item["score"],
                status=item["status"],
                confidence=item["confidence"],
                rule_version=item["rule_version"],
                as_of=as_of,
                dimensions_json=item["dimensions"],
                deductions_json=item["deductions"],
                source_hash=_snapshot_source_hash(item),
            )
        )
        health_snapshots_created += 1

    db.flush()
    return {
        "metric_snapshots_created": metric_snapshots_created,
        "health_snapshots_created": health_snapshots_created,
    }
