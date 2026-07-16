#!/usr/bin/env python3
"""Fail-closed gate for the final staging Agent Loop evidence bundle.

The gate consumes four read-only artifacts collected by operators:

* ``run_staging_preflight.py --mode staging --json`` output;
* a machine-readable dual-runtime worker recovery report;
* the JSONL produced by ``run_ga_observe.py``.
* a machine-readable release evidence report covering migration, tests,
  canary rollout, rollback drill, and production checkpointer review.

It never calls a remote service, reads a Bearer token, or changes a database.
Local rehearsal output is intentionally rejected when the gate runs in its
default ``staging`` mode.

Example::

  python scripts/run_staging_preflight.py --mode staging \
    --base-url https://staging.example.com \
    --bearer-token-env STAGING_BEARER_TOKEN \
    --release-id release-20260714-001 --json > preflight.json
  python scripts/run_staging_recovery_rehearsal.py --cases 1000 --json > recovery.json
  python scripts/run_ga_observe.py --base-url https://staging.example.com \
    --bearer-token-env STAGING_BEARER_TOKEN \
    --release-id release-20260714-001 \
    --out ../docs/plans/ga-observe-staging.jsonl
  python scripts/evaluate_staging_evidence.py \
    --preflight preflight.json --recovery recovery.json \
    --observe ../docs/plans/ga-observe-staging.jsonl \
    --release release-evidence.json --json

The recovery command above is only a local rehearsal unless its report is
replaced by the deployment-platform report with ``environment=staging`` and
the required worker/fencing evidence fields.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from math import isfinite
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

try:  # package import for tests; direct import for ``python scripts/foo.py``
    from app.agent_runtime.core_task_evidence import validate_core_task_evidence
    from scripts.evaluate_ga_observe import evaluate, load_rows
    from scripts.observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )
    from scripts.staging_auth import normalize_release_id
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from app.agent_runtime.core_task_evidence import validate_core_task_evidence
    from evaluate_ga_observe import evaluate, load_rows
    from observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )
    from staging_auth import normalize_release_id


SCHEMA_VERSION = "1.0"
RECOVERY_SCHEMA_VERSION = "1.1"
RELEASE_SCHEMA_VERSION = "1.4"
MIN_RECOVERY_CASES = 1000
MIN_RECOVERY_RATE = 0.999
MIN_ROLLOUT_STAGE_DURATION = timedelta(hours=48)
EXPECTED_ROLLOUT_STAGES = (
    ("internal", 0),
    ("1_percent", 1),
    ("5_percent", 5),
    ("20_percent", 20),
    ("50_percent", 50),
    ("100_percent", 100),
)


def load_json(path: Path) -> dict[str, Any] | None:
    """Load one JSON object without exposing malformed artifact contents."""

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def load_observation_rows(path: Path) -> list[dict[str, Any]]:
    """Load the observation artifact without silently dropping corrupt rows."""

    return load_rows(path, strict=True)


def _check(check_id: str, passed: bool, detail: dict[str, Any]) -> dict[str, Any]:
    return {"id": check_id, "status": "pass" if passed else "fail", "detail": detail}


def _nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def _json_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def _json_nonnegative_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if isfinite(parsed) and parsed >= 0 else None


def _nonempty_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _timestamp(value: Any) -> datetime | None:
    """Parse an explicit, timezone-aware ISO-8601 timestamp."""

    text = _nonempty_text(value)
    if text is None:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None


def _release_identity(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return normalize_release_id(value, required=True)
    except ValueError:
        return None


def _staging_base_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().rstrip("/")
    parsed = urlsplit(normalized)
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None
    return normalized


def _validate_rollout_stages(
    value: Any,
    *,
    canary_started_at: datetime | None,
    canary_completed_at: datetime | None,
) -> dict[str, Any]:
    """Validate the ordered, sampled 48-hour rollout evidence timeline."""

    stages = value if isinstance(value, list) else []
    structure_ok = isinstance(value, list) and len(stages) == len(
        EXPECTED_ROLLOUT_STAGES
    )
    identity_ok = structure_ok
    timestamps_ok = structure_ok
    durations_ok = structure_ok
    order_ok = structure_ok
    samples_ok = structure_ok
    statuses_ok = structure_ok
    stage_ids: list[str | None] = []
    rollout_percentages: list[int | None] = []
    first_started_at: datetime | None = None
    last_completed_at: datetime | None = None
    previous_completed_at: datetime | None = None

    for index, (expected_stage, expected_percent) in enumerate(
        EXPECTED_ROLLOUT_STAGES
    ):
        raw_stage = stages[index] if index < len(stages) else None
        if not isinstance(raw_stage, dict):
            identity_ok = False
            timestamps_ok = False
            durations_ok = False
            order_ok = False
            samples_ok = False
            statuses_ok = False
            stage_ids.append(None)
            rollout_percentages.append(None)
            continue

        stage_id = _nonempty_text(raw_stage.get("stage"))
        rollout_percent = _json_nonnegative_int(raw_stage.get("rollout_percent"))
        started_at = _timestamp(raw_stage.get("started_at"))
        completed_at = _timestamp(raw_stage.get("completed_at"))
        finished_runs = _json_nonnegative_int(raw_stage.get("finished_runs"))

        stage_ids.append(stage_id)
        rollout_percentages.append(rollout_percent)
        identity_ok = identity_ok and (
            stage_id == expected_stage and rollout_percent == expected_percent
        )
        stage_timestamps_ok = (
            started_at is not None
            and completed_at is not None
            and completed_at >= started_at
        )
        timestamps_ok = timestamps_ok and stage_timestamps_ok
        durations_ok = durations_ok and (
            stage_timestamps_ok
            and completed_at - started_at >= MIN_ROLLOUT_STAGE_DURATION
        )
        order_ok = order_ok and (
            started_at is not None
            and (
                previous_completed_at is None
                or started_at >= previous_completed_at
            )
        )
        samples_ok = samples_ok and finished_runs is not None and finished_runs > 0
        statuses_ok = statuses_ok and raw_stage.get("status") == "passed"

        if index == 0:
            first_started_at = started_at
        if index == len(EXPECTED_ROLLOUT_STAGES) - 1:
            last_completed_at = completed_at
        previous_completed_at = completed_at

    bounds_ok = (
        structure_ok
        and canary_started_at is not None
        and canary_completed_at is not None
        and first_started_at == canary_started_at
        and last_completed_at == canary_completed_at
    )
    passed = (
        structure_ok
        and identity_ok
        and timestamps_ok
        and durations_ok
        and order_ok
        and samples_ok
        and statuses_ok
        and bounds_ok
    )
    return {
        "ok": passed,
        "structure_ok": structure_ok,
        "identity_ok": identity_ok,
        "timestamps_ok": timestamps_ok,
        "durations_ok": durations_ok,
        "order_ok": order_ok,
        "samples_ok": samples_ok,
        "statuses_ok": statuses_ok,
        "bounds_ok": bounds_ok,
        "stage_ids": stage_ids,
        "rollout_percentages": rollout_percentages,
    }


def _case_identity(case: dict[str, Any]) -> str | None:
    """Return a stable case identity without accepting ambiguous values."""

    field = "case_id" if "case_id" in case else "case"
    value = case.get(field)
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _validate_preflight(report: dict[str, Any], *, mode: str) -> dict[str, Any]:
    checks = report.get("checks")
    required = {
        "harness_spec",
        "migration_graph",
        "runtime_mode",
        "langgraph_dependency_isolation",
        "authorization",
        "staging_transport",
        "release_identity",
        "observation_policy",
    }
    check_items = checks if isinstance(checks, list) else []
    raw_check_ids = [item.get("id") for item in check_items if isinstance(item, dict)]
    check_ids = [item for item in raw_check_ids if isinstance(item, str)]
    checks_shape_ok = bool(check_items) and all(
        isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and item.get("status") in {"pass", "fail"}
        for item in check_items
    )
    unique_ids_ok = (
        len(raw_check_ids) == len(check_ids)
        and len(check_ids) == len(set(check_ids))
    )
    check_map = {
        item["id"]: item
        for item in check_items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    statuses_ok = all(check_map.get(item, {}).get("status") == "pass" for item in required)
    actual_failed_checks = sorted(
        item["id"]
        for item in check_items
        if isinstance(item, dict)
        and item.get("status") != "pass"
        and isinstance(item.get("id"), str)
    )
    reported_failed_checks = report.get("failed_checks")
    failed_checks_shape_ok = isinstance(reported_failed_checks, list) and all(
        isinstance(item, str) for item in reported_failed_checks
    )
    status_consistent = (
        failed_checks_shape_ok
        and sorted(reported_failed_checks) == actual_failed_checks
        and report.get("overall") == ("pass" if not actual_failed_checks else "fail")
    )
    release_id = _release_identity(report.get("release_id"))
    base_url = _staging_base_url(report.get("base_url"))
    generated_at = _timestamp(report.get("generated_at"))
    identity_ok = release_id is not None and base_url is not None and generated_at is not None
    passed = (
        report.get("overall") == "pass"
        and report.get("mode") == mode
        and checks_shape_ok
        and unique_ids_ok
        and statuses_ok
        and status_consistent
        and identity_ok
    )
    return _check(
        "preflight",
        passed,
        {
            "artifact_present": bool(report),
            "mode": report.get("mode"),
            "required_checks": sorted(required),
            "failed_checks": reported_failed_checks if failed_checks_shape_ok else None,
            "checks_shape_ok": checks_shape_ok,
            "unique_ids_ok": unique_ids_ok,
            "status_consistent": status_consistent,
            "identity_ok": identity_ok,
            "release_id": release_id,
            "base_url": base_url,
        },
    )


def _validate_recovery(
    report: dict[str, Any],
    *,
    mode: str,
    min_cases: int,
    min_rate: float,
) -> dict[str, Any]:
    total = _nonnegative_int(report.get("total"))
    recovered = _nonnegative_int(report.get("recovered"))
    failed = _nonnegative_int(report.get("failed"))
    recovery_rate = _number(report.get("recovery_rate"))
    target = _number(report.get("target"))
    cases = report.get("cases")
    cases_shape_ok = isinstance(cases, list) and total is not None and len(cases) == total
    case_results_ok = cases_shape_ok and all(
        isinstance(case, dict) and isinstance(case.get("passed"), bool) for case in cases
    )
    case_id_values = (
        [_case_identity(case) for case in cases if isinstance(case, dict)]
        if cases_shape_ok
        else []
    )
    case_identity_shape_ok = (
        cases_shape_ok
        and len(case_id_values) == len(cases)
        and all(value is not None for value in case_id_values)
    )
    case_identity_unique_ok = (
        case_identity_shape_ok
        and len(set(case_id_values)) == len(case_id_values)
    )
    passed_case_count = (
        sum(
            1
            for case in cases
            if isinstance(case, dict) and case.get("passed") is True
        )
        if cases_shape_ok
        else 0
    )
    count_consistent = (
        total is not None
        and recovered is not None
        and failed is not None
        and recovered + failed == total
        and (not cases_shape_ok or passed_case_count == recovered)
    )
    rate_consistent = (
        total is not None
        and recovered is not None
        and recovery_rate is not None
        and abs(recovery_rate - (recovered / total if total else 0.0)) <= 0.0001
    )
    zero_counters = all(
        _nonnegative_int(report.get(field)) == 0
        for field in ("duplicate_side_effects", "dual_owner_incidents")
    )
    run_id = _nonempty_text(report.get("run_id"))
    worker_a_id = _nonempty_text(report.get("worker_a_id"))
    worker_b_id = _nonempty_text(report.get("worker_b_id"))
    worker_a_sigkill_at = _timestamp(report.get("worker_a_sigkill_at"))
    takeover_event = report.get("takeover_event")
    takeover_event_at = (
        _timestamp(takeover_event.get("at"))
        if isinstance(takeover_event, dict)
        else None
    )
    timeline_shape_ok = (
        run_id is not None
        and worker_a_id is not None
        and worker_b_id is not None
        and worker_a_id != worker_b_id
        and worker_a_sigkill_at is not None
        and isinstance(takeover_event, dict)
        and takeover_event.get("type") == "lease_takeover"
        and takeover_event.get("run_id") == run_id
        and takeover_event.get("worker_id") == worker_b_id
        and takeover_event_at is not None
        and takeover_event_at >= worker_a_sigkill_at
        and report.get("final_status") == "succeeded"
    )
    kill_evidence = all(report.get(field) is True for field in (
        "worker_a_sigkilled",
        "worker_b_took_over",
        "stale_worker_fenced",
    ))
    passed = (
        report.get("schema_version") == RECOVERY_SCHEMA_VERSION
        and report.get("environment") == mode
        and isinstance(report.get("mode"), str)
        and report["mode"].startswith("staging_")
        and report.get("scope") == "dual_runtime_process_boundary"
        and report.get("passed") is True
        and total is not None
        and total >= min_cases
        and recovered is not None
        and failed is not None
        and recovery_rate is not None
        and recovery_rate >= min_rate
        and target is not None
        and target >= min_rate
        and count_consistent
        and rate_consistent
        and cases_shape_ok
        and case_results_ok
        and case_identity_shape_ok
        and case_identity_unique_ok
        and zero_counters
        and timeline_shape_ok
        and kill_evidence
        and _release_identity(report.get("release_id")) is not None
        and _staging_base_url(report.get("base_url")) is not None
    )
    return _check(
        "recovery",
        passed,
        {
            "schema_version": report.get("schema_version"),
            "environment": report.get("environment"),
            "mode": report.get("mode"),
            "total": total,
            "recovered": recovered,
            "failed": failed,
            "recovery_rate": recovery_rate,
            "min_cases": min_cases,
            "min_rate": min_rate,
            "count_consistent": count_consistent,
            "rate_consistent": rate_consistent,
            "cases_shape_ok": cases_shape_ok,
            "case_results_ok": case_results_ok,
            "case_identity_shape_ok": case_identity_shape_ok,
            "case_identity_unique_ok": case_identity_unique_ok,
            "timeline_shape_ok": timeline_shape_ok,
            "kill_evidence": kill_evidence,
            "release_id": _release_identity(report.get("release_id")),
            "base_url": _staging_base_url(report.get("base_url")),
            "zero_duplicate_or_dual_owner_counters": zero_counters,
        },
    )


def _validate_observation(
    rows: list[Any],
    *,
    min_days: int,
    min_success_rate: float,
    min_finished_runs: int,
) -> dict[str, Any]:
    if not isinstance(rows, list):
        return _check(
            "observation",
            False,
            {
                "overall": "invalid_artifact",
                "samples": 0,
                "transport_failures": 0,
                "malformed_rows": 1,
            },
        )
    transport_failures = 0
    identity_failures = 0
    malformed_rows = 0
    for row in rows:
        if not isinstance(row, dict):
            malformed_rows += 1
            transport_failures += 1
            identity_failures += 1
            continue
        if _release_identity(row.get("release_id")) is None:
            identity_failures += 1
        raw_url = row.get("base_url")
        if _staging_base_url(raw_url) is None:
            transport_failures += 1
    observation = evaluate(
        rows,
        min_days=min_days,
        require_ready=True,
        min_success_rate=min_success_rate,
        min_finished_runs=min_finished_runs,
    )
    passed = (
        observation.get("overall") == "pass"
        and transport_failures == 0
        and identity_failures == 0
        and malformed_rows == 0
    )
    return _check(
        "observation",
        passed,
        {
            "overall": observation.get("overall"),
            "samples": observation.get("samples"),
            "unique_days": observation.get("unique_days"),
            "consecutive_days": observation.get("consecutive_days"),
            "min_days": min_days,
            "transport_failures": transport_failures,
            "identity_failures": identity_failures,
            "malformed_rows": malformed_rows,
            "fail_count": observation.get("fail_count"),
            "insufficient_count": observation.get("insufficient_count"),
        },
    )


def _validate_release(report: dict[str, Any], *, mode: str) -> dict[str, Any]:
    migration_raw = report.get("migration")
    tests_raw = report.get("tests")
    core_tasks_raw = report.get("core_task_evaluation")
    canary_raw = report.get("canary")
    rollback_raw = report.get("rollback_drill")
    checkpointer_raw = report.get("production_checkpointer_review")
    migration = migration_raw if isinstance(migration_raw, dict) else {}
    tests = tests_raw if isinstance(tests_raw, dict) else {}
    core_tasks = core_tasks_raw if isinstance(core_tasks_raw, dict) else {}
    canary = canary_raw if isinstance(canary_raw, dict) else {}
    rollback = rollback_raw if isinstance(rollback_raw, dict) else {}
    checkpointer = checkpointer_raw if isinstance(checkpointer_raw, dict) else {}

    generated_at = _timestamp(report.get("generated_at"))
    migration_at = _timestamp(migration.get("applied_at"))
    tests_at = _timestamp(tests.get("completed_at"))
    core_tasks_at = _timestamp(core_tasks.get("completed_at"))
    canary_started_at = _timestamp(canary.get("started_at"))
    canary_completed_at = _timestamp(canary.get("completed_at"))
    rollback_at = _timestamp(rollback.get("executed_at"))
    checkpointer_at = _timestamp(checkpointer.get("reviewed_at"))

    from_revision = _nonempty_text(migration.get("from_revision"))
    to_revision = _nonempty_text(migration.get("to_revision"))
    tests_passed = _json_nonnegative_int(tests.get("passed"))
    tests_failed = _json_nonnegative_int(tests.get("failed"))
    tests_skipped = _json_nonnegative_int(tests.get("skipped"))
    core_task_evaluation = validate_core_task_evidence(
        core_tasks_raw,
        environment=mode,
        execution_not_before=tests_at,
    )
    core_task_identity_ok = (
        _release_identity(core_tasks.get("release_id"))
        == _release_identity(report.get("release_id"))
        and _staging_base_url(core_tasks.get("base_url"))
        == _staging_base_url(report.get("base_url"))
    )
    tests_identity_ok = (
        _release_identity(tests.get("release_id"))
        == _release_identity(report.get("release_id"))
        and _release_identity(tests.get("release_id")) is not None
        and _staging_base_url(tests.get("base_url"))
        == _staging_base_url(report.get("base_url"))
        and _staging_base_url(tests.get("base_url")) is not None
    )
    rollout_stages = _validate_rollout_stages(
        canary.get("rollout_stages"),
        canary_started_at=canary_started_at,
        canary_completed_at=canary_completed_at,
    )
    baseline_success_rate = _json_nonnegative_number(
        canary.get("baseline_success_rate")
    )
    candidate_success_rate = _json_nonnegative_number(
        canary.get("candidate_success_rate")
    )
    p0_incidents = _json_nonnegative_int(canary.get("p0_incidents"))
    p1_incidents = _json_nonnegative_int(canary.get("p1_incidents"))
    duplicate_side_effects = _json_nonnegative_int(
        canary.get("duplicate_side_effects")
    )
    dual_owner_incidents = _json_nonnegative_int(
        canary.get("dual_owner_incidents")
    )
    rollback_duration = _json_nonnegative_number(rollback.get("duration_seconds"))

    top_level_ok = (
        report.get("schema_version") == RELEASE_SCHEMA_VERSION
        and report.get("environment") == mode
        and _release_identity(report.get("release_id")) is not None
        and _staging_base_url(report.get("base_url")) is not None
        and generated_at is not None
    )
    migration_ok = (
        isinstance(migration_raw, dict)
        and _nonempty_text(migration.get("record_id")) is not None
        and from_revision is not None
        and to_revision is not None
        and from_revision != to_revision
        and migration_at is not None
        and migration.get("status") == "succeeded"
        and migration.get("single_head_verified") is True
        and migration.get("expand_contract") is True
    )
    tests_ok = (
        isinstance(tests_raw, dict)
        and _nonempty_text(tests.get("report_id")) is not None
        and tests_at is not None
        and tests.get("status") == "passed"
        and tests_passed is not None
        and tests_passed > 0
        and tests_failed == 0
        and tests_skipped is not None
        and tests.get("harness_release_gate") is True
        and tests_identity_ok
    )
    core_tasks_ok = (
        isinstance(core_tasks_raw, dict)
        and core_task_evaluation["ok"]
        and core_task_identity_ok
    )
    canary_ok = (
        isinstance(canary_raw, dict)
        and _nonempty_text(canary.get("report_id")) is not None
        and canary_started_at is not None
        and canary_completed_at is not None
        and canary_completed_at >= canary_started_at
        and canary.get("status") == "passed"
        and rollout_stages["ok"]
        and baseline_success_rate is not None
        and baseline_success_rate <= 1
        and candidate_success_rate is not None
        and candidate_success_rate <= 1
        and candidate_success_rate >= baseline_success_rate
        and p0_incidents == 0
        and p1_incidents == 0
        and duplicate_side_effects == 0
        and dual_owner_incidents == 0
    )
    rollback_ok = (
        isinstance(rollback_raw, dict)
        and _nonempty_text(rollback.get("drill_id")) is not None
        and rollback_at is not None
        and rollback.get("status") == "succeeded"
        and rollback_duration is not None
        and rollback_duration <= 15 * 60
        and rollback.get("feature_flag_restored") is True
        and rollback.get("target_runtime") == "native"
        and rollback.get("new_schema_preserved") is True
    )
    checkpointer_ok = (
        isinstance(checkpointer_raw, dict)
        and _nonempty_text(checkpointer.get("review_id")) is not None
        and checkpointer_at is not None
        and _nonempty_text(checkpointer.get("reviewer")) is not None
        and _nonempty_text(checkpointer.get("backend")) is not None
        and checkpointer.get("status") == "approved"
        and checkpointer.get("durable") is True
        and checkpointer.get("multi_instance_supported") is True
        and checkpointer.get("fencing_supported") is True
        and _nonempty_text(checkpointer.get("restore_test_report_id")) is not None
    )
    timeline_ok = (
        generated_at is not None
        and migration_at is not None
        and tests_at is not None
        and core_tasks_at is not None
        and canary_started_at is not None
        and canary_completed_at is not None
        and rollback_at is not None
        and checkpointer_at is not None
        and migration_at <= tests_at <= core_tasks_at <= canary_started_at
        and canary_started_at <= canary_completed_at
        and canary_completed_at <= rollback_at <= generated_at
        and canary_completed_at <= checkpointer_at <= generated_at
    )
    passed = (
        top_level_ok
        and migration_ok
        and tests_ok
        and core_tasks_ok
        and canary_ok
        and rollback_ok
        and checkpointer_ok
        and timeline_ok
    )
    return _check(
        "release",
        passed,
        {
            "artifact_present": bool(report),
            "schema_version": report.get("schema_version"),
            "environment": report.get("environment"),
            "release_id": report.get("release_id"),
            "base_url": _staging_base_url(report.get("base_url")),
            "top_level_ok": top_level_ok,
            "migration_ok": migration_ok,
            "tests_ok": tests_ok,
            "tests_identity_ok": tests_identity_ok,
            "core_tasks_ok": core_tasks_ok,
            "core_task_identity_ok": core_task_identity_ok,
            "core_task_evaluation": core_task_evaluation,
            "canary_ok": canary_ok,
            "rollback_ok": rollback_ok,
            "production_checkpointer_ok": checkpointer_ok,
            "timeline_ok": timeline_ok,
            "rollout_stages_ok": rollout_stages["ok"],
            "rollout_stage_ids": rollout_stages["stage_ids"],
            "rollout_percentages": rollout_stages["rollout_percentages"],
            "rollout_structure_ok": rollout_stages["structure_ok"],
            "rollout_identity_ok": rollout_stages["identity_ok"],
            "rollout_timestamps_ok": rollout_stages["timestamps_ok"],
            "rollout_durations_ok": rollout_stages["durations_ok"],
            "rollout_order_ok": rollout_stages["order_ok"],
            "rollout_samples_ok": rollout_stages["samples_ok"],
            "rollout_statuses_ok": rollout_stages["statuses_ok"],
            "rollout_bounds_ok": rollout_stages["bounds_ok"],
            "rollback_duration_seconds": rollback_duration,
        },
    )


def _validate_evidence_coherence(
    preflight: dict[str, Any],
    recovery: dict[str, Any],
    observations: list[Any],
    release: dict[str, Any],
    *,
    min_days: int,
) -> dict[str, Any]:
    rows = observations if isinstance(observations, list) else []
    observation_rows = [row for row in rows if isinstance(row, dict)]
    release_ids = [
        _release_identity(preflight.get("release_id")),
        _release_identity(recovery.get("release_id")),
        _release_identity(release.get("release_id")),
        *[_release_identity(row.get("release_id")) for row in observation_rows],
    ]
    base_urls = [
        _staging_base_url(preflight.get("base_url")),
        _staging_base_url(recovery.get("base_url")),
        _staging_base_url(release.get("base_url")),
        *[_staging_base_url(row.get("base_url")) for row in observation_rows],
    ]
    expected_identity_count = 3 + len(rows)
    release_identity_ok = (
        len(release_ids) == expected_identity_count
        and all(value is not None for value in release_ids)
        and len(set(release_ids)) == 1
    )
    environment_ok = (
        len(base_urls) == expected_identity_count
        and all(value is not None for value in base_urls)
        and len(set(base_urls)) == 1
    )

    canary = release.get("canary")
    canary = canary if isinstance(canary, dict) else {}
    migration = release.get("migration")
    migration = migration if isinstance(migration, dict) else {}
    migration_check = next(
        (
            item
            for item in preflight.get("checks", [])
            if isinstance(item, dict) and item.get("id") == "migration_graph"
        ),
        {},
    )
    migration_detail = migration_check.get("detail")
    migration_detail = migration_detail if isinstance(migration_detail, dict) else {}
    preflight_heads = migration_detail.get("heads")
    migration_head = _nonempty_text(migration_detail.get("head"))
    migration_head_ok = (
        migration_check.get("status") == "pass"
        and isinstance(preflight_heads, list)
        and preflight_heads == [migration_head]
        and migration_head is not None
        and migration_head == _nonempty_text(migration.get("to_revision"))
    )
    canary_started_at = _timestamp(canary.get("started_at"))
    canary_completed_at = _timestamp(canary.get("completed_at"))
    canary_duration_ok = (
        canary_started_at is not None
        and canary_completed_at is not None
        and canary_completed_at - canary_started_at >= timedelta(days=min_days)
    )
    observation_times = [_timestamp(row.get("ts")) for row in observation_rows]
    observations_in_window = (
        len(observation_times) == len(rows)
        and bool(observation_times)
        and canary_started_at is not None
        and canary_completed_at is not None
        and all(
            item is not None and canary_started_at <= item <= canary_completed_at
            for item in observation_times
        )
    )
    canary_window_ok = canary_duration_ok and observations_in_window

    preflight_at = _timestamp(preflight.get("generated_at"))
    preflight_before_canary = (
        preflight_at is not None
        and canary_started_at is not None
        and preflight_at <= canary_started_at
    )
    takeover = recovery.get("takeover_event")
    takeover = takeover if isinstance(takeover, dict) else {}
    recovery_times = (
        _timestamp(recovery.get("worker_a_sigkill_at")),
        _timestamp(takeover.get("at")),
    )
    recovery_in_window = (
        canary_started_at is not None
        and canary_completed_at is not None
        and all(
            item is not None and canary_started_at <= item <= canary_completed_at
            for item in recovery_times
        )
    )
    passed = (
        release_identity_ok
        and environment_ok
        and migration_head_ok
        and canary_window_ok
        and preflight_before_canary
        and recovery_in_window
    )
    return _check(
        "evidence_coherence",
        passed,
        {
            "release_identity_ok": release_identity_ok,
            "environment_ok": environment_ok,
            "migration_head_ok": migration_head_ok,
            "preflight_migration_heads": preflight_heads,
            "preflight_migration_head": migration_head,
            "release_migration_to_revision": _nonempty_text(
                migration.get("to_revision")
            ),
            "canary_window_ok": canary_window_ok,
            "canary_duration_ok": canary_duration_ok,
            "observations_in_window": observations_in_window,
            "preflight_before_canary": preflight_before_canary,
            "recovery_in_window": recovery_in_window,
            "artifact_identity_count": len(release_ids),
            "expected_identity_count": expected_identity_count,
        },
    )


def evaluate_bundle(
    preflight: dict[str, Any] | None,
    recovery: dict[str, Any] | None,
    observations: list[dict[str, Any]],
    *,
    release: dict[str, Any] | None = None,
    mode: str = "staging",
    min_recovery_cases: int = MIN_RECOVERY_CASES,
    min_recovery_rate: float = MIN_RECOVERY_RATE,
    min_days: int = DEFAULT_OBSERVATION_DAYS,
    min_success_rate: float = DEFAULT_MIN_SUCCESS_RATE,
    min_finished_runs: int = DEFAULT_MIN_FINISHED_RUNS,
) -> dict[str, Any]:
    preflight_report = preflight if isinstance(preflight, dict) else {}
    recovery_report = recovery if isinstance(recovery, dict) else {}
    release_report = release if isinstance(release, dict) else {}
    checks = [
        _validate_preflight(preflight_report, mode=mode),
        _validate_recovery(
            recovery_report,
            mode=mode,
            min_cases=min_recovery_cases,
            min_rate=min_recovery_rate,
        ),
        _validate_observation(
            observations,
            min_days=min_days,
            min_success_rate=min_success_rate,
            min_finished_runs=min_finished_runs,
        ),
        _validate_release(release_report, mode=mode),
        _validate_evidence_coherence(
            preflight_report,
            recovery_report,
            observations,
            release_report,
            min_days=min_days,
        ),
    ]
    failed_checks = [item["id"] for item in checks if item["status"] != "pass"]
    return {
        "schema_version": SCHEMA_VERSION,
        "overall": "pass" if not failed_checks else "fail",
        "mode": mode,
        "checks": checks,
        "failed_checks": failed_checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate final staging evidence bundle")
    parser.add_argument("--preflight", required=True, type=Path)
    parser.add_argument("--recovery", required=True, type=Path)
    parser.add_argument("--observe", required=True, type=Path)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--min-recovery-cases", type=int, default=MIN_RECOVERY_CASES)
    parser.add_argument("--min-recovery-rate", type=float, default=MIN_RECOVERY_RATE)
    parser.add_argument("--min-days", type=int, default=DEFAULT_OBSERVATION_DAYS)
    parser.add_argument("--min-success-rate", type=float, default=DEFAULT_MIN_SUCCESS_RATE)
    parser.add_argument("--min-finished-runs", type=int, default=DEFAULT_MIN_FINISHED_RUNS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.min_recovery_cases < 1:
        parser.error("--min-recovery-cases 必须至少为 1")
    if not 0 <= args.min_recovery_rate <= 1:
        parser.error("--min-recovery-rate 必须位于 0 到 1")
    if args.min_days < 1:
        parser.error("--min-days 必须至少为 1")
    if not 0 <= args.min_success_rate <= 1:
        parser.error("--min-success-rate 必须位于 0 到 1")
    if args.min_finished_runs < 1:
        parser.error("--min-finished-runs 必须至少为 1")
    preflight = load_json(args.preflight)
    recovery = load_json(args.recovery)
    release = load_json(args.release)
    try:
        rows = load_observation_rows(args.observe)
    except (OSError, UnicodeError, ValueError) as exc:
        parser.error(f"观测 artifact 无法读取：{exc}")
    report = evaluate_bundle(
        preflight,
        recovery,
        rows,
        release=release,
        min_recovery_cases=args.min_recovery_cases,
        min_recovery_rate=args.min_recovery_rate,
        min_days=args.min_days,
        min_success_rate=args.min_success_rate,
        min_finished_runs=args.min_finished_runs,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.json else None))
    return 0 if report["overall"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
