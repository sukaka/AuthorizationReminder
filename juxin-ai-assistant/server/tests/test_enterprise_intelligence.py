from __future__ import annotations

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.audit_service import (
    EnterpriseAuditFilters,
    query_enterprise_audit_logs,
)
from app.enterprise_intelligence.service import (
    build_enterprise_data_quality_report,
    build_enterprise_overview,
    build_enterprise_operation_summary,
    list_enterprise_organizations,
)
from app.enterprise_business_lineage_models import ProjectRemediation
from app.enterprise_intelligence_models import EnterpriseOrganization
from app.models import WorkArtifact
from app.governance_models import AuditLog
from app.project_initialization_models import ProjectContract, ProjectServiceScope
from app.project_task_models import ProjectDeliverable, ProjectIssue, ProjectTask
from app.project_workspace_models import Project, ProjectMember
from datetime import UTC, datetime, timedelta

from app.schemas import AuthScope, SessionPayload, UserPayload


def _session(user_id: str, role: str, *, department: str = "交付部") -> SessionPayload:
    return SessionPayload(
        user=UserPayload(id=user_id, username=f"user-{user_id}", role=role),
        scope=AuthScope(department=department, managed_departments=[department]),
        apps=["ai-assistant"],
    )


def test_enterprise_scope_denies_external_and_keeps_fingerprint_subject_bound() -> None:
    employee = EnterpriseAccessScope.from_session(_session("u-1", "employee"))
    external = EnterpriseAccessScope.from_session(
        _session("customer-1", "external_customer"),
    )
    admin = EnterpriseAccessScope.from_session(_session("admin-1", "admin"))

    assert employee.can("intelligence:view") is True
    assert external.can("intelligence:view") is False
    assert admin.can("intelligence:manage") is True
    assert employee.scope_fingerprint != EnterpriseAccessScope.from_session(
        _session("u-2", "employee")
    ).scope_fingerprint


def test_enterprise_organization_selector_route_is_role_and_scope_bound(
    generation_db,
    client_for_user,
) -> None:
    visible = EnterpriseOrganization(external_id="selector-visible", name="可选组织")
    empty = EnterpriseOrganization(external_id="selector-empty", name="空组织")
    generation_db.add_all([visible, empty])
    generation_db.flush()
    project = Project(
        name="组织项目",
        owner_user_id="admin-1",
        created_by="admin-1",
        organization_id=visible.id,
        status="active",
    )
    inactive = Project(
        name="已归档项目",
        owner_user_id="admin-1",
        created_by="admin-1",
        organization_id=empty.id,
        status="archived",
    )
    generation_db.add_all([project, inactive])
    generation_db.flush()
    generation_db.add(
        ProjectMember(
            project_id=project.id,
            user_id="employee-1",
            role="member",
            status="active",
        )
    )
    generation_db.commit()

    employee = client_for_user("employee-1", "employee")
    assert employee.get("/api/ai/intelligence/organizations").status_code == 403

    admin = client_for_user("admin-1", "admin")
    response = admin.get("/api/ai/intelligence/organizations")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {
                "id": visible.id,
                "uuid": visible.uuid,
                "external_id": "selector-visible",
                "name": "可选组织",
                "status": "active",
                "project_count": 1,
            },
            {
                "id": empty.id,
                "uuid": empty.uuid,
                "external_id": "selector-empty",
                "name": "空组织",
                "status": "active",
                "project_count": 0,
            },
        ]
    }


