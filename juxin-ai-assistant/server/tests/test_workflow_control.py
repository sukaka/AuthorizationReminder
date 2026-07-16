from datetime import UTC, datetime, timedelta

import pytest


def test_schedule_claim_is_fenced_and_mutually_exclusive(generation_db):
    from app.workflow_control import claim_due_schedules, create_schedule

    now = datetime.now(UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-1",
        workflow_id="scheduled_weekly_brief",
        name="每周简报",
        cron_expression="0 9 * * 1",
        timezone="Asia/Shanghai",
        next_fire_at=now - timedelta(seconds=1),
    )
    generation_db.commit()

    first = claim_due_schedules(generation_db, worker_id="worker-a", now=now)
    second = claim_due_schedules(generation_db, worker_id="worker-b", now=now)

    assert [item.uuid for item in first] == [schedule.uuid]
    assert second == []
    assert first[0].lease_owner == "worker-a"
    assert first[0].lease_token == 1


def test_schedule_release_rejects_stale_lease_token(generation_db):
    from app.workflow_control import claim_due_schedules, create_schedule, release_schedule_claim

    now = datetime.now(UTC).replace(tzinfo=None)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-fence",
        workflow_id="scheduled_weekly_brief",
        name="租约围栏",
        cron_expression="* * * * *",
        next_fire_at=now - timedelta(seconds=1),
    )
    generation_db.commit()
    claimed = claim_due_schedules(generation_db, worker_id="worker-a", now=now)
    token = claimed[0].lease_token
    assert release_schedule_claim(
        generation_db,
        schedule.uuid,
        worker_id="worker-a",
        lease_token=token + 1,
        next_fire_at=now,
    ) is None
    generation_db.refresh(schedule)
    assert schedule.lease_owner == "worker-a"
    assert release_schedule_claim(
        generation_db,
        schedule.uuid,
        worker_id="worker-a",
        lease_token=token,
        next_fire_at=now,
    ) is schedule


def test_schedule_claim_is_scoped_to_owner_and_cron_respects_timezone(generation_db):
    from app.workflow_control import claim_due_schedules, create_schedule, next_schedule_fire_at

    now = datetime(2026, 7, 19, 0, 30, tzinfo=UTC)
    schedule = create_schedule(
        generation_db,
        owner_user_id="u-owner",
        workflow_id="scheduled_weekly_brief",
        name="隔离周报",
        cron_expression="0 9 * * 1",
        timezone="Asia/Shanghai",
        next_fire_at=now.replace(tzinfo=None) - timedelta(seconds=1),
    )
    generation_db.commit()

    assert claim_due_schedules(
        generation_db, worker_id="wrong-owner", now=now, owner_user_id="u-other"
    ) == []
    claimed = claim_due_schedules(
        generation_db, worker_id="right-owner", now=now, owner_user_id="u-owner"
    )
    assert [item.uuid for item in claimed] == [schedule.uuid]

    next_fire = next_schedule_fire_at(
        "0 9 * * 1", "Asia/Shanghai", after=now
    )
    assert next_fire == datetime(2026, 7, 20, 1, 0)


