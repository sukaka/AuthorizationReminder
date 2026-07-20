from __future__ import annotations

import json
from dataclasses import dataclass
from math import log2
from pathlib import Path
from typing import Iterable, Mapping, Sequence


SERVER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASES_PATH = SERVER_ROOT / "retrieval_eval_cases.json"


@dataclass(frozen=True)
class RetrievalEvalCase:
    """A manually annotated query and the chunk ids that answer it."""

    case_id: str
    query: str
    relevant_chunk_ids: frozenset[str]


def _normalise_ids(chunk_ids: Iterable[str]) -> tuple[str, ...]:
    """Keep ranked order while removing blanks and duplicate ids."""
    result: list[str] = []
    seen: set[str] = set()
    for chunk_id in chunk_ids:
        value = str(chunk_id).strip()
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return tuple(result)


def _relevant_ids(relevant_chunk_ids: Iterable[str]) -> frozenset[str]:
    return frozenset(_normalise_ids(relevant_chunk_ids))


def recall_at_k(
    ranked_chunk_ids: Sequence[str],
    relevant_chunk_ids: Iterable[str],
    k: int,
) -> float:
    """Return the fraction of annotated relevant chunks found in the top k."""
    relevant = _relevant_ids(relevant_chunk_ids)
    if not relevant or k <= 0:
        return 0.0
    retrieved = set(_normalise_ids(ranked_chunk_ids)[:k])
    return len(retrieved & relevant) / len(relevant)


def reciprocal_rank(
    ranked_chunk_ids: Sequence[str],
    relevant_chunk_ids: Iterable[str],
) -> float:
    """Return the reciprocal rank of the first relevant chunk."""
    relevant = _relevant_ids(relevant_chunk_ids)
    if not relevant:
        return 0.0
    for rank, chunk_id in enumerate(_normalise_ids(ranked_chunk_ids), start=1):
        if chunk_id in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(
    ranked_chunk_ids: Sequence[str],
    relevant_chunk_ids: Iterable[str],
    k: int,
) -> float:
    """Return binary-relevance nDCG@k for the annotated chunk ids."""
    relevant = _relevant_ids(relevant_chunk_ids)
    if not relevant or k <= 0:
        return 0.0
    ranked = _normalise_ids(ranked_chunk_ids)[:k]
    dcg = sum(
        1.0 / log2(rank + 1)
        for rank, chunk_id in enumerate(ranked, start=1)
        if chunk_id in relevant
    )
    ideal_hits = min(k, len(relevant))
    ideal_dcg = sum(1.0 / log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return dcg / ideal_dcg if ideal_dcg else 0.0


def load_retrieval_eval_cases(
    path: Path = DEFAULT_CASES_PATH,
) -> list[RetrievalEvalCase]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != "1.0":
        raise ValueError("retrieval_eval_cases.json 版本必须为 1.0")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("retrieval_eval_cases.json 缺少 cases 列表")

    cases: list[RetrievalEvalCase] = []
    seen_ids: set[str] = set()
    for item in raw_cases:
        if not isinstance(item, dict):
            raise ValueError("检索评测 case 必须是对象")
        case_id = str(item.get("id") or "").strip()
        query = str(item.get("query") or "").strip()
        relevant = _relevant_ids(item.get("relevant_chunk_ids") or [])
        if not case_id or not query or not relevant:
            raise ValueError("检索评测 case 必须包含 id、query 和 relevant_chunk_ids")
        if case_id in seen_ids:
            raise ValueError(f"检索评测 case id 重复: {case_id}")
        seen_ids.add(case_id)
        cases.append(
            RetrievalEvalCase(
                case_id=case_id,
                query=query,
                relevant_chunk_ids=relevant,
            )
        )
    return cases


def evaluate_retrieval_cases(
    cases: Sequence[RetrievalEvalCase],
    rankings: Mapping[str, Sequence[str]],
    *,
    cutoffs: Sequence[int] = (5, 10),
) -> dict[str, object]:
    """Evaluate externally produced rankings without coupling to a retriever.

    The ranking adapter can call the production retriever and persist only chunk
    ids. This keeps the benchmark deterministic and prevents answers or source
    text from entering the evaluation artifact.
    """
    normalised_cutoffs = tuple(sorted({int(k) for k in cutoffs if int(k) > 0}))
    if not normalised_cutoffs:
        raise ValueError("至少需要一个正整数 cutoff")

    results: list[dict[str, object]] = []
    for case in cases:
        ranked = _normalise_ids(rankings.get(case.case_id, ()))
        metrics: dict[str, float] = {
            f"recall@{k}": recall_at_k(ranked, case.relevant_chunk_ids, k)
            for k in normalised_cutoffs
        }
        metrics["mrr"] = reciprocal_rank(ranked, case.relevant_chunk_ids)
        metrics.update(
            {
                f"ndcg@{k}": ndcg_at_k(ranked, case.relevant_chunk_ids, k)
                for k in normalised_cutoffs
            }
        )
        results.append(
            {
                "id": case.case_id,
                "query": case.query,
                "ranked_chunk_ids": list(ranked),
                "metrics": metrics,
                "missing_ranking": case.case_id not in rankings,
            }
        )

    aggregate: dict[str, float] = {}
    for metric_name in (
        *(f"recall@{k}" for k in normalised_cutoffs),
        "mrr",
        *(f"ndcg@{k}" for k in normalised_cutoffs),
    ):
        aggregate[metric_name] = round(
            sum(float(item["metrics"][metric_name]) for item in results)
            / len(results),
            6,
        )
    return {
        "version": "1.0",
        "total": len(results),
        "rankings_provided": sum(
            1 for item in results if not item["missing_ranking"]
        ),
        "aggregate": aggregate,
        "results": results,
    }


def check_retrieval_eval_gate(
    report: Mapping[str, object],
    thresholds: Mapping[str, float],
    *,
    allow_missing_rankings: bool = False,
) -> dict[str, object]:
    """Check aggregate retrieval metrics against explicit release thresholds.

    The gate is intentionally separate from metric calculation so a report can
    still be inspected when a threshold fails.  When thresholds are supplied,
    missing rankings fail closed unless callers explicitly opt out.
    """
    aggregate = report.get("aggregate")
    if not isinstance(aggregate, Mapping):
        raise ValueError("评测报告缺少 aggregate 指标")
    total = int(report.get("total") or 0)
    rankings_provided = int(report.get("rankings_provided") or 0)
    failures: list[str] = []
    if thresholds and not allow_missing_rankings and rankings_provided < total:
        failures.append(
            f"rankings_provided={rankings_provided} < total={total}"
        )

    checked: dict[str, dict[str, float | bool]] = {}
    for metric_name, minimum in thresholds.items():
        threshold = float(minimum)
        if not 0.0 <= threshold <= 1.0:
            raise ValueError(f"评测阈值必须在 0 到 1 之间: {metric_name}")
        raw_value = aggregate.get(metric_name)
        if raw_value is None:
            failures.append(f"缺少指标 {metric_name}")
            checked[metric_name] = {
                "actual": 0.0,
                "minimum": threshold,
                "passed": False,
            }
            continue
        actual = float(raw_value)
        passed = actual >= threshold
        checked[metric_name] = {
            "actual": actual,
            "minimum": threshold,
            "passed": passed,
        }
        if not passed:
            failures.append(
                f"{metric_name}={actual:.6f} < minimum={threshold:.6f}"
            )
    return {
        "passed": not failures,
        "failures": failures,
        "allow_missing_rankings": allow_missing_rankings,
        "metrics": checked,
    }
