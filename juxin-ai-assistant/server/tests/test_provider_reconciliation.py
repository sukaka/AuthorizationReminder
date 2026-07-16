from datetime import UTC, datetime, timedelta

from app.config import get_settings
from app.provider_reconciliation import FakeNotificationProvider
from app.workflow_control import enqueue_notification
from app.workflow_control_worker import WorkflowControlWorker


def _notification(db, key: str):
    row, _ = enqueue_notification(
        db,
        owner_user_id="u-provider",
        run_id=f"run-{key}",
        node_id="notify",
        idempotency_key=key,
        channel="in_app",
        recipient="u-provider",
        payload={"title": "provider test"},
    )
    db.commit()
    return row


def test_provider_success_records_receipt_and_acks(generation_db):
    key = "provider-success-1"
    row = _notification(generation_db, key)
    provider = FakeNotificationProvider({key: "success"})
    worker = WorkflowControlWorker(get_settings(), worker_id="provider-worker", notification_provider=provider)

    result = worker.tick(generation_db, now=datetime.now(UTC).replace(tzinfo=None))

    assert result.notifications_sent == 1
    generation_db.refresh(row)
    assert row.status == "sent"
    assert row.payload_json["_provider_reconciliation"]["outcome"] == "succeeded"
    assert row.payload_json["_provider_reconciliation"]["receipt"]["idempotency_key"] == key


def test_provider_failure_retries_but_confirmed_success_is_applied_once(generation_db):
    key = "provider-failure-then-success"
    row = _notification(generation_db, key)
    provider = FakeNotificationProvider({key: ["failure", "success"]})
    worker = WorkflowControlWorker(get_settings(), worker_id="provider-worker", notification_provider=provider)
    now = datetime.now(UTC).replace(tzinfo=None)

    first = worker.tick(generation_db, now=now)
    assert first.notifications_retried == 1
    generation_db.refresh(row)
    assert row.status == "pending"
    assert provider.effect_count[key] == 0

    second = worker.tick(generation_db, now=now + timedelta(minutes=1))
    assert second.notifications_sent == 1
    generation_db.refresh(row)
    assert row.status == "sent"
    assert provider.send_calls[key] == 2
    assert provider.effect_count[key] == 1


def test_provider_timeout_requires_reconciliation_and_never_blind_retries(generation_db):
    key = "provider-timeout-1"
    row = _notification(generation_db, key)
    provider = FakeNotificationProvider({key: "timeout"})
    worker = WorkflowControlWorker(get_settings(), worker_id="provider-worker", notification_provider=provider)
    now = datetime.now(UTC).replace(tzinfo=None)

    first = worker.tick(generation_db, now=now)
    assert first.notifications_reconciliation_required == 1
    generation_db.refresh(row)
    assert row.status == "reconciliation_required"
    assert provider.send_calls[key] == 1

    replay_tick = worker.tick(generation_db, now=now + timedelta(minutes=1))
    assert replay_tick.notifications_claimed == 0
    assert provider.send_calls[key] == 1

    unresolved = worker.reconcile_notification(generation_db, row.uuid)
    generation_db.commit()
    assert unresolved.outcome.value == "unknown"
    generation_db.refresh(row)
    assert row.status == "reconciliation_required"
    assert provider.reconcile_calls[key] == 1

    provider.resolve(key, "succeeded")
    resolved = worker.reconcile_notification(generation_db, row.uuid)
    generation_db.commit()
    assert resolved.outcome.value == "succeeded"
    generation_db.refresh(row)
    assert row.status == "sent"
    assert provider.send_calls[key] == 1
    assert provider.effect_count[key] == 1


def test_provider_duplicate_key_is_replayed_without_second_effect(generation_db):
    key = "provider-duplicate-1"
    row = _notification(generation_db, key)
    provider = FakeNotificationProvider({key: "duplicate"})

    first = provider.send(row)
    second = provider.send(row)

    assert first.outcome.value == "succeeded"
    assert second.outcome.value == "succeeded"
    assert second.replayed is True
    assert provider.send_calls[key] == 2
    assert provider.effect_count[key] == 1
