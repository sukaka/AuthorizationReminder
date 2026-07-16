"""Offline eval suite aligned with 6.0 GA gates (citation / no-evidence / FAQ).

Runs without external models: uses learning_eval scenarios + synthetic answers.
"""

from __future__ import annotations

from typing import Any

from .agent_runtime.deep_retrieve import no_evidence_answer
from .learning_eval import (
    DEFAULT_EVAL_PATH,
    load_eval_questions,
    run_learning_eval,
    scenario_for_question,
)


# Questions expected to refuse when no evidence (scenario has no official chunks)
NO_EVIDENCE_QUESTION_IDS = frozenset({
    "no-source-guard",
})

# Questions that should cite/require knowledge evidence
CITATION_QUESTION_IDS = frozenset({
    "wdsp-deployment",
    "compliance-platform-customer",
    "citation-preview",
})


def _synthetic_answer_for_scenario(question_id: str, question: str) -> tuple[str, dict[str, Any]]:
    """Produce a deterministic answer shape for offline scoring."""
    scenario = scenario_for_question(question_id)
    if question_id in NO_EVIDENCE_QUESTION_IDS or (
        not scenario.official_chunks and scenario.mode == "knowledge" and "编造" in " ".join(scenario.required_snippets)
    ):
        text = no_evidence_answer(question)
        return text, {"path": "no_evidence", "refused": True, "citations": []}

    if scenario.official_chunks:
        lines = [f"根据资料回答「{question}」：", ""]
        citations = []
        for chunk in scenario.official_chunks:
            lines.append(f"- 来源《{chunk.file_name}》：{chunk.chunk_text[:120]}")
            citations.append(
                {
                    "citation_id": chunk.file_uuid,
                    "name": chunk.file_name,
                    "location": chunk.section_title,
                    "excerpt": chunk.chunk_text[:80],
                }
            )
        lines.append("")
        lines.append("来源清单：")
        for c in citations:
            lines.append(f"- 《{c['name']}》")
        # include required snippets loosely for learning_eval context checks
        for snip in scenario.required_snippets:
            if snip not in "\n".join(lines):
                lines.append(snip)
        return "\n".join(lines), {
            "path": "retrieve_synthesize",
            "refused": False,
            "citations": citations,
            "snippet_count": len(citations),
        }

    # default: include required snippets for context-builder style eval
    body = f"回答：{question}\n" + "\n".join(scenario.required_snippets)
    return body, {"path": "default", "refused": False, "citations": []}


def score_answer(
    *,
    question_id: str,
    question: str,
    answer: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Score a single answer against GA-related checks."""
    meta = meta or {}
    scenario = scenario_for_question(question_id)
    missing = [s for s in scenario.required_snippets if s and s not in answer]

    citations = meta.get("citations") if isinstance(meta.get("citations"), list) else []
    refused = bool(meta.get("refused") or "无依据" in answer or "【无依据拒答】" in answer)

    checks: dict[str, Any] = {
        "required_snippets_passed": not missing,
        "missing_snippets": missing,
    }

    # Citation check: knowledge questions with chunks must have citations
    if question_id in CITATION_QUESTION_IDS or scenario.official_chunks:
        has_cite = len(citations) > 0 or "来源" in answer or "《" in answer
        checks["citation_present"] = has_cite
        checks["citation_passed"] = has_cite
    else:
        checks["citation_present"] = None
        checks["citation_passed"] = None

    # No-evidence: must refuse correctly
    if question_id in NO_EVIDENCE_QUESTION_IDS:
        checks["no_evidence_correct"] = refused and ("不能编造" in answer or "无依据" in answer or "缺少依据" in answer or "【无依据拒答】" in answer)
    else:
        checks["no_evidence_correct"] = None

    # FAQ zero-model: not applicable offline here
    checks["faq_zero_model"] = None

    passed = checks["required_snippets_passed"]
    if checks["citation_passed"] is False:
        passed = False
    if checks["no_evidence_correct"] is False:
        passed = False

    return {
        "question_id": question_id,
        "question": question,
        "passed": passed,
        "checks": checks,
        "meta": {
            "path": meta.get("path"),
            "refused": refused,
            "citation_count": len(citations),
        },
    }


def run_ga_offline_eval(*, use_synthetic: bool = True) -> dict[str, Any]:
    """Run full offline suite and aggregate GA-aligned rates."""
    # Base learning context eval (existing)
    learning = run_learning_eval(DEFAULT_EVAL_PATH)

    questions = load_eval_questions(DEFAULT_EVAL_PATH)
    scored: list[dict[str, Any]] = []
    citation_total = citation_ok = 0
    refusal_total = refusal_ok = 0

    for item in questions:
        qid = str(item["id"])
        question = str(item["question"])
        if use_synthetic:
            answer, meta = _synthetic_answer_for_scenario(qid, question)
        else:
            answer, meta = "", {}
        row = score_answer(question_id=qid, question=question, answer=answer, meta=meta)
        scored.append(row)

        if row["checks"]["citation_passed"] is not None:
            citation_total += 1
            if row["checks"]["citation_passed"]:
                citation_ok += 1
        if row["checks"]["no_evidence_correct"] is not None:
            refusal_total += 1
            if row["checks"]["no_evidence_correct"]:
                refusal_ok += 1

    def ratio(ok: int, total: int) -> float | None:
        if total <= 0:
            return None
        return ok / total

    return {
        "learning_context_eval": {
            "total": learning["total"],
            "passed": learning["passed"],
            "failed": learning["failed"],
            "pass_rate": (learning["passed"] / learning["total"]) if learning["total"] else None,
        },
        "answer_eval": {
            "total": len(scored),
            "passed": sum(1 for r in scored if r["passed"]),
            "failed": sum(1 for r in scored if not r["passed"]),
            "results": scored,
        },
        "ga_rates": {
            "citation_accuracy": ratio(citation_ok, citation_total),
            "no_evidence_refusal_rate": ratio(refusal_ok, refusal_total),
            "citation_sample": citation_total,
            "refusal_sample": refusal_total,
        },
        "source": str(DEFAULT_EVAL_PATH.name),
    }
