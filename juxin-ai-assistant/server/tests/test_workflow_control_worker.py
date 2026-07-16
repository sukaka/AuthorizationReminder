from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.config import get_settings
from app.enterprise_insight_models import EnterpriseRecommendation
from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.insight_service import (
    acknowledge_insight,
    approve_recommendation_action,
    detect_overdue_task_insights,
    propose_recommendation,
    queue_recommendation_workflow_event,
)
from app.enterprise_intelligence_models import EnterpriseOrganization
from app.project_task_models import ProjectTask
from app.project_workspace_models import Project
from app.schemas import AuthScope, SessionPayload, UserPayload
from app.workflow_control import claim_trigger_event, enqueue_notification, enqueue_trigger_event
from app.workflow_control_worker import MAX_CATCH_UP_FIRES, WorkflowControlWorker


def _admin_scope(user_id: str = "admin-1") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=user_id, role="admin"),
            scope=AuthScope(department="交付部"),
            apps=["ai-assistant"],
        )
    )


def _fake_runtime(monkeypatch):
    calls: list[dict] = []

    def find_idempotent_run(*_args, **_kwargs):
        return None

    def start_and_run(self, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status="succeeded"), SimpleNamespace(uuid=f"run-{len(calls)}")

    monkeypatch.setattr(
        "app.workflow_control_worker.WorkflowRunService.find_idempotent_run",
        staticmethod(find_idempotent_run),
    )
    monkeypatch.setattr("app.workflow_control_worker.WorkflowRunService.start_and_run", start_and_run)
    return calls


def test_worker_tick_dispatches_due_schedule_once_and_advances_fire(generation_db, monkeypatch):
    from app.workflow_control import create_schedule

    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        name="本地调度",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(seconds=1),
    )
    generation_db.commit()

    worker = WorkflowControlWorker(get_settings(), worker_id="worker-a")
    first = worker.tick(generation_db, now=now)
    assert first.schedules_claimed == 1
    assert first.schedules_dispatched == 1
    assert first.schedules_failed == 0
    assert len(calls) == 1
    generation_db.refresh(schedule)
    assert schedule.lease_owner == ""
    assert schedule.next_fire_at == now.replace(second=0, microsecond=0) + timedelta(minutes=1)

    second = worker.tick(generation_db, now=now)
    assert second.schedules_claimed == 0
    assert len(calls) == 1


def test_worker_schedule_misfire_skip_advances_without_running(generation_db, monkeypatch):
    from app.workflow_control import create_schedule

    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        name="跳过过期调度",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(minutes=5),
        misfire_policy="skip",
    )
    generation_db.commit()

    result = WorkflowControlWorker(get_settings(), worker_id="worker-skip").tick(
        generation_db, now=now
    )
    assert result.schedules_claimed == 1
    assert result.schedules_dispatched == 0
    assert result.schedules_skipped == 1
    assert calls == []
    generation_db.refresh(schedule)
    assert schedule.next_fire_at == now.replace(second=0, microsecond=0) + timedelta(minutes=1)


def test_worker_schedule_misfire_fire_once_runs_oldest_and_skips_backlog(
    generation_db, monkeypatch
):
    from app.workflow_control import create_schedule

    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    scheduled = now - timedelta(minutes=5)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        name="单次补偿调度",
        cron_expression="* * * * *",
        next_fire_at=scheduled,
        misfire_policy="fire_once",
    )
    generation_db.commit()

    result = WorkflowControlWorker(get_settings(), worker_id="worker-once").tick(
        generation_db, now=now
    )
    assert result.schedules_dispatched == 1
    assert result.schedules_skipped == 0
    assert len(calls) == 1
    assert calls[0]["routing_summary"]["scheduled_fire_at"] == scheduled.isoformat()
    generation_db.refresh(schedule)
    assert schedule.next_fire_at == now.replace(second=0, microsecond=0) + timedelta(minutes=1)


def test_worker_schedule_misfire_catch_up_runs_each_occurrence(generation_db, monkeypatch):
    from app.workflow_control import create_schedule

    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        name="补偿调度",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(minutes=3),
        misfire_policy="catch_up",
    )
    generation_db.commit()

    result = WorkflowControlWorker(get_settings(), worker_id="worker-catch-up").tick(
        generation_db, now=now
    )
    assert result.schedules_dispatched == 1
    assert result.schedules_skipped == 0
    assert len(calls) == 4  # 00:57, 00:58, 00:59 and the 01:00 occurrence.
    assert [
        call["routing_summary"]["scheduled_fire_at"] for call in calls
    ] == [
        (now - timedelta(minutes=offset)).isoformat() for offset in (3, 2, 1, 0)
    ]
    generation_db.refresh(schedule)
    assert schedule.next_fire_at == now.replace(second=0, microsecond=0) + timedelta(minutes=1)