def test_schedule_patch_and_enable_are_validated_and_owner_scoped(generation_db):
    from app.workflow_control import (
        create_schedule,
        set_schedule_enabled,
        update_schedule,
    )

    schedule = create_schedule(
        generation_db,
        owner_user_id="u-schedule",
        workflow_id="serial_summary_echo",
        name="可控调度",
        cron_expression="0 9 * * 1",
        timezone="Asia/Shanghai",
        next_fire_at=datetime(2026, 7, 20, 1, 0),
    )
    generation_db.commit()

    assert update_schedule(
        generation_db,
        schedule.uuid,
        owner_user_id="u-other",
        changes={"name": "越权修改"},
    ) is None
    patched = update_schedule(
        generation_db,
        schedule.uuid,
        owner_user_id="u-schedule",
        changes={
            "name": "已修改调度",
            "cron_expression": "*/15 8-10 * * 1-5",
            "timezone": "UTC",
            "misfire_policy": "fire_once",
            "catch_up": True,
            "concurrency_policy": "allow",
            "metadata": {"source": "test"},
        },
    )
    assert patched is schedule
    assert schedule.name == "已修改调度"
    assert schedule.cron_expression == "*/15 8-10 * * 1-5"
    assert schedule.timezone == "UTC"
    assert schedule.misfire_policy == "fire_once"
    assert schedule.catch_up is True
    assert schedule.concurrency_policy == "allow"
    assert schedule.metadata_json == {"source": "test"}

    with pytest.raises(ValueError, match="cron_expression_invalid"):
        update_schedule(
            generation_db,
            schedule.uuid,
            owner_user_id="u-schedule",
            changes={"cron_expression": "every fifteen minutes"},
        )

    disabled = set_schedule_enabled(
        generation_db,
        schedule.uuid,
        owner_user_id="u-schedule",
        enabled=False,
    )
    assert disabled is schedule
    assert schedule.enabled is False
    schedule.next_fire_at = None
    enabled = set_schedule_enabled(
        generation_db,
        schedule.uuid,
        owner_user_id="u-schedule",
        enabled=True,
        now=datetime(2026, 7, 19, 0, 30),
    )
    assert enabled is schedule
    assert schedule.enabled is True
    assert schedule.next_fire_at == datetime(2026, 7, 20, 8, 0)


def test_trigger_inbox_is_scoped_and_idempotent(generation_db):
    from app.workflow_control import enqueue_trigger_event

    first, replayed = enqueue_trigger_event(
        generation_db,
        owner_user_id="u-1",
        workflow_id="review_and_notify",
        event_type="project.updated",
        event_key="evt-1",
        payload={"project_uuid": "p-1"},
    )
    same, replayed_same = enqueue_trigger_event(
        generation_db,
        owner_user_id="u-1",
        workflow_id="review_and_notify",
        event_type="project.updated",
        event_key="evt-1",
        payload={"project_uuid": "p-1"},
    )
    other, replayed_other = enqueue_trigger_event(
        generation_db,
        owner_user_id="u-2",
        workflow_id="review_and_notify",
        event_type="project.updated",
        event_key="evt-1",
        payload={"project_uuid": "p-1"},
    )

    assert replayed is False
    assert replayed_same is True
    assert replayed_other is False
    assert same.uuid == first.uuid
    assert other.uuid != first.uuid


def test_trigger_processing_lease_recovers_stuck_and_fences(generation_db):
    from app.workflow_control import (
        claim_trigger_event,
        enqueue_trigger_event,
        mark_trigger_processed,
        recover_stuck_trigger_events,
    )

    now = datetime.now(UTC).replace(tzinfo=None)
    event, _ = enqueue_trigger_event(
        generation_db,
        owner_user_id="u-lease",
        workflow_id="serial_summary_echo",
        event_type="project.updated",
        event_key="lease-event-1",
        payload={"input_text": "租约测试"},
    )
    claimed = claim_trigger_event(
        generation_db,
        event.uuid,
        owner_user_id="u-lease",
        worker_id="worker-a",
        now=now,
        lease_ttl_seconds=5,
    )
    assert claimed is not None
    processing, token = claimed
    assert processing.status == "processing"
    assert processing.lease_owner == "worker-a"
    assert token == 1
    assert mark_trigger_processed(
        generation_db,
        event.uuid,
        worker_id="worker-a",
        lease_token=token + 1,
        run_id="run-stale",
    ) is None
    generation_db.refresh(event)
    assert event.status == "processing"

    recovered = recover_stuck_trigger_events(
        generation_db,
        owner_user_id="u-lease",
        now=now + timedelta(seconds=6),
    )
    assert recovered == 1
    generation_db.refresh(event)
    assert event.status == "pending"
    assert event.lease_owner == ""

    reclaimed = claim_trigger_event(
        generation_db,
        event.uuid,
        owner_user_id="u-lease",
        worker_id="worker-b",
        now=now + timedelta(seconds=6),
    )
    assert reclaimed is not None
    processing_again, token_again = reclaimed
    assert token_again > token
    assert mark_trigger_processed(
        generation_db,
        event.uuid,
        worker_id="worker-b",
        lease_token=token_again,
        run_id="run-final",
    ) is not None
    generation_db.refresh(event)
    assert event.status == "processed"
    assert event.run_id == "run-final"