def test_enterprise_audit_query_is_prefix_filtered_and_subject_bound(generation_db) -> None:
    generation_db.add_all(
        [
            AuditLog(
                sso_user_id="employee-1",
                username_snapshot="employee",
                action="enterprise.capability_evaluation.create",
                entity_type="enterprise_capability_evaluation",
                entity_uuid="evaluation-1",
                result="SUCCESS",
                metadata_json={"sample_size": 10},
            ),
            AuditLog(
                sso_user_id="employee-2",
                username_snapshot="other",
                action="enterprise.optimization_proposal.create",
                entity_type="enterprise_optimization_proposal",
                entity_uuid="proposal-1",
                result="SUCCESS",
                metadata_json={"secret": "must-not-leak"},
            ),
            AuditLog(
                sso_user_id="employee-1",
                username_snapshot="employee",
                action="admin.user.read",
                entity_type="user",
                entity_uuid="user-1",
                result="SUCCESS",
            ),
        ]
    )
    generation_db.commit()

    employee = EnterpriseAccessScope.from_session(_session("employee-1", "employee"))
    employee_logs = query_enterprise_audit_logs(
        generation_db,
        employee,
        EnterpriseAuditFilters(),
        offset=0,
        limit=20,
    )
    assert employee_logs.total == 1
    assert employee_logs.items[0].action == "enterprise.capability_evaluation.create"

    admin = EnterpriseAccessScope.from_session(_session("admin-1", "admin"))
    admin_logs = query_enterprise_audit_logs(
        generation_db,
        admin,
        EnterpriseAuditFilters(action="enterprise.optimization_proposal.create"),
        offset=0,
        limit=20,
    )
    assert admin_logs.total == 1
    assert admin_logs.items[0].entity_uuid == "proposal-1"

    try:
        query_enterprise_audit_logs(
            generation_db,
            admin,
            EnterpriseAuditFilters(action="admin.user.read"),
            offset=0,
            limit=20,
        )
    except ValueError as exc:
        assert "enterprise.*" in str(exc)
    else:
        raise AssertionError("non-enterprise action must be rejected")


def test_enterprise_audit_query_route_is_scoped_and_paginated(
    generation_db,
    client_for_user,
) -> None:
    generation_db.add_all(
        [
            AuditLog(
                sso_user_id="employee-1",
                username_snapshot="employee",
                action="enterprise.insights.scan_overdue",
                entity_type="enterprise_insight_scan",
                entity_uuid="scan-1",
                result="SUCCESS",
            ),
            AuditLog(
                sso_user_id="employee-2",
                username_snapshot="other",
                action="enterprise.insights.scan_overdue",
                entity_type="enterprise_insight_scan",
                entity_uuid="scan-2",
                result="SUCCESS",
            ),
        ]
    )
    generation_db.commit()

    employee = client_for_user("employee-1", "employee")
    assert employee.get("/api/ai/intelligence/audit-logs?limit=1").status_code == 403

    admin = client_for_user("admin-1", "admin")
    response = admin.get("/api/ai/intelligence/audit-logs?limit=1")
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2

    assert admin.get("/api/ai/intelligence/audit-logs?action=admin.user.read").status_code == 400


