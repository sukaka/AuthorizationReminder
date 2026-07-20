from __future__ import annotations

from collections.abc import Hashable, Iterable, Mapping, Sequence
from typing import TypeVar


RRF_RANK_CONSTANT = 60.0
ScoreKeyT = TypeVar("ScoreKeyT", bound=Hashable)


def rrf_score(
    ranks: Iterable[int | None],
    *,
    rank_constant: float = RRF_RANK_CONSTANT,
) -> float:
    """Fuse reciprocal ranks from independent retrieval signals."""
    if rank_constant < 0:
        raise ValueError("rank_constant 必须为非负数")
    return sum(
        1.0 / (rank_constant + rank)
        for rank in ranks
        if rank is not None and int(rank) > 0
    )


def rank_scores(
    scores: Mapping[ScoreKeyT, float],
    *,
    limit: int | None = None,
) -> dict[ScoreKeyT, int]:
    """Turn a score map into deterministic one-based ranks."""
    ranked = sorted(
        ((key, float(value)) for key, value in scores.items()),
        key=lambda item: (-item[1], str(item[0])),
    )
    if limit is not None:
        ranked = ranked[: max(0, int(limit))]
    return {key: rank for rank, (key, _score) in enumerate(ranked, start=1)}


def reciprocal_rank_fusion(
    rankings: Sequence[Sequence[ScoreKeyT]],
    *,
    rank_constant: float = RRF_RANK_CONSTANT,
) -> dict[ScoreKeyT, float]:
    """Fuse ranked id lists while ignoring duplicate ids within one signal."""
    fused: dict[ScoreKeyT, float] = {}
    for ranking in rankings:
        seen: set[ScoreKeyT] = set()
        for rank, item in enumerate(ranking, start=1):
            if item in seen:
                continue
            seen.add(item)
            fused[item] = fused.get(item, 0.0) + rrf_score(
                (rank,),
                rank_constant=rank_constant,
            )
    return fused