def test_notification_outbox_retries_then_requires_reconciliation(generation_db):
    from app.workflow_control import (
        ack_notification,
        claim_notifications,
        enqueue_notification,
        fail_notification,
    )

    notification, replayed = enqueue_notification(
        generation_db,
        owner_user_id="u-1",
        run_id="run-1",
        node_id="notify",
        idempotency_key="run-1:notify",
        channel="in_app",
        recipient="u-1",
        payload={"title": "已完成"},
    )
    same, replayed_same = enqueue_notification(
        generation_db,
        owner_user_id="u-1",
        run_id="run-1",
        node_id="notify",
        idempotency_key="run-1:notify",
        channel="in_app",
        recipient="u-1",
        payload={"title": "已完成"},
    )
    assert replayed is False
    assert replayed_same is True
    assert same.uuid == notification.uuid

    claimed = claim_notifications(generation_db, worker_id="worker-a")
    assert [item.uuid for item in claimed] == [notification.uuid]
    fail_notification(generation_db, notification.uuid, worker_id="worker-a", error="temporary")
    generation_db.refresh(notification)
    assert notification.status == "pending"
    claimed = claim_notifications(
        generation_db,
        worker_id="worker-a",
        now=datetime.now(UTC) + timedelta(minutes=1),
    )
    fail_notification(
        generation_db,
        notification.uuid,
        worker_id="worker-a",
        error="permanent",
        max_attempts=1,
    )
    generation_db.refresh(notification)
    assert notification.status == "reconciliation_required"
    assert [item.uuid for item in claimed] == [notification.uuid]
    assert ack_notification(generation_db, notification.uuid, worker_id="worker-a") is False


def test_notification_ack_and_fail_reject_stale_lease_token(generation_db):
    from app.workflow_control import (
        ack_notification,
        claim_notifications,
        enqueue_notification,
        fail_notification,
    )

    notification, _ = enqueue_notification(
        generation_db,
        owner_user_id="u-fence",
        run_id="run-fence",
        node_id="notify",
        idempotency_key="run-fence:notify",
        channel="in_app",
        recipient="u-fence",
    )
    claimed = claim_notifications(generation_db, worker_id="worker-a")
    token = claimed[0].lease_token
    assert ack_notification(
        generation_db,
        notification.uuid,
        worker_id="worker-a",
        lease_token=token + 1,
    ) is False
    generation_db.refresh(notification)
    assert notification.status == "pending"
    assert fail_notification(
        generation_db,
        notification.uuid,
        worker_id="worker-a",
        lease_token=token + 1,
        error="stale",
    ) is False
    assert ack_notification(
        generation_db,
        notification.uuid,
        worker_id="worker-a",
        lease_token=token,
    ) is True


def test_wait_resume_is_owner_scoped_and_idempotent(generation_db):
    from app.workflow_control import create_wait, resume_wait

    wait, created = create_wait(
        generation_db,
        owner_user_id="u-1",
        run_id="run-1",
        node_id="wait_for_signal",
        wait_key="signal-1",
        signal_key="project.approved",
    )
    same, created_same = create_wait(
        generation_db,
        owner_user_id="u-1",
        run_id="run-1",
        node_id="wait_for_signal",
        wait_key="signal-1",
        signal_key="project.approved",
    )
    assert created is True
    assert created_same is False
    assert same.uuid == wait.uuid
    assert resume_wait(
        generation_db,
        wait.uuid,
        owner_user_id="u-2",
        resumed_by="u-2",
        payload={"ok": True},
    ) is None
    resumed = resume_wait(
        generation_db,
        wait.uuid,
        owner_user_id="u-1",
        resumed_by="u-1",
        resume_token=wait.resume_token,
        payload={"ok": True},
    )
    assert resumed is not None
    assert resumed.status == "resumed"
    assert resumed.payload_json == {"ok": True}