def test_enterprise_overview_only_counts_projects_in_membership_scope(generation_db) -> None:
    visible = Project(name="可见项目", owner_user_id="u-1", created_by="u-1")
    hidden = Project(name="不可见项目", owner_user_id="u-2", created_by="u-2")
    generation_db.add_all([visible, hidden])
    generation_db.flush()
    generation_db.add_all([
        ProjectMember(
            project_id=visible.id,
            user_id="u-1",
            role="member",
            invited_by="u-1",
        ),
        ProjectMember(
            project_id=hidden.id,
            user_id="u-2",
            role="project_lead",
            invited_by="u-2",
        ),
        ProjectTask(
            project_id=visible.id,
            title="任务",
            created_by="u-1",
            status="doing",
            due_at=datetime.now(UTC) - timedelta(days=1),
        ),
        ProjectDeliverable(
            project_id=visible.id,
            title="交付物",
            created_by="u-1",
            status="review",
        ),
        ProjectIssue(
            project_id=visible.id,
            title="问题",
            created_by="u-1",
            status="open",
        ),
        WorkArtifact(
            owner_user_id="u-1",
            title="成果",
            artifact_type="report",
            project_id=visible.id,
            created_by="u-1",
            lifecycle_status="draft",
        ),
    ])
    generation_db.commit()

    overview = build_enterprise_overview(
        generation_db,
        EnterpriseAccessScope.from_session(_session("u-1", "employee")),
    )

    assert overview["scope"]["project_count"] == 1
    assert overview["scope"]["project_uuids"] == [visible.uuid]
    assert overview["metrics"] == {
        "projects": 1,
        "tasks": 1,
        "deliverables": 1,
        "open_issues": 1,
        "artifacts": 1,
    }
    assert overview["data_quality"]["status"] == "partial"
    assert "organization_master_data" in overview["data_quality"]["gaps"]

    snapshots = {item["metric_code"]: item for item in overview["metric_snapshots"]}
    overdue = snapshots["overdue_task_rate"]
    assert overdue["numerator"] == 1
    assert overdue["denominator"] == 1
    assert overdue["value"] == 1.0
    assert overdue["definition_version"] == "1.0.0"
    assert overdue["scope_fingerprint"] == overview["scope"]["scope_fingerprint"]
    assert overdue["evidence_refs"] == [visible.uuid]

    health = overview["project_health"]
    assert len(health) == 1
    assert health[0]["project_uuid"] == visible.uuid
    assert health[0]["status"] == "data_incomplete"
    assert health[0]["confidence"] < 0.8
    assert any(item["code"] == "OVERDUE_TASK" for item in health[0]["deductions"])


def test_enterprise_organization_selector_is_scoped_and_counts_active_projects(generation_db) -> None:
    visible_org = EnterpriseOrganization(external_id="selector-visible", name="可见组织")
    hidden_org = EnterpriseOrganization(external_id="selector-hidden", name="隐藏组织")
    empty_org = EnterpriseOrganization(external_id="selector-empty", name="空组织")
    generation_db.add_all([visible_org, hidden_org, empty_org])
    generation_db.flush()
    visible = Project(
        name="可见组织项目",
        owner_user_id="u-1",
        created_by="u-1",
        organization_id=visible_org.id,
    )
    inactive = Project(
        name="已停用项目",
        owner_user_id="u-1",
        created_by="u-1",
        organization_id=visible_org.id,
        status="archived",
    )
    hidden = Project(
        name="隐藏组织项目",
        owner_user_id="u-2",
        created_by="u-2",
        organization_id=hidden_org.id,
    )
    generation_db.add_all([visible, inactive, hidden])
    generation_db.flush()
    generation_db.add_all([
        ProjectMember(project_id=visible.id, user_id="u-1", role="member", invited_by="u-1"),
        ProjectMember(project_id=hidden.id, user_id="u-2", role="member", invited_by="u-2"),
    ])
    generation_db.commit()

    employee_items = list_enterprise_organizations(
        generation_db,
        EnterpriseAccessScope.from_session(_session("u-1", "employee")),
    )
    assert [(item["external_id"], item["project_count"]) for item in employee_items] == [
        ("selector-visible", 1),
    ]

    admin_items = list_enterprise_organizations(
        generation_db,
        EnterpriseAccessScope.from_session(_session("admin-1", "admin")),
    )
    assert {
        item["external_id"]: item["project_count"]
        for item in admin_items
    } == {
        "selector-empty": 0,
        "selector-hidden": 1,
        "selector-visible": 1,
    }


def test_enterprise_overview_scope_is_explicitly_denied_for_external() -> None:
    scope = EnterpriseAccessScope.from_session(
        _session("customer-1", "external_customer"),
    )
    assert scope.can("intelligence:view") is False


