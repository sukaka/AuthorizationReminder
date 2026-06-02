from __future__ import annotations


def confidence_level(score: float) -> str:
    if score >= 85:
        return "High"
    if score >= 70:
        return "Medium-High"
    if score >= 50:
        return "Medium"
    if score >= 30:
        return "Low"
    return "Review"


def component_confidence(engine_count: int, has_purl: bool, has_lock_evidence: bool, version: str) -> tuple[float, str]:
    if version == "unknown":
        return 20, "Review"
    score = 35 + engine_count * 18
    if has_purl:
        score += 18
    if has_lock_evidence:
        score += 12
    score = min(score, 100)
    return score, confidence_level(score)


def vulnerability_confidence(engine_count: int, purl_match: bool, cpe_match: bool, fuzzy_only: bool, version_unknown: bool, severity_conflict: bool) -> dict[str, object]:
    score = 25 + engine_count * 20
    reasons: list[str] = []
    if purl_match:
        score += 20
        reasons.append("purl 精确匹配")
    if cpe_match:
        score += 18
        reasons.append("cpe 精确匹配")
    if fuzzy_only:
        score -= 25
        reasons.append("仅名称模糊匹配")
    if version_unknown:
        score -= 30
        reasons.append("版本未知")
    if severity_conflict:
        score -= 10
        reasons.append("多工具等级存在差异")
    score = max(0, min(score, 100))
    level = confidence_level(score)
    return {
        "score": score,
        "level": level,
        "reason": "；".join(reasons) or "多源扫描结果合并评分",
        "need_manual_review": level in {"Low", "Review"} or severity_conflict or version_unknown,
        "manual_review_reason": "；".join(reasons) if level in {"Low", "Review"} or severity_conflict or version_unknown else "",
    }

