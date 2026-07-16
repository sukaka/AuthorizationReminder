"""Internal multi-agent roles for complex tasks (6.0 P1).

Roles are activated dynamically; deterministic FAQ remains outside this path.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .answer_engine import RetrievedSnippet

COMPLEX_MARKERS = (
    "报告", "方案", "汇总", "对比", "分析", "纪要", "PPT", "培训",
    "验收", "整改", "评估", "多份", "梳理", "整理成",
)


def is_complex_task(question: str) -> bool:
    q = str(question or "")
    return any(marker in q for marker in COMPLEX_MARKERS) or len(q) >= 80


@dataclass
class CoordinationPlan:
    goal: str
    needs_research: bool = True
    needs_review: bool = True
    workflow: str = "research_write_review"
    budget_model_calls: int = 4


@dataclass
class ResearchBundle:
    snippets: list[RetrievedSnippet] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


def coordinate(question: str) -> CoordinationPlan:
    complex_task = is_complex_task(question)
    return CoordinationPlan(
        goal=question.strip()[:500],
        needs_research=True,
        needs_review=complex_task,
        workflow="research_write_review" if complex_task else "research_write",
        budget_model_calls=4 if complex_task else 2,
    )


def research_from_snippets(
    snippets: list[RetrievedSnippet],
    question: str,
    *,
    extra_gaps: list[str] | None = None,
) -> ResearchBundle:
    gaps: list[str] = list(extra_gaps or [])
    if not snippets:
        gaps.append("未检索到相关资料片段")
    total_len = sum(len(s.text) for s in snippets)
    if snippets and total_len < 40:
        gaps.append("资料摘录过短，可能证据不足")
    coverage = len({s.file_uuid or s.name for s in snippets})
    if snippets and coverage < 2 and len(question) >= 20:
        gaps.append("文档覆盖偏少，建议补充资料")
    return ResearchBundle(snippets=list(snippets), gaps=gaps, conflicts=[])


def write_from_research(question: str, research: ResearchBundle) -> str:
    from .deep_retrieve import mark_inference_sections, no_evidence_answer

    if not research.snippets:
        return no_evidence_answer(question)
    lines = [
        "## 任务目标",
        question.strip(),
        "",
        f"## 资料要点（{len(research.snippets)} 条）",
    ]
    for index, snip in enumerate(research.snippets[:6], start=1):
        loc = f"，{snip.location}" if snip.location else ""
        excerpt = snip.text.replace("\n", " ").strip()
        if len(excerpt) > 220:
            excerpt = excerpt[:220] + "…"
        lines.append(f"{index}. 来源《{snip.name}》{loc}：{excerpt}")
    if research.gaps:
        lines.extend(["", "## 资料缺口", *[f"- {g}" for g in research.gaps]])
    lines.extend(
        [
            "",
            "## 结论说明",
            "以上【资料事实】严格基于检索摘录；缺口处不编造制度细节。",
            "",
            "来源：",
            *[
                f"- 《{s.name}》{(' ' + s.location) if s.location else ''}"
                for s in research.snippets[:8]
            ],
        ]
    )
    return mark_inference_sections("\n".join(lines), has_evidence=True)
