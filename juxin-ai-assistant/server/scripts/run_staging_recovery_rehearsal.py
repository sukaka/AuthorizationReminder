#!/usr/bin/env python3
"""Run a local process-boundary recovery rehearsal without staging credentials.

Each case creates an isolated SQLite database, starts Worker A, hard-kills it
while its lease is held, waits for expiry, and lets Worker B take over.  The
parent then checks that the old fencing token cannot renew or write.  This is
evidence for the staging procedure, not a substitute for the staging run.

Usage:
  python scripts/run_staging_recovery_rehearsal.py --cases 3
  python scripts/run_staging_recovery_rehearsal.py --cases 3 --json
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
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import get_context
from pathlib import Path
from typing import Any


MAX_CASES = 1000
MAX_PARALLELISM = 32


def _ensure_import_path() -> None:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))


def _setup_env() -> None:
    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault(
        "AI_LOCAL_BINDING_SECRET",
        "local-binding-secret-for-recovery-rehearsal-32",
    )
    if not os.environ.get("CONTENT_ENCRYPTION_KEY"):
        os.environ["CONTENT_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(
            b"recovery-rehearsal-key-32-bytes!"
        ).decode("ascii")


def _lease_worker(
    database_url: str,
    run_id: str,
    worker_id: str,
    ttl_seconds: float,
    result_connection,
    *,
    wait_for_kill: bool,
) -> None:
    """Acquire a lease in an independent process and optionally wait to be killed."""

    _ensure_import_path()
    _setup_env()
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService
    from app.crypto import ContentCipher

    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            token = AgentRunService(
                db,
                ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
            ).acquire_lease(run_id, worker_id, ttl_seconds=ttl_seconds)
            db.commit()
        result_connection.send({"token": token})
        result_connection.close()
        if wait_for_kill:
            while True:
                time.sleep(60)
    finally:
        engine.dispose()


def _create_run(database_url: str, case_number: int) -> str:
    _ensure_import_path()
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService
    from app.crypto import ContentCipher
    from app.database import Base
    from app import models  # noqa: F401  # register models before create_all

    engine = create_engine(database_url)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            row = AgentRunService(
                db,
                ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
            ).create_run(
                owner_user_id="recovery-rehearsal",
                input_text=f"进程边界恢复演练 {case_number}",
                run_type="complex",
            )
            db.commit()
            return row.uuid
    finally:
        engine.dispose()


def _check_takeover(
    database_url: str,
    run_id: str,
    stale_token: int,
    active_token: int,
) -> tuple[bool, bool]:
    _ensure_import_path()
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.agent_run_service import AgentRunService, LeaseLostError
    from app.crypto import ContentCipher

    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            service = AgentRunService(
                db,
                ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
            )
            row = service.get_owned_run(run_id, "recovery-rehearsal")
            if row is None:
                return False, False
            renewed = service.renew_lease(run_id, "worker-a", stale_token)
            fenced = False
            try:
                service.assert_lease(row, "worker-a", stale_token)
            except LeaseLostError:
                fenced = True
            released = service.release_lease(run_id, "worker-b", active_token)
            db.commit()
            return (not renewed and released), fenced
    finally:
        engine.dispose()


def _run_case(
    case_number: int, *, lease_ttl_seconds: float, timeout_seconds: float
) -> dict[str, Any]:
    context = get_context("spawn")
    result: dict[str, Any] = {
        "case": case_number,
        "first_worker_exitcode": None,
        "second_worker_exitcode": None,
        "first_token": None,
        "second_token": None,
        "fencing_takeover": False,
        "stale_worker_fenced": False,
        "errors": [],
    }
    with tempfile.TemporaryDirectory(prefix="juxin-recovery-rehearsal-") as directory:
        database_url = f"sqlite+pysqlite:///{Path(directory) / 'rehearsal.db'}"
        run_id = _create_run(database_url, case_number)
        first_receiver, first_sender = context.Pipe(duplex=False)
        first_worker = context.Process(
            target=_lease_worker,
            args=(database_url, run_id, "worker-a", lease_ttl_seconds, first_sender),
            kwargs={"wait_for_kill": True},
        )
        second_worker = None
        second_receiver = None
        second_sender = None
        try:
            first_worker.start()
            first_sender.close()
            if not first_receiver.poll(timeout_seconds):
                raise TimeoutError("first_worker_token_timeout")
            first_payload = first_receiver.recv()
            result["first_token"] = first_payload.get("token")
            os.kill(first_worker.pid, signal.SIGKILL)
            first_worker.join(timeout=timeout_seconds)
            if first_worker.is_alive():
                first_worker.kill()
                first_worker.join(timeout=timeout_seconds)
            result["first_worker_exitcode"] = first_worker.exitcode
            time.sleep(lease_ttl_seconds + 0.2)

            second_receiver, second_sender = context.Pipe(duplex=False)
            second_worker = context.Process(
                target=_lease_worker,
                args=(database_url, run_id, "worker-b", lease_ttl_seconds, second_sender),
                kwargs={"wait_for_kill": False},
            )
            second_worker.start()
            second_sender.close()
            if not second_receiver.poll(timeout_seconds):
                raise TimeoutError("second_worker_token_timeout")
            second_payload = second_receiver.recv()
            result["second_token"] = second_payload.get("token")
            second_worker.join(timeout=timeout_seconds)
            if second_worker.is_alive():
                second_worker.kill()
                second_worker.join(timeout=timeout_seconds)
            result["second_worker_exitcode"] = second_worker.exitcode

            first_token = result["first_token"]
            second_token = result["second_token"]
            result["fencing_takeover"] = (
                isinstance(first_token, int)
                and isinstance(second_token, int)
                and second_token == first_token + 1
            )
            if result["fencing_takeover"]:
                fenced, stale_fenced = _check_takeover(
                    database_url,
                    run_id,
                    first_token,
                    second_token,
                )
                result["fencing_takeover"] = fenced
                result["stale_worker_fenced"] = stale_fenced
            if not result["fencing_takeover"]:
                result["errors"].append("fencing_takeover_failed")
            if not result["stale_worker_fenced"]:
                result["errors"].append("stale_worker_not_fenced")
        except Exception as exc:
            result["errors"].append(type(exc).__name__ + ":" + str(exc)[:200])
        finally:
            if first_worker.is_alive():
                first_worker.kill()
                first_worker.join(timeout=timeout_seconds)
            if second_worker is not None and second_worker.is_alive():
                second_worker.kill()
                second_worker.join(timeout=timeout_seconds)
            first_receiver.close()
            if first_sender is not None:
                first_sender.close()
            if second_receiver is not None:
                second_receiver.close()
            if second_sender is not None:
                second_sender.close()
            result["first_worker_exitcode"] = first_worker.exitcode
            if second_worker is not None:
                result["second_worker_exitcode"] = second_worker.exitcode
            if result["first_worker_exitcode"] != -signal.SIGKILL:
                result["errors"].append("first_worker_not_sigkill")
            if result["second_worker_exitcode"] != 0:
                result["errors"].append("second_worker_failed")
    result["passed"] = not result["errors"]
    return result


def run_rehearsal(
    *,
    cases: int = 3,
    lease_ttl_seconds: float = 1.0,
    timeout_seconds: float = 30.0,
    parallelism: int = 1,
) -> dict[str, Any]:
    """Return deterministic, machine-readable local recovery evidence."""

    _ensure_import_path()
    _setup_env()
    if isinstance(cases, bool) or not isinstance(cases, int) or cases <= 0:
        raise ValueError("cases_must_be_positive")
    if cases > MAX_CASES:
        raise ValueError(f"cases_exceed_maximum_{MAX_CASES}")
    if lease_ttl_seconds <= 0:
        raise ValueError("lease_ttl_seconds_must_be_positive")
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds_must_be_positive")
    if isinstance(parallelism, bool) or not isinstance(parallelism, int) or parallelism <= 0:
        raise ValueError("parallelism_must_be_positive")
    if parallelism > MAX_PARALLELISM:
        raise ValueError(f"parallelism_exceed_maximum_{MAX_PARALLELISM}")
    total = cases
    worker_count = min(parallelism, total)
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = list(
            executor.map(
                lambda index: _run_case(
                    index,
                    lease_ttl_seconds=lease_ttl_seconds,
                    timeout_seconds=timeout_seconds,
                ),
                range(1, total + 1),
            )
        )
    recovered = sum(1 for item in results if item["passed"])
    return {
        "schema_version": "1.0",
        "scope": "local_process_boundary",
        "environment": "local",
        "mode": "local_process_boundary_rehearsal",
        "total": total,
        "recovered": recovered,
        "failed": total - recovered,
        "recovery_rate": round(recovered / total, 4),
        "target": 1.0,
        "passed": recovered == total,
        "cases": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Local process-boundary recovery rehearsal")
    parser.add_argument("--cases", type=int, default=3)
    parser.add_argument("--lease-ttl-seconds", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--parallelism", type=int, default=1)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = run_rehearsal(
            cases=args.cases,
            lease_ttl_seconds=args.lease_ttl_seconds,
            timeout_seconds=args.timeout,
            parallelism=args.parallelism,
        )
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
