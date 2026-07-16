from __future__ import annotations

from app.enterprise_intelligence_models import EnterpriseCustomer, EnterpriseOrganization
from app.project_initialization_models import ProjectAsset
from app.project_task_models import ProjectIssue
from app.project_workspace_models import Project


def _seed_project(generation_db):
    organization = EnterpriseOrganization(external_id="org-api", name="接口组织")
    generation_db.add(organization)
    generation_db.flush()
    project = Project(
        name="接口项目",
        owner_user_id="admin-1",
        created_by="admin-1",
        organization_id=organization.id,
    )
    customer = EnterpriseCustomer(
        organization_id=organization.id,
        customer_code="customer-api",
        name="接口客户",
    )
    generation_db.add_all([project, customer])
    generation_db.flush()
    issue = ProjectIssue(project_id=project.id, title="接口问题", created_by="admin-1")
    asset = ProjectAsset(project_id=project.id, name="接口资产")
    generation_db.add_all([issue, asset])
    generation_db.commit()
    return project, customer, issue, asset


def test_lineage_routes_require_manage_and_idempotency_key(
    generation_db,
    client_for_user,
) -> None:
    project, customer, issue, asset = _seed_project(generation_db)
    employee = client_for_user("employee-1", "employee")
    admin = client_for_user("admin-1", "admin")
    url = f"/api/ai/intelligence/projects/{project.id}/customers"
    payload = {"customer_id": customer.id}

    missing_key = admin.post(url, json=payload)
    assert missing_key.status_code == 400
    assert "Idempotency-Key" in missing_key.json()["detail"]

    denied = employee.post(url, headers={"Idempotency-Key": "customer-denied"}, json=payload)
    assert denied.status_code == 403

    created = admin.post(url, headers={"Idempotency-Key": "customer-1"}, json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["kind"] == "project_customer_link"
    replay = admin.post(
        url,
        headers={"Idempotency-Key": "customer-2"},
        json={"customer_id": customer.id, "source": "replay"},
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == created.json()["id"]

    issue_asset = admin.post(
        f"/api/ai/intelligence/projects/{project.id}/issue-assets",
        headers={"Idempotency-Key": "issue-asset-1"},
        json={"issue_id": issue.id, "asset_id": asset.id},
    )
    assert issue_asset.status_code == 201, issue_asset.text

    remediation = admin.post(
        f"/api/ai/intelligence/projects/{project.id}/remediations",
        headers={"Idempotency-Key": "remediation-1"},
        json={
            "issue_id": issue.id,
            "asset_id": asset.id,
            "title": "补充修复证据",
            "remediation_uuid": "api-remediation-1",
        },
    )
    assert remediation.status_code == 201, remediation.text
    remediation_id = remediation.json()["id"]

    evidence = admin.post(
        f"/api/ai/intelligence/projects/{project.id}/remediations/{remediation_id}/evidence",
        headers={"Idempotency-Key": "evidence-1"},
        json={
            "evidence_type": "work_artifact",
            "evidence_uuid": "artifact-api-1",
            "source_table": "ai_work_artifacts",
        },
    )
    assert evidence.status_code == 201, evidence.text
    assert evidence.json()["kind"] == "remediation_evidence_link"
