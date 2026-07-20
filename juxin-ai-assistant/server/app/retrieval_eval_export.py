from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping, Sequence

from .retrieval_eval import RetrievalEvalCase


def write_rankings_json(
    path: Path,
    rankings: Mapping[str, Sequence[str]],
) -> None:
    """Persist a redacted ranking artifact containing chunk ids only."""
    cleaned: dict[str, list[str]] = {}
    for case_id, chunk_ids in rankings.items():
        values: list[str] = []
        seen: set[str] = set()
        for chunk_id in chunk_ids:
            value = str(chunk_id).strip()
            if value and value not in seen:
                values.append(value)
                seen.add(value)
        cleaned[str(case_id)] = values
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"version": "1.0", "rankings": cleaned},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def collect_production_rankings(
    cases: Sequence[RetrievalEvalCase],
    *,
    db,
    cipher,
    sso_user_id: str,
    top_k: int,
    knowledge_base_ids: list[str] | None = None,
    categories: list[str] | None = None,
    document_types: list[str] | None = None,
    vector_index=None,
    keyword_index=None,
    knowledge_cache=None,
) -> dict[str, list[str]]:
    """Run the official retriever without usage tracking and keep only ids."""
    from .knowledge_search import search_knowledge_chunks
    from .retrieval_eval_adapter import collect_rankings

    def retrieve(query: str):
        return search_knowledge_chunks(
            db,
            sso_user_id=sso_user_id,
            query=query,
            cipher=cipher,
            top_k=top_k,
            knowledge_base_ids=knowledge_base_ids,
            categories=categories,
            document_types=document_types,
            track_usage=False,
            vector_index=vector_index,
            keyword_index=keyword_index,
            knowledge_cache=knowledge_cache,
        )

    return collect_rankings(cases, retrieve, chunk_id=lambda chunk: chunk.chunk_id)
