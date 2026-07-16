from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.agent_runtime.core_task_evidence import (
    MIN_TRIALS,
    catalog_digest,
    load_core_task_catalog,
)
from scripts.evaluate_staging_evidence import (
    evaluate_bundle,
    load_json,
    load_observation_rows,
)


RELEASE_ID = "release-20260714-001"
BASE_URL = "https://staging.example.test"


def _snapshot(*, succeeded: int, failed: int = 0) -> dict:
    return {
        "runs_succeeded": succeeded,
        "runs_failed": failed,
        "tool_invocations_reconciliation_required": 0,
        "direct_actions_reconciliation_required": 0,
        "run_reconciliation_overall": "pass",
        "run_reconciliation_scanned_runs": succeeded + failed,
        "run_reconciliation_issue_count": 0,
        "slo_audit": {"overall": "pass", "fail_count": 0},
        "notes": [],
    }


def _observations(days: int = 14) -> list[dict]:
    rows: list[dict] = []
    start = date(2026, 7, 1)
    for index in range(days):
        rows.append(
            {
                "ts": f"{(start + timedelta(days=index)).isoformat()}T10:00:00+00:00",
                "release_id": RELEASE_ID,
                "base_url": BASE_URL,
                "readiness_overall": "ready",
                "security_overall": "pass",
                "ga_overall": "ready",
                "ops_snapshot": _snapshot(succeeded=(index + 1) * 10),
                "probes": {"/api/ai/ops/readiness": {"status_code": 200, "semantic_ok": True}},
            }
        )
    return rows


def _preflight() -> dict:
    return {
        "overall": "pass",
        "mode": "staging",
        "release_id": RELEASE_ID,
        "base_url": BASE_URL,
        "generated_at": "2026-06-30T07:00:00Z",
        "checks": [
            {"id": "harness_spec", "status": "pass"},
            {
                "id": "migration_graph",
                "status": "pass",
                "detail": {
                    "heads": ["0050_current_revision"],
                    "head": "0050_current_revision",
                },
            },
            {"id": "runtime_mode", "status": "pass"},
            {"id": "langgraph_dependency_isolation", "status": "pass"},
            {"id": "authorization", "status": "pass"},
            {"id": "staging_transport", "status": "pass"},
            {"id": "release_identity", "status": "pass"},
            {"id": "observation_policy", "status": "pass"},
        ],
        "failed_checks": [],
    }


def _recovery(*, environment: str = "staging", mode: str = "staging_dual_runtime_rehearsal") -> dict:
    return {
        "schema_version": "1.1",
        "scope": "dual_runtime_process_boundary",
        "environment": environment,
        "mode": mode,
        "release_id": RELEASE_ID,
        "base_url": BASE_URL,
        "run_id": "staging-run-20260714-001",
        "worker_a_id": "worker-a-001",
        "worker_b_id": "worker-b-001",
        "worker_a_sigkill_at": "2026-07-14T10:00:00Z",
        "takeover_event": {
            "type": "lease_takeover",
            "run_id": "staging-run-20260714-001",
            "worker_id": "worker-b-001",
            "at": "2026-07-14T10:00:02Z",
        },
        "final_status": "succeeded",
        "total": 1000,
        "recovered": 1000,
        "failed": 0,
        "recovery_rate": 1.0,
        "target": 0.999,
        "passed": True,
        "worker_a_sigkilled": True,
        "worker_b_took_over": True,
        "stale_worker_fenced": True,
        "duplicate_side_effects": 0,
        "dual_owner_incidents": 0,
        "cases": [
            {"case_id": f"case-{index + 1}", "passed": True}
            for index in range(1000)
        ],
    }


