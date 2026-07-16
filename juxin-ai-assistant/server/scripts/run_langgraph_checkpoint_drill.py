#!/usr/bin/env python3
"""Run a process-boundary LangGraph checkpoint takeover rehearsal.

The rehearsal uses a file-backed SQLite database and one SQLAlchemy engine per
worker.  Worker A commits a checkpoint and is hard-killed; after its lease
expires, Worker B takes over, reads the committed checkpoint, and commits the
next one.  The parent then attempts a stale write with Worker A's fencing token.

This is local evidence for the staging procedure.  It does not enable the
production LangGraph runtime and does not contact a remote service.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import signal
import sys
import tempfile
import time
from multiprocessing import get_context
from pathlib import Path
from typing import Any


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _ensure_import_path() -> None:
    root = _root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


def _setup_env() -> None:
    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault(
        "AI_LOCAL_BINDING_SECRET",
        "local-binding-secret-langgraph-checkpoint-drill-32",
    )
    if not os.environ.get("CONTENT_ENCRYPTION_KEY"):
        os.environ["CONTENT_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(
            b"0" * 32
        ).decode("ascii")


def _engine(database_url: str):
    from sqlalchemy import create_engine

    return create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False},
    )


def _checkpoint(checkpoint_id: str, phase: str) -> dict[str, Any]:
    return {
        "id": checkpoint_id,
        "channel_values": {"phase": phase},
        "channel_versions": {"phase": checkpoint_id},
        "versions_seen": {},
        "updated_channels": ["phase"],
    }


def _config(run_id: str) -> dict[str, dict[str, str]]:
    return {"configurable": {"thread_id": run_id, "checkpoint_ns": ""}}


def _worker_a(
    database_url: str,
    run_id: str,
    ttl_seconds: int,
    result_queue: Any,
) -> None:
    """Acquire the first lease, commit cp-1, then wait to be SIGKILLed."""

    _ensure_import_path()
    _setup_env()
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService
    from app.agent_runtime.agent_run_checkpoint_saver import AgentRunCheckpointSaver
    from app.crypto import ContentCipher
    from app.models import AgentRun

    engine = _engine(database_url)
    try:
        with Session(engine) as db:
            service = AgentRunService(db, ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]))
            token = service.acquire_lease(run_id, "worker-a", ttl_seconds=ttl_seconds)
            if token is None:
                result_queue.put({"error": "worker_a_lease_not_acquired"})
                return
            db.commit()
            row = db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
            if row is None:
                result_queue.put({"error": "worker_a_run_missing"})
                return
            saver = AgentRunCheckpointSaver(
                service,
                row,
                worker_id="worker-a",
                fencing_token=token,
            )
            saver.put(
                _config(run_id),
                _checkpoint("cp-1", "executed"),
                {"phase": "execute", "worker": "a"},
                {"phase": 1},
            )
            result_queue.put({"token": token, "checkpoint_id": "cp-1"})
            while True:
                time.sleep(60)
    except Exception as exc:
        result_queue.put({"error": f"{type(exc).__name__}:{str(exc)[:180]}"})
        raise
    finally:
        engine.dispose()


def _worker_b(
    database_url: str,
    run_id: str,
    ttl_seconds: int,
    result_queue: Any,
) -> None:
    """Take over, read cp-1, and commit cp-2 from a separate process."""

    _ensure_import_path()
    _setup_env()
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService
    from app.agent_runtime.agent_run_checkpoint_saver import AgentRunCheckpointSaver
    from app.crypto import ContentCipher
    from app.models import AgentRun

    engine = _engine(database_url)
    try:
        with Session(engine) as db:
            service = AgentRunService(db, ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]))
            token = service.acquire_lease(run_id, "worker-b", ttl_seconds=ttl_seconds)
            if token is None:
                result_queue.put({"error": "worker_b_lease_not_acquired"})
                return
            db.commit()
            row = db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
            if row is None:
                result_queue.put({"error": "worker_b_run_missing"})
                return
            saver = AgentRunCheckpointSaver(
                service,
                row,
                worker_id="worker-b",
                fencing_token=token,
            )
            restored = saver.get_tuple(_config(run_id))
            restored_id = None
            if restored is not None:
                restored_id = str(restored.checkpoint.get("id") or "")
            saver.put(
                {
                    "configurable": {
                        "thread_id": run_id,
                        "checkpoint_ns": "",
                        "checkpoint_id": restored_id or "cp-1",
                    }
                },
                _checkpoint("cp-2", "verified"),
                {"phase": "verify", "worker": "b"},
                {"phase": 2},
            )
            result_queue.put(
                {
                    "token": token,
                    "restored_checkpoint_id": restored_id,
                    "checkpoint_id": "cp-2",
                }
            )
    except Exception as exc:
        result_queue.put({"error": f"{type(exc).__name__}:{str(exc)[:180]}"})
        raise
    finally:
        engine.dispose()


def _create_run(database_url: str, case_number: int) -> str:
    _ensure_import_path()
    _setup_env()
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService
    from app.crypto import ContentCipher
    from app.database import Base
    from app import models  # noqa: F401  # register all model tables

    engine = _engine(database_url)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            row = AgentRunService(
                db,
                ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
            ).create_run(
                owner_user_id="checkpoint-drill",
                input_text=f"LangGraph checkpoint 进程边界演练 {case_number}",
                run_type="complex",
            )
            db.commit()
            return str(row.uuid)
    finally:
        engine.dispose()


def _stale_write_is_fenced(
    database_url: str,
    run_id: str,
    stale_token: int,
) -> tuple[bool, str | None]:
    _ensure_import_path()
    _setup_env()
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService, LeaseLostError
    from app.agent_runtime.agent_run_checkpoint_saver import AgentRunCheckpointSaver
    from app.crypto import ContentCipher
    from app.models import AgentRun

    engine = _engine(database_url)
    try:
        with Session(engine) as db:
            row = db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
            if row is None:
                return False, "run_missing"
            saver = AgentRunCheckpointSaver(
                AgentRunService(db, ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])),
                row,
                worker_id="worker-a",
                fencing_token=stale_token,
            )
            try:
                saver.put(
                    _config(run_id),
                    _checkpoint("cp-stale", "stale"),
                    {"phase": "stale"},
                    {"phase": 99},
                )
            except LeaseLostError:
                return True, None
            return False, "stale_write_accepted"
    except Exception as exc:
        return False, f"{type(exc).__name__}:{str(exc)[:200]}"
    finally:
        engine.dispose()


def _read_checkpoint_ids(database_url: str, run_id: str) -> list[str]:
    _ensure_import_path()
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.models import AgentRunLangGraphCheckpoint

    engine = _engine(database_url)
    try:
        with Session(engine) as db:
            records = list(
                db.scalars(
                    select(AgentRunLangGraphCheckpoint)
                    .where(AgentRunLangGraphCheckpoint.run_id == run_id)
                    .order_by(AgentRunLangGraphCheckpoint.id.asc())
                )
            )
            return [str(record.checkpoint_id) for record in records]
    finally:
        engine.dispose()


def _run_case(case_number: int, *, lease_ttl_seconds: int, timeout_seconds: float) -> dict[str, Any]:
    context = get_context("spawn")
    result: dict[str, Any] = {
        "case": case_number,
        "first_worker_exitcode": None,
        "second_worker_exitcode": None,
        "first_token": None,
        "second_token": None,
        "restored_checkpoint_id": None,
        "checkpoint_ids": [],
        "stale_worker_fenced": False,
        "stale_write_error": None,
        "errors": [],
    }
    with tempfile.TemporaryDirectory(prefix="juxin-langgraph-checkpoint-") as directory:
        database_url = f"sqlite+pysqlite:///{Path(directory) / 'checkpoint.db'}"
        run_id = _create_run(database_url, case_number)
        first_queue = context.Queue()
        second_queue = context.Queue()
        first_worker = context.Process(
            target=_worker_a,
            args=(database_url, run_id, lease_ttl_seconds, first_queue),
        )
        second_worker = None
        try:
            first_worker.start()
            first_payload = first_queue.get(timeout=timeout_seconds)
            if first_payload.get("error"):
                result["errors"].append(str(first_payload["error"]))
            result["first_token"] = first_payload.get("token")
            os.kill(first_worker.pid, signal.SIGKILL)
            first_worker.join(timeout=timeout_seconds)
            result["first_worker_exitcode"] = first_worker.exitcode
            time.sleep(lease_ttl_seconds + 0.2)

            second_worker = context.Process(
                target=_worker_b,
                args=(database_url, run_id, lease_ttl_seconds, second_queue),
            )
            second_worker.start()
            second_payload = second_queue.get(timeout=timeout_seconds)
            if second_payload.get("error"):
                result["errors"].append(str(second_payload["error"]))
            result["second_token"] = second_payload.get("token")
            result["restored_checkpoint_id"] = second_payload.get("restored_checkpoint_id")
            second_worker.join(timeout=timeout_seconds)
            result["second_worker_exitcode"] = second_worker.exitcode

            stale_token = result["first_token"]
            if isinstance(stale_token, int):
                (
                    result["stale_worker_fenced"],
                    result["stale_write_error"],
                ) = _stale_write_is_fenced(
                    database_url,
                    run_id,
                    stale_token,
                )
            result["checkpoint_ids"] = _read_checkpoint_ids(database_url, run_id)

            if result["first_worker_exitcode"] != -signal.SIGKILL:
                result["errors"].append("first_worker_not_sigkill")
            if result["second_worker_exitcode"] != 0:
                result["errors"].append("second_worker_failed")
            if not (
                isinstance(result["first_token"], int)
                and isinstance(result["second_token"], int)
                and result["second_token"] == result["first_token"] + 1
            ):
                result["errors"].append("fencing_token_not_incremented")
            if result["restored_checkpoint_id"] != "cp-1":
                result["errors"].append("checkpoint_not_restored")
            if result["checkpoint_ids"] != ["cp-1", "cp-2"]:
                result["errors"].append("checkpoint_sequence_invalid")
            if not result["stale_worker_fenced"]:
                result["errors"].append("stale_worker_not_fenced")
        except Exception as exc:
            result["errors"].append(f"{type(exc).__name__}:{str(exc)[:200]}")
        finally:
            if first_worker.is_alive():
                first_worker.kill()
                first_worker.join(timeout=timeout_seconds)
            if second_worker is not None and second_worker.is_alive():
                second_worker.kill()
                second_worker.join(timeout=timeout_seconds)
            first_queue.close()
            second_queue.close()
            first_queue.join_thread()
            second_queue.join_thread()
    result["passed"] = not result["errors"]
    return result


def run_drill(
    *,
    cases: int = 3,
    lease_ttl_seconds: int = 1,
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    """Return machine-readable process-boundary checkpoint evidence."""

    _ensure_import_path()
    _setup_env()
    if lease_ttl_seconds <= 0:
        raise ValueError("lease_ttl_seconds_must_be_positive")
    total = max(1, min(int(cases), 20))

    from app.agent_runtime.langgraph_graph import langgraph_graph_status

    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        return {
            "mode": "process_boundary_langgraph_checkpoint",
            "total": total,
            "recovered": 0,
            "failed": total,
            "recovery_rate": 0.0,
            "target": 1.0,
            "passed": False,
            "skipped": True,
            "reason": "checkpointer_dependency_missing",
            "cases": [
                {
                    "case": index,
                    "errors": ["checkpointer_dependency_missing"],
                    "passed": False,
                }
                for index in range(1, total + 1)
            ],
        }

    results = [
        _run_case(
            index,
            lease_ttl_seconds=lease_ttl_seconds,
            timeout_seconds=timeout_seconds,
        )
        for index in range(1, total + 1)
    ]
    recovered = sum(1 for item in results if item["passed"])
    return {
        "mode": "process_boundary_langgraph_checkpoint",
        "total": total,
        "recovered": recovered,
        "failed": total - recovered,
        "recovery_rate": round(recovered / total, 4),
        "target": 1.0,
        "passed": recovered == total,
        "skipped": False,
        "cases": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="LangGraph checkpoint process-boundary drill")
    parser.add_argument("--cases", type=int, default=3)
    parser.add_argument("--lease-ttl-seconds", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--json",
        action="store_true",
        help="保留兼容参数；脚本始终输出机器可读 JSON",
    )
    args = parser.parse_args()
    try:
        report = run_drill(
            cases=args.cases,
            lease_ttl_seconds=args.lease_ttl_seconds,
            timeout_seconds=args.timeout,
        )
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else (0 if report.get("skipped") else 1)


if __name__ == "__main__":
    raise SystemExit(main())
