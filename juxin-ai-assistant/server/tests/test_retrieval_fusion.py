from __future__ import annotations

import pytest

from app.knowledge_search import RerankService
from app.retrieval_fusion import rank_scores, reciprocal_rank_fusion, rrf_score


def test_rrf_score_uses_only_positive_ranks() -> None:
    assert rrf_score([1, 2, None]) == pytest.approx(1 / 61 + 1 / 62)
    assert rrf_score([None, 0, -1]) == 0.0
    with pytest.raises(ValueError):
        rrf_score([1], rank_constant=-1)


def test_rank_scores_is_deterministic_for_ties() -> None:
    assert rank_scores({"b": 1.0, "a": 1.0, "c": 2.0}) == {
        "c": 1,
        "a": 2,
        "b": 3,
    }


def test_reciprocal_rank_fusion_deduplicates_each_signal() -> None:
    scores = reciprocal_rank_fusion(
        [["a", "a", "b"], ["b", "c"]],
    )

    assert scores["a"] == pytest.approx(1 / 61)
    assert scores["b"] == pytest.approx(1 / 63 + 1 / 61)
    assert scores["c"] == pytest.approx(1 / 62)


def test_rerank_service_prefers_multi_signal_rrf_over_single_signal_raw_score() -> None:
    multi_signal = RerankService.score(
        keyword_score=1,
        vector_score=0.35,
        bm25_score=0.2,
        metadata_bonus=0,
        keyword_rank=8,
        bm25_rank=2,
        vector_rank=2,
    )
    single_signal = RerankService.score(
        keyword_score=20,
        vector_score=0.0,
        bm25_score=0.0,
        metadata_bonus=0,
        keyword_rank=1,
    )

    assert multi_signal > single_signal
