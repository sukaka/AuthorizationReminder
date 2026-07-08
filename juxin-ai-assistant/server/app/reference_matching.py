from __future__ import annotations

import re

_NEGATIVE_EVIDENCE_PHRASES = (
    "没有明确依据",
    "未找到明确依据",
    "没有找到明确依据",
    "未找到",
    "没有找到",
    "没有包含",
    "未包含",
    "并未包含",
    "不包含",
    "无法确认",
    "无法为您提取",
    "不能确认",
    "缺少明确依据",
    "资料不足",
    "依据不足",
    "引用片段没有",
    "引用片段未",
)


def normalize_reference_text(value: str | None) -> str:
    if not value:
        return ""
    return "".join(str(value).lower().split())


def reference_match_candidates(*values: str | None) -> list[str]:
    candidates: list[str] = []
    for value in values:
        normalized = normalize_reference_text(value)
        if not normalized:
            continue
        candidates.append(normalized)
        stem = _strip_known_file_extension(normalized)
        if stem != normalized:
            candidates.append(stem)
        without_sequence = _strip_leading_file_sequence(normalized)
        if without_sequence != normalized:
            candidates.append(without_sequence)
            without_sequence_stem = _strip_known_file_extension(without_sequence)
            if without_sequence_stem != without_sequence:
                candidates.append(without_sequence_stem)
    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if len(candidate) < 4 or candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def source_is_mentioned(source, output: str | None, *, none_matches: bool = False) -> bool:
    if output is None and none_matches:
        return True
    normalized_output = normalize_reference_text(output)
    if not normalized_output:
        return False
    for candidate in reference_match_candidates(source.file_name, source.title):
        index = normalized_output.find(candidate)
        if index < 0:
            continue
        if not _source_mention_is_negative_evidence_context(normalized_output, index, candidate):
            return True
    return False


def _source_mention_is_negative_evidence_context(
    normalized_output: str,
    index: int,
    candidate: str,
) -> bool:
    start = max(0, index - 80)
    end = min(len(normalized_output), index + len(candidate) + 120)
    context = normalized_output[start:end]
    return any(phrase in context for phrase in _NEGATIVE_EVIDENCE_PHRASES)


def _strip_known_file_extension(value: str) -> str:
    for suffix in (".docx", ".xlsx", ".pptx", ".pdf", ".txt", ".md", ".doc", ".xls", ".ppt"):
        if value.endswith(suffix):
            return value[: -len(suffix)]
    return value


def _strip_leading_file_sequence(value: str) -> str:
    return re.sub(r"^\d+[-_、.．]+", "", value)
