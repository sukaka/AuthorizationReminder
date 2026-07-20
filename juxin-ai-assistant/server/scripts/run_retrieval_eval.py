from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.retrieval_eval import (
    DEFAULT_CASES_PATH,
    check_retrieval_eval_gate,
    evaluate_retrieval_cases,
    load_retrieval_eval_cases,
)


def _load_rankings(path: Path) -> dict[str, list[str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_rankings = payload.get("rankings", payload)
    if not isinstance(raw_rankings, dict):
        raise ValueError("排名文件必须是 {case_id: [chunk_id, ...]} 或 {rankings: {...}}")
    return {
        str(case_id): [str(chunk_id) for chunk_id in chunk_ids]
        for case_id, chunk_ids in raw_rankings.items()
        if isinstance(chunk_ids, list)
    }


def _parse_threshold(value: str) -> tuple[str, float]:
    metric_name, separator, raw_threshold = value.partition("=")
    metric_name = metric_name.strip()
    if not separator or not metric_name:
        raise ValueError("阈值格式必须是 metric=value")
    try:
        threshold = float(raw_threshold)
    except ValueError as exc:
        raise ValueError(f"阈值不是数字: {value}") from exc
    return metric_name, threshold


def main() -> int:
    parser = argparse.ArgumentParser(description="运行检索 Recall/MRR/nDCG 评测")
    parser.add_argument("--rankings", required=True, type=Path, help="生产检索器导出的排名 JSON")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument(
        "--threshold",
        action="append",
        default=[],
        metavar="METRIC=VALUE",
        help="可重复的质量门禁阈值，例如 recall@5=0.8",
    )
    parser.add_argument(
        "--allow-missing-rankings",
        action="store_true",
        help="门禁时允许评测 case 没有排名（默认缺排名失败）",
    )
    args = parser.parse_args()
    report = evaluate_retrieval_cases(
        load_retrieval_eval_cases(args.cases),
        _load_rankings(args.rankings),
    )
    if args.threshold:
        thresholds = dict(_parse_threshold(item) for item in args.threshold)
        report["gate"] = check_retrieval_eval_gate(
            report,
            thresholds,
            allow_missing_rankings=args.allow_missing_rankings,
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("gate", {}).get("passed", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