def test_enterprise_operation_summary_reports_scoped_attention_items(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="operation-summary-org", name="运营汇总组织")
    generation_db.add(organization)
    generation_db.flush()
    visible = Project(name="运营汇总项目", owner_user_id="u-1", created_by="u-1")
    hidden = Project(name="隐藏运营项目", owner_user_id="u-2", created_by="u-2")
    generation_db.add_all([visible, hidden])
    generation_db.flush()
    high_issue = ProjectIssue(
        project_id=visible.id,
        title="高危问题",
        created_by="u-1",
        status="open",
        severity="high",
    )
    generation_db.add(high_issue)
    generation_db.flush()
    generation_db.add_all(
        [
            ProjectMember(project_id=visible.id, user_id="u-1", role="member", invited_by="u-1"),
            ProjectMember(project_id=hidden.id, user_id="u-2", role="member", invited_by="u-2"),
            ProjectContract(project_id=visible.id, name="运营合同", status="active"),
            ProjectServiceScope(
                project_id=visible.id,
                name="已确认服务",
                confirmation_status="confirmed",
                status="active",
            ),
            ProjectTask(
                project_id=visible.id,
                title="逾期任务",
                created_by="u-1",
                status="doing",
                due_at=datetime.now(UTC) - timedelta(days=1),
            ),
            ProjectRemediation(
                organization_id=organization.id,
                project_id=visible.id,
                issue_id=high_issue.id,
                title="未完成整改",
                status="open",
                due_at=datetime.now(UTC) - timedelta(hours=2),
            ),
            ProjectTask(
                project_id=hidden.id,
                title="隐藏逾期任务",
                created_by="u-2",
                status="todo",
                due_at=datetime.now(UTC) - timedelta(days=2),
            ),
        ]
    )
    generation_db.commit()

    summary = build_enterprise_operation_summary(
        generation_db,
        EnterpriseAccessScope.from_session(_session("u-1", "employee")),
        cutoff=datetime.now(UTC),
    )

    assert summary["scope"]["project_uuids"] == [visible.uuid]
    assert summary["contracts"] == {"total": 1, "confirmed": 0, "pending_confirmation": 1}
    assert summary["services"]["confirmed"] == 1
    assert summary["services"]["missing_occurrences"] == 1
    assert summary["tasks"]["overdue"] == 1
    assert summary["issues"]["open_high_or_critical"] == 1
    assert {item["type"] for item in summary["attention_items"]} >= {
        "overdue_task",
        "service_occurrence_missing",
        "open_high_issue",
    }
    assert all(item["project_uuid"] == visible.uuid for item in summary["attention_items"])