def _core_task_evaluation() -> dict:
    catalog = load_core_task_catalog()
    cases = []
    for trial in range(1, MIN_TRIALS + 1):
        for task in catalog["tasks"]:
            suffix = f"{task['task_id']}-t{trial}"
            cases.append(
                {
                    "task_id": task["task_id"],
                    "category": task["category"],
                    "trial": trial,
                    "executed_at": "2026-06-30T09:30:00Z",
                    "evidence_ref": f"trace://staging/{suffix}",
                    "baseline": {
                        "run_id": f"native-{suffix}",
                        "passed": True,
                        "cost_units": 1.0,
                        "step_count": 2,
                        "latency_ms": 100.0,
                        "human_interventions": 0,
                        "duplicate_actions": 0,
                        "isolation_id": f"native-isolation-{suffix}",
                    },
                    "candidate": {
                        "run_id": f"langgraph-{suffix}",
                        "passed": True,
                        "cost_units": 1.1,
                        "step_count": 2,
                        "latency_ms": 105.0,
                        "human_interventions": 0,
                        "duplicate_actions": 0,
                        "isolation_id": f"langgraph-isolation-{suffix}",
                    },
                }
            )
    return {
        "schema_version": "1.1",
        "environment": "staging",
        "source": "staging_runtime_execution",
        "synthetic": False,
        "status": "passed",
        "report_id": "core-eval-20260714-001",
        "completed_at": "2026-06-30T10:00:00Z",
        "release_id": RELEASE_ID,
        "base_url": BASE_URL,
        "task_set_id": catalog["task_set_id"],
        "task_set_sha256": catalog_digest(catalog),
        "trial_count": MIN_TRIALS,
        "baseline_runtime": "native",
        "candidate_runtime": "langgraph",
        "baseline_success_rate": 1.0,
        "candidate_success_rate": 1.0,
        "cases": cases,
        "classification_review": {
            "source": "independent_human_review",
            "reviewed_by": "reviewer-001",
            "reviewed_at": "2026-06-30T09:45:00Z",
            "labels": [
                {
                    "task_id": case["task_id"],
                    "trial": case["trial"],
                    "runtime": runtime,
                    "expected_passed": case["task_id"] != "knowledge-01",
                }
                for case in cases
                for runtime in ("baseline", "candidate")
            ],
        },
    }


def _release() -> dict:
    return {
        "schema_version": "1.4",
        "environment": "staging",
        "release_id": RELEASE_ID,
        "base_url": BASE_URL,
        "generated_at": "2026-07-15T12:00:00Z",
        "migration": {
            "record_id": "migration-20260714-001",
            "from_revision": "0049_previous_revision",
            "to_revision": "0050_current_revision",
            "applied_at": "2026-06-30T08:00:00Z",
            "status": "succeeded",
            "single_head_verified": True,
            "expand_contract": True,
        },
        "tests": {
            "report_id": "tests-20260714-001",
            "completed_at": "2026-06-30T09:00:00Z",
            "release_id": RELEASE_ID,
            "base_url": BASE_URL,
            "status": "passed",
            "passed": 204,
            "failed": 0,
            "skipped": 9,
            "harness_release_gate": True,
        },
        "core_task_evaluation": _core_task_evaluation(),
        "canary": {
            "report_id": "canary-20260714-001",
            "started_at": "2026-07-01T00:00:00Z",
            "completed_at": "2026-07-15T00:00:00Z",
            "status": "passed",
            "rollout_stages": [
                {
                    "stage": "internal",
                    "rollout_percent": 0,
                    "started_at": "2026-07-01T00:00:00Z",
                    "completed_at": "2026-07-03T00:00:00Z",
                    "finished_runs": 50,
                    "status": "passed",
                },
                {
                    "stage": "1_percent",
                    "rollout_percent": 1,
                    "started_at": "2026-07-03T00:00:00Z",
                    "completed_at": "2026-07-05T00:00:00Z",
                    "finished_runs": 100,
                    "status": "passed",
                },
                {
                    "stage": "5_percent",
                    "rollout_percent": 5,
                    "started_at": "2026-07-05T00:00:00Z",
                    "completed_at": "2026-07-07T00:00:00Z",
                    "finished_runs": 500,
                    "status": "passed",
                },
                {
                    "stage": "20_percent",
                    "rollout_percent": 20,
                    "started_at": "2026-07-07T00:00:00Z",
                    "completed_at": "2026-07-09T00:00:00Z",
                    "finished_runs": 2000,
                    "status": "passed",
                },
                {
                    "stage": "50_percent",
                    "rollout_percent": 50,
                    "started_at": "2026-07-09T00:00:00Z",
                    "completed_at": "2026-07-11T00:00:00Z",
                    "finished_runs": 5000,
                    "status": "passed",
                },
                {
                    "stage": "100_percent",
                    "rollout_percent": 100,
                    "started_at": "2026-07-11T00:00:00Z",
                    "completed_at": "2026-07-15T00:00:00Z",
                    "finished_runs": 10000,
                    "status": "passed",
                },
            ],
            "baseline_success_rate": 0.98,
            "candidate_success_rate": 0.99,
            "p0_incidents": 0,
            "p1_incidents": 0,
            "duplicate_side_effects": 0,
            "dual_owner_incidents": 0,
        },
        "rollback_drill": {
            "drill_id": "rollback-20260714-001",
            "executed_at": "2026-07-15T00:10:00Z",
            "status": "succeeded",
            "duration_seconds": 420,
            "feature_flag_restored": True,
            "target_runtime": "native",
            "new_schema_preserved": True,
        },
        "production_checkpointer_review": {
            "review_id": "checkpointer-20260714-001",
            "reviewed_at": "2026-07-15T00:20:00Z",
            "reviewer": "release-owner",
            "backend": "postgresql",
            "status": "approved",
            "durable": True,
            "multi_instance_supported": True,
            "fencing_supported": True,
            "restore_test_report_id": "restore-20260714-001",
        },
    }


