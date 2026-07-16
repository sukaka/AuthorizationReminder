from datetime import UTC, date, datetime

import pytest

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.lineage_service import (
    create_project_remediation,
    create_service_occurrence,
    link_issue_asset,
    link_project_customer,
    link_remediation_evidence,
)
from app.enterprise_business_lineage_models import (
    ProjectIssueAssetLink,
    ProjectRemediationEvidenceLink,
)
from app.enterprise_intelligence_models import EnterpriseCustomer, EnterpriseOrganization
from app.project_initialization_models import ProjectAsset, ProjectContract, ProjectServiceScope
from app.project_task_models import ProjectDeliverable, ProjectIssue, ProjectTask
from app.project_workspace_models import Project
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str, role: str = "admin") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=user_id, role=role),
            scope=AuthScope(department="交付部"),
            apps=["ai-assistant"],
        )
    )


def _project(db, organization_id: int, name: str) -> Project:
    row = Project(
        name=name,
        owner_user_id="admin-1",
        created_by="admin-1",
        organization_id=organization_id,
    )
    db.add(row)
    db.flush()
    return row


def test_project_customer_link_requires_manage_and_is_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="org-1", name="组织一")
    other_organization = EnterpriseOrganization(external_id="org-2", name="组织二")
    generation_db.add_all([organization, other_organization])
    generation_db.flush()
    project = _project(generation_db, organization.id, "项目一")
    customer = EnterpriseCustomer(
        organization_id=organization.id,
        customer_code="customer-1",
        name="客户一",
    )
    other_customer = EnterpriseCustomer(
        organization_id=other_organization.id,
        customer_code="customer-2",
        name="客户二",
    )
    generation_db.add_all([customer, other_customer])
    generation_db.flush()

    with pytest.raises(PermissionError, match="管理权限"):
        link_project_customer(generation_db, _scope("employee-1", "employee"), project.id, customer.id)

    with pytest.raises(ValueError, match="同一组织"):
        link_project_customer(generation_db, _scope("admin-1"), project.id, other_customer.id)

    first = link_project_customer(
        generation_db,
        _scope("admin-1"),
        project.id,
        customer.id,
        source="import",
    )
    generation_db.commit()
    original_source = first.source
    second = link_project_customer(
        generation_db,
        _scope("admin-2"),
        project.id,
        customer.id,
        source="manual",
        confirmed_by="admin-2",
    )
    assert second.id == first.id
    assert second.source == original_source
    assert second.confirmed_by == "admin-1"


def test_service_occurrence_validates_lineage_and_is_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="org-occ", name="发生记录组织")
    generation_db.add(organization)
    generation_db.flush()
    project = _project(generation_db, organization.id, "服务项目")
    other_project = _project(generation_db, organization.id, "其他项目")
    contract = ProjectContract(
        project_id=project.id,
        organization_id=organization.id,
        name="主合同",
    )
    other_scope = ProjectServiceScope(project_id=other_project.id, name="其他服务")
    generation_db.add_all([contract, other_scope])
    generation_db.flush()
    service_scope = ProjectServiceScope(
        project_id=project.id,
        contract_id=contract.id,
        name="月度服务",
    )
    task = ProjectTask(project_id=project.id, title="执行任务", created_by="admin-1")
    generation_db.add_all([service_scope, task])
    generation_db.flush()
    deliverable = ProjectDeliverable(
        project_id=project.id,
        task_id=task.id,
        title="服务报告",
        created_by="admin-1",
    )
    generation_db.add(deliverable)
    generation_db.flush()

    with pytest.raises(ValueError, match="结束日期"):
        create_service_occurrence(
            generation_db,
            _scope("admin-1"),
            project.id,
            occurrence_key="bad-period",
            period_start=date(2026, 7, 31),
            period_end=date(2026, 7, 1),
            due_at=datetime(2026, 7, 31, tzinfo=UTC),
        )

    with pytest.raises(ValueError, match="同一项目"):
        create_service_occurrence(
            generation_db,
            _scope("admin-1"),
            project.id,
            occurrence_key="wrong-project",
            period_start=date(2026, 7, 1),
            period_end=date(2026, 7, 31),
            due_at=datetime(2026, 7, 31, tzinfo=UTC),
            service_scope_id=other_scope.id,
        )

    first = create_service_occurrence(
        generation_db,
        _scope("admin-1"),
        project.id,
        occurrence_key="project-1:monthly:2026-07",
        period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31),
        due_at=datetime(2026, 7, 31, tzinfo=UTC),
        contract_id=contract.id,
        service_scope_id=service_scope.id,
        task_id=task.id,
        deliverable_id=deliverable.id,
    )
    generation_db.commit()
    assert first.status == "scheduled"
    second = create_service_occurrence(
        generation_db,
        _scope("admin-2"),
        project.id,
        occurrence_key="project-1:monthly:2026-07",
        period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31),
        due_at=datetime(2026, 8, 1, tzinfo=UTC),
        status="completed",
        source_version=2,
    )
    assert second.id == first.id
    assert second.status == "scheduled"
    assert second.source_version == 1


