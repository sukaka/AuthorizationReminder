from __future__ import annotations

import json
from math import log2
from pathlib import Path

import pytest

from app.retrieval_eval import (
    RetrievalEvalCase,
    check_retrieval_eval_gate,
    evaluate_retrieval_cases,
    load_retrieval_eval_cases,
    ndcg_at_k,
    recall_at_k,
    reciprocal_rank,
)
from app.retrieval_eval_adapter import collect_rankings
from app.retrieval_eval_export import write_rankings_json
from app.retrieval_eval_export import collect_production_rankings


def test_retrieval_metrics_use_unique_ranked_ids_and_binary_relevance() -> None:
    ranked = ["noise", "gold-a", "gold-a", "noise-2", "gold-b"]
    relevant = {"gold-a", "gold-b"}

    assert recall_at_k(ranked, relevant, 3) == pytest.approx(0.5)
    assert reciprocal_rank(ranked, relevant) == pytest.approx(0.5)
    assert ndcg_at_k(ranked, relevant, 3) == pytest.approx(
        (1 / log2(3)) / (1 + 1 / log2(3))
    )


def test_retrieval_metrics_fail_closed_for_empty_gold_or_non_positive_cutoff() -> None:
    assert recall_at_k(["chunk"], [], 5) == 0.0
    assert reciprocal_rank(["chunk"], []) == 0.0
    assert ndcg_at_k(["chunk"], ["chunk"], 0) == 0.0


def test_retrieval_eval_cases_have_unique_ids_and_gold_chunks() -> None:
    path = Path(__file__).resolve().parents[1] / "retrieval_eval_cases.json"
    cases = load_retrieval_eval_cases(path)

    assert len(cases) >= 6
    assert len({case.case_id for case in cases}) == len(cases)
    assert all(case.query and case.relevant_chunk_ids for case in cases)


def test_retrieval_eval_report_exposes_missing_rankings() -> None:
    cases = [
        RetrievalEvalCase("case-a", "问题 A", frozenset({"gold-a"})),
        RetrievalEvalCase("case-b", "问题 B", frozenset({"gold-b"})),
    ]
    report = evaluate_retrieval_cases(cases, {"case-a": ["gold-a", "noise"]})

    assert report["total"] == 2
    assert report["rankings_provided"] == 1
    assert report["aggregate"]["recall@5"] == pytest.approx(0.5)
    missing = next(item for item in report["results"] if item["id"] == "case-b")
    assert missing["missing_ranking"] is True


def test_retrieval_eval_cases_json_is_valid() -> None:
    path = Path(__file__).resolve().parents[1] / "retrieval_eval_cases.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["version"] == "1.0"
    assert isinstance(payload["cases"], list)


def test_collect_rankings_keeps_only_unique_chunk_ids() -> None:
    cases = [RetrievalEvalCase("case-a", "问题 A", frozenset({"gold-a"}))]
    calls: list[str] = []

    def retrieve(query: str) -> list[dict[str, object]]:
        calls.append(query)
        return [
            {"chunk_id": "gold-a", "text": "敏感正文不应导出"},
            {"chunk_id": "gold-a", "text": "重复结果"},
            {"chunk_id": "noise", "text": "其他正文"},
        ]

    rankings = collect_rankings(cases, retrieve, chunk_id=lambda item: str(item["chunk_id"]))

    assert calls == ["问题 A"]
    assert rankings == {"case-a": ["gold-a", "noise"]}


def test_retrieval_eval_gate_fails_closed_on_missing_rankings_and_low_metrics() -> None:
    report = evaluate_retrieval_cases(
        [RetrievalEvalCase("case-a", "问题 A", frozenset({"gold-a"}))],
        {},
    )

    gate = check_retrieval_eval_gate(
        report,
        {"recall@5": 0.8, "mrr": 0.8},
    )

    assert gate["passed"] is False
    assert any("rankings_provided" in item for item in gate["failures"])
    assert gate["metrics"]["recall@5"]["passed"] is False


def test_write_rankings_json_is_redacted_and_deduplicated(tmp_path: Path) -> None:
    output = tmp_path / "rankings.json"
    write_rankings_json(
        output,
        {"case-a": ["gold-a", "gold-a", "", "noise"]},
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload == {
        "version": "1.0",
        "rankings": {"case-a": ["gold-a", "noise"]},
    }
    assert "敏感" not in output.read_text(encoding="utf-8")


def test_collect_production_rankings_disables_usage_tracking(monkeypatch) -> None:
    from types import SimpleNamespace

    calls: list[dict[str, object]] = []

    def fake_search(db, **kwargs):
        calls.append({"db": db, **kwargs})
        return [
            SimpleNamespace(chunk_id="chunk-a", chunk_text="不应进入排名文件"),
            SimpleNamespace(chunk_id="chunk-a", chunk_text="duplicate"),
        ]

    import app.knowledge_search as knowledge_search

    monkeypatch.setattr(knowledge_search, "search_knowledge_chunks", fake_search)
    rankings = collect_production_rankings(
        [RetrievalEvalCase("case-a", "问题 A", frozenset({"chunk-a"}))],
        db=object(),
        cipher=object(),
        sso_user_id="eval-user",
        top_k=12,
    )

    assert rankings == {"case-a": ["chunk-a"]}
    assert calls[0]["track_usage"] is False
    assert calls[0]["sso_user_id"] == "eval-user"