def test_staging_evidence_bundle_passes_only_with_one_coherent_release() -> None:
    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        _observations(),
        release=_release(),
    )

    assert report["overall"] == "pass"
    assert report["failed_checks"] == []
    assert {item["id"] for item in report["checks"]} == {
        "preflight",
        "recovery",
        "observation",
        "release",
        "evidence_coherence",
    }
    release_check = next(item for item in report["checks"] if item["id"] == "release")
    assert release_check["detail"]["rollout_stage_ids"] == [
        "internal",
        "1_percent",
        "5_percent",
        "20_percent",
        "50_percent",
        "100_percent",
    ]


def test_release_rejects_core_task_case_executed_before_current_test_batch() -> None:
    release = _release()
    release["core_task_evaluation"]["cases"][0]["executed_at"] = (
        "2026-06-30T08:59:59Z"
    )

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        _observations(),
        release=release,
    )

    assert report["overall"] == "fail"
    release_check = next(
        item for item in report["checks"] if item["id"] == "release"
    )
    assert release_check["detail"]["core_task_evaluation"][
        "execution_window_ok"
    ] is False


@pytest.mark.parametrize(
    ("artifact", "field", "value"),
    [
        ("preflight", "release_id", "release-other"),
        ("recovery", "base_url", "https://other-staging.example.test"),
        ("observation", "release_id", "release-other"),
        ("release", "base_url", "https://other-staging.example.test"),
    ],
)
def test_evidence_coherence_rejects_mixed_release_or_environment(
    artifact: str,
    field: str,
    value: str,
) -> None:
    preflight = _preflight()
    recovery = _recovery()
    observations = _observations()
    release = _release()
    if artifact == "observation":
        observations[3][field] = value
    else:
        {
            "preflight": preflight,
            "recovery": recovery,
            "release": release,
        }[artifact][field] = value

    report = evaluate_bundle(preflight, recovery, observations, release=release)

    assert report["overall"] == "fail"
    coherence = next(
        item for item in report["checks"] if item["id"] == "evidence_coherence"
    )
    assert coherence["status"] == "fail"