def test_wait_resume_token_is_one_time_and_expires(generation_db):
    from app.workflow_control import create_wait, resume_wait

    now = datetime.now(UTC).replace(tzinfo=None)
    wait, created = create_wait(
        generation_db,
        owner_user_id="u-token",
        run_id="run-token",
        node_id="wait_for_signal",
        wait_key="signal-token",
        resume_expires_at=now + timedelta(seconds=5),
    )
    assert created is True
    assert wait.resume_token
    assert resume_wait(
        generation_db,
        wait.uuid,
        owner_user_id="u-token",
        resumed_by="u-token",
        resume_token="wrong-token",
        now=now,
    ) is None
    assert resume_wait(
        generation_db,
        wait.uuid,
        owner_user_id="u-token",
        resumed_by="u-token",
        resume_token=wait.resume_token,
        now=now + timedelta(seconds=6),
    ) is None

    valid_wait, _ = create_wait(
        generation_db,
        owner_user_id="u-token",
        run_id="run-token-2",
        node_id="wait_for_signal",
        wait_key="signal-token-2",
        resume_expires_at=now + timedelta(seconds=5),
    )
    resumed = resume_wait(
        generation_db,
        valid_wait.uuid,
        owner_user_id="u-token",
        resumed_by="u-token",
        resume_token=valid_wait.resume_token,
        now=now,
    )
    assert resumed is not None
    assert resume_wait(
        generation_db,
        valid_wait.uuid,
        owner_user_id="u-token",
        resumed_by="u-token",
        resume_token=valid_wait.resume_token,
        now=now,
    ) is None


def test_new_typed_nodes_fail_closed_without_durable_handler(generation_db):
    from app.workflow_engine import WorkflowEngine

    engine = WorkflowEngine(generation_db)
    for step_type in ("project_read", "transform", "notification", "wait", "subflow"):
        with pytest.raises(ValueError, match="typed_step_requires_durable_runtime"):
            engine._exec_step(step_type, {}, {})


def test_durable_typed_nodes_are_deterministic_and_persist_side_effects(generation_db):
    from app.config import Settings
    from app.models import AgentRun
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    row = AgentRun(
        uuid="run-typed-1",
        owner_user_id="u-1",
        metadata_json={"workflow_runtime": {"workflow_id": "project_dossier"}},
    )
    ctx = {
        "context": {
            "project_records": {"p-1": {"name": "一季度项目", "status": "active"}},
        },
        "_current_step_id": "read_project",
    }

    project = service._exec_typed_step(
        row, "project_read", {"project_uuid": "p-1"}, ctx,
    )
    assert project == {
        "status": "ok",
        "project_uuid": "p-1",
        "output": {"name": "一季度项目", "status": "active"},
    }

    transformed = service._exec_typed_step(
        row,
        "transform",
        {"operation": "concat", "inputs": ["项目：", "一季度项目"]},
        ctx,
    )
    assert transformed["output"] == "项目：一季度项目"

    notification, replayed = service._exec_typed_step(
        row,
        "notification",
        {
            "channel": "in_app",
            "recipient": "u-1",
            "idempotency_key": "run-typed-1:notify",
            "payload": {"title": "项目已更新"},
        },
        ctx,
    ), False
    assert notification["status"] == "ok"
    assert notification["outbox_id"]
    assert replayed is False
    replay = service._exec_typed_step(
        row,
        "notification",
        {
            "channel": "in_app",
            "recipient": "u-1",
            "idempotency_key": "run-typed-1:notify",
            "payload": {"title": "项目已更新"},
        },
        ctx,
    )
    assert replay["outbox_id"] == notification["outbox_id"]

    waiting = service._exec_typed_step(
        row,
        "wait",
        {"wait_key": "project-approval", "signal_key": "project.approved"},
        ctx,
    )
    assert waiting["status"] == "waiting_human"
    assert waiting["wait_uuid"]
    assert waiting["resume_token"]
    assert waiting["resume_expires_at"]


def test_durable_approval_node_issues_one_time_token(generation_db):
    from app.config import Settings
    from app.models import AgentRun
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    row = AgentRun(
        uuid="run-approval-token",
        owner_user_id="u-1",
        metadata_json={"workflow_runtime": {"workflow_id": "project_dossier"}},
    )
    output = service._exec_typed_step(
        row,
        "approval",
        {"approval_key": "publish", "expires_in_seconds": 60},
        {"_current_step_id": "approve_publish"},
    )
    assert output["status"] == "waiting_human"
    assert output["approval_token"]
    assert len(output["approval_token_hash"]) == 64
    assert output["approval_expires_at"]


