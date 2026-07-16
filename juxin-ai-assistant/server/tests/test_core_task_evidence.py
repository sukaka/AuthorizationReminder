from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest

from app.agent_runtime.core_task_evidence import (
    MIN_TRIALS,
    catalog_digest,
    load_core_task_catalog,
    validate_core_task_evidence,
)


def _evidence() -> dict:
    catalog = load_core_task_catalog()
    generated_at = datetime(2026, 7, 14, 8, 0, tzinfo=UTC)
    cases: list[dict] = []
    for trial in range(1, MIN_TRIALS + 1):
        for index, task in enumerate(catalog["tasks"]):
            run_suffix = f"{task['task_id']}-t{trial}"
            executed_at = generated_at + timedelta(minutes=len(cases))
            cases.append(
                {
                    "task_id": task["task_id"],
                    "category": task["category"],
                    "trial": trial,
                    "executed_at": executed_at.isoformat(),
                    "evidence_ref": f"trace://staging/{run_suffix}",
                    "baseline": {
                        "run_id": f"native-{run_suffix}",
                        "passed": index != 0,
                        "cost_units": 1.0,
                        "step_count": 2,
                        "latency_ms": 100.0,
                        "human_interventions": 0,
                        "duplicate_actions": 0,
                        "isolation_id": f"native-isolation-{run_suffix}",
                    },
                    "candidate": {
                        "run_id": f"langgraph-{run_suffix}",
                        "passed": True,
                        "cost_units": 1.1,
                        "step_count": 2,
                        "latency_ms": 105.0,
                        "human_interventions": 0,
                        "duplicate_actions": 0,
                        "isolation_id": f"langgraph-isolation-{run_suffix}",
                    },
                }
            )
    total = len(cases)
    return {
        "schema_version": "1.1",
        "environment": "staging",
        "source": "staging_runtime_execution",
        "synthetic": False,
        "status": "passed",
        "report_id": "core-eval-20260714-001",
        "completed_at": (generated_at + timedelta(minutes=total)).isoformat(),
        "task_set_id": catalog["task_set_id"],
        "task_set_sha256": catalog_digest(catalog),
        "trial_count": MIN_TRIALS,
        "baseline_runtime": "native",
        "candidate_runtime": "langgraph",
        "baseline_success_rate": (total - MIN_TRIALS) / total,
        "candidate_success_rate": 1.0,
        "cases": cases,
        "classification_review": {
            "source": "independent_human_review",
            "reviewed_by": "reviewer-001",
            "reviewed_at": (generated_at + timedelta(minutes=total)).isoformat(),
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


def test_checked_in_catalog_has_fifty_fixed_tasks_and_required_coverage() -> None:
    catalog = load_core_task_catalog()

    assert len(catalog["tasks"]) == 50
    assert len({item["task_id"] for item in catalog["tasks"]}) == 50
    assert {item["category"] for item in catalog["tasks"]} == {
        "knowledge_qa",
        "file",
        "write_operation",
        "approval",
        "long_running",
    }
    assert all(item["prompt"].strip() for item in catalog["tasks"])
    assert all(item["success_criteria"] for item in catalog["tasks"])


def test_real_three_trial_evidence_passes_and_reports_recomputed_metrics() -> None:
    result = validate_core_task_evidence(_evidence(), environment="staging")

    assert result["ok"] is True
    assert result["total_tasks"] == 50
    assert result["trial_count"] == 3
    assert result["total_cases"] == 150
    assert result["candidate_success_rate"] == 1.0
    assert result["candidate_not_below_baseline"] is True
    assert result["per_task_success_non_regression_ok"] is True
    assert result["per_category_success_non_regression_ok"] is True
    assert result["side_effect_isolation_ok"] is True
    assert result["side_effect_isolation_unique_ok"] is True
    assert result["metric_comparison"] == {
        "cost_units": {
            "baseline_mean": 1.0,
            "candidate_mean": 1.1,
            "candidate_delta": pytest.approx(0.1),
        },
        "step_count": {
            "baseline_mean": 2.0,
            "candidate_mean": 2.0,
            "candidate_delta": 0.0,
        },
        "latency_ms": {
            "baseline_mean": 100.0,
            "candidate_mean": 105.0,
            "candidate_delta": 5.0,
        },
        "human_interventions": {
            "baseline_mean": 0.0,
            "candidate_mean": 0.0,
            "candidate_delta": 0.0,
        },
        "human_intervention_rate": {
            "baseline_mean": 0.0,
            "candidate_mean": 0.0,
            "candidate_delta": 0.0,
        },
    }


def test_evidence_rejects_case_before_explicit_execution_window() -> None:
    report = _evidence()
    execution_not_before = datetime(2026, 7, 14, 8, 0, tzinfo=UTC)
    report["cases"][0]["executed_at"] = (
        execution_not_before - timedelta(microseconds=1)
    ).isoformat()

    result = validate_core_task_evidence(
        report,
        environment="staging",
        execution_not_before=execution_not_before,
    )

    assert result["execution_timeline_ok"] is True
    assert result["execution_window_ok"] is False
    assert result["ok"] is False


def test_execution_window_includes_report_completion_upper_bound() -> None:
    report = _evidence()
    report["completed_at"] = "2026-07-14T07:59:59+00:00"

    result = validate_core_task_evidence(
        report,
        environment="staging",
        execution_not_before=datetime(2026, 7, 14, 7, 0, tzinfo=UTC),
    )

    assert result["execution_timeline_ok"] is False
    assert result["execution_window_ok"] is False
    assert result["ok"] is False


def test_evidence_rejects_task_regression_hidden_by_aggregate_rate() -> None:
    report = _evidence()
    for case in report["cases"]:
        if case["task_id"] == "knowledge-01":
            case["baseline"]["passed"] = False
            case["candidate"]["passed"] = True
        elif case["task_id"] == "knowledge-02":
            case["baseline"]["passed"] = True
            case["candidate"]["passed"] = False
    report["baseline_success_rate"] = report["candidate_success_rate"] = 0.98

    result = validate_core_task_evidence(report, environment="staging")

    assert result["candidate_not_below_baseline"] is True
    assert result["per_task_success_non_regression_ok"] is False
    assert result["per_category_success_non_regression_ok"] is True
    assert result["ok"] is False


def test_metric_comparison_reports_human_intervention_case_rate() -> None:
    report = _evidence()
    report["cases"][0]["candidate"]["human_interventions"] = 2

    result = validate_core_task_evidence(report, environment="staging")

    assert result["ok"] is True
    assert result["metric_comparison"]["human_interventions"] == {
        "baseline_mean": 0.0,
        "candidate_mean": 0.013333,
        "candidate_delta": 0.013333,
    }
    assert result["metric_comparison"]["human_intervention_rate"] == {
        "baseline_mean": 0.0,
        "candidate_mean": 0.006667,
        "candidate_delta": 0.006667,
    }


def _add_classification_review(
    report: dict,
    *,
    expected_passed_by_task: dict[str, bool] | None = None,
) -> None:
    expected_passed_by_task = expected_passed_by_task or {
        case["task_id"]: case["task_id"] != "knowledge-01"
        for case in report["cases"]
    }
    report["classification_review"] = {
        "source": "independent_human_review",
        "reviewed_by": "reviewer-001",
        "reviewed_at": report["completed_at"],
        "labels": [
            {
                "task_id": case["task_id"],
                "trial": case["trial"],
                "runtime": runtime,
                "expected_passed": expected_passed_by_task[case["task_id"]],
            }
            for case in report["cases"]
            for runtime in ("baseline", "candidate")
        ],
    }


def test_classification_review_reports_false_positive_and_negative_rates() -> None:
    report = _evidence()
    for case in report["cases"]:
        if case["task_id"] == "knowledge-02":
            case["baseline"]["passed"] = False
            case["candidate"]["passed"] = False
    _add_classification_review(report)

    result = validate_core_task_evidence(report, environment="staging")

    assert result["classification_metrics_ok"] is True
    assert result["classification_metrics"]["baseline"] == {
        "true_positive": 144,
        "true_negative": 3,
        "false_positive": 0,
        "false_negative": 3,
        "false_positive_rate": 0.0,
        "false_negative_rate": 0.020408,
        "reviewed_cases": 150,
    }
    assert result["classification_metrics"]["candidate"] == {
        "true_positive": 144,
        "true_negative": 0,
        "false_positive": 3,
        "false_negative": 3,
        "false_positive_rate": 1.0,
        "false_negative_rate": 0.020408,
        "reviewed_cases": 150,
    }


def test_evidence_fails_closed_without_independent_classification_review() -> None:
    report = _evidence()
    report.pop("classification_review")
    result = validate_core_task_evidence(report, environment="staging")

    assert result["classification_metrics_ok"] is False
    assert result["ok"] is False


def test_evidence_rejects_reused_trace_reference() -> None:
    report = _evidence()
    report["cases"][1]["evidence_ref"] = report["cases"][0]["evidence_ref"]

    result = validate_core_task_evidence(report, environment="staging")

    assert result["evidence_trace_unique_ok"] is False
    assert result["ok"] is False


def test_evidence_rejects_reused_side_effect_isolation_id() -> None:
    report = _evidence()
    catalog = load_core_task_catalog()
    side_effect_task_ids = {
        task["task_id"] for task in catalog["tasks"] if task["side_effecting"]
    }
    side_effect_cases = [
        case for case in report["cases"] if case["task_id"] in side_effect_task_ids
    ]
    side_effect_cases[1]["baseline"]["isolation_id"] = side_effect_cases[0][
        "baseline"
    ]["isolation_id"]

    result = validate_core_task_evidence(report, environment="staging")

    assert result.get("side_effect_isolation_unique_ok") is False
    assert result["ok"] is False


@pytest.mark.parametrize(
    ("mutate", "failed_detail"),
    [
        (lambda report: report.update(synthetic=True), "real_execution_ok"),
        (lambda report: report.update(source="local_contract_fixture"), "real_execution_ok"),
        (lambda report: report["cases"].pop(), "coverage_ok"),
        (lambda report: report.update(trial_count=2), "trial_coverage_ok"),
        (
            lambda report: report.update(
                completed_at="2026-07-14T07:59:59+00:00"
            ),
            "execution_timeline_ok",
        ),
        (
            lambda report: report["cases"][0]["candidate"].update(
                duplicate_actions=1
            ),
            "zero_duplicate_actions",
        ),
        (
            lambda report: report["cases"][20]["candidate"].update(
                isolation_id=report["cases"][20]["baseline"]["isolation_id"]
            ),
            "side_effect_isolation_ok",
        ),
        (
            lambda report: [
                case["candidate"].update(passed=False) for case in report["cases"]
            ],
            "candidate_not_below_baseline",
        ),
    ],
)
def test_evidence_fails_closed_when_required_proof_is_missing(
    mutate,
    failed_detail: str,
) -> None:
    report = deepcopy(_evidence())
    mutate(report)

    result = validate_core_task_evidence(report, environment="staging")

    assert result["ok"] is False
    assert result[failed_detail] is False


def test_evidence_rejects_catalog_digest_or_reported_rate_mismatch() -> None:
    bad_digest = _evidence()
    bad_digest["task_set_sha256"] = "0" * 64
    bad_rate = _evidence()
    bad_rate["candidate_success_rate"] = 0.5

    assert validate_core_task_evidence(bad_digest, environment="staging")[
        "catalog_identity_ok"
    ] is False
    assert validate_core_task_evidence(bad_rate, environment="staging")[
        "rates_consistent"
    ] is False
