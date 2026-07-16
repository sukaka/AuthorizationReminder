"""Answer engine for NativeRuntime non-FAQ paths.

Default retrieve uses Phase-3 deep retrieval (lexical multi-pass).
Generate can refuse without evidence and mark inference sections.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

from sqlalchemy.orm import Session

from .deep_retrieve import (
    DeepRetrievalResult,
    RetrievedSnippet,
    build_citation_cards,
    deep_retrieve,
    mark_inference_sections,
    no_evidence_answer,
)


RetrieveFn = Callable[[Session, str, str], list[RetrievedSnippet]]
GenerateFn = Callable[[str, list[RetrievedSnippet]], tuple[str, int, dict[str, Any]]]


class AnswerEngine(Protocol):
    def retrieve(self, db: Session, owner_user_id: str, query: str) -> list[RetrievedSnippet]: ...

    def generate(
        self,
        query: str,
        snippets: list[RetrievedSnippet],
    ) -> tuple[str, int, dict[str, Any]]:
        """Return (answer, model_calls, usage_meta)."""
        ...


def simple_knowledge_retrieve(
    db: Session,
    owner_user_id: str,
    query: str,
    *,
    limit: int | None = None,
) -> list[RetrievedSnippet]:
    """Backward-compatible name: deep multi-pass lexical retrieve."""
    result = deep_retrieve(db, owner_user_id, query, limit=limit)
    return list(result.snippets)


def deep_knowledge_retrieve(
    db: Session,
    owner_user_id: str,
    query: str,
    *,
    limit: int | None = None,
) -> DeepRetrievalResult:
    return deep_retrieve(db, owner_user_id, query, limit=limit)


def synthesize_from_snippets(query: str, snippets: list[RetrievedSnippet]) -> tuple[str, int, dict[str, Any]]:
    if not snippets:
        return (
            no_evidence_answer(query),
            0,
            {
                "path": "no_evidence",
                "refused": True,
                "citations": [],
            },
        )
    lines = [f"根据检索到的 {len(snippets)} 条资料，针对「{query.strip()}」整理如下：", ""]
    for index, snip in enumerate(snippets[:5], start=1):
        loc = f"（{snip.location}）" if snip.location else ""
        excerpt = snip.text.replace("\n", " ").strip()
        if len(excerpt) > 280:
            excerpt = excerpt[:280] + "…"
        lines.append(f"{index}. 来源《{snip.name}》{loc}：{excerpt}")
    lines.append("")
    lines.append("来源清单：")
    for snip in snippets[:8]:
        loc = f" {snip.location}" if snip.location else ""
        lines.append(f"- 《{snip.name}》{loc}")
    body = "\n".join(lines)
    body = mark_inference_sections(body, has_evidence=True)
    return (
        body,
        0,
        {
            "path": "retrieve_synthesize",
            "snippet_count": len(snippets),
            "citations": build_citation_cards(snippets),
            "refused": False,
        },
    )


class DefaultAnswerEngine:
    def __init__(
        self,
        *,
        retrieve_fn: RetrieveFn | None = None,
        generate_fn: GenerateFn | None = None,
    ) -> None:
        self._retrieve_fn = retrieve_fn or simple_knowledge_retrieve
        self._generate_fn = generate_fn or synthesize_from_snippets
        self.last_retrieval: DeepRetrievalResult | None = None

    def retrieve(self, db: Session, owner_user_id: str, query: str) -> list[RetrievedSnippet]:
        # Prefer deep result metadata when using default path
        if self._retrieve_fn is simple_knowledge_retrieve:
            result = deep_knowledge_retrieve(db, owner_user_id, query)
            self.last_retrieval = result
            return list(result.snippets)
        snippets = list(self._retrieve_fn(db, owner_user_id, query) or [])
        self.last_retrieval = None
        return snippets

    def generate(
        self,
        query: str,
        snippets: list[RetrievedSnippet],
    ) -> tuple[str, int, dict[str, Any]]:
        answer, calls, meta = self._generate_fn(query, snippets)
        meta = dict(meta or {})
        if self.last_retrieval is not None:
            meta.setdefault("retrieval_mode", self.last_retrieval.mode)
            meta.setdefault("second_pass_used", self.last_retrieval.second_pass_used)
            meta.setdefault("file_coverage", self.last_retrieval.file_coverage)
            meta.setdefault("primary_hits", self.last_retrieval.primary_hits)
            meta.setdefault("secondary_hits", self.last_retrieval.secondary_hits)
            meta.setdefault("expanded_terms", self.last_retrieval.expanded_terms)
            if self.last_retrieval.gaps:
                meta.setdefault("retrieval_gaps", self.last_retrieval.gaps)
        if not snippets:
            meta["refused"] = True
            meta["path"] = meta.get("path") or "no_evidence"
        if "citations" not in meta and snippets:
            meta["citations"] = build_citation_cards(snippets)
        return answer, calls, meta