def test_worker_schedule_catch_up_is_bounded_and_leaves_due_cursor(generation_db, monkeypatch):
    from app.workflow_control import create_schedule

    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        name="有上限的补偿调度",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(minutes=30),
        misfire_policy="catch_up",
    )
    generation_db.commit()

    result = WorkflowControlWorker(get_settings(), worker_id="worker-catch-up-cap").tick(
        generation_db, now=now
    )
    assert result.schedules_dispatched == 1
    assert len(calls) == MAX_CATCH_UP_FIRES
    generation_db.refresh(schedule)
    assert schedule.next_fire_at <= now


def test_worker_dispatches_enterprise_insight_scan_with_frozen_scope(generation_db, monkeypatch):
    from app.enterprise_intelligence.insight_scan import create_insight_scan_schedule

    organization = EnterpriseOrganization(external_id="scheduled-scan-org", name="周期扫描组织")
    generation_db.add(organization)
    generation_db.flush()
    scope = _admin_scope("scan-admin")
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_insight_scan_schedule(
        generation_db,
        scope,
        organization.id,
        name="每日洞察扫描",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(seconds=1),
    )
    generation_db.commit()

    calls: list[dict] = []

    def fake_scan(db, frozen_scope, organization_id, *, cutoff, source_version, **_kwargs):
        calls.append(
            {
                "db": db,
                "scope": frozen_scope,
                "organization_id": organization_id,
                "cutoff": cutoff,
                "source_version": source_version,
            }
        )
        return None

    monkeypatch.setattr("app.workflow_control_worker.scan_overdue_insights", fake_scan)
    result = WorkflowControlWorker(get_settings(), worker_id="worker-scan").tick(
        generation_db,
        now=now,
    )

    assert result.schedules_claimed == 1
    assert result.schedules_dispatched == 1
    assert result.schedules_failed == 0
    assert len(calls) == 1
    assert calls[0]["organization_id"] == organization.id
    assert calls[0]["cutoff"] == now - timedelta(seconds=1)
    assert calls[0]["source_version"] == "project-task-v1"
    assert calls[0]["scope"].scope_fingerprint == scope.scope_fingerprint
    generation_db.refresh(schedule)
    assert schedule.lease_owner == ""


def test_worker_rejects_tampered_enterprise_insight_scope(generation_db, monkeypatch):
    from app.enterprise_intelligence.insight_scan import create_insight_scan_schedule

    organization = EnterpriseOrganization(external_id="tampered-scan-org", name="篡改扫描组织")
    generation_db.add(organization)
    generation_db.flush()
    scope = _admin_scope("scan-admin")
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    schedule = create_insight_scan_schedule(
        generation_db,
        scope,
        organization.id,
        name="篡改范围扫描",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(seconds=1),
    )
    metadata = dict(schedule.metadata_json)
    scan_metadata = dict(metadata["enterprise_insight_scan"])
    frozen_scope = dict(scan_metadata["scope"])
    frozen_scope["department"] = "财务部"
    scan_metadata["scope"] = frozen_scope
    metadata["enterprise_insight_scan"] = scan_metadata
    schedule.metadata_json = metadata
    generation_db.commit()

    calls: list[object] = []
    monkeypatch.setattr(
        "app.workflow_control_worker.scan_overdue_insights",
        lambda *_args, **_kwargs: calls.append(True),
    )
    result = WorkflowControlWorker(get_settings(), worker_id="worker-scan-tampered").tick(
        generation_db,
        now=now,
    )

    assert result.schedules_claimed == 1
    assert result.schedules_dispatched == 0
    assert result.schedules_failed == 1
    assert any("enterprise_insight_scope_changed" in error for error in result.errors)
    assert calls == []