def test_evidence_coherence_requires_full_canary_observation_window() -> None:
    release = _release()
    release["canary"]["completed_at"] = "2026-07-13T00:00:00Z"
    release["canary"]["rollout_stages"][-1]["completed_at"] = (
        "2026-07-13T00:00:00Z"
    )
    release["rollback_drill"]["executed_at"] = "2026-07-13T00:10:00Z"
    release["production_checkpointer_review"]["reviewed_at"] = (
        "2026-07-13T00:20:00Z"
    )

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        _observations(),
        release=release,
    )

    assert report["overall"] == "fail"
    coherence = next(
        item for item in report["checks"] if item["id"] == "evidence_coherence"
    )
    assert coherence["status"] == "fail"
    assert coherence["detail"]["canary_window_ok"] is False


def test_evidence_coherence_rejects_migration_revision_mismatch() -> None:
    preflight = _preflight()
    release = _release()
    release["migration"]["to_revision"] = "0051_other_revision"

    report = evaluate_bundle(
        preflight,
        _recovery(),
        _observations(),
        release=release,
    )

    assert report["overall"] == "fail"
    coherence = next(
        item for item in report["checks"] if item["id"] == "evidence_coherence"
    )
    assert coherence["status"] == "fail"
    assert coherence["detail"]["migration_head_ok"] is False


def test_staging_evidence_bundle_fails_closed_without_release_artifact() -> None:
    report = evaluate_bundle(_preflight(), _recovery(), _observations())

    assert report["overall"] == "fail"
    assert "release" in report["failed_checks"]


def test_local_recovery_report_can_never_satisfy_staging_gate() -> None:
    report = evaluate_bundle(
        _preflight(),
        _recovery(environment="local", mode="local_process_boundary_rehearsal"),
        _observations(),
        release=_release(),
    )

    assert report["overall"] == "fail"
    assert "recovery" in report["failed_checks"]


def test_preflight_requires_every_safety_check() -> None:
    for missing_id in ("langgraph_dependency_isolation", "observation_policy"):
        preflight = _preflight()
        preflight["checks"] = [
            item for item in preflight["checks"] if item["id"] != missing_id
        ]

        report = evaluate_bundle(
            preflight,
            _recovery(),
            _observations(),
            release=_release(),
        )

        assert report["overall"] == "fail"
        assert "preflight" in report["failed_checks"]


def test_preflight_rejects_duplicate_or_unreported_check_status() -> None:
    duplicate = _preflight()
    duplicate["checks"].append({"id": "harness_spec", "status": "pass"})
    unreported_failure = _preflight()
    unreported_failure["checks"].append({"id": "unexpected", "status": "fail"})
    malformed_id = _preflight()
    malformed_id["checks"][0]["id"] = ["harness_spec"]

    for preflight in (duplicate, unreported_failure, malformed_id):
        report = evaluate_bundle(
            preflight,
            _recovery(),
            _observations(),
            release=_release(),
        )

        assert report["overall"] == "fail"
        assert "preflight" in report["failed_checks"]


def test_recovery_requires_actual_kill_takeover_and_zero_duplicate_effects() -> None:
    recovery = _recovery()
    recovery["stale_worker_fenced"] = False
    recovery["duplicate_side_effects"] = 1

    report = evaluate_bundle(
        _preflight(),
        recovery,
        _observations(),
        release=_release(),
    )

    assert report["overall"] == "fail"
    recovery_check = next(item for item in report["checks"] if item["id"] == "recovery")
    assert recovery_check["status"] == "fail"


def test_recovery_requires_unique_case_identity() -> None:
    duplicate = _recovery()
    duplicate["cases"][1]["case_id"] = duplicate["cases"][0]["case_id"]
    missing = _recovery()
    missing["cases"][0].pop("case_id")

    for recovery in (duplicate, missing):
        report = evaluate_bundle(
            _preflight(),
            recovery,
            _observations(),
            release=_release(),
        )

        assert report["overall"] == "fail"
        recovery_check = next(item for item in report["checks"] if item["id"] == "recovery")
        assert recovery_check["status"] == "fail"


