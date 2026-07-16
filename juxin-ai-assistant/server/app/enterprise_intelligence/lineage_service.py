"""Safe write services for the additive enterprise business-lineage tables.

The existing project, contract, task and customer tables remain authoritative.
This module only records explicit relations and service occurrences after the
request scope and all cross-project references have been checked.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..enterprise_business_lineage_models import (
    ProjectCustomerLink,
    ProjectIssueAssetLink,
    ProjectRemediation,
    ProjectRemediationEvidenceLink,
    ProjectServiceOccurrence,
)
from ..enterprise_intelligence_models import EnterpriseCustomer
from ..project_initialization_models import ProjectAsset, ProjectContract, ProjectServiceScope
from ..project_task_models import ProjectDeliverable, ProjectIssue, ProjectTask
from ..project_workspace_models import Project, ProjectMember
from ..models import WorkArtifact
from .access import EnterpriseAccessScope


def _require_manage_scope(scope: EnterpriseAccessScope) -> None:
    if not scope.can("intelligence:manage"):
        raise PermissionError("缺少企业智能管理权限")


def _get_manageable_project(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
) -> Project:
    """Resolve an active, visible, organization-bound project for a write."""

    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.status == "active")
    )
    if project is None:
        raise LookupError("项目不存在或不可访问")
    if not scope.is_admin:
        membership = db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == scope.user_id,
                ProjectMember.status == "active",
            )
        )
        if membership is None:
            raise LookupError("项目不存在或不可访问")
    if project.organization_id is None:
        raise ValueError("项目尚未绑定组织，不能写入企业血缘")
    return project


def link_project_customer(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
    customer_id: int,
    *,
    relation_type: str = "primary",
    source: str = "manual",
    confirmed_by: str | None = None,
    confirmed_at: datetime | None = None,
) -> ProjectCustomerLink:
    """Create an explicit project/customer relation, idempotently."""

    _require_manage_scope(scope)
    project = _get_manageable_project(db, scope, project_id)
    relation_type = relation_type.strip()
    if not relation_type:
        raise ValueError("客户关联类型不能为空")

    existing = db.scalar(
        select(ProjectCustomerLink).where(
            ProjectCustomerLink.organization_id == project.organization_id,
            ProjectCustomerLink.project_id == project.id,
            ProjectCustomerLink.customer_id == customer_id,
            ProjectCustomerLink.relation_type == relation_type,
        )
    )
    if existing is not None:
        return existing

    customer = db.scalar(
        select(EnterpriseCustomer).where(
            EnterpriseCustomer.id == customer_id,
            EnterpriseCustomer.status == "active",
        )
    )
    if customer is None:
        raise LookupError("客户不存在或已停用")
    if customer.organization_id != project.organization_id:
        raise ValueError("客户与项目不属于同一组织")

    row = ProjectCustomerLink(
        organization_id=project.organization_id,
        project_id=project.id,
        customer_id=customer.id,
        relation_type=relation_type,
        source=source.strip() or "manual",
        confirmed_by=str(confirmed_by or scope.user_id),
        confirmed_at=confirmed_at or datetime.now(UTC),
    )
    db.add(row)
    db.flush()
    return row


def _validate_project_reference(
    db: Session,
    model,
    entity_id: int,
    project_id: int,
    label: str,
):
    row = db.scalar(select(model).where(model.id == entity_id))
    if row is None:
        raise LookupError(f"{label}不存在")
    if row.project_id != project_id:
        raise ValueError(f"{label}与服务发生记录不属于同一项目")
    return row


def create_service_occurrence(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
    *,
    occurrence_key: str,
    period_start: date,
    period_end: date,
    due_at: datetime,
    contract_id: int | None = None,
    service_scope_id: int | None = None,
    task_id: int | None = None,
    deliverable_id: int | None = None,
    workflow_run_id: str | None = None,
    work_artifact_id: int | None = None,
    status: str = "scheduled",
    completion_evidence_type: str = "",
    completion_evidence_uuid: str = "",
    source_version: int = 1,
) -> ProjectServiceOccurrence:
    """Record one scheduled/service event with project-consistent references."""

    _require_manage_scope(scope)
    project = _get_manageable_project(db, scope, project_id)
    occurrence_key = occurrence_key.strip()
    if not occurrence_key or len(occurrence_key) > 192:
        raise ValueError("服务发生记录的 occurrence_key 必须为 1-192 个字符")
    if not isinstance(period_start, date) or not isinstance(period_end, date):
        raise TypeError("服务发生记录必须使用 date 类型的周期")
    if period_end < period_start:
        raise ValueError("服务发生记录的结束日期不能早于开始日期")
    if source_version < 1:
        raise ValueError("source_version 必须大于等于 1")

    existing = db.scalar(
        select(ProjectServiceOccurrence).where(
            ProjectServiceOccurrence.organization_id == project.organization_id,
            ProjectServiceOccurrence.occurrence_key == occurrence_key,
        )
    )
    if existing is not None:
        return existing

    contract = None
    if contract_id is not None:
        contract = _validate_project_reference(
            db, ProjectContract, contract_id, project.id, "合同"
        )
        if contract.organization_id not in (None, project.organization_id):
            raise ValueError("合同与项目不属于同一组织")

    service_scope = None
    if service_scope_id is not None:
        service_scope = _validate_project_reference(
            db, ProjectServiceScope, service_scope_id, project.id, "服务范围"
        )
        if (
            contract_id is not None
            and service_scope.contract_id is not None
            and service_scope.contract_id != contract_id
        ):
            raise ValueError("服务范围与合同不匹配")

    if task_id is not None:
        _validate_project_reference(db, ProjectTask, task_id, project.id, "任务")

    if deliverable_id is not None:
        deliverable = _validate_project_reference(
            db, ProjectDeliverable, deliverable_id, project.id, "交付物"
        )
        if task_id is not None and deliverable.task_id not in (None, task_id):
            raise ValueError("交付物与任务不匹配")

    if work_artifact_id is not None:
        artifact = db.scalar(select(WorkArtifact).where(WorkArtifact.id == work_artifact_id))
        if artifact is None:
            raise LookupError("工作产物不存在")
        if artifact.project_id != project.id:
            raise ValueError("工作产物与服务发生记录不属于同一项目")

    row = ProjectServiceOccurrence(
        organization_id=project.organization_id,
        project_id=project.id,
        contract_id=contract_id,
        service_scope_id=service_scope_id,
        task_id=task_id,
        deliverable_id=deliverable_id,
        workflow_run_id=workflow_run_id,
        work_artifact_id=work_artifact_id,
        occurrence_key=occurrence_key,
        period_start=period_start,
        period_end=period_end,
        due_at=due_at,
        status=status.strip() or "scheduled",
        completion_evidence_type=completion_evidence_type.strip(),
        completion_evidence_uuid=completion_evidence_uuid.strip(),
        source_version=source_version,
    )
    db.add(row)
    db.flush()
    return row


def link_issue_asset(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
    issue_id: int,
    asset_id: int,
    *,
    relation_type: str = "affected",
    source: str = "manual",
) -> ProjectIssueAssetLink:
    """Create an issue/asset relation after enforcing project ownership."""

    _require_manage_scope(scope)
    project = _get_manageable_project(db, scope, project_id)
    relation_type = relation_type.strip()
    if not relation_type:
        raise ValueError("问题资产关联类型不能为空")
    existing = db.scalar(
        select(ProjectIssueAssetLink).where(
            ProjectIssueAssetLink.organization_id == project.organization_id,
            ProjectIssueAssetLink.issue_id == issue_id,
            ProjectIssueAssetLink.asset_id == asset_id,
            ProjectIssueAssetLink.relation_type == relation_type,
        )
    )
    if existing is not None:
        return existing
    _validate_project_reference(db, ProjectIssue, issue_id, project.id, "问题")
    _validate_project_reference(db, ProjectAsset, asset_id, project.id, "资产")
    row = ProjectIssueAssetLink(
        organization_id=project.organization_id,
        project_id=project.id,
        issue_id=issue_id,
        asset_id=asset_id,
        relation_type=relation_type,
        source=source.strip() or "manual",
    )
    db.add(row)
    db.flush()
    return row


def create_project_remediation(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
    issue_id: int,
    *,
    title: str,
    asset_id: int | None = None,
    description: str = "",
    owner_user_id: str = "",
    priority: str = "normal",
    status: str = "open",
    due_at: datetime | None = None,
    verification_status: str = "pending",
    remediation_uuid: str | None = None,
) -> ProjectRemediation:
    """Create a remediation record without mutating the source issue."""

    _require_manage_scope(scope)
    project = _get_manageable_project(db, scope, project_id)
    title = title.strip()
    if not title:
        raise ValueError("整改标题不能为空")
    if remediation_uuid is not None:
        remediation_uuid = remediation_uuid.strip()
        if not remediation_uuid or len(remediation_uuid) > 36:
            raise ValueError("remediation_uuid 无效")
        existing = db.scalar(
            select(ProjectRemediation).where(ProjectRemediation.uuid == remediation_uuid)
        )
        if existing is not None:
            if existing.organization_id != project.organization_id or existing.project_id != project.id:
                raise ValueError("整改 UUID 与项目不匹配")
            return existing

    _validate_project_reference(db, ProjectIssue, issue_id, project.id, "问题")
    if asset_id is not None:
        _validate_project_reference(db, ProjectAsset, asset_id, project.id, "资产")

    row = ProjectRemediation(
        uuid=remediation_uuid,
        organization_id=project.organization_id,
        project_id=project.id,
        issue_id=issue_id,
        asset_id=asset_id,
        title=title,
        description=description,
        owner_user_id=owner_user_id,
        priority=priority.strip() or "normal",
        status=status.strip() or "open",
        due_at=due_at,
        verification_status=verification_status.strip() or "pending",
    )
    db.add(row)
    db.flush()
    return row


def link_remediation_evidence(
    db: Session,
    scope: EnterpriseAccessScope,
    project_id: int,
    remediation_id: int,
    *,
    evidence_type: str,
    evidence_uuid: str,
    source_table: str = "",
    source_version: int = 1,
    relation_type: str = "supports",
    notes: str = "",
) -> ProjectRemediationEvidenceLink:
    """Attach a versioned evidence reference to a project remediation."""

    _require_manage_scope(scope)
    project = _get_manageable_project(db, scope, project_id)
    evidence_type = evidence_type.strip()
    evidence_uuid = evidence_uuid.strip()
    if not evidence_type or not evidence_uuid:
        raise ValueError("整改证据类型和 UUID 不能为空")
    if source_version < 1:
        raise ValueError("source_version 必须大于等于 1")
    remediation = db.scalar(
        select(ProjectRemediation).where(
            ProjectRemediation.id == remediation_id,
            ProjectRemediation.organization_id == project.organization_id,
            ProjectRemediation.project_id == project.id,
        )
    )
    if remediation is None:
        raise LookupError("整改不存在或不可访问")
    existing = db.scalar(
        select(ProjectRemediationEvidenceLink).where(
            ProjectRemediationEvidenceLink.organization_id == project.organization_id,
            ProjectRemediationEvidenceLink.remediation_id == remediation.id,
            ProjectRemediationEvidenceLink.evidence_type == evidence_type,
            ProjectRemediationEvidenceLink.evidence_uuid == evidence_uuid,
            ProjectRemediationEvidenceLink.source_version == source_version,
        )
    )
    if existing is not None:
        return existing
    row = ProjectRemediationEvidenceLink(
        organization_id=project.organization_id,
        remediation_id=remediation.id,
        evidence_type=evidence_type,
        evidence_uuid=evidence_uuid,
        source_table=source_table.strip(),
        source_version=source_version,
        relation_type=relation_type.strip() or "supports",
        notes=notes,
    )
    db.add(row)
    db.flush()
    return row


__all__ = [
    "create_project_remediation",
    "create_service_occurrence",
    "link_issue_asset",
    "link_project_customer",
    "link_remediation_evidence",
]