def test_worker_recovers_stuck_event_after_stop_and_processes_idempotently(generation_db, monkeypatch):
    calls = _fake_runtime(monkeypatch)
    now = datetime(2026, 7, 16, 1, 0, tzinfo=UTC).replace(tzinfo=None)
    event, _ = enqueue_trigger_event(
        generation_db,
        owner_user_id="u-worker",
        workflow_id="serial_summary_echo",
        event_type="project.updated",
        event_key="stop-recovery-1",
        payload={"input_text": "恢复"},
    )
    generation_db.commit()
    claimed = claim_trigger_event(
        generation_db,
        event.uuid,
        owner_user_id="u-worker",
        worker_id="dead-worker",
        now=now,
        lease_ttl_seconds=5,
    )
    assert claimed is not None
    generation_db.commit()

    worker = WorkflowControlWorker(get_settings(), worker_id="worker-b")
    result = worker.tick(generation_db, now=now + timedelta(seconds=6))
    assert result.recovered_events == 1
    assert result.events_claimed == 1
    assert result.events_processed == 1
    assert result.events_failed == 0
    generation_db.refresh(event)
    assert event.status == "processed"
    assert event.run_id == "run-1"

    replay = worker.tick(generation_db, now=now + timedelta(seconds=7))
    assert replay.events_claimed == 0
    assert len(calls) == 1


def test_worker_binds_enterprise_recommendation_run_after_trigger_execution(generation_db, monkeypatch):
    organization = EnterpriseOrganization(external_id="worker-recommendation-org", name="Worker 建议组织")
    generation_db.add(organization)
    generation_db.flush()
    project = Project(
        name="Worker 建议项目",
        owner_user_id="admin-1",
        created_by="admin-1",
        organization_id=organization.id,
    )
    generation_db.add(project)
    generation_db.flush()
    now = datetime.now(UTC).replace(tzinfo=None)
    generation_db.add(
        ProjectTask(
            project_id=project.id,
            title="Worker 逾期任务",
            status="todo",
            due_at=now - timedelta(hours=1),
            created_by="admin-1",
        )
    )
    generation_db.flush()
    scope = _admin_scope()
    insight = detect_overdue_task_insights(
        generation_db,
        scope,
        organization.id,
        cutoff=now,
    )[0]
    acknowledge_insight(generation_db, scope, insight.uuid)
    recommendation, _action = propose_recommendation(
        generation_db,
        scope,
        insight.uuid,
        recommendation_type="notify_owner",
        title="Worker 通知负责人",
        payload={"workflow_id": "demo-workflow", "task_uuid": "worker-task"},
        risk_level="medium",
        idempotency_key="worker-recommendation-1",
    )
    approve_recommendation_action(generation_db, scope, recommendation.uuid)
    event, replayed = queue_recommendation_workflow_event(
        generation_db,
        scope,
        recommendation.uuid,
        idempotency_key="worker-dispatch-1",
    )
    assert replayed is False
    generation_db.commit()

    calls = _fake_runtime(monkeypatch)
    worker = WorkflowControlWorker(get_settings(), worker_id="worker-enterprise")
    result = worker.tick(generation_db)
    assert result.events_processed == 1
    assert result.events_failed == 0
    assert calls[0]["routing_summary"]["event_uuid"] == event.uuid
    generation_db.refresh(recommendation)
    generation_db.refresh(event)
    assert recommendation.workflow_run_id == "run-1"
    assert event.run_id == "run-1"
    assert event.status == "processed"
    assert generation_db.query(EnterpriseRecommendation).count() == 1


def test_worker_outbox_local_sink_acks_without_provider(generation_db):
    notification, _ = enqueue_notification(
        generation_db,
        owner_user_id="u-worker",
        run_id="run-local",
        node_id="notify",
        idempotency_key="run-local:notify",
        channel="in_app",
        recipient="u-worker",
        payload={"title": "本地通知"},
    )
    generation_db.commit()
    worker = WorkflowControlWorker(get_settings(), worker_id="worker-a")
    result = worker.tick(generation_db)
    assert result.notifications_claimed == 1
    assert result.notifications_sent == 1
    generation_db.refresh(notification)
    assert notification.status == "sent"


def test_worker_outbox_failure_retries_then_reconciles(generation_db):
    notification, _ = enqueue_notification(
        generation_db,
        owner_user_id="u-worker",
        run_id="run-retry",
        node_id="notify",
        idempotency_key="run-retry:notify",
        channel="in_app",
        recipient="u-worker",
    )
    generation_db.commit()
    worker = WorkflowControlWorker(
        get_settings(), worker_id="worker-a", notification_sender=lambda _row: False
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    first = worker.tick(generation_db, now=now)
    assert first.notifications_retried == 1
    generation_db.refresh(notification)
    assert notification.status == "pending"
    second = worker.tick(generation_db, now=now + timedelta(minutes=1))
    third = worker.tick(generation_db, now=now + timedelta(minutes=2))
    assert second.notifications_retried == 1
    assert third.notifications_reconciliation_required == 1
    generation_db.refresh(notification)
    assert notification.status == "reconciliation_required"