def test_recovery_rejects_malformed_case_without_raising() -> None:
    recovery = _recovery()
    recovery["cases"][0] = []

    report = evaluate_bundle(
        _preflight(),
        recovery,
        _observations(),
        release=_release(),
    )

    assert report["overall"] == "fail"
    recovery_check = next(item for item in report["checks"] if item["id"] == "recovery")
    assert recovery_check["status"] == "fail"


def test_recovery_requires_auditable_worker_timeline() -> None:
    invalid_reports = []

    missing_run_id = _recovery()
    missing_run_id.pop("run_id")
    invalid_reports.append(missing_run_id)

    duplicate_workers = _recovery()
    duplicate_workers["worker_b_id"] = duplicate_workers["worker_a_id"]
    invalid_reports.append(duplicate_workers)

    malformed_kill_time = _recovery()
    malformed_kill_time["worker_a_sigkill_at"] = "not-a-timestamp"
    invalid_reports.append(malformed_kill_time)

    wrong_takeover_worker = _recovery()
    wrong_takeover_worker["takeover_event"]["worker_id"] = "worker-c-001"
    invalid_reports.append(wrong_takeover_worker)

    unfinished = _recovery()
    unfinished["final_status"] = "unknown"
    invalid_reports.append(unfinished)

    for recovery in invalid_reports:
        report = evaluate_bundle(
            _preflight(),
            recovery,
            _observations(),
            release=_release(),
        )

        assert report["overall"] == "fail"
        recovery_check = next(item for item in report["checks"] if item["id"] == "recovery")
        assert recovery_check["status"] == "fail"


def test_observation_requires_https_and_continuous_window() -> None:
    rows = _observations()
    rows[0]["base_url"] = "http://staging.example.test"

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        rows,
        release=_release(),
    )

    assert report["overall"] == "fail"
    observation_check = next(item for item in report["checks"] if item["id"] == "observation")
    assert observation_check["status"] == "fail"


def test_load_json_rejects_non_object_artifacts(tmp_path: Path) -> None:
    path = tmp_path / "artifact.json"
    path.write_text(json.dumps(["not-an-object"]), encoding="utf-8")

    assert load_json(path) is None


def test_staging_observation_artifact_rejects_silent_row_drops(tmp_path: Path) -> None:
    path = tmp_path / "observe.jsonl"
    path.write_text('{"ok": true}\nnot-json\n', encoding="utf-8")

    with pytest.raises(ValueError, match="line 2"):
        load_observation_rows(path)


def test_staging_observation_rejects_non_object_rows_without_raising() -> None:
    rows = _observations()
    rows.insert(3, [])

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        rows,
        release=_release(),
    )

    assert report["overall"] == "fail"
    observation_check = next(item for item in report["checks"] if item["id"] == "observation")
    assert observation_check["status"] == "fail"


def test_staging_observation_requires_timezone_aware_timestamps() -> None:
    rows = _observations()
    rows[0]["ts"] = "2026-07-01T10:00:00"

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        rows,
        release=_release(),
    )

    assert report["overall"] == "fail"
    observation_check = next(item for item in report["checks"] if item["id"] == "observation")
    assert observation_check["status"] == "fail"


def test_release_artifact_requires_every_evidence_section() -> None:
    for section in (
        "migration",
        "tests",
        "core_task_evaluation",
        "canary",
        "rollback_drill",
        "production_checkpointer_review",
    ):
        release = _release()
        release.pop(section)

        report = evaluate_bundle(
            _preflight(),
            _recovery(),
            _observations(),
            release=release,
        )

        assert report["overall"] == "fail"
        assert "release" in report["failed_checks"]