def test_enterprise_operation_summary_route_has_stable_contract(client_for_user) -> None:
    response = client_for_user("u-1", "employee").get(
        "/api/ai/intelligence/operation-summary"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {
        "scope",
        "as_of",
        "contracts",
        "services",
        "tasks",
        "deliverables",
        "issues",
        "automation",
        "attention_items",
    }
    assert set(payload["attention_items"][0]) if payload["attention_items"] else {
        "type",
        "severity",
        "title",
        "summary",
        "project_uuid",
        "project_name",
        "evidence_refs",
        "status",
    }


def test_enterprise_overview_route_exposes_contract_and_denies_external(client_for_user) -> None:
    employee = client_for_user("u-1", "employee")
    external = client_for_user("customer-1", "external_customer")

    response = employee.get("/api/ai/intelligence/overview")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {
        "scope",
        "metrics",
        "metric_snapshots",
        "project_health",
        "freshness",
        "data_quality",
    }
    assert payload["scope"]["user_id"] == "u-1"
    assert payload["freshness"]["mode"] == "live_query"
    assert external.get("/api/ai/intelligence/overview").status_code == 403


def test_enterprise_data_quality_report_is_scoped_and_never_auto_resolves(generation_db) -> None:
    visible = Project(name="待治理项目", owner_user_id="u-1", created_by="u-1")
    hidden = Project(name="隐藏项目", owner_user_id="u-2", created_by="u-2")
    generation_db.add_all([visible, hidden])
    generation_db.flush()
    generation_db.add_all(
        [
            ProjectMember(
                project_id=visible.id,
                user_id="u-1",
                role="member",
                invited_by="u-1",
            ),
            ProjectMember(
                project_id=hidden.id,
                user_id="u-2",
                role="member",
                invited_by="u-2",
            ),
            ProjectContract(
                project_id=visible.id,
                name="客户合同",
                customer_name="待确认客户",
            ),
            ProjectServiceScope(
                project_id=visible.id,
                name="季度扫描",
                confirmation_status="confirmed",
            ),
        ]
    )
    generation_db.commit()

    report = build_enterprise_data_quality_report(
        generation_db,
        EnterpriseAccessScope.from_session(_session("u-1", "employee")),
    )

    assert report["summary"]["entities_scanned"] == 3
    assert report["summary"]["unresolved_count"] == 7
    assert report["status"] == "partial"
    assert {item["project_uuid"] for item in report["issues"]} == {visible.uuid}
    assert "CONTRACT_CUSTOMER_UNRESOLVED" in {item["code"] for item in report["issues"]}
    assert "SERVICE_OCCURRENCE_MISSING" in {item["code"] for item in report["issues"]}
    assert all(item["resolution"] == "manual_review" for item in report["issues"])


def test_enterprise_data_quality_route_returns_report_contract(client_for_user) -> None:
    response = client_for_user("u-1", "employee").get(
        "/api/ai/intelligence/data-quality"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"status", "as_of", "scope_fingerprint", "summary", "issues"}
    assert set(payload["summary"]) == {
        "entities_scanned",
        "unresolved_count",
        "completeness",
    }


def test_enterprise_insight_routes_expose_evidence_and_approval_gate(
    generation_db,
    client_for_user,
) -> None:
    from app.enterprise_intelligence_models import EnterpriseOrganization

    organization = EnterpriseOrganization(external_id="insight-route-org", name="洞察接口组织")
    generation_db.add(organization)
    generation_db.flush()
    project = Project(name="洞察接口项目", owner_user_id="admin-1", created_by="admin-1", organization_id=organization.id)
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="employee-1", role="member", status="active"))
    generation_db.add(
        ProjectTask(
            project_id=project.id,
            title="接口逾期任务",
            created_by="admin-1",
            status="todo",
            priority="high",
            due_at=datetime.now(UTC) - timedelta(hours=1),
        )
    )
    generation_db.commit()

    admin = client_for_user("admin-1", "admin")
    employee = client_for_user("employee-1", "employee")
    detect = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/detect-overdue",
        json={"cutoff": datetime.now(UTC).isoformat()},
    )
    assert detect.status_code == 200, detect.text
    insight = detect.json()["items"][0]
    assert insight["evidence_refs"]
    assert employee.get("/api/ai/intelligence/insights").json()["items"][0]["uuid"] == insight["uuid"]

    scan_cutoff = datetime.now(UTC).isoformat()
    scan = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/scan-overdue",
        headers={"Idempotency-Key": "route-insight-scan-1"},
        json={"cutoff": scan_cutoff},
    )
    assert scan.status_code == 202, scan.text
    scan_payload = scan.json()
    assert scan_payload["detected_count"] == 1
    assert scan_payload["notifications_enqueued"] == 1
    assert scan_payload["notifications_replayed"] == 0
    assert len(scan_payload["notification_uuids"]) == 1
    scan_retry = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/scan-overdue",
        headers={"Idempotency-Key": "route-insight-scan-2"},
        json={"cutoff": scan_cutoff},
    )
    assert scan_retry.status_code == 202, scan_retry.text
    assert scan_retry.json()["notifications_enqueued"] == 0
    assert scan_retry.json()["notifications_replayed"] == 1

    missing_schedule_key = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/schedules",
        json={
            "name": "每日洞察扫描（缺少幂等键）",
            "cron_expression": "0 11 * * *",
            "timezone": "Asia/Shanghai",
            "source_version": "route-scan-v1",
        },
    )
    assert missing_schedule_key.status_code == 400
    assert missing_schedule_key.json()["detail"] == "缺少或无效的 Idempotency-Key"

    schedule = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/schedules",
        headers={"Idempotency-Key": "route-insight-schedule-1"},
        json={
            "name": "每日洞察扫描",
            "cron_expression": "0 9 * * *",
            "timezone": "Asia/Shanghai",
            "source_version": "route-scan-v1",
        },
    )
    assert schedule.status_code == 201, schedule.text
    schedule_payload = schedule.json()
    assert schedule_payload["workflow_id"] == "__enterprise_insight_scan__"
    assert schedule_payload["organization_id"] == organization.id
    assert schedule_payload["source_version"] == "route-scan-v1"
    assert schedule_payload["scope_fingerprint"] == admin.get(
        "/api/ai/intelligence/overview"
    ).json()["scope"]["scope_fingerprint"]
    schedule_retry = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/schedules",
        headers={"Idempotency-Key": "route-insight-schedule-1"},
        json={
            "name": "每日洞察扫描",
            "cron_expression": "0 9 * * *",
            "timezone": "Asia/Shanghai",
            "source_version": "route-scan-v1",
        },
    )
    assert schedule_retry.status_code == 201, schedule_retry.text
    assert schedule_retry.json()["schedule_uuid"] == schedule_payload["schedule_uuid"]
    schedule_conflict = admin.post(
        f"/api/ai/intelligence/organizations/{organization.id}/insights/schedules",
        headers={"Idempotency-Key": "route-insight-schedule-1"},
        json={
            "name": "每日洞察扫描",
            "cron_expression": "0 10 * * *",
            "timezone": "Asia/Shanghai",
            "source_version": "route-scan-v1",
        },
    )
    assert schedule_conflict.status_code == 400
    assert schedule_conflict.json()["detail"] == "idempotency_key_conflict"

    assert employee.post(
        f"/api/ai/intelligence/insights/{insight['uuid']}/acknowledge",
        json={"feedback": "员工不能管理"},
    ).status_code == 403
    acknowledged = admin.post(
        f"/api/ai/intelligence/insights/{insight['uuid']}/acknowledge",
        json={"feedback": "已确认"},
    )
    assert acknowledged.status_code == 200
    assert acknowledged.json()["status"] == "acknowledged"

    recommendation_url = f"/api/ai/intelligence/insights/{insight['uuid']}/recommendations"
    assert admin.post(recommendation_url, json={"recommendation_type": "notify_owner", "title": "通知负责人"}).status_code == 400
    proposed = admin.post(
        recommendation_url,
        headers={"Idempotency-Key": "route-recommendation-1"},
        json={
            "recommendation_type": "notify_owner",
            "title": "通知负责人",
            "risk_level": "medium",
            "payload": {"workflow_id": "demo-workflow"},
        },
    )
    assert proposed.status_code == 201, proposed.text
    recommendation = proposed.json()
    assert recommendation["action"]["status"] == "pending_approval"

    approved = admin.post(
        f"/api/ai/intelligence/recommendations/{recommendation['uuid']}/approve",
        headers={"Idempotency-Key": "route-approval-1"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["action"]["status"] == "approved"
    dispatched = admin.post(
        f"/api/ai/intelligence/recommendations/{recommendation['uuid']}/dispatch",
        headers={"Idempotency-Key": "route-dispatch-1"},
    )
    assert dispatched.status_code == 202, dispatched.text
    dispatch_payload = dispatched.json()
    assert dispatch_payload["workflow_id"] == "demo-workflow"
    assert dispatch_payload["status"] == "pending"
    assert dispatch_payload["replayed"] is False
    replayed_dispatch = admin.post(
        f"/api/ai/intelligence/recommendations/{recommendation['uuid']}/dispatch",
        headers={"Idempotency-Key": "route-dispatch-1"},
    )
    assert replayed_dispatch.status_code == 202, replayed_dispatch.text
    assert replayed_dispatch.json()["replayed"] is True
    assert replayed_dispatch.json()["event_uuid"] == dispatch_payload["event_uuid"]
    result = admin.post(
        f"/api/ai/intelligence/recommendations/{recommendation['uuid']}/result",
        json={"status": "succeeded", "result": {"sent": True}},
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "succeeded"
