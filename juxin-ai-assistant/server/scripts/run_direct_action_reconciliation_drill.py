#!/usr/bin/env python3
"""Run a deterministic, local-only drill for direct side-effect ledgers.

This drill never calls a network or external provider.  It exercises the
reservation, replay, conflict, timeout, and reconciliation semantics used by
``DirectActionService`` against a fresh in-memory SQLite database per case.
It is local evidence only; it is not a substitute for staging or production
recovery evidence.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sys
from typing import Any, Callable


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))


def _new_session() -> tuple[Any, Any]:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app import models  # noqa: F401 - register all model metadata
    from app.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    return engine, session


def _count_invocations(db: Any) -> int:
    from sqlalchemy import func, select

    from app.models import DirectActionInvocation

    return int(db.scalar(select(func.count()).select_from(DirectActionInvocation)) or 0)


def _run_case(case_id: str, callback: Callable[[Any], None]) -> dict[str, Any]:
    engine, db = _new_session()
    try:
        callback(db)
        return {"id": case_id, "status": "pass"}
    except Exception as exc:  # pragma: no cover - exercised by injected-failure test
        return {
            "id": case_id,
            "status": "fail",
            "detail": {"error": f"{type(exc).__name__}: {str(exc)[:200]}"},
        }
    finally:
        db.close()
        engine.dispose()


def _success_replay_is_single_effect(db: Any) -> None:
    from app.direct_action_service import DirectActionService

    service = DirectActionService(db)
    request = {"artifact_id": "artifact-1"}
    payload = {"artifact_id": "artifact-1", "download_url": "/exports/artifact-1"}
    invocation, replay = service.begin(
        user_id="drill-user",
        action_name="export_word",
        idempotency_key="success-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert invocation is not None and replay is None
    service.succeed(invocation, status_code=201, payload=payload)

    duplicate, replay = service.begin(
        user_id="drill-user",
        action_name="export_word",
        idempotency_key="success-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert duplicate is None and replay is not None
    assert replay.status_code == 201
    assert replay.payload == payload
    assert _count_invocations(db) == 1


def _idempotency_key_conflict_is_rejected(db: Any) -> None:
    from app.direct_action_service import DirectActionService

    service = DirectActionService(db)
    invocation, replay = service.begin(
        user_id="drill-user",
        action_name="export_word",
        idempotency_key="conflict-key",
        request_payload={"artifact_id": "artifact-1"},
        timeout_seconds=30,
    )
    assert invocation is not None and replay is None
    duplicate, replay = service.begin(
        user_id="drill-user",
        action_name="export_word",
        idempotency_key="conflict-key",
        request_payload={"artifact_id": "artifact-2"},
        timeout_seconds=30,
    )
    assert duplicate is None and replay is not None
    assert replay.status_code == 409
    assert replay.error_code == "DIRECT_ACTION_IDEMPOTENCY_KEY_CONFLICT"
    assert _count_invocations(db) == 1


def _unknown_result_blocks_retry(db: Any) -> None:
    from app.direct_action_service import DirectActionService

    service = DirectActionService(db)
    request = {"capture_id": "capture-1", "save_target": "personal_reference"}
    invocation, replay = service.begin(
        user_id="drill-user",
        action_name="web_capture_confirm",
        idempotency_key="unknown-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert invocation is not None and replay is None
    service.require_reconciliation(invocation, error_message_safe="外部结果未知")

    duplicate, replay = service.begin(
        user_id="drill-user",
        action_name="web_capture_confirm",
        idempotency_key="unknown-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert duplicate is None and replay is not None
    assert replay.status_code == 409
    assert replay.error_code == "DIRECT_ACTION_RECONCILIATION_REQUIRED"
    assert _count_invocations(db) == 1


def _expired_in_progress_moves_to_reconciliation(db: Any) -> None:
    from app.direct_action_service import DirectActionService

    service = DirectActionService(db)
    request = {"capture_id": "capture-2", "save_target": "personal_reference"}
    invocation, replay = service.begin(
        user_id="drill-user",
        action_name="web_capture_confirm",
        idempotency_key="expired-key",
        request_payload=request,
        timeout_seconds=1,
    )
    assert invocation is not None and replay is None
    invocation.started_at = (datetime.now(UTC) - timedelta(seconds=10)).replace(tzinfo=None)
    db.commit()

    duplicate, replay = service.begin(
        user_id="drill-user",
        action_name="web_capture_confirm",
        idempotency_key="expired-key",
        request_payload=request,
        timeout_seconds=1,
    )
    assert duplicate is None and replay is not None
    assert replay.status_code == 409
    assert replay.error_code == "DIRECT_ACTION_RECONCILIATION_REQUIRED"
    db.refresh(invocation)
    assert invocation.status == "reconciliation_required"
    assert _count_invocations(db) == 1


def _failed_result_requires_new_key(db: Any) -> None:
    from app.direct_action_service import DirectActionService

    service = DirectActionService(db)
    request = {"content_id": "content-1"}
    invocation, replay = service.begin(
        user_id="drill-user",
        action_name="export_content_word",
        idempotency_key="failed-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert invocation is not None and replay is None
    service.fail(
        invocation,
        error_code="DRILL_FAILED",
        error_message_safe="本地演练失败",
    )

    duplicate, replay = service.begin(
        user_id="drill-user",
        action_name="export_content_word",
        idempotency_key="failed-key",
        request_payload=request,
        timeout_seconds=30,
    )
    assert duplicate is None and replay is not None
    assert replay.status_code == 409
    assert replay.error_code == "DRILL_FAILED"

    retry, replay = service.begin(
        user_id="drill-user",
        action_name="export_content_word",
        idempotency_key="failed-key-retry",
        request_payload=request,
        timeout_seconds=30,
    )
    assert retry is not None and replay is None
    assert _count_invocations(db) == 2


CASE_BUILDERS: tuple[tuple[str, Callable[[Any], None]], ...] = (
    ("success_replay_is_single_effect", _success_replay_is_single_effect),
    ("idempotency_key_conflict_is_rejected", _idempotency_key_conflict_is_rejected),
    ("unknown_result_blocks_retry", _unknown_result_blocks_retry),
    ("expired_in_progress_moves_to_reconciliation", _expired_in_progress_moves_to_reconciliation),
    ("failed_result_requires_new_key", _failed_result_requires_new_key),
)


def run_drill() -> dict[str, Any]:
    cases = [_run_case(case_id, callback) for case_id, callback in CASE_BUILDERS]
    failed = sum(1 for case in cases if case["status"] != "pass")
    return {
        "schema_version": "1.0",
        "scope": "local_in_memory_only",
        "total": len(cases),
        "passed": failed == 0,
        "passed_count": len(cases) - failed,
        "failed": failed,
        "cases": cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Direct action reconciliation drill")
    parser.add_argument("--json", action="store_true", help="print the full JSON report")
    args = parser.parse_args()
    report = run_drill()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            f"scope={report['scope']} passed={report['passed_count']}/"
            f"{report['total']} failed={report['failed']}"
        )
        for case in report["cases"]:
            print(f"  [{case['status']}] {case['id']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
