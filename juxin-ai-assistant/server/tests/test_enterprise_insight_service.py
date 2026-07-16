from datetime import UTC, datetime, timedelta

import pytest

from app.enterprise_insight_models import (
    EnterpriseInsight,
    EnterpriseInsightEvidence,
    EnterpriseRecommendation,
)
from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.insight_service import (
    acknowledge_insight,
    approve_recommendation_action,
    bind_recommendation_workflow_run,
    detect_overdue_task_insights,
    propose_recommendation,
    queue_recommendation_workflow_event,
    record_recommendation_result,
)
from app.enterprise_intelligence.insight_scan import scan_overdue_insights
from app.enterprise_intelligence_models import EnterpriseOrganization
from app.project_task_models import ProjectTask
from app.project_workspace_models import Project, ProjectMember
from app.models import WorkflowNotificationOutbox
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str, role: str = "admin", department: str = "交付部") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=user_id, role=role),
            scope=AuthScope(department=department),
            apps=["ai-assistant"],
        )
    )


def _manager_scope(user_id: str, department: str = "交付部") -> EnterpriseAccessScope:
    return EnterpriseAccessScope(
        user_id=user_id,
        username=user_id,
        role="manager",
        department=department,
        managed_departments=(department,),
        is_admin=False,
        is_external=False,
        capabilities=frozenset({"assistant:use", "intelligence:view", "intelligence:manage"}),
    )


def _project(db, organization_id: int, name: str) -> Project:
    row = Project(name=name, owner_user_id="employee-1", created_by="employee-1", organization_id=organization_id)
    db.add(row)
    db.flush()
    return row


def test_overdue_detection_is_scope_bound_and_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="insight-org", name="洞察组织")
    generation_db.add(organization)
    generation_db.flush()
    visible = _project(generation_db, organization.id, "交付项目")
    hidden = _project(generation_db, organization.id, "隐藏项目")
    generation_db.add(ProjectMember(project_id=visible.id, user_id="employee-1", role="member", status="active"))
    now = datetime.now(UTC).replace(tzinfo=None)
    generation_db.add_all(
        [
            ProjectTask(
                project_id=visible.id,
                title="逾期任务",
                status="todo",
                priority="high",
                due_at=now - timedelta(hours=2),
                created_by="employee-1",
            ),
            ProjectTask(
                project_id=hidden.id,
                title="隐藏逾期任务",
                status="todo",
                priority="normal",
                due_at=now - timedelta(hours=2),
                created_by="employee-2",
            ),
        ]
    )
    generation_db.flush()

    first = detect_overdue_task_insights(generation_db, _scope("admin-1"), organization.id, cutoff=now)
    second = detect_overdue_task_insights(generation_db, _scope("admin-1"), organization.id, cutoff=now)
    assert len(first) == 2
    assert [row.id for row in second] == [row.id for row in first]
    assert generation_db.query(EnterpriseInsight).count() == 2
    assert generation_db.query(EnterpriseInsightEvidence).count() == 2

    employee_rows = detect_overdue_task_insights(
        generation_db,
        _manager_scope("employee-1"),
        organization.id,
        cutoff=now,
    )
    assert len(employee_rows) == 1
    assert employee_rows[0].project_id == visible.id

    with pytest.raises(PermissionError, match="管理权限"):
        acknowledge_insight(generation_db, _scope("employee-1", "employee"), first[0].uuid)


def test_overdue_scan_enqueues_one_durable_notification_per_visible_task(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="scan-org", name="扫描组织")
    generation_db.add(organization)
    generation_db.flush()
    project = _project(generation_db, organization.id, "扫描项目")
    now = datetime.now(UTC).replace(tzinfo=None)
    task = ProjectTask(
        project_id=project.id,
        title="待通知逾期任务",
        status="todo",
        priority="high",
        due_at=now - timedelta(hours=1),
        created_by="admin-1",
    )
    generation_db.add(task)
    generation_db.flush()

    first = scan_overdue_insights(
        generation_db,
        _scope("admin-1"),
        organization.id,
        cutoff=now,
    )
    assert first.notifications_enqueued == 1
    assert first.notifications_replayed == 0
    assert len(first.notifications) == 1
    notification = first.notifications[0]
    assert notification.channel == "in_app"
    assert notification.recipient == "admin-1"
    assert notification.payload_json["task_uuid"] == task.uuid
    assert generation_db.query(WorkflowNotificationOutbox).count() == 1

    # A later evidence snapshot is allowed, but the task-level notification
    # identity replays the existing outbox row instead of creating a duplicate.
    second = scan_overdue_insights(
        generation_db,
        _scope("admin-1"),
        organization.id,
        cutoff=now + timedelta(minutes=1),
    )
    assert second.notifications_enqueued == 0
    assert second.notifications_replayed == 1
    assert second.notifications[0].uuid == notification.uuid
    assert generation_db.query(WorkflowNotificationOutbox).count() == 1


