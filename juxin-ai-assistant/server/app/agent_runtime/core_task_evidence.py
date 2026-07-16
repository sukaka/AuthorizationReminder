"""Fail-closed validation for real dual-runtime core task evidence."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from math import isfinite
from pathlib import Path
from typing import Any


CATALOG_SCHEMA_VERSION = "1.0"
EVIDENCE_SCHEMA_VERSION = "1.1"
EXPECTED_TASK_COUNT = 50
MIN_TRIALS = 3
REQUIRED_CATEGORIES = {
    "knowledge_qa",
    "file",
    "write_operation",
    "approval",
    "long_running",
}
COMPARISON_METRICS = (
    "cost_units",
    "step_count",
    "latency_ms",
    "human_interventions",
)


class CoreTaskEvidenceError(ValueError):
    pass


def core_task_catalog_path() -> Path:
    return Path(__file__).with_name("core_task_catalog.json")


def _nonempty_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _strict_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _strict_nonnegative_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if isfinite(parsed) and parsed >= 0 else None


def _timestamp(value: Any) -> datetime | None:
    text = _nonempty_text(value)
    if text is None:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None


def validate_core_task_catalog(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise CoreTaskEvidenceError("core_task_catalog_not_object")
    if payload.get("schema_version") != CATALOG_SCHEMA_VERSION:
        raise CoreTaskEvidenceError("core_task_catalog_schema_invalid")
    if _nonempty_text(payload.get("task_set_id")) is None:
        raise CoreTaskEvidenceError("core_task_catalog_id_invalid")
    tasks = payload.get("tasks")
    if not isinstance(tasks, list) or len(tasks) != EXPECTED_TASK_COUNT:
        raise CoreTaskEvidenceError("core_task_catalog_count_invalid")

    task_ids: list[str] = []
    categories: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict):
            raise CoreTaskEvidenceError("core_task_catalog_task_invalid")
        task_id = _nonempty_text(task.get("task_id"))
        category = _nonempty_text(task.get("category"))
        success_criteria = task.get("success_criteria")
        if (
            task_id is None
            or category not in REQUIRED_CATEGORIES
            or not isinstance(task.get("side_effecting"), bool)
            or _nonempty_text(task.get("prompt")) is None
            or not isinstance(success_criteria, list)
            or not success_criteria
            or not all(_nonempty_text(item) is not None for item in success_criteria)
        ):
            raise CoreTaskEvidenceError("core_task_catalog_task_invalid")
        task_ids.append(task_id)
        categories.add(category)

    if len(set(task_ids)) != EXPECTED_TASK_COUNT:
        raise CoreTaskEvidenceError("core_task_catalog_ids_not_unique")
    if categories != REQUIRED_CATEGORIES:
        raise CoreTaskEvidenceError("core_task_catalog_coverage_invalid")
    return payload


def load_core_task_catalog(path: Path | None = None) -> dict[str, Any]:
    resolved = path or core_task_catalog_path()
    try:
        payload = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CoreTaskEvidenceError("core_task_catalog_unreadable") from exc
    return validate_core_task_catalog(payload)


def catalog_digest(catalog: dict[str, Any] | None = None) -> str:
    payload = validate_core_task_catalog(catalog or load_core_task_catalog())
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _runtime_result_shape(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return (
        _nonempty_text(value.get("run_id")) is not None
        and isinstance(value.get("passed"), bool)
        and _strict_nonnegative_number(value.get("cost_units")) is not None
        and _strict_nonnegative_int(value.get("step_count")) is not None
        and _strict_nonnegative_number(value.get("latency_ms")) is not None
        and _strict_nonnegative_int(value.get("human_interventions")) is not None
        and _strict_nonnegative_int(value.get("duplicate_actions")) is not None
        and _nonempty_text(value.get("isolation_id")) is not None
    )


def _classification_review_metrics(
    review: Any,
    *,
    expected_pairs: set[tuple[str, int]],
    case_by_pair: dict[tuple[str, int], dict[str, Any]],
    completed_at: datetime | None,
) -> tuple[bool, dict[str, dict[str, Any]]]:
    """Validate independent truth labels and calculate FP/FN rates."""

    review_dict = review if isinstance(review, dict) else {}
    reviewed_at = _timestamp(review_dict.get("reviewed_at"))
    labels = review_dict.get("labels")
    top_level_ok = (
        review_dict.get("source") == "independent_human_review"
        and _nonempty_text(review_dict.get("reviewed_by")) is not None
        and reviewed_at is not None
        and completed_at is not None
        and reviewed_at <= completed_at
        and isinstance(labels, list)
    )
    expected_label_keys = {
        (task_id, trial, runtime)
        for task_id, trial in expected_pairs
        for runtime in ("baseline", "candidate")
    }
    seen_label_keys: set[tuple[str, int, str]] = set()
    counts = {
        runtime: {
            "true_positive": 0,
            "true_negative": 0,
            "false_positive": 0,
            "false_negative": 0,
        }
        for runtime in ("baseline", "candidate")
    }
    labels_shape_ok = isinstance(labels, list)
    for label in labels or []:
        if not isinstance(label, dict):
            labels_shape_ok = False
            continue
        task_id = _nonempty_text(label.get("task_id"))
        trial = label.get("trial")
        runtime = _nonempty_text(label.get("runtime"))
        expected_passed = label.get("expected_passed")
        label_key = (task_id or "", trial, runtime or "")
        valid_label = (
            task_id is not None
            and isinstance(trial, int)
            and not isinstance(trial, bool)
            and runtime in ("baseline", "candidate")
            and isinstance(expected_passed, bool)
            and (task_id, trial) in case_by_pair
        )
        if not valid_label:
            labels_shape_ok = False
            continue
        seen_label_keys.add(label_key)
        case = case_by_pair[(task_id, trial)]
        predicted_passed = case[runtime]["passed"]
        if predicted_passed and expected_passed:
            counts[runtime]["true_positive"] += 1
        elif not predicted_passed and not expected_passed:
            counts[runtime]["true_negative"] += 1
        elif predicted_passed and not expected_passed:
            counts[runtime]["false_positive"] += 1
        else:
            counts[runtime]["false_negative"] += 1

    coverage_ok = (
        labels_shape_ok
        and len(seen_label_keys) == len(labels or [])
        and seen_label_keys == expected_label_keys
    )
    metrics: dict[str, dict[str, Any]] = {}
    rates_ok = coverage_ok
    for runtime, runtime_counts in counts.items():
        negative_cases = runtime_counts["true_negative"] + runtime_counts[
            "false_positive"
        ]
        positive_cases = runtime_counts["true_positive"] + runtime_counts[
            "false_negative"
        ]
        false_positive_rate = (
            runtime_counts["false_positive"] / negative_cases
            if negative_cases
            else None
        )
        false_negative_rate = (
            runtime_counts["false_negative"] / positive_cases
            if positive_cases
            else None
        )
        rates_ok = rates_ok and false_positive_rate is not None and false_negative_rate is not None
        metrics[runtime] = {
            **runtime_counts,
            "false_positive_rate": (
                round(false_positive_rate, 6)
                if false_positive_rate is not None
                else None
            ),
            "false_negative_rate": (
                round(false_negative_rate, 6)
                if false_negative_rate is not None
                else None
            ),
            "reviewed_cases": sum(runtime_counts.values()),
        }
    return top_level_ok and coverage_ok and rates_ok, metrics


def validate_core_task_evidence(
    report: Any,
    *,
    environment: str,
    catalog: dict[str, Any] | None = None,
    execution_not_before: datetime | None = None,
) -> dict[str, Any]:
    """Validate exported per-run evidence without executing either runtime."""

    fixed_catalog = validate_core_task_catalog(catalog or load_core_task_catalog())
    tasks = fixed_catalog["tasks"]
    task_by_id = {task["task_id"]: task for task in tasks}
    payload = report if isinstance(report, dict) else {}
    raw_cases = payload.get("cases")
    cases = raw_cases if isinstance(raw_cases, list) else []
    trial_count = _strict_nonnegative_int(payload.get("trial_count"))
    completed_at = _timestamp(payload.get("completed_at"))

    top_level_ok = (
        isinstance(report, dict)
        and payload.get("schema_version") == EVIDENCE_SCHEMA_VERSION
        and payload.get("environment") == environment
        and payload.get("status") == "passed"
        and _nonempty_text(payload.get("report_id")) is not None
        and completed_at is not None
        and payload.get("baseline_runtime") == "native"
        and payload.get("candidate_runtime") == "langgraph"
    )
    real_execution_ok = (
        payload.get("source") == "staging_runtime_execution"
        and payload.get("synthetic") is False
    )
    catalog_identity_ok = (
        payload.get("task_set_id") == fixed_catalog["task_set_id"]
        and payload.get("task_set_sha256") == catalog_digest(fixed_catalog)
    )
    trial_coverage_ok = trial_count is not None and trial_count >= MIN_TRIALS
    expected_pairs = (
        {
            (task_id, trial)
            for trial in range(1, trial_count + 1)
            for task_id in task_by_id
        }
        if trial_coverage_ok
        else set()
    )

    seen_pairs: list[tuple[str, int]] = []
    case_by_pair: dict[tuple[str, int], dict[str, Any]] = {}
    baseline_run_ids: list[str] = []
    candidate_run_ids: list[str] = []
    evidence_refs: list[str] = []
    side_effect_isolation_ids: list[str] = []
    metrics_shape_ok = isinstance(raw_cases, list)
    evidence_trace_ok = isinstance(raw_cases, list)
    execution_timeline_ok = isinstance(raw_cases, list) and completed_at is not None
    execution_not_before_ok = execution_not_before is None or (
        isinstance(execution_not_before, datetime)
        and execution_not_before.tzinfo is not None
        and execution_not_before.utcoffset() is not None
    )
    execution_window_ok = execution_timeline_ok and execution_not_before_ok
    category_identity_ok = isinstance(raw_cases, list)
    side_effect_isolation_ok = isinstance(raw_cases, list)
    zero_duplicate_actions = isinstance(raw_cases, list)
    baseline_passes = 0
    candidate_passes = 0
    task_stats = {
        task_id: {
            "category": task["category"],
            "observed_cases": 0,
            "baseline_passes": 0,
            "candidate_passes": 0,
        }
        for task_id, task in task_by_id.items()
    }
    category_stats = {
        category: {
            "observed_cases": 0,
            "baseline_passes": 0,
            "candidate_passes": 0,
        }
        for category in REQUIRED_CATEGORIES
    }
    metric_totals = {
        runtime: {metric: 0.0 for metric in COMPARISON_METRICS}
        for runtime in ("baseline", "candidate")
    }
    human_intervention_cases = {"baseline": 0, "candidate": 0}
    metric_case_count = 0

    for case in cases:
        if not isinstance(case, dict):
            metrics_shape_ok = False
            evidence_trace_ok = False
            category_identity_ok = False
            side_effect_isolation_ok = False
            zero_duplicate_actions = False
            continue
        task_id = _nonempty_text(case.get("task_id"))
        trial = _strict_nonnegative_int(case.get("trial"))
        task = task_by_id.get(task_id or "")
        baseline = case.get("baseline")
        candidate = case.get("candidate")
        executed_at = _timestamp(case.get("executed_at"))
        evidence_ref = _nonempty_text(case.get("evidence_ref"))
        case_shape_ok = (
            task is not None
            and trial is not None
            and trial >= 1
            and _runtime_result_shape(baseline)
            and _runtime_result_shape(candidate)
        )
        metrics_shape_ok = metrics_shape_ok and case_shape_ok
        evidence_trace_ok = evidence_trace_ok and (
            executed_at is not None and evidence_ref is not None
        )
        if evidence_ref is not None:
            evidence_refs.append(evidence_ref)
        execution_timeline_ok = execution_timeline_ok and (
            executed_at is not None
            and completed_at is not None
            and executed_at <= completed_at
        )
        execution_window_ok = execution_window_ok and (
            executed_at is not None
            and completed_at is not None
            and executed_at <= completed_at
            and (
                execution_not_before is None
                or (
                    execution_not_before_ok
                    and executed_at >= execution_not_before
                )
            )
        )
        category_identity_ok = category_identity_ok and (
            task is not None and case.get("category") == task["category"]
        )
        if task_id is not None and trial is not None:
            seen_pairs.append((task_id, trial))
            if case_shape_ok:
                case_by_pair.setdefault((task_id, trial), case)
        if not isinstance(baseline, dict) or not isinstance(candidate, dict):
            side_effect_isolation_ok = False
            zero_duplicate_actions = False
            continue
        baseline_run_id = _nonempty_text(baseline.get("run_id"))
        candidate_run_id = _nonempty_text(candidate.get("run_id"))
        if baseline_run_id is not None:
            baseline_run_ids.append(baseline_run_id)
        if candidate_run_id is not None:
            candidate_run_ids.append(candidate_run_id)
        if baseline.get("passed") is True:
            baseline_passes += 1
        if candidate.get("passed") is True:
            candidate_passes += 1
        if case_shape_ok and task_id is not None and task is not None:
            task_stat = task_stats[task_id]
            category_stat = category_stats[task["category"]]
            task_stat["observed_cases"] += 1
            category_stat["observed_cases"] += 1
            if baseline["passed"]:
                task_stat["baseline_passes"] += 1
                category_stat["baseline_passes"] += 1
            if candidate["passed"]:
                task_stat["candidate_passes"] += 1
                category_stat["candidate_passes"] += 1
            for metric in COMPARISON_METRICS:
                metric_totals["baseline"][metric] += float(baseline[metric])
                metric_totals["candidate"][metric] += float(candidate[metric])
            if baseline["human_interventions"] > 0:
                human_intervention_cases["baseline"] += 1
            if candidate["human_interventions"] > 0:
                human_intervention_cases["candidate"] += 1
            metric_case_count += 1
        zero_duplicate_actions = zero_duplicate_actions and (
            baseline.get("duplicate_actions") == 0
            and candidate.get("duplicate_actions") == 0
        )
        if task is not None and task["side_effecting"]:
            baseline_isolation_id = _nonempty_text(baseline.get("isolation_id"))
            candidate_isolation_id = _nonempty_text(candidate.get("isolation_id"))
            side_effect_isolation_ok = side_effect_isolation_ok and (
                baseline_isolation_id is not None
                and candidate_isolation_id is not None
                and baseline_isolation_id != candidate_isolation_id
            )
            if baseline_isolation_id is not None:
                side_effect_isolation_ids.append(baseline_isolation_id)
            if candidate_isolation_id is not None:
                side_effect_isolation_ids.append(candidate_isolation_id)

    unique_pairs = len(seen_pairs) == len(set(seen_pairs))
    evidence_trace_unique_ok = (
        len(evidence_refs) == len(set(evidence_refs)) == len(cases)
    )
    expected_side_effect_executions = (
        sum(task["side_effecting"] for task in tasks) * trial_count * 2
        if trial_coverage_ok and trial_count is not None
        else None
    )
    side_effect_isolation_unique_ok = (
        expected_side_effect_executions is not None
        and len(side_effect_isolation_ids)
        == len(set(side_effect_isolation_ids))
        == expected_side_effect_executions
    )
    unique_run_ids = (
        len(baseline_run_ids) == len(set(baseline_run_ids)) == len(cases)
        and len(candidate_run_ids) == len(set(candidate_run_ids)) == len(cases)
        and set(baseline_run_ids).isdisjoint(candidate_run_ids)
    )
    coverage_ok = (
        trial_coverage_ok
        and set(seen_pairs) == expected_pairs
        and len(cases) == len(expected_pairs)
        and unique_pairs
        and unique_run_ids
        and category_identity_ok
    )
    classification_metrics_ok, classification_metrics = _classification_review_metrics(
        payload.get("classification_review"),
        expected_pairs=expected_pairs,
        case_by_pair=case_by_pair,
        completed_at=completed_at,
    )
    total_cases = len(cases)
    baseline_rate = baseline_passes / total_cases if total_cases else 0.0
    candidate_rate = candidate_passes / total_cases if total_cases else 0.0
    reported_baseline_rate = _strict_nonnegative_number(
        payload.get("baseline_success_rate")
    )
    reported_candidate_rate = _strict_nonnegative_number(
        payload.get("candidate_success_rate")
    )
    rates_consistent = (
        reported_baseline_rate is not None
        and reported_candidate_rate is not None
        and reported_baseline_rate <= 1
        and reported_candidate_rate <= 1
        and abs(reported_baseline_rate - baseline_rate) <= 0.000001
        and abs(reported_candidate_rate - candidate_rate) <= 0.000001
    )
    candidate_not_below_baseline = candidate_rate >= baseline_rate
    per_task_success_comparison = []
    for task_id in task_by_id:
        stats = task_stats[task_id]
        observed_cases = stats["observed_cases"]
        task_baseline_rate = (
            stats["baseline_passes"] / observed_cases if observed_cases else 0.0
        )
        task_candidate_rate = (
            stats["candidate_passes"] / observed_cases if observed_cases else 0.0
        )
        per_task_success_comparison.append(
            {
                "task_id": task_id,
                "category": stats["category"],
                "observed_cases": observed_cases,
                "baseline_success_rate": task_baseline_rate,
                "candidate_success_rate": task_candidate_rate,
                "candidate_not_below_baseline": (
                    task_candidate_rate >= task_baseline_rate
                ),
            }
        )
    per_category_success_comparison = []
    for category in sorted(REQUIRED_CATEGORIES):
        stats = category_stats[category]
        observed_cases = stats["observed_cases"]
        category_baseline_rate = (
            stats["baseline_passes"] / observed_cases if observed_cases else 0.0
        )
        category_candidate_rate = (
            stats["candidate_passes"] / observed_cases if observed_cases else 0.0
        )
        per_category_success_comparison.append(
            {
                "category": category,
                "observed_cases": observed_cases,
                "baseline_success_rate": category_baseline_rate,
                "candidate_success_rate": category_candidate_rate,
                "candidate_not_below_baseline": (
                    category_candidate_rate >= category_baseline_rate
                ),
            }
        )
    per_task_success_non_regression_ok = coverage_ok and all(
        row["candidate_not_below_baseline"]
        for row in per_task_success_comparison
    )
    per_category_success_non_regression_ok = coverage_ok and all(
        row["candidate_not_below_baseline"]
        for row in per_category_success_comparison
    )
    metric_comparison = {}
    for metric in COMPARISON_METRICS:
        baseline_mean = (
            metric_totals["baseline"][metric] / metric_case_count
            if metric_case_count
            else 0.0
        )
        candidate_mean = (
            metric_totals["candidate"][metric] / metric_case_count
            if metric_case_count
            else 0.0
        )
        metric_comparison[metric] = {
            "baseline_mean": round(baseline_mean, 6),
            "candidate_mean": round(candidate_mean, 6),
            "candidate_delta": round(candidate_mean - baseline_mean, 6),
        }
    baseline_intervention_rate = (
        human_intervention_cases["baseline"] / metric_case_count
        if metric_case_count
        else 0.0
    )
    candidate_intervention_rate = (
        human_intervention_cases["candidate"] / metric_case_count
        if metric_case_count
        else 0.0
    )
    metric_comparison["human_intervention_rate"] = {
        "baseline_mean": round(baseline_intervention_rate, 6),
        "candidate_mean": round(candidate_intervention_rate, 6),
        "candidate_delta": round(
            candidate_intervention_rate - baseline_intervention_rate,
            6,
        ),
    }

    ok = all(
        (
            top_level_ok,
            real_execution_ok,
            catalog_identity_ok,
            trial_coverage_ok,
            coverage_ok,
            metrics_shape_ok,
            evidence_trace_ok,
            evidence_trace_unique_ok,
            execution_timeline_ok,
            execution_window_ok,
            side_effect_isolation_ok,
            side_effect_isolation_unique_ok,
            zero_duplicate_actions,
            rates_consistent,
            candidate_not_below_baseline,
            per_task_success_non_regression_ok,
            per_category_success_non_regression_ok,
            classification_metrics_ok,
        )
    )
    return {
        "ok": ok,
        "top_level_ok": top_level_ok,
        "real_execution_ok": real_execution_ok,
        "catalog_identity_ok": catalog_identity_ok,
        "trial_coverage_ok": trial_coverage_ok,
        "coverage_ok": coverage_ok,
        "metrics_shape_ok": metrics_shape_ok,
        "evidence_trace_ok": evidence_trace_ok,
        "evidence_trace_unique_ok": evidence_trace_unique_ok,
        "execution_timeline_ok": execution_timeline_ok,
        "execution_window_ok": execution_window_ok,
        "side_effect_isolation_ok": side_effect_isolation_ok,
        "side_effect_isolation_unique_ok": side_effect_isolation_unique_ok,
        "zero_duplicate_actions": zero_duplicate_actions,
        "rates_consistent": rates_consistent,
        "candidate_not_below_baseline": candidate_not_below_baseline,
        "per_task_success_non_regression_ok": per_task_success_non_regression_ok,
        "per_category_success_non_regression_ok": (
            per_category_success_non_regression_ok
        ),
        "classification_metrics_ok": classification_metrics_ok,
        "classification_metrics": classification_metrics,
        "total_tasks": len(tasks),
        "trial_count": trial_count,
        "total_cases": total_cases,
        "baseline_success_rate": baseline_rate,
        "candidate_success_rate": candidate_rate,
        "per_task_success_comparison": per_task_success_comparison,
        "per_category_success_comparison": per_category_success_comparison,
        "metric_comparison": metric_comparison,
        "categories": sorted({task["category"] for task in tasks}),
    }