def test_release_artifact_rejects_unproven_release_evidence() -> None:
    invalid_reports: list[dict] = []

    for legacy_version in ("1.0", "1.1", "1.2", "1.3"):
        legacy_schema = _release()
        legacy_schema["schema_version"] = legacy_version
        invalid_reports.append(legacy_schema)

    failed_migration = _release()
    failed_migration["migration"]["single_head_verified"] = False
    invalid_reports.append(failed_migration)

    failed_tests = _release()
    failed_tests["tests"]["failed"] = 1
    invalid_reports.append(failed_tests)

    synthetic_core_tasks = _release()
    synthetic_core_tasks["core_task_evaluation"]["synthetic"] = True
    invalid_reports.append(synthetic_core_tasks)

    regressed_core_tasks = _release()
    regressed_core_tasks["core_task_evaluation"]["cases"][0]["candidate"][
        "passed"
    ] = False
    invalid_reports.append(regressed_core_tasks)

    masked_task_regression = _release()
    for case in masked_task_regression["core_task_evaluation"]["cases"]:
        if case["task_id"] == "knowledge-01":
            case["baseline"]["passed"] = False
            case["candidate"]["passed"] = True
        elif case["task_id"] == "knowledge-02":
            case["baseline"]["passed"] = True
            case["candidate"]["passed"] = False
    masked_task_regression["core_task_evaluation"]["baseline_success_rate"] = 0.98
    masked_task_regression["core_task_evaluation"]["candidate_success_rate"] = 0.98
    invalid_reports.append(masked_task_regression)

    reused_core_task_trace = _release()
    reused_core_task_trace["core_task_evaluation"]["cases"][1][
        "evidence_ref"
    ] = reused_core_task_trace["core_task_evaluation"]["cases"][0][
        "evidence_ref"
    ]
    invalid_reports.append(reused_core_task_trace)

    reused_side_effect_isolation = _release()
    side_effect_task_ids = {
        task["task_id"]
        for task in load_core_task_catalog()["tasks"]
        if task["side_effecting"]
    }
    side_effect_cases = [
        case
        for case in reused_side_effect_isolation["core_task_evaluation"]["cases"]
        if case["task_id"] in side_effect_task_ids
    ]
    side_effect_cases[1]["baseline"]["isolation_id"] = side_effect_cases[0][
        "baseline"
    ]["isolation_id"]
    invalid_reports.append(reused_side_effect_isolation)

    regressed_canary = _release()
    regressed_canary["canary"]["candidate_success_rate"] = 0.97
    invalid_reports.append(regressed_canary)

    slow_rollback = _release()
    slow_rollback["rollback_drill"]["duration_seconds"] = 901
    invalid_reports.append(slow_rollback)

    unsupported_checkpointer = _release()
    unsupported_checkpointer["production_checkpointer_review"][
        "multi_instance_supported"
    ] = False
    invalid_reports.append(unsupported_checkpointer)

    string_counter = _release()
    string_counter["tests"]["failed"] = "0"
    invalid_reports.append(string_counter)

    string_rate = _release()
    string_rate["canary"]["candidate_success_rate"] = "0.99"
    invalid_reports.append(string_rate)

    for release in invalid_reports:
        report = evaluate_bundle(
            _preflight(),
            _recovery(),
            _observations(),
            release=release,
        )

        assert report["overall"] == "fail"
        release_check = next(
            item for item in report["checks"] if item["id"] == "release"
        )
        assert release_check["status"] == "fail"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("release_id", "release-other"),
        ("base_url", "https://other-staging.example.test"),
    ],
)
def test_release_artifact_rejects_tests_from_another_release(
    field: str,
    value: str,
) -> None:
    release = _release()
    release["tests"][field] = value

    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        _observations(),
        release=release,
    )

    assert report["overall"] == "fail"
    release_check = next(
        item for item in report["checks"] if item["id"] == "release"
    )
    assert release_check["status"] == "fail"
    assert release_check["detail"]["tests_identity_ok"] is False