def test_recommendation_action_requires_approval_and_is_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="recommendation-org", name="建议组织")
    generation_db.add(organization)
    generation_db.flush()
    project = _project(generation_db, organization.id, "建议项目")
    now = datetime.now(UTC).replace(tzinfo=None)
    generation_db.add(
        ProjectTask(
            project_id=project.id,
            title="逾期任务",
            status="todo",
            priority="high",
            due_at=now - timedelta(hours=1),
            created_by="employee-1",
        )
    )
    generation_db.flush()
    insight = detect_overdue_task_insights(generation_db, _scope("admin-1"), organization.id, cutoff=now)[0]

    acknowledged = acknowledge_insight(generation_db, _scope("admin-1"), insight.uuid, feedback="已确认")
    assert acknowledged.status == "acknowledged"
    recommendation, action = propose_recommendation(
        generation_db,
        _scope("admin-1"),
        insight.uuid,
        recommendation_type="notify_owner",
        title="通知任务负责人",
        payload={"task_uuid": "task-1", "workflow_id": "demo-workflow"},
        risk_level="medium",
        idempotency_key="recommendation-1",
    )
    same, same_action = propose_recommendation(
        generation_db,
        _scope("admin-2"),
        insight.uuid,
        recommendation_type="notify_owner",
        title="通知任务负责人",
        payload={"task_uuid": "task-1", "workflow_id": "demo-workflow"},
        risk_level="medium",
        idempotency_key="recommendation-1",
    )
    assert same.id == recommendation.id
    assert same_action.id == action.id
    assert action.status == "pending_approval"
    assert generation_db.query(EnterpriseRecommendation).count() == 1

    with pytest.raises(ValueError, match="不同建议"):
        propose_recommendation(
            generation_db,
            _scope("admin-1"),
            insight.uuid,
            recommendation_type="notify_owner",
            title="不同标题",
            payload={"task_uuid": "task-1", "workflow_id": "demo-workflow"},
            risk_level="medium",
            idempotency_key="recommendation-1",
        )

    with pytest.raises(PermissionError, match="执行权限"):
        approve_recommendation_action(generation_db, _manager_scope("employee-1"), recommendation.uuid)
    approved = approve_recommendation_action(generation_db, _scope("admin-1"), recommendation.uuid)
    assert approved.status == "approved"
    approved_retry = approve_recommendation_action(generation_db, _scope("admin-1"), recommendation.uuid)
    assert approved_retry.id == approved.id
    assert approved_retry.row_version == approved.row_version

    event, replayed = queue_recommendation_workflow_event(
        generation_db,
        _scope("admin-1"),
        recommendation.uuid,
        idempotency_key="dispatch-1",
    )
    assert replayed is False
    assert event.event_type == "enterprise.recommendation.action"
    assert event.workflow_id == "demo-workflow"
    assert event.status == "pending"
    assert action.status == "queued"
    assert recommendation.status == "queued"
    event_retry, replayed_retry = queue_recommendation_workflow_event(
        generation_db,
        _scope("admin-1"),
        recommendation.uuid,
        idempotency_key="dispatch-1",
    )
    assert replayed_retry is True
    assert event_retry.uuid == event.uuid
    with pytest.raises(ValueError, match="幂等键冲突"):
        queue_recommendation_workflow_event(
            generation_db,
            _scope("admin-1"),
            recommendation.uuid,
            idempotency_key="dispatch-2",
        )

    assert bind_recommendation_workflow_run(
        generation_db,
        event.payload_json,
        "run-recommendation-1",
    ) is True
    assert recommendation.workflow_run_id == "run-recommendation-1"
    assert bind_recommendation_workflow_run(
        generation_db,
        event.payload_json,
        "run-recommendation-1",
    ) is False
    with pytest.raises(ValueError, match="其他 workflow run"):
        bind_recommendation_workflow_run(
            generation_db,
            event.payload_json,
            "run-recommendation-2",
        )

    result = record_recommendation_result(
        generation_db,
        _scope("admin-1"),
        recommendation.uuid,
        status="reconciliation_required",
        result={"provider": "not-confirmed"},
    )
    assert result.reconciliation_status == "required"
    assert result.status == "reconciliation_required"
    result_retry = record_recommendation_result(
        generation_db,
        _scope("admin-1"),
        recommendation.uuid,
        status="reconciliation_required",
        result={"provider": "not-confirmed"},
    )
    assert result_retry.id == result.id
    with pytest.raises(ValueError, match="不同的结果"):
        record_recommendation_result(
            generation_db,
            _scope("admin-1"),
            recommendation.uuid,
            status="reconciliation_required",
            result={"provider": "different"},
        )
