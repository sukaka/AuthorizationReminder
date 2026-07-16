from datetime import datetime

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.notification_service import (
    list_enterprise_notifications,
    mark_enterprise_notification_read,
)
from app.governance_models import AuditLog
from app.models import WorkflowNotificationOutbox
from app.schemas import AuthScope, SessionPayload, UserPayload


def _session(user_id: str, role: str = "employee") -> SessionPayload:
    return SessionPayload(
        user=UserPayload(id=user_id, username=f"user-{user_id}", role=role),
        scope=AuthScope(department="测试部", managed_departments=[]),
        apps=["ai-assistant"],
    )


def _notification(
    owner_user_id: str,
    uuid: str,
    *,
    source: str = "enterprise_insight",
    read_at: datetime | None = None,
    created_at: datetime | None = None,
) -> WorkflowNotificationOutbox:
    return WorkflowNotificationOutbox(
        uuid=uuid,
        owner_user_id=owner_user_id,
        run_id=f"run-{uuid}",
        node_id="enterprise.insight.notify",
        idempotency_key=f"key-{uuid}",
        channel="in_app",
        recipient=owner_user_id,
        payload_json={
            "source": source,
            "insight_uuid": f"insight-{uuid}",
            "title": "交付任务即将超期",
            "summary": "任务需要负责人确认。",
            "severity": "high",
            "project_uuid": "project-a",
            "task_uuid": "task-a",
            "data_cutoff_at": "2026-07-16T08:00:00+00:00",
            "data_version": "project-task-v1",
        },
        status="sent",
        created_at=created_at,
        sent_at=datetime(2026, 7, 16, 8, 1),
        read_at=read_at,
        read_by_user_id=owner_user_id if read_at else None,
    )


def test_notification_service_is_subject_and_source_bound(generation_db) -> None:
    generation_db.add_all(
        [
            _notification("employee-1", "notification-1", created_at=datetime(2026, 7, 16, 8)),
            _notification("employee-1", "notification-other", source="workflow_generic"),
            _notification("employee-2", "notification-2"),
            _notification("employee-1", "notification-read", read_at=datetime(2026, 7, 16, 9), created_at=datetime(2026, 7, 16, 9)),
        ]
    )
    generation_db.commit()

    scope = EnterpriseAccessScope.from_session(_session("employee-1"))
    result = list_enterprise_notifications(generation_db, scope, unread_only=False, limit=20)

    assert result.total == 2
    assert result.unread_count == 1
    assert [item["notification_uuid"] for item in result.items] == [
        "notification-read",
        "notification-1",
    ]
    assert result.items[0]["unread"] is False
    assert result.items[1]["unread"] is True


def test_notification_read_is_idempotent_and_auditable(generation_db) -> None:
    row = _notification("employee-1", "notification-1")
    generation_db.add(row)
    generation_db.commit()
    scope = EnterpriseAccessScope.from_session(_session("employee-1"))

    first, replayed = mark_enterprise_notification_read(
        generation_db,
        scope,
        "notification-1",
    )
    assert replayed is False
    assert first.read_at is not None
    generation_db.commit()

    second, replayed = mark_enterprise_notification_read(
        generation_db,
        scope,
        "notification-1",
    )
    assert replayed is True
    assert second.read_at == first.read_at


def test_notification_routes_enforce_scope_and_idempotent_read(generation_db, client_for_user) -> None:
    generation_db.add(_notification("employee-1", "notification-1"))
    generation_db.commit()

    employee = client_for_user("employee-1", "employee")
    response = employee.get("/api/ai/intelligence/notifications")
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["unread_count"] == 1

    marked = employee.post(
        "/api/ai/intelligence/notifications/notification-1/read",
        headers={"Idempotency-Key": "notification-read-1"},
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["unread"] is False
    replay = employee.post(
        "/api/ai/intelligence/notifications/notification-1/read",
        headers={"Idempotency-Key": "notification-read-2"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True

    audits = generation_db.query(AuditLog).filter(
        AuditLog.action == "enterprise.notification.read",
    ).all()
    assert len(audits) == 2
    assert {audit.entity_uuid for audit in audits} == {"notification-1"}

    external = client_for_user("customer-1", "external_customer")
    assert external.get("/api/ai/intelligence/notifications").status_code == 403

    other = client_for_user("employee-2", "employee")
    assert other.post(
        "/api/ai/intelligence/notifications/notification-1/read",
        headers={"Idempotency-Key": "notification-read-3"},
    ).status_code == 404
