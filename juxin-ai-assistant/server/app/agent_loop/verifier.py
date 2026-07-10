from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.reference_matching import source_is_mentioned


_MANUAL_REVIEW_SECTION_MARKERS = (
    "待确认事项",
    "需人工复核事项",
    "人工复核事项",
    "需人工确认事项",
)

_OPS_PLAN_TASK_MARKERS = (
    "安全运维",
    "安全服务",
    "运维服务",
    "应急响应",
    "漏洞扫描",
    "风险评估",
    "等保",
)

_ABSOLUTE_PROMISES = (
    "100%防住所有攻击",
    "百分百防住所有攻击",
    "必定通过测评",
    "一定通过测评",
    "完全无风险",
    "绝对无风险",
)


class Verifier:
    def verify_references(self, answer: str, candidate_sources: list[Any]) -> dict[str, Any]:
        sources = [_source_to_namespace(source) for source in candidate_sources]
        kept_sources = [
            source
            for source in sources
            if _verified_source_is_used(source, answer)
        ]
        removed_count = max(0, len(sources) - len(kept_sources))
        suggestions: list[str] = []
        if removed_count:
            suggestions.append("建议复核：已移除仅作为缺少依据提及的参考来源。")
        return {
            "status": "warning" if removed_count else "pass",
            "sources": [_source_to_payload(source) for source in kept_sources],
            "kept_count": len(kept_sources),
            "removed_count": removed_count,
            "suggestions": suggestions,
        }

    def verify_document_structure(self, answer: str, task_type: str | None = None) -> dict[str, Any]:
        warnings: list[str] = []
        risks: list[str] = []
        if _is_ops_plan(answer, task_type) and not _has_manual_review_section(answer):
            warnings.append("建议复核：安全运维/服务方案类文档建议补充“待确认事项/需人工复核事项”。")
        if _has_absolute_promise(answer):
            risks.append("风险提示：文档包含绝对化承诺，建议改为有条件、可复核的表述。")
        return {
            "status": "risk" if risks else "warning" if warnings else "pass",
            "warnings": warnings,
            "risks": risks,
        }


def _source_to_namespace(source: Any) -> SimpleNamespace:
    if isinstance(source, dict):
        return SimpleNamespace(
            source_type=str(source.get("source_type") or ""),
            source_uuid=str(source.get("source_uuid") or source.get("file_id") or ""),
            file_name=str(source.get("file_name") or ""),
            title=str(source.get("title") or source.get("file_name") or ""),
            chunk_id=str(source.get("chunk_id") or ""),
            page_number=source.get("page_number"),
            section_title=str(source.get("section_title") or ""),
            chunk_index=source.get("chunk_index"),
            score=_safe_int(source.get("score")),
            chunk_text=str(source.get("chunk_text") or ""),
        )
    return SimpleNamespace(
        source_type=str(getattr(source, "source_type", "")),
        source_uuid=str(getattr(source, "source_uuid", "")),
        file_name=str(getattr(source, "file_name", "")),
        title=str(getattr(source, "title", "")),
        chunk_id=str(getattr(source, "chunk_id", "")),
        page_number=getattr(source, "page_number", None),
        section_title=str(getattr(source, "section_title", "")),
        chunk_index=getattr(source, "chunk_index", None),
        score=_safe_int(getattr(source, "score", 0)),
        chunk_text=str(getattr(source, "chunk_text", "") or ""),
    )


def _source_to_payload(source: SimpleNamespace) -> dict[str, Any]:
    return {
        "source_type": source.source_type,
        "source_uuid": source.source_uuid,
        "file_name": source.file_name,
        "title": source.title,
        "chunk_id": source.chunk_id,
        "page_number": source.page_number,
        "section_title": source.section_title,
        "chunk_index": source.chunk_index,
        "score": source.score,
    }


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _verified_source_is_used(source: SimpleNamespace, answer: str) -> bool:
    if source.chunk_text:
        return _source_evidence_is_used(source, answer)
    return source_is_mentioned(source, answer)


def _source_evidence_is_used(source: SimpleNamespace, answer: str) -> bool:
    if not source.chunk_text:
        return True
    normalized_answer = _normalize_evidence_text(answer)
    chunk_text = _normalize_evidence_text(source.chunk_text)
    matched_phrases = {
        phrase
        for phrase in _evidence_phrases(chunk_text)
        if phrase in normalized_answer
    }
    if len(matched_phrases) >= (1 if len(chunk_text) < 8 else 2):
        return True
    if matched_phrases and source_is_mentioned(source, answer):
        return True
    section_title = _normalize_evidence_text(source.section_title)
    section_candidates = {
        section_title,
        section_title.lstrip("一二三四五六七八九十0123456789"),
    }
    return bool(
        any(
            len(candidate) >= 4 and candidate in normalized_answer
            for candidate in section_candidates
        )
        and source_is_mentioned(source, answer)
    )


def _normalize_evidence_text(value: str | None) -> str:
    if not value:
        return ""
    return "".join(char for char in value if char.isalnum() or "\u4e00" <= char <= "\u9fff")


def _evidence_phrases(value: str) -> list[str]:
    if len(value) < 4:
        return [value] if value else []
    # Require multiple distinct four-character matches at the call site. A
    # single match is too weak because unrelated chunks commonly share headings
    # such as “技术背景” or “安全服务”, while multiple matches still tolerate
    # concise paraphrasing.
    step = 4
    return [
        value[index : index + step]
        for index in range(0, max(0, len(value) - step + 1))
        if len(value[index : index + step]) == step
    ][:80]


def _is_ops_plan(answer: str, task_type: str | None) -> bool:
    text = f"{task_type or ''}\n{answer or ''}"
    return any(marker in text for marker in _OPS_PLAN_TASK_MARKERS)


def _has_manual_review_section(answer: str) -> bool:
    return any(marker in (answer or "") for marker in _MANUAL_REVIEW_SECTION_MARKERS)


def _has_absolute_promise(answer: str) -> bool:
    return any(promise in (answer or "") for promise in _ABSOLUTE_PROMISES)
