from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.query_plan import (
    QueryPlanIn,
    compile_query_plan,
    execute_query_plan,
    serialize_query_result_csv,
)
from app.project_task_models import ProjectTask
from app.project_workspace_models import Project, ProjectMember
from app.governance_models import AuditLog
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str = "u-1", role: str = "employee") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=f"user-{user_id}", role=role),
            scope=AuthScope(department="交付部", managed_departments=["交付部"]),
            apps=["ai-assistant"],
        )
    )


def _request(*, project_uuids: list[str] | None = None, metrics: list[str] | None = None) -> dict:
    return {
        "intent": "metric_summary",
        "scope": {"project_uuids": project_uuids or [], "department_ids": []},
        "period": {"start": "2026-07-01", "end": "2026-07-16"},
        "metrics": metrics or ["active_project_count"],
        "filters": [],
        "group_by": [],
        "limit": 20,
    }


def test_query_plan_rejects_unknown_metrics_free_sql_and_personal_fields() -> None:
    with pytest.raises(ValueError, match="未知指标"):
        QueryPlanIn.model_validate(_request(metrics=["drop table ai_projects"]))

    with pytest.raises(ValueError, match="不允许的筛选字段"):
        QueryPlanIn.model_validate(
            {
                **_request(),
                "filters": [{"field": "owner_user_id", "op": "eq", "value": "u-1"}],
            }
        )

    with pytest.raises(ValueError, match="不允许的筛选字段"):
        QueryPlanIn.model_validate(
            {
                **_request(),
                "filters": [{"field": "project_id;select", "op": "eq", "value": "1"}],
            }
        )

    with pytest.raises(ValueError):
        QueryPlanIn.model_validate({**_request(), "limit": 101})


def test_query_plan_binds_to_membership_scope_and_rejects_hidden_project(generation_db) -> None:
    visible = Project(name="可见项目", owner_user_id="u-1", created_by="u-1")
    hidden = Project(name="隐藏项目", owner_user_id="u-2", created_by="u-2")
    generation_db.add_all([visible, hidden])
    generation_db.flush()
    generation_db.add_all(
        [
            ProjectMember(project_id=visible.id, user_id="u-1", role="member", invited_by="u-1"),
            ProjectMember(project_id=hidden.id, user_id="u-2", role="member", invited_by="u-2"),
            ProjectTask(
                project_id=visible.id,
                title="逾期任务",
                created_by="u-1",
                status="todo",
                due_at=datetime.now(UTC) - timedelta(days=1),
            ),
        ]
    )
    generation_db.commit()

    plan = compile_query_plan(
        generation_db,
        _scope(),
        _request(project_uuids=[visible.uuid], metrics=["overdue_task_rate"]),
    )
    assert plan.project_uuids == (visible.uuid,)
    assert plan.scope_fingerprint == _scope().scope_fingerprint
    result = execute_query_plan(generation_db, _scope(), plan)
    assert result["rows"][0]["metrics"]["overdue_task_rate"] == 1.0
    assert result["evidence_refs"]

    with pytest.raises(PermissionError, match="访问范围"):
        compile_query_plan(
            generation_db,
            _scope(),
            _request(project_uuids=[hidden.uuid]),
        )


def test_query_plan_supports_health_comparison_with_traceable_rows(generation_db) -> None:
    project = Project(name="健康项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="u-1", role="member", invited_by="u-1"))
    generation_db.commit()

    request = _request(metrics=["project_health_score"])
    request["intent"] = "compare_project_health"
    request["group_by"] = ["project"]
    plan = compile_query_plan(generation_db, _scope(), request)
    result = execute_query_plan(generation_db, _scope(), plan)

    assert result["plan"]["intent"] == "compare_project_health"
    assert result["rows"][0]["group"]["project_uuid"] == project.uuid
    assert result["rows"][0]["evidence_refs"] == [project.uuid]


def test_query_result_csv_is_traceable_and_blocks_formula_injection() -> None:
    payload = serialize_query_result_csv(
        {
            "plan": {
                "period": {"start": "2026-07-01", "end": "2026-07-16"},
                "policy_version": "enterprise-scope-v1",
                "scope_fingerprint": "fingerprint",
                "metrics": ["active_project_count"],
            },
            "rows": [{
                "group": {"project_name": "=恶意项目"},
                "metrics": {"active_project_count": 1},
                "evidence_refs": ["project-a"],
            }],
        }
    ).decode("utf-8")

    assert payload.startswith("\ufeffperiod_start")
    assert "'=恶意项目" in payload
    assert "\r\n" in payload


def test_query_export_returns_csv_and_denies_external_scope(client_for_user, generation_db) -> None:
    project = Project(name="导出项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="u-1", role="member", invited_by="u-1"))
    generation_db.commit()

    body = _request(project_uuids=[project.uuid])
    employee = client_for_user("u-1", "employee")
    external = client_for_user("customer-1", "external_customer")
    response = employee.post("/api/ai/intelligence/management/export", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert project.uuid in response.content.decode("utf-8-sig")
    audit_rows = generation_db.scalars(
        select(AuditLog).where(AuditLog.action == "enterprise.management.export")
    ).all()
    assert audit_rows
    assert audit_rows[-1].metadata_json == {
        "event": "query_exported",
        "record_count": 1,
        "media_type": "text/csv",
        "size_bytes": len(response.content),
    }
    assert "导出项目" not in str(audit_rows[-1].metadata_json)
    assert external.post("/api/ai/intelligence/management/export", json=body).status_code == 403


def test_query_route_returns_compiled_plan_and_denies_external(client_for_user, generation_db) -> None:
    project = Project(name="接口项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="u-1", role="member", invited_by="u-1"))
    generation_db.commit()

    employee = client_for_user("u-1", "employee")
    external = client_for_user("customer-1", "external_customer")
    body = _request(project_uuids=[project.uuid])
    response = employee.post("/api/ai/intelligence/management/query", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["scope_fingerprint"]
    assert payload["rows"][0]["metrics"]["active_project_count"] == 1
    assert external.post("/api/ai/intelligence/management/query", json=body).status_code == 403
