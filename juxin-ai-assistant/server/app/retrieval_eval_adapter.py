from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TypeVar

from .retrieval_eval import RetrievalEvalCase


ChunkT = TypeVar("ChunkT")


def collect_rankings(
    cases: Sequence[RetrievalEvalCase],
    retrieve: Callable[[str], Sequence[ChunkT]],
    *,
    chunk_id: Callable[[ChunkT], str],
) -> dict[str, list[str]]:
    """Call a read-only production retriever and keep only ranked chunk ids.

    ``retrieve`` can wrap ``search_knowledge_chunks`` or a test double. The
    adapter deliberately drops text, scores, file names and user identifiers
    so evaluation artifacts cannot become an accidental answer or data export.
    """
    rankings: dict[str, list[str]] = {}
    for case in cases:
        ranked_ids: list[str] = []
        seen: set[str] = set()
        for result in retrieve(case.query):
            value = str(chunk_id(result)).strip()
            if value and value not in seen:
                ranked_ids.append(value)
                seen.add(value)
        rankings[case.case_id] = ranked_ids
    return rankings