def test_release_artifact_requires_ordered_evidence_timeline() -> None:
    invalid_reports: list[dict] = []

    tests_before_migration = _release()
    tests_before_migration["tests"]["completed_at"] = "2026-06-30T07:59:59Z"
    invalid_reports.append(tests_before_migration)

    canary_before_tests = _release()
    canary_before_tests["tests"]["completed_at"] = "2026-07-01T00:00:01Z"
    invalid_reports.append(canary_before_tests)

    rollback_before_canary_completion = _release()
    rollback_before_canary_completion["rollback_drill"]["executed_at"] = (
        "2026-07-14T23:59:59Z"
    )
    invalid_reports.append(rollback_before_canary_completion)

    review_before_canary_completion = _release()
    review_before_canary_completion["production_checkpointer_review"][
        "reviewed_at"
    ] = "2026-07-14T23:59:59Z"
    invalid_reports.append(review_before_canary_completion)

    for release in invalid_reports:
        report = evaluate_bundle(
            _preflight(),
            _recovery(),
            _observations(),
            release=release,
        )

        release_check = next(
            item for item in report["checks"] if item["id"] == "release"
        )
        assert release_check["status"] == "fail"
        assert release_check["detail"]["timeline_ok"] is False


def test_release_artifact_requires_complete_rollout_stage_sequence() -> None:
    invalid_reports: list[dict] = []

    missing_stage = _release()
    missing_stage["canary"]["rollout_stages"].pop(1)
    invalid_reports.append(missing_stage)

    wrong_order = _release()
    stages = wrong_order["canary"]["rollout_stages"]
    stages[2], stages[3] = stages[3], stages[2]
    invalid_reports.append(wrong_order)

    wrong_percent = _release()
    wrong_percent["canary"]["rollout_stages"][2]["rollout_percent"] = 10
    invalid_reports.append(wrong_percent)

    for release in invalid_reports:
        report = evaluate_bundle(
            _preflight(),
            _recovery(),
            _observations(),
            release=release,
        )

        release_check = next(
            item for item in report["checks"] if item["id"] == "release"
        )
        assert release_check["status"] == "fail"
        assert release_check["detail"]["rollout_stages_ok"] is False


def test_release_artifact_requires_48_hours_and_samples_per_rollout_stage() -> None:
    invalid_reports: list[dict] = []

    short_stage = _release()
    short_stage["canary"]["rollout_stages"][2][
        "completed_at"
    ] = "2026-07-06T23:59:59Z"
    invalid_reports.append(short_stage)

    overlapping_stage = _release()
    overlapping_stage["canary"]["rollout_stages"][3][
        "started_at"
    ] = "2026-07-06T23:59:59Z"
    invalid_reports.append(overlapping_stage)

    empty_stage = _release()
    empty_stage["canary"]["rollout_stages"][4]["finished_runs"] = 0
    invalid_reports.append(empty_stage)

    string_sample_count = _release()
    string_sample_count["canary"]["rollout_stages"][5]["finished_runs"] = "100"
    invalid_reports.append(string_sample_count)

    failed_stage = _release()
    failed_stage["canary"]["rollout_stages"][0]["status"] = "failed"
    invalid_reports.append(failed_stage)

    for release in invalid_reports:
        report = evaluate_bundle(
            _preflight(),
            _recovery(),
            _observations(),
            release=release,
        )

        release_check = next(
            item for item in report["checks"] if item["id"] == "release"
        )
        assert release_check["status"] == "fail"
        assert release_check["detail"]["rollout_stages_ok"] is False


def test_release_artifact_rejects_non_object_without_raising() -> None:
    report = evaluate_bundle(
        _preflight(),
        _recovery(),
        _observations(),
        release=[],  # type: ignore[arg-type]
    )

    assert report["overall"] == "fail"
    assert "release" in report["failed_checks"]


@pytest.mark.parametrize("artifact", ["preflight", "recovery", "release"])
def test_bundle_rejects_non_object_top_level_artifacts_without_raising(
    artifact: str,
) -> None:
    preflight: object = _preflight()
    recovery: object = _recovery()
    release: object = _release()
    if artifact == "preflight":
        preflight = ["not-an-object"]
    elif artifact == "recovery":
        recovery = ["not-an-object"]
    else:
        release = ["not-an-object"]

    report = evaluate_bundle(
        preflight,  # type: ignore[arg-type]
        recovery,  # type: ignore[arg-type]
        _observations(),
        release=release,  # type: ignore[arg-type]
    )

    assert report["overall"] == "fail"
    assert artifact in report["failed_checks"]
