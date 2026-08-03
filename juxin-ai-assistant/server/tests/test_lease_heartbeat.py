import base64
import os
import signal
import time
from datetime import timedelta
from multiprocessing import get_context

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.agent_run_service import AgentRunService
from app.agent_run_service import LeaseLostError
from app.agent_runtime.lease_heartbeat import LeaseHeartbeat
from app.crypto import ContentCipher


def _cipher() -> ContentCipher:
    return ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))


def _lease_worker(
    database_url: str,
    run_id: str,
    worker_id: str,
    ttl_seconds: int,
    result_queue,
    *,
    wait_for_kill: bool,
) -> None:
    """Independent process used only by the multi-instance recovery drill."""

    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            token = AgentRunService(db, _cipher()).acquire_lease(
                run_id,
                worker_id,
                ttl_seconds=ttl_seconds,
            )
            db.commit()
        result_queue.put(token)
        if wait_for_kill:
            while True:
                time.sleep(60)
    finally:
        engine.dispose()


def test_heartbeat_renews_from_an_independent_session(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="长任务")
    token = service.acquire_lease(row.uuid, "worker-a")
    assert token is not None
    generation_db.commit()
    revision_before = row.state_revision

    heartbeat = LeaseHeartbeat(
        generation_db.get_bind(),
        _cipher(),
        run_id=row.uuid,
        worker_id="worker-a",
        fencing_token=token,
        interval_seconds=5,
        ttl_seconds=20,
    )
    assert heartbeat.renew_once() is True
    assert heartbeat.lost is False

    generation_db.refresh(row)
    assert row.lease_owner == "worker-a"
    assert row.fencing_token == token
    # Lease liveness is independent of the run-state revision.  Incrementing
    # the optimistic-lock column here races the worker's checkpoint writes.
    assert row.state_revision == revision_before


def test_crashed_worker_cannot_renew_or_write_after_takeover(generation_db) -> None:
    """Simulate a hard-stopped worker by letting its lease expire before takeover."""

    first = AgentRunService(generation_db, _cipher())
    row = first.create_run(owner_user_id="dev", input_text="可恢复任务")
    first_token = first.acquire_lease(row.uuid, "worker-a", ttl_seconds=1)
    assert first_token is not None
    generation_db.commit()
    generation_db.refresh(row)

    # The independent worker session observes an expired lease and claims it.
    expired_at = row.lease_expires_at + timedelta(seconds=1)
    second_token = first.acquire_lease(
        row.uuid,
        "worker-b",
        ttl_seconds=20,
        now=expired_at,
    )
    assert second_token is not None
    assert second_token > first_token
    generation_db.commit()

    heartbeat = LeaseHeartbeat(
        generation_db.get_bind(),
        _cipher(),
        run_id=row.uuid,
        worker_id="worker-a",
        fencing_token=first_token,
    )
    assert heartbeat.renew_once() is False
    assert heartbeat.lost is True

    generation_db.refresh(row)
    try:
        first.assert_lease(row, "worker-a", first_token)
    except LeaseLostError:
        pass
    else:
        raise AssertionError("stale worker must be fenced from further writes")


def test_sigkill_worker_lease_takeover_uses_two_independent_processes(tmp_path) -> None:
    """A hard-killed worker cannot reclaim or write after a second process takes over."""

    from app import models  # noqa: F401
    from app.database import Base

    database_url = f"sqlite+pysqlite:///{tmp_path / 'lease-takeover.db'}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as db:
            service = AgentRunService(db, _cipher())
            row = service.create_run(owner_user_id="dev", input_text="强杀恢复演练")
            db.commit()
            run_id = row.uuid

        context = get_context("spawn")
        first_queue = context.Queue()
        first_worker = context.Process(
            target=_lease_worker,
            args=(database_url, run_id, "worker-a", 1, first_queue),
            kwargs={"wait_for_kill": True},
        )
        first_worker.start()
        first_token = first_queue.get(timeout=10)
        assert first_token == 1

        os.kill(first_worker.pid, signal.SIGKILL)
        first_worker.join(timeout=10)
        assert first_worker.exitcode == -signal.SIGKILL

        # Wait for the durable lease to expire; B is a separately spawned worker.
        time.sleep(1.2)
        second_queue = context.Queue()
        second_worker = context.Process(
            target=_lease_worker,
            args=(database_url, run_id, "worker-b", 20, second_queue),
            kwargs={"wait_for_kill": False},
        )
        second_worker.start()
        second_token = second_queue.get(timeout=10)
        second_worker.join(timeout=10)
        assert second_worker.exitcode == 0
        assert second_token == 2

        with Session(engine) as db:
            service = AgentRunService(db, _cipher())
            row = service.get_owned_run(run_id, "dev")
            assert row is not None
            assert service.renew_lease(run_id, "worker-a", first_token) is False
            try:
                service.assert_lease(row, "worker-a", first_token)
            except LeaseLostError:
                pass
            else:
                raise AssertionError("SIGKILL worker must be fenced after takeover")
    finally:
        if "first_worker" in locals() and first_worker.is_alive():
            first_worker.kill()
            first_worker.join(timeout=10)
        if "second_worker" in locals() and second_worker.is_alive():
            second_worker.kill()
            second_worker.join(timeout=10)
        Base.metadata.drop_all(engine)
        engine.dispose()
