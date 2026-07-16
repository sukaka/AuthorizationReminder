#!/usr/bin/env python3
"""Evaluate dual-week GA observation JSONL produced by run_ga_observe.py.

Usage:
  python scripts/evaluate_ga_observe.py --in ../../docs/plans/ga-observe.jsonl
  python scripts/evaluate_ga_observe.py --in ga-observe.jsonl --min-days 14 --require-ready
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

try:  # package import for tests; direct import for `python scripts/foo.py`
    from scripts.ops_probe_semantics import semantic_ok
    from scripts.observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from ops_probe_semantics import semantic_ok
    from observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )


def _parse_ts(value: Any) -> datetime | None:
    """Parse only timezone-aware observation timestamps."""

    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None


def _safe_nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if parsed >= 0 else None


def _safe_status_code(value: Any) -> int | None:
    """Parse an HTTP status without coercing malformed values into success."""

    if isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if 100 <= parsed <= 599 else None


def _probe_result(path: str, probe: dict[str, Any]) -> tuple[bool, bool]:
    """Return ``(http_ok, semantic_ok)`` for one observation probe.

    Rows generated before the semantic field was introduced remain readable:
    a missing field is derived from the response body when present, otherwise
    treated as a legacy generic probe. Current rows always carry the field and
    therefore fail closed on false or malformed values.
    """

    status_code = _safe_status_code(probe.get("status_code"))
    http_ok = status_code is not None and 200 <= status_code < 300
    if "semantic_ok" in probe:
        semantic_value = probe.get("semantic_ok")
        semantic_pass = semantic_value is True
    elif "body" in probe:
        semantic_pass = semantic_ok(path, probe.get("body"))
    else:
        semantic_pass = True
    return http_ok, semantic_pass


def load_rows(path: Path, *, strict: bool = False) -> list[dict[str, Any]]:
    """Load JSONL observations, optionally rejecting malformed artifact rows.

    The default keeps the standalone evaluator backward compatible with older
    files.  The final staging evidence gate uses ``strict=True`` so a damaged
    or partially non-object artifact cannot be silently shortened into a
    passing observation window.
    """

    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            if strict:
                raise ValueError(f"invalid observation JSON on line {line_number}") from None
            continue
        if isinstance(obj, dict):
            rows.append(obj)
        elif strict:
            raise ValueError(f"observation row must be an object on line {line_number}")
    return rows


def _latest_consecutive_window(dates: set[date]) -> tuple[int, date | None, date | None, list[str]]:
    """Return the uninterrupted daily observation window ending on the latest sample."""
    if not dates:
        return 0, None, None, []
    end = max(dates)
    start = end
    while start - timedelta(days=1) in dates:
        start -= timedelta(days=1)
    observed_start = min(dates)
    missing = [
        (observed_start + timedelta(days=offset)).isoformat()
        for offset in range((end - observed_start).days + 1)
        if observed_start + timedelta(days=offset) not in dates
    ]
    return (end - start).days + 1, start, end, missing


def evaluate(
    rows: list[Any],
    *,
    min_days: int,
    require_ready: bool,
    min_success_rate: float = 0.9,
    min_finished_runs: int = 1,
) -> dict[str, Any]:
    readiness = Counter()
    security = Counter()
    ga = Counter()
    dates: set[date] = set()
    bad_http = 0
    semantic_failures = 0
    malformed_probes = 0
    rows_without_probes = 0
    snapshot_missing = 0
    snapshot_unavailable = 0
    tool_reconciliation_backlog = 0
    direct_action_reconciliation_backlog = 0
    run_reconciliation_missing = 0
    run_reconciliation_unavailable = 0
    run_reconciliation_failures = 0
    run_reconciliation_issue_total = 0
    slo_missing = 0
    slo_unavailable = 0
    slo_failures = 0
    slo_gaps = 0
    malformed_rows = 0
    invalid_timestamps = 0
    snapshots_by_day: dict[date, tuple[datetime, dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            malformed_rows += 1
            continue
        ts = _parse_ts(row.get("ts"))
        if ts:
            dates.add(ts.date())
        else:
            invalid_timestamps += 1
        readiness[str(row.get("readiness_overall") or "missing")] += 1
        security[str(row.get("security_overall") or "missing")] += 1
        ga[str(row.get("ga_overall") or "missing")] += 1
        raw_probes = row.get("probes")
        probes = raw_probes if isinstance(raw_probes, dict) else {}
        if not probes:
            rows_without_probes += 1
        for path, probe in probes.items():
            if not isinstance(probe, dict):
                malformed_probes += 1
                semantic_failures += 1
                continue
            http_ok, semantic_pass = _probe_result(str(path), probe)
            if not http_ok:
                bad_http += 1
            if not semantic_pass:
                semantic_failures += 1
        snapshot = row.get("ops_snapshot")
        if not isinstance(snapshot, dict):
            snapshot_missing += 1
            continue
        notes = snapshot.get("notes")
        if not isinstance(notes, list) or any(
            note in {
                "runs_table_unavailable",
                "agent_tool_invocations_table_unavailable",
                "direct_action_invocations_table_unavailable",
            }
            for note in notes
        ):
            snapshot_unavailable += 1
            continue
        counters = (
            snapshot.get("runs_succeeded"),
            snapshot.get("runs_failed"),
            snapshot.get("tool_invocations_reconciliation_required"),
            snapshot.get("direct_actions_reconciliation_required"),
        )
        if any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0
            for value in counters
        ):
            snapshot_unavailable += 1
            continue
        slo = snapshot.get("slo_audit")
        if not isinstance(slo, dict):
            slo_missing += 1
        else:
            slo_overall = str(slo.get("overall") or "unavailable")
            if slo_overall in {"fail", "unavailable"}:
                slo_failures += 1
            elif slo_overall == "pass_with_gaps":
                slo_gaps += 1
            elif slo_overall != "pass":
                slo_unavailable += 1
            slo_fail_count = _safe_nonnegative_int(slo.get("fail_count"))
            if slo_fail_count is None:
                slo_unavailable += 1
            elif slo_fail_count > 0:
                slo_failures += 1
        reconciliation_overall = snapshot.get("run_reconciliation_overall")
        reconciliation_scanned = snapshot.get("run_reconciliation_scanned_runs")
        reconciliation_issues = snapshot.get("run_reconciliation_issue_count")
        if reconciliation_overall is None or reconciliation_scanned is None or reconciliation_issues is None:
            run_reconciliation_missing += 1
        elif (
            reconciliation_overall == "unavailable"
            or not isinstance(reconciliation_scanned, int)
            or isinstance(reconciliation_scanned, bool)
            or reconciliation_scanned < 0
            or not isinstance(reconciliation_issues, int)
            or isinstance(reconciliation_issues, bool)
            or reconciliation_issues < 0
        ):
            run_reconciliation_unavailable += 1
        else:
            run_reconciliation_issue_total += reconciliation_issues
            if reconciliation_overall != "pass" or reconciliation_issues != 0:
                run_reconciliation_failures += 1
        tool_reconciliation_backlog += counters[2]
        direct_action_reconciliation_backlog += counters[3]
        if ts:
            previous = snapshots_by_day.get(ts.date())
            if previous is None or ts >= previous[0]:
                snapshots_by_day[ts.date()] = (ts, snapshot)

    low_success_rate_days = 0
    insufficient_run_days = 0
    counter_reset_days = 0
    previous_counts: tuple[int, int] | None = None
    for day in sorted(snapshots_by_day):
        snapshot = snapshots_by_day[day][1]
        succeeded = max(0, int(snapshot.get("runs_succeeded") or 0))
        failed = max(0, int(snapshot.get("runs_failed") or 0))
        if previous_counts is None:
            succeeded_delta, failed_delta = succeeded, failed
        else:
            previous_succeeded, previous_failed = previous_counts
            if succeeded < previous_succeeded or failed < previous_failed:
                counter_reset_days += 1
                succeeded_delta = failed_delta = 0
            else:
                succeeded_delta = succeeded - previous_succeeded
                failed_delta = failed - previous_failed
        previous_counts = (succeeded, failed)
        completed = succeeded_delta + failed_delta
        if completed < min_finished_runs:
            insufficient_run_days += 1
        elif succeeded_delta / completed < min_success_rate:
            low_success_rate_days += 1

    day_count = len(dates)
    consecutive_days, consecutive_start, consecutive_end, missing_dates = _latest_consecutive_window(dates)
    ready_ok = readiness.get("ready", 0) + readiness.get("ready_with_warnings", 0)
    not_ready = readiness.get("not_ready", 0) + readiness.get("missing", 0)
    sec_fail = security.get("fail", 0)
    ga_blocked = ga.get("blocked", 0) + ga.get("not_ready", 0)

    days_ok = consecutive_days >= min_days
    readiness_ok = not_ready == 0 and (
        (not require_ready and ready_ok >= 0)
        or ready_ok >= max(1, len(rows) // 2)
    )
    if len(rows) == 0:
        readiness_ok = False
    checks = [
        {
            "id": "observation_rows",
            "name": "观测行是对象且时间戳带时区",
            "status": (
                "insufficient"
                if not rows
                else ("fail" if malformed_rows or invalid_timestamps else "pass")
            ),
            "detail": {
                "malformed_rows": malformed_rows,
                "invalid_timestamps": invalid_timestamps,
            },
        },
        {
            "id": "min_days",
            "name": f"连续观测天数 ≥ {min_days}",
            "status": "pass" if days_ok else "insufficient",
            "detail": (
                f"unique_days={day_count} consecutive_days={consecutive_days} "
                f"samples={len(rows)} missing_dates={','.join(missing_dates) or '-'}"
            ),
        },
        {
            "id": "readiness",
            "name": "readiness 无 not_ready",
            "status": "pass" if readiness_ok and len(rows) else ("fail" if not_ready else "warn"),
            "detail": dict(readiness),
        },
        {
            "id": "security",
            "name": "security-audit 无 fail",
            "status": "pass" if sec_fail == 0 else "fail",
            "detail": dict(security),
        },
        {
            "id": "ga_report",
            "name": "ga-report 无 blocked",
            "status": "pass" if ga_blocked == 0 else "fail",
            "detail": dict(ga),
        },
        {
            "id": "http",
            "name": "探针 HTTP 无失败",
            "status": "pass" if bad_http == 0 else "fail",
            "detail": f"bad_http={bad_http}",
        },
        {
            "id": "probe_semantics",
            "name": "探针响应满足共享语义契约",
            "status": (
                "insufficient"
                if not rows or rows_without_probes
                else ("fail" if semantic_failures else "pass")
            ),
            "detail": {
                "semantic_failures": semantic_failures,
                "malformed_probes": malformed_probes,
                "rows_without_probes": rows_without_probes,
            },
        },
        {
            "id": "ops_snapshot",
            "name": "运行与工具账本快照可用",
            "status": (
                "insufficient"
                if not rows
                else ("pass" if snapshot_missing == 0 and snapshot_unavailable == 0 else "fail")
            ),
            "detail": {
                "missing": snapshot_missing,
                "unavailable": snapshot_unavailable,
            },
        },
        {
            "id": "reconciliation",
            "name": "待对账副作用积压为 0",
            "status": (
                "insufficient"
                if not rows
                else (
                    "pass"
                    if tool_reconciliation_backlog == 0 and direct_action_reconciliation_backlog == 0
                    else "fail"
                )
            ),
            "detail": {
                "tool_invocations_pending": tool_reconciliation_backlog,
                "direct_actions_pending": direct_action_reconciliation_backlog,
            },
        },
        {
            "id": "run_reconciliation",
            "name": "Run/Step/Event 对账摘要为 pass 且问题数为 0",
            "status": (
                "insufficient"
                if not rows
                else (
                    "fail"
                    if run_reconciliation_missing
                    or run_reconciliation_unavailable
                    or run_reconciliation_failures
                    else "pass"
                )
            ),
            "detail": {
                "missing": run_reconciliation_missing,
                "unavailable": run_reconciliation_unavailable,
                "failed_samples": run_reconciliation_failures,
                "issue_total": run_reconciliation_issue_total,
            },
        },
        {
            "id": "agent_loop_slo",
            "name": "Agent Loop SLO 审计可用且无硬性违规",
            "status": (
                "fail"
                if slo_missing or slo_unavailable or slo_failures
                else ("insufficient" if slo_gaps else ("insufficient" if not rows else "pass"))
            ),
            "detail": {
                "missing": slo_missing,
                "unavailable": slo_unavailable,
                "failed_samples": slo_failures,
                "gap_samples": slo_gaps,
            },
        },
        {
            "id": "run_success_rate",
            "name": f"每个自然日新增完成运行 ≥ {min_finished_runs} 且成功率 ≥ {min_success_rate:.0%}",
            "status": (
                "fail"
                if low_success_rate_days or counter_reset_days
                else ("insufficient" if not rows or insufficient_run_days else "pass")
            ),
            "detail": {
                "low_success_rate_days": low_success_rate_days,
                "insufficient_run_days": insufficient_run_days,
                "counter_reset_days": counter_reset_days,
            },
        },
    ]
    hard = sum(1 for c in checks if c["status"] == "fail")
    warns = sum(1 for c in checks if c["status"] == "warn")
    insufficient = sum(1 for c in checks if c["status"] == "insufficient")
    if hard:
        overall = "fail"
    elif not days_ok or insufficient:
        overall = "insufficient_data"
    else:
        overall = "pass"
    return {
        "overall": overall,
        "samples": len(rows),
        "unique_days": day_count,
        "consecutive_days": consecutive_days,
        "date_range": {
            "first": min(dates).isoformat() if dates else None,
            "last": max(dates).isoformat() if dates else None,
        },
        "consecutive_window": {
            "first": consecutive_start.isoformat() if consecutive_start else None,
            "last": consecutive_end.isoformat() if consecutive_end else None,
            "missing_dates": missing_dates,
        },
        "counters": {
            "readiness": dict(readiness),
            "security": dict(security),
            "ga": dict(ga),
        },
        "checks": checks,
        "fail_count": hard,
        "warn_count": warns,
        "insufficient_count": insufficient,
        "recommendation": {
            "pass": "连续观测达标，可宣布 6.0 GA（仍需复核高危事件为零）",
            "insufficient_data": f"最新连续观测窗口不足 {min_days} 天，继续每日 run_ga_observe",
            "fail": "存在 fail 项，修复后重新累计观测窗口",
        }.get(overall, ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate GA observe JSONL")
    parser.add_argument(
        "--in",
        dest="infile",
        default="",
        help="JSONL path (default: docs/plans/ga-observe.jsonl)",
    )
    parser.add_argument("--min-days", type=int, default=DEFAULT_OBSERVATION_DAYS)
    parser.add_argument("--min-success-rate", type=float, default=DEFAULT_MIN_SUCCESS_RATE)
    parser.add_argument("--min-finished-runs", type=int, default=DEFAULT_MIN_FINISHED_RUNS)
    parser.add_argument(
        "--require-ready",
        action="store_true",
        help="Require majority readiness=ready (not only ready_with_warnings)",
    )
    args = parser.parse_args()
    path = Path(args.infile) if args.infile else (
        Path(__file__).resolve().parents[2] / "docs" / "plans" / "ga-observe.jsonl"
    )
    rows = load_rows(path)
    if not 0 <= args.min_success_rate <= 1:
        parser.error("--min-success-rate 必须位于 0 到 1")
    if args.min_finished_runs < 1:
        parser.error("--min-finished-runs 必须至少为 1")
    report = evaluate(
        rows,
        min_days=args.min_days,
        require_ready=args.require_ready,
        min_success_rate=args.min_success_rate,
        min_finished_runs=args.min_finished_runs,
    )
    report["source"] = str(path)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["overall"] == "pass":
        return 0
    if report["overall"] == "insufficient_data":
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
