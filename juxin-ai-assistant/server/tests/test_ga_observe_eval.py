"""evaluate_ga_observe pure logic tests."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from scripts.evaluate_ga_observe import evaluate, load_rows
from scripts.observation_policy import DEFAULT_OBSERVATION_DAYS
from scripts import run_ga_observe


def _snapshot(
    *, succeeded: int = 9, failed: int = 1, pending: int = 0, direct_pending: int = 0
) -> dict:
    return {
        "runs_succeeded": succeeded,
        "runs_failed": failed,
        "success_rate": succeeded / (succeeded + failed) if succeeded + failed else 0.0,
        "tool_invocations_reconciliation_required": pending,
        "direct_actions_reconciliation_required": direct_pending,
        "run_reconciliation_overall": "pass",
        "run_reconciliation_scanned_runs": succeeded + failed,
        "run_reconciliation_issue_count": 0,
        "run_reconciliation_issue_counts": {},
        "slo_audit": {"overall": "pass", "fail_count": 0, "gap_count": 0},
        "notes": [],
    }


def test_observation_default_is_two_weeks() -> None:
    assert DEFAULT_OBSERVATION_DAYS == 14


def test_observation_runner_records_release_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    out = tmp_path / "observe.jsonl"
    monkeypatch.setattr(
        run_ga_observe,
        "_req",
        lambda *args, **kwargs: (200, {"overall": "ready"}, 1.0),
    )
    monkeypatch.setattr(run_ga_observe, "observation_probe_ok", lambda *args: True)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_ga_observe.py",
            "--base-url",
            "http://127.0.0.1:18093/",
            "--release-id",
            "release-local-001",
            "--out",
            str(out),
        ],
    )

    assert run_ga_observe.main() == 0
    row = json.loads(out.read_text(encoding="utf-8"))
    assert row["release_id"] == "release-local-001"
    assert row["base_url"] == "http://127.0.0.1:18093"


def test_staging_observation_requires_release_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STAGING_TOKEN", "redacted-test-token")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_ga_observe.py",
            "--base-url",
            "https://staging.example.test",
            "--bearer-token-env",
            "STAGING_TOKEN",
        ],
    )

    with pytest.raises(SystemExit) as exc:
        run_ga_observe.main()

    assert exc.value.code == 2


def test_evaluate_insufficient_and_pass(tmp_path: Path) -> None:
    path = tmp_path / "obs.jsonl"
    rows = [
        {
            "ts": "2026-07-01T10:00:00+00:00",
            "readiness_overall": "ready",
            "security_overall": "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=9, failed=1),
            "probes": {"/x": {"status_code": 200}},
        },
        {
            "ts": "2026-07-02T10:00:00+00:00",
            "readiness_overall": "ready_with_warnings",
            "security_overall": "pass_with_warnings",
            "ga_overall": "partial",
            "ops_snapshot": _snapshot(succeeded=18, failed=2),
            "probes": {"/x": {"status_code": 200}},
        },
    ]
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    loaded = load_rows(path)
    assert len(loaded) == 2
    short = evaluate(loaded, min_days=10, require_ready=False)
    assert short["overall"] == "insufficient_data"
    full = evaluate(loaded, min_days=2, require_ready=False)
    assert full["overall"] == "pass"
    assert full["unique_days"] == 2


def test_load_rows_strict_rejects_malformed_or_non_object_lines(tmp_path: Path) -> None:
    path = tmp_path / "malformed.jsonl"
    path.write_text('{"ok": true}\nnot-json\n[]\n', encoding="utf-8")

    with pytest.raises(ValueError, match="line 2"):
        load_rows(path, strict=True)

    non_object = tmp_path / "non-object.jsonl"
    non_object.write_text('{"ok": true}\n[]\n', encoding="utf-8")

    with pytest.raises(ValueError, match="line 2"):
        load_rows(non_object, strict=True)


def test_evaluate_fails_on_security(tmp_path: Path) -> None:
    rows = [
        {
            "ts": f"2026-07-{d:02d}T00:00:00+00:00",
            "readiness_overall": "ready",
            "security_overall": "fail" if d == 5 else "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=d * 9, failed=d),
            "probes": {},
        }
        for d in range(1, 12)
    ]
    report = evaluate(rows, min_days=10, require_ready=False)
    assert report["overall"] == "fail"
    assert report["fail_count"] >= 1


def test_evaluate_requires_a_continuous_daily_window() -> None:
    rows = [
        {
            "ts": value,
            "readiness_overall": "ready",
            "security_overall": "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=index * 9, failed=index),
            "probes": {"/x": {"status_code": 200}},
        }
        for index, value in enumerate((
            "2026-07-01T10:00:00+00:00",
            "2026-07-03T10:00:00+00:00",
            "2026-07-04T10:00:00+00:00",
        ), start=1)
    ]

    report = evaluate(rows, min_days=3, require_ready=False)

    assert report["overall"] == "insufficient_data"
    assert report["unique_days"] == 3
    assert report["consecutive_days"] == 2
    assert report["consecutive_window"] == {
        "first": "2026-07-03",
        "last": "2026-07-04",
        "missing_dates": ["2026-07-02"],
    }


def test_evaluate_requires_snapshot_and_zero_reconciliation_backlog() -> None:
    base = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "probes": {"/x": {"status_code": 200}},
    }
    missing = evaluate([base], min_days=1, require_ready=False)
    assert missing["overall"] == "fail"
    assert next(item for item in missing["checks"] if item["id"] == "ops_snapshot")["status"] == "fail"

    pending = evaluate(
        [{**base, "ops_snapshot": _snapshot(pending=1)}],
        min_days=1,
        require_ready=False,
    )
    assert pending["overall"] == "fail"
    assert next(item for item in pending["checks"] if item["id"] == "reconciliation")["status"] == "fail"

    direct_pending = evaluate(
        [{**base, "ops_snapshot": _snapshot(direct_pending=1)}],
        min_days=1,
        require_ready=False,
    )
    assert direct_pending["overall"] == "fail"
    assert next(item for item in direct_pending["checks"] if item["id"] == "reconciliation")["status"] == "fail"

    malformed = evaluate(
        [{**base, "ops_snapshot": {"notes": []}}],
        min_days=1,
        require_ready=False,
    )
    assert malformed["overall"] == "fail"
    assert next(item for item in malformed["checks"] if item["id"] == "ops_snapshot")["status"] == "fail"


def test_evaluate_fails_on_run_step_event_reconciliation_issue() -> None:
    snapshot = _snapshot()
    snapshot["run_reconciliation_overall"] = "fail"
    snapshot["run_reconciliation_issue_count"] = 1
    snapshot["run_reconciliation_issue_counts"] = {"terminal_event_missing": 1}
    row = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": snapshot,
        "probes": {"/x": {"status_code": 200}},
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "run_reconciliation")
    assert check["status"] == "fail"


def test_evaluate_blocks_unobserved_or_failed_slo_audit() -> None:
    base = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "probes": {"/x": {"status_code": 200}},
    }
    with_gap = _snapshot()
    with_gap["slo_audit"] = {"overall": "pass_with_gaps", "fail_count": 0}
    report = evaluate([{**base, "ops_snapshot": with_gap}], min_days=1, require_ready=False)
    assert report["overall"] == "insufficient_data"
    assert next(item for item in report["checks"] if item["id"] == "agent_loop_slo")["status"] == "insufficient"

    failed = _snapshot()
    failed["slo_audit"] = {"overall": "fail", "fail_count": 1}
    report = evaluate([{**base, "ops_snapshot": failed}], min_days=1, require_ready=False)
    assert report["overall"] == "fail"
    assert next(item for item in report["checks"] if item["id"] == "agent_loop_slo")["status"] == "fail"


def test_evaluate_fails_closed_on_malformed_slo_fail_count() -> None:
    base = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "probes": {"/x": {"status_code": 200}},
    }
    snapshot = _snapshot()
    snapshot["slo_audit"] = {"overall": "pass", "fail_count": "not-a-number"}

    report = evaluate([{**base, "ops_snapshot": snapshot}], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "agent_loop_slo")
    assert check["status"] == "fail"


def test_evaluate_consumes_probe_semantic_contract() -> None:
    row = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": _snapshot(succeeded=9, failed=1),
        "probes": {
            "/api/ai/ops/readiness": {
                "status_code": 200,
                "semantic_ok": False,
                "body": {"overall": "not_ready"},
            }
        },
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "probe_semantics")
    assert check["status"] == "fail"
    assert check["detail"]["semantic_failures"] == 1


def test_evaluate_fails_closed_on_malformed_probe_fields() -> None:
    row = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": _snapshot(succeeded=9, failed=1),
        "probes": {
            "/api/ai/ops/readiness": {
                "status_code": "not-a-status",
                "semantic_ok": "true",
                "body": {"overall": "ready"},
            }
        },
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    assert next(item for item in report["checks"] if item["id"] == "http")["detail"] == "bad_http=1"
    assert next(item for item in report["checks"] if item["id"] == "probe_semantics")["status"] == "fail"


def test_evaluate_keeps_legacy_generic_probe_rows_compatible() -> None:
    row = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": _snapshot(succeeded=9, failed=1),
        "probes": {"/x": {"status_code": 200}},
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert next(item for item in report["checks"] if item["id"] == "probe_semantics")["status"] == "pass"


def test_evaluate_does_not_accept_snapshot_without_run_reconciliation_summary() -> None:
    snapshot = _snapshot()
    for key in (
        "run_reconciliation_overall",
        "run_reconciliation_scanned_runs",
        "run_reconciliation_issue_count",
    ):
        snapshot.pop(key)
    row = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": snapshot,
        "probes": {"/x": {"status_code": 200}},
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "run_reconciliation")
    assert check["status"] == "fail"


def test_evaluate_requires_finished_runs_and_success_rate() -> None:
    base = {
        "ts": "2026-07-01T10:00:00+00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "probes": {"/x": {"status_code": 200}},
    }
    no_runs = evaluate(
        [{**base, "ops_snapshot": _snapshot(succeeded=0, failed=0)}],
        min_days=1,
        require_ready=False,
    )
    assert no_runs["overall"] == "insufficient_data"

    low_rate = evaluate(
        [{**base, "ops_snapshot": _snapshot(succeeded=8, failed=2)}],
        min_days=1,
        require_ready=False,
    )
    assert low_rate["overall"] == "fail"


def test_evaluate_empty_observations_are_never_reported_as_snapshot_pass() -> None:
    report = evaluate([], min_days=1, require_ready=False)
    statuses = {item["id"]: item["status"] for item in report["checks"]}
    assert report["overall"] == "insufficient_data"
    assert statuses["ops_snapshot"] == "insufficient"
    assert statuses["reconciliation"] == "insufficient"
    assert statuses["run_success_rate"] == "insufficient"


def test_evaluate_rejects_non_object_rows() -> None:
    report = evaluate([[]], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "observation_rows")
    assert check["status"] == "fail"


def test_evaluate_rejects_naive_observation_timestamps() -> None:
    row = {
        "ts": "2026-07-01T10:00:00",
        "readiness_overall": "ready",
        "security_overall": "pass",
        "ga_overall": "ready",
        "ops_snapshot": _snapshot(succeeded=9, failed=1),
        "probes": {"/x": {"status_code": 200}},
    }

    report = evaluate([row], min_days=1, require_ready=False)

    assert report["overall"] == "fail"
    check = next(item for item in report["checks"] if item["id"] == "observation_rows")
    assert check["status"] == "fail"


def test_evaluate_requires_new_completed_runs_each_day() -> None:
    rows = [
        {
            "ts": f"2026-07-0{day}T10:00:00+00:00",
            "readiness_overall": "ready",
            "security_overall": "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=9, failed=1),
            "probes": {"/x": {"status_code": 200}},
        }
        for day in (1, 2)
    ]
    report = evaluate(rows, min_days=2, require_ready=False)
    status = next(item for item in report["checks"] if item["id"] == "run_success_rate")
    assert report["overall"] == "insufficient_data"
    assert status["status"] == "insufficient"


def test_evaluate_fails_if_cumulative_counters_reset() -> None:
    rows = [
        {
            "ts": "2026-07-01T10:00:00+00:00",
            "readiness_overall": "ready",
            "security_overall": "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=9, failed=1),
            "probes": {"/x": {"status_code": 200}},
        },
        {
            "ts": "2026-07-02T10:00:00+00:00",
            "readiness_overall": "ready",
            "security_overall": "pass",
            "ga_overall": "ready",
            "ops_snapshot": _snapshot(succeeded=1, failed=0),
            "probes": {"/x": {"status_code": 200}},
        },
    ]

    report = evaluate(rows, min_days=2, require_ready=False)
    status = next(item for item in report["checks"] if item["id"] == "run_success_rate")

    assert report["overall"] == "fail"
    assert status["status"] == "fail"
