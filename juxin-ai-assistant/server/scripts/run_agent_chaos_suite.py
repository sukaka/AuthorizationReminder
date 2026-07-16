#!/usr/bin/env python3
"""Run deterministic, local Agent Loop/Harness chaos cases.

This suite deliberately uses an in-memory SQLite database and no network.  It
checks that cancellation, budgets, model failures, unknown side-effect outcomes,
fencing, and temporary database failures converge to explicit machine-readable
outcomes.
It is a local preflight signal, not evidence that production staging is safe.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import traceback
from datetime import UTC, datetime, timedelta
from typing import Any, Callable


def _ensure_import_path() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)


def _setup_env() -> None:
    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault("AI_LOCAL_BINDING_SECRET", "local-chaos-binding-secret-32chars")
    os.environ.setdefault(
        "CONTENT_ENCRYPTION_KEY",
        base64.urlsafe_b64encode(b"local-chaos-suite-key-32-bytes!!").decode("ascii"),
    )


def _new_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from app.database import Base
    from app import models  # noqa: F401  # register all models before create_all

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine, Session(engine)


def _case_loop_convergence() -> dict[str, Any]:
    from app.agent_runtime.loop_kernel import LoopKernel, LoopKernelInput

    kernel = LoopKernel()
    checks = {
        "cancel": kernel.decide(LoopKernelInput(0, 0, 0, cancel_requested=True)).code == "CANCEL_REQUESTED",
        "confirmation": kernel.decide(LoopKernelInput(0, 0, 0, confirmation_required=True)).code == "CONFIRMATION_REQUIRED",
        "duplicate_block": kernel.decide(LoopKernelInput(0, 0, 0, duplicate_action_count=3)).code == "DUPLICATE_ACTION_BLOCKED",
        "step_budget": kernel.decide(LoopKernelInput(32, 0, 0)).code == "STEP_BUDGET_EXCEEDED",
        "quality_risk": kernel.decide(LoopKernelInput(1, 0, 0, has_output=True, quality_risk="high")).code == "QUALITY_HIGH_RISK",
        "success": kernel.decide(LoopKernelInput(1, 0, 0, has_output=True, quality_passed=True)).action == "complete",
    }
    return {"checks": checks, "passed_checks": sum(checks.values()), "total_checks": len(checks)}


def _case_cancel_and_budget() -> dict[str, Any]:
    from app.agent_run_service import AgentRunService, BudgetExceededError
    from app.crypto import ContentCipher

    engine, db = _new_db()
    try:
        service = AgentRunService(db, ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]))
        cancelled = service.create_run(owner_user_id="chaos-user", input_text="cancel")
        service.request_cancel(cancelled)
        budgeted = service.create_run(
            owner_user_id="chaos-user", input_text="budget", max_model_calls=1
        )
        service.record_model_call(budgeted)
        budget_code = ""
        try:
            service.record_model_call(budgeted)
        except BudgetExceededError as exc:
            budget_code = exc.code
        return {
            "cancel_status": cancelled.status,
            "budget_error_code": budget_code,
            "passed": cancelled.status == "cancelled" and budget_code == "MODEL_CALL_BUDGET_EXCEEDED",
        }
    finally:
        db.close()
        engine.dispose()


def _case_tool_unknown_outcome() -> dict[str, Any]:
    from app.agent_runtime.tool_base import BaseTool, ToolContext, ToolResult
    from app.agent_runtime.tool_registry import ToolRegistry
    from app.models import AgentToolInvocation

    class ChaosExternalTool(BaseTool):
        name = "chaos_external"
        version = "1"
        effect = "external"
        data_scopes = frozenset({"external"})

        def __init__(self) -> None:
            self.calls = 0

        def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
            self.calls += 1
            return ToolResult(tool_name=self.name, payload={"ok": True})

    engine, db = _new_db()
    try:
        tool = ChaosExternalTool()
        registry = ToolRegistry()
        registry.register(tool)
        tool_input = {"value": "same"}
        request_hash = hashlib.sha256(
            json.dumps(tool_input, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        db.add(
            AgentToolInvocation(
                run_id="chaos-run",
                user_id="chaos-user",
                tool_name=tool.name,
                tool_version=tool.version,
                idempotency_key="chaos-1",
                request_hash=request_hash,
                effect="non_idempotent_write",
                status="in_progress",
                started_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=120),
            )
        )
        db.commit()
        result = registry.execute(
            tool.name,
            tool_input,
            ToolContext(
                user_id="chaos-user",
                db=db,
                run_id="chaos-run",
                idempotency_key="chaos-1",
                confirmed_idempotency_keys={"chaos-1"},
            ),
        )
        invocation = db.query(AgentToolInvocation).one()
        passed = (
            result.error_code == "TOOL_RECONCILIATION_REQUIRED"
            and invocation.status == "reconciliation_required"
            and tool.calls == 0
        )
        return {
            "error_code": result.error_code,
            "invocation_status": invocation.status,
            "tool_executions": tool.calls,
            "passed": passed,
        }
    finally:
        db.close()
        engine.dispose()


def _case_tool_timeout_taxonomy() -> dict[str, Any]:
    from app.agent_runtime.tool_base import BaseTool, ToolContext, ToolResult
    from app.agent_runtime.tool_registry import ToolRegistry

    class ChaosTimeoutTool(BaseTool):
        name = "chaos_timeout"
        version = "1"
        effect = "write"
        data_scopes = frozenset({"user"})

        def __init__(self) -> None:
            self.calls = 0

        def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
            self.calls += 1
            raise TimeoutError("simulated tool timeout")

    engine, db = _new_db()
    try:
        tool = ChaosTimeoutTool()
        registry = ToolRegistry()
        registry.register(tool)
        context = ToolContext(
            user_id="chaos-user",
            db=db,
            run_id="chaos-timeout-run",
            idempotency_key="chaos-timeout-1",
            confirmed_idempotency_keys={"chaos-timeout-1"},
        )
        first = registry.execute(tool.name, {"value": "same"}, context)
        replay = registry.execute(tool.name, {"value": "same"}, context)
        return {
            "first_error_code": first.error_code,
            "replay_error_code": replay.error_code,
            "tool_executions": tool.calls,
            "passed": first.error_code == "TOOL_TIMEOUT" and replay.error_code == "TOOL_TIMEOUT" and tool.calls == 1,
        }
    finally:
        db.close()
        engine.dispose()


def _case_model_failure_taxonomy() -> dict[str, Any]:
    import httpx

    from app.server_model_client import _model_http_failure, _model_transport_failure

    request = httpx.Request("POST", "https://model.example.test/v1/chat/completions")
    expectations = {
        401: ("SERVER_MODEL_AUTH_FAILED", 502),
        429: ("SERVER_MODEL_RATE_LIMITED", 429),
        503: ("SERVER_MODEL_UPSTREAM_UNAVAILABLE", 503),
        408: ("SERVER_MODEL_TIMEOUT", 504),
    }
    checks = {}
    for status_code, expected in expectations.items():
        response = httpx.Response(status_code, request=request)
        failure = _model_http_failure(response)
        checks[str(status_code)] = (failure.detail, failure.status_code) == expected
    timeout = _model_transport_failure(httpx.ReadTimeout("simulated timeout", request=request))
    checks["transport_timeout"] = (timeout.detail, timeout.status_code) == ("SERVER_MODEL_TIMEOUT", 504)
    return {"checks": checks, "passed_checks": sum(checks.values()), "total_checks": len(checks)}


def _case_lease_fencing() -> dict[str, Any]:
    from app.agent_contracts import AgentRunStatus
    from app.agent_run_service import AgentRunService, LeaseLostError
    from app.crypto import ContentCipher

    engine, db = _new_db()
    try:
        service = AgentRunService(db, ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]))
        row = service.create_run(owner_user_id="chaos-user", input_text="fence")
        base = datetime(2026, 1, 1, tzinfo=UTC).replace(tzinfo=None)
        first = service.acquire_lease(row.uuid, "worker-a", ttl_seconds=1, now=base)
        db.commit()
        second = service.acquire_lease(row.uuid, "worker-b", ttl_seconds=1, now=base + timedelta(seconds=2))
        db.commit()
        rejected = False
        try:
            service.transition_status(
                row,
                AgentRunStatus.RUNNING,
                worker_id="worker-a",
                fencing_token=first,
                now=base + timedelta(seconds=2),
            )
        except LeaseLostError:
            rejected = True
        return {"first_token": first, "second_token": second, "stale_write_rejected": rejected, "passed": first == 1 and second == 2 and rejected}
    finally:
        db.close()
        engine.dispose()


def _case_db_unavailable_fail_closed() -> dict[str, Any]:
    from sqlalchemy import event, text
    from sqlalchemy.exc import OperationalError

    engine, db = _new_db()
    fired = {"value": False}

    def fail_once(conn, cursor, statement, parameters, context, executemany):
        if not fired["value"]:
            fired["value"] = True
            raise OperationalError("simulated temporary database outage", statement, parameters)

    event.listen(engine, "before_cursor_execute", fail_once)
    try:
        failed_closed = False
        try:
            db.execute(text("select 1"))
        except OperationalError:
            failed_closed = True
            db.rollback()
        recovered = db.execute(text("select 1")).scalar_one() == 1
        return {"injected_failure": fired["value"], "failed_closed": failed_closed, "recovered": recovered, "passed": failed_closed and recovered}
    finally:
        event.remove(engine, "before_cursor_execute", fail_once)
        db.close()
        engine.dispose()


def _run_case(case_id: str, name: str, runner: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        detail = runner()
        passed = bool(detail.get("passed", detail.get("passed_checks") == detail.get("total_checks")))
        return {"id": case_id, "name": name, "status": "pass" if passed else "fail", "detail": detail}
    except Exception as exc:
        return {"id": case_id, "name": name, "status": "fail", "detail": {"error": str(exc), "trace": traceback.format_exc()[-600:]}}


def run_suite(*, repeat: int = 1) -> dict[str, Any]:
    if repeat < 1 or repeat > 20:
        raise ValueError("repeat must be between 1 and 20")
    _ensure_import_path()
    _setup_env()
    case_factories = (
        ("loop_convergence", "Loop 收敛与阻断", _case_loop_convergence),
        ("cancel_and_budget", "取消收敛与预算越界", _case_cancel_and_budget),
        ("tool_unknown_outcome", "外部工具未知结果对账阻断", _case_tool_unknown_outcome),
        ("tool_timeout_taxonomy", "工具超时错误分类与回放", _case_tool_timeout_taxonomy),
        ("model_failure_taxonomy", "模型失败错误分类", _case_model_failure_taxonomy),
        ("lease_fencing", "旧租约 fencing 写入拒绝", _case_lease_fencing),
        ("db_unavailable_fail_closed", "数据库短暂不可用 fail-closed", _case_db_unavailable_fail_closed),
    )
    cases: list[dict[str, Any]] = []
    for round_number in range(1, repeat + 1):
        for case_id, name, runner in case_factories:
            case = _run_case(case_id, name, runner)
            case["round"] = round_number
            cases.append(case)
    failed = [case for case in cases if case["status"] != "pass"]
    return {
        "schema_version": "1.0",
        "overall": "pass" if not failed else "fail",
        "passed": not failed,
        "repeat": repeat,
        "total": len(cases),
        "passed_count": len(cases) - len(failed),
        "failed_count": len(failed),
        "cases": cases,
        "scope": "local_in_memory_only",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic local Agent Loop/Harness chaos suite")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = run_suite(repeat=args.repeat)
    except ValueError as exc:
        parser.error(str(exc))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"overall={report['overall']} pass={report['passed_count']} fail={report['failed_count']}")
        for case in report["cases"]:
            print(f"  [{case['status']}] {case['name']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