def test_issue_asset_link_enforces_project_scope_and_is_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="org-issue", name="问题组织")
    generation_db.add(organization)
    generation_db.flush()
    project = _project(generation_db, organization.id, "问题项目")
    other_project = _project(generation_db, organization.id, "其他问题项目")
    issue = ProjectIssue(project_id=project.id, title="接口超时", created_by="admin-1")
    asset = ProjectAsset(project_id=project.id, name="接口服务")
    other_issue = ProjectIssue(project_id=other_project.id, title="其他问题", created_by="admin-1")
    generation_db.add_all([issue, asset, other_issue])
    generation_db.flush()

    with pytest.raises(PermissionError, match="管理权限"):
        link_issue_asset(
            generation_db,
            _scope("employee-1", "employee"),
            project.id,
            issue.id,
            asset.id,
        )

    with pytest.raises(ValueError, match="同一项目"):
        link_issue_asset(
            generation_db,
            _scope("admin-1"),
            project.id,
            other_issue.id,
            asset.id,
        )

    first = link_issue_asset(
        generation_db,
        _scope("admin-1"),
        project.id,
        issue.id,
        asset.id,
        source="incident-import",
    )
    generation_db.commit()
    second = link_issue_asset(
        generation_db,
        _scope("admin-2"),
        project.id,
        issue.id,
        asset.id,
        source="manual",
    )
    assert second.id == first.id
    assert second.source == "incident-import"
    assert generation_db.query(ProjectIssueAssetLink).count() == 1


def test_remediation_and_evidence_links_are_scoped_and_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="org-remediation", name="整改组织")
    generation_db.add(organization)
    generation_db.flush()
    project = _project(generation_db, organization.id, "整改项目")
    other_project = _project(generation_db, organization.id, "其他整改项目")
    issue = ProjectIssue(project_id=project.id, title="交付缺陷", created_by="admin-1")
    asset = ProjectAsset(project_id=project.id, name="交付系统")
    other_issue = ProjectIssue(project_id=other_project.id, title="其他缺陷", created_by="admin-1")
    generation_db.add_all([issue, asset, other_issue])
    generation_db.flush()

    with pytest.raises(ValueError, match="标题"):
        create_project_remediation(
            generation_db,
            _scope("admin-1"),
            project.id,
            issue.id,
            title="   ",
        )

    with pytest.raises(ValueError, match="同一项目"):
        create_project_remediation(
            generation_db,
            _scope("admin-1"),
            project.id,
            other_issue.id,
            title="跨项目整改",
        )

    first = create_project_remediation(
        generation_db,
        _scope("admin-1"),
        project.id,
        issue.id,
        title="补充交付证据",
        asset_id=asset.id,
        remediation_uuid="remediation-1",
    )
    generation_db.commit()
    second = create_project_remediation(
        generation_db,
        _scope("admin-2"),
        project.id,
        issue.id,
        title="不应覆盖原标题",
        status="closed",
        remediation_uuid="remediation-1",
    )
    assert second.id == first.id
    assert second.title == "补充交付证据"
    assert second.status == "open"

    with pytest.raises(ValueError, match="source_version"):
        link_remediation_evidence(
            generation_db,
            _scope("admin-1"),
            project.id,
            first.id,
            evidence_type="work_artifact",
            evidence_uuid="artifact-1",
            source_version=0,
        )

    evidence = link_remediation_evidence(
        generation_db,
        _scope("admin-1"),
        project.id,
        first.id,
        evidence_type="work_artifact",
        evidence_uuid="artifact-1",
        source_table="ai_work_artifacts",
        notes="验收截图",
    )
    repeated = link_remediation_evidence(
        generation_db,
        _scope("admin-2"),
        project.id,
        first.id,
        evidence_type="work_artifact",
        evidence_uuid="artifact-1",
        source_table="other_table",
        notes="不应覆盖原备注",
    )
    assert repeated.id == evidence.id
    assert repeated.source_table == "ai_work_artifacts"
    assert repeated.notes == "验收截图"
    assert generation_db.query(ProjectRemediationEvidenceLink).count() == 1

    with pytest.raises(LookupError, match="整改"):
        link_remediation_evidence(
            generation_db,
            _scope("admin-1"),
            project.id,
            999999,
            evidence_type="work_artifact",
            evidence_uuid="missing",
        )