def test_durable_typed_nodes_reject_unsafe_transform_and_unknown_project(generation_db):
    from app.config import Settings
    from app.models import AgentRun
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    row = AgentRun(
        uuid="run-typed-2",
        owner_user_id="u-1",
        metadata_json={"workflow_runtime": {"workflow_id": "project_dossier"}},
    )
    with pytest.raises(ValueError, match="project_not_found"):
        service._exec_typed_step(
            row, "project_read", {"project_uuid": "missing"}, {"context": {"project_records": {}}},
        )
    with pytest.raises(ValueError, match="transform_operation_not_allowed"):
        service._exec_typed_step(row, "transform", {"operation": "eval", "value": "1+1"}, {})


def test_subflow_creates_durable_child_run_and_replays_by_node_key(generation_db):
    from sqlalchemy import select

    from app.config import Settings
    from app.models import AgentRun
    from app.workflow_run_service import WorkflowRunService

    service = WorkflowRunService(generation_db, Settings())
    parent = AgentRun(
        uuid="run-subflow-parent",
        owner_user_id="u-subflow",
        metadata_json={"workflow_runtime": {"workflow_id": "project_dossier"}},
    )
    ctx = {"input_text": "子流程输入", "context": {}}

    first = service._exec_typed_step(
        parent,
        "subflow",
        {"workflow_id": "serial_summary_echo", "idempotency_key": "parent:child"},
        ctx,
    )
    assert first["status"] == "ok"
    assert first["child_run_id"]
    child = generation_db.scalar(select(AgentRun).where(AgentRun.uuid == first["child_run_id"]))
    assert child is not None
    child_meta = child.metadata_json["workflow_runtime"]
    assert child_meta["parent_run_id"] == parent.uuid
    assert child_meta["routing"]["idempotency_key"] == "parent:child"

    replay = service._exec_typed_step(
        parent,
        "subflow",
        {"workflow_id": "serial_summary_echo", "idempotency_key": "parent:child"},
        ctx,
    )
    assert replay["child_run_id"] == first["child_run_id"]


def test_wait_resume_continues_durable_workflow_and_closes_step(
    generation_client, generation_db
):
    from sqlalchemy import select

    from app.models import AgentRun, AgentRunStep, WorkflowWait

    definition = {
        "id": "wait_resume_flow",
        "name": "等待恢复流程",
        "steps": [
            {
                "id": "wait_for_signal",
                "type": "wait",
                "params": {"wait_key": "approval-1", "signal_key": "approved"},
            },
            {"id": "finish", "type": "set", "params": {"key": "done", "value": True}},
        ],
    }
    saved = generation_client.post("/api/ai/workflows/custom", json=definition)
    assert saved.status_code == 201, saved.text
    published = generation_client.post("/api/ai/workflows/custom/wait_resume_flow/publish")
    assert published.status_code == 200, published.text

    started = generation_client.post(
        "/api/ai/workflows/wait_resume_flow/run",
        json={"input_text": "等待信号", "context": {"source": "test"}},
    )
    assert started.status_code == 200, started.text
    payload = started.json()
    assert payload["status"] == "waiting_human"
    run_id = payload["agent_run_id"]
    wait = generation_db.scalar(select(WorkflowWait).where(WorkflowWait.run_id == run_id))
    assert wait is not None and wait.status == "waiting"

    resumed = generation_client.post(
        f"/api/ai/workflows/waits/{wait.uuid}/resume",
        json={"payload": {"approved": True}},
    )
    assert resumed.status_code == 200, resumed.text
    resumed_payload = resumed.json()
    assert resumed_payload["status"] == "succeeded"
    assert resumed_payload["run"]["status"] == "succeeded"

    generation_db.expire_all()
    run = generation_db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
    assert run is not None and run.status == "succeeded"
    wait_step = generation_db.scalar(
        select(AgentRunStep)
        .where(AgentRunStep.run_id == run_id, AgentRunStep.step_type == "workflow:wait")
        .order_by(AgentRunStep.sequence.asc())
    )
    assert wait_step is not None and wait_step.status == "succeeded"
    assert wait_step.output_summary_json["wait_resumed"] is True
