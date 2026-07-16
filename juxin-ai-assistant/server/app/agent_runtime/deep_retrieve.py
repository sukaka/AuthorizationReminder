"""Phase 3 deep retrieval: dynamic limits, multi-doc coverage, second pass.

Keeps a light lexical path so unit tests do not require embeddings/numpy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import KnowledgeFile


@dataclass(frozen=True)
class RetrievedSnippet:
    name: str
    text: str
    location: str = ""
    file_uuid: str = ""

# Plan 5.5 dynamic recall
LIMIT_PRECISE = 12
LIMIT_SUMMARY = 20
LIMIT_COMPARE = 24
MIN_FILE_COVERAGE = 3

FACT_MARKERS = ("规定", "必须", "应当", "制度", "标准", "流程", "步骤", "要求")
INFERENCE_MARKERS = ("建议", "可以考虑", "通常", "一般", "推断", "可能")

SYNONYM_MAP: dict[str, list[str]] = {
    "vpn": ["远程接入", "专线", "拨号"],
    "密码": ["口令", "凭据", "登录密码"],
    "报销": ["费用", "差旅", "票据"],
    "年假": ["休假", "带薪假", "假期"],
    "等保": ["等级保护", "网络安全等级保护"],
    "验收": ["交付验收", "项目验收", "验收报告"],
}


@dataclass
class RetrievalPlan:
    mode: str  # precise | summary | compare | complex
    limit: int
    expand_terms: list[str] = field(default_factory=list)
    need_second_pass: bool = True


@dataclass
class DeepRetrievalResult:
    snippets: list[RetrievedSnippet]
    mode: str
    primary_hits: int
    secondary_hits: int
    file_coverage: int
    expanded_terms: list[str]
    second_pass_used: bool
    gaps: list[str] = field(default_factory=list)


def classify_query(query: str) -> RetrievalPlan:
    q = str(query or "")
    terms = _tokenize(q)
    expanded = _expand_terms(terms)
    if any(m in q for m in ("对比", "版本", "变更", "差异", "前后")):
        return RetrievalPlan(mode="compare", limit=LIMIT_COMPARE, expand_terms=expanded)
    if any(m in q for m in ("汇总", "总结", "报告", "方案", "梳理", "整理", "分析")):
        return RetrievalPlan(mode="summary", limit=LIMIT_SUMMARY, expand_terms=expanded)
    if any(m in q for m in ("是什么", "如何", "怎么", "哪里", "多少", "规定", "标准")):
        return RetrievalPlan(mode="precise", limit=LIMIT_PRECISE, expand_terms=expanded)
    if len(q) >= 80:
        return RetrievalPlan(mode="complex", limit=LIMIT_SUMMARY, expand_terms=expanded)
    return RetrievalPlan(mode="precise", limit=LIMIT_PRECISE, expand_terms=expanded)


def deep_retrieve(
    db: Session,
    owner_user_id: str,
    query: str,
    *,
    limit: int | None = None,
    cipher=None,
    embedding_service=None,
    vector_index=None,
    prefer_hybrid: bool = True,
) -> DeepRetrievalResult:
    """Deep retrieval with optional hybrid (vector+BM25+keyword) primary path.

    When ``cipher`` is provided (or resolvable from settings), attempts
    ``search_knowledge_chunks`` hybrid ranking first; always falls back to
    lexical multi-pass so unit tests and empty-index environments stay safe.
    """
    plan = classify_query(query)
    effective_limit = int(limit or plan.limit)
    gaps: list[str] = []
    hybrid_used = False

    primary: list[RetrievedSnippet] = []
    if prefer_hybrid:
        hybrid_primary = _hybrid_chunk_search(
            db,
            owner_user_id=owner_user_id,
            query=query,
            limit=effective_limit,
            cipher=cipher,
            embedding_service=embedding_service,
            vector_index=vector_index,
        )
        if hybrid_primary:
            primary = hybrid_primary
            hybrid_used = True

    if not primary:
        primary = _lexical_search(
            db,
            query=query,
            terms=_tokenize(query) + plan.expand_terms,
            limit=effective_limit,
            owner_user_id=owner_user_id,
        )
    primary = _dedupe_snippets(primary)
    primary = _enforce_file_coverage(primary, target=MIN_FILE_COVERAGE)

    secondary: list[RetrievedSnippet] = []
    second_pass = False

    if plan.need_second_pass and _needs_second_pass(primary, query):
        second_pass = True
        alt_terms = _second_pass_terms(query, plan.expand_terms)
        # Second pass prefers lexical diversification; hybrid already covered
        # dense candidates on the first pass.
        secondary = _lexical_search(
            db,
            query=query,
            terms=alt_terms,
            limit=max(8, effective_limit // 2),
            owner_user_id=owner_user_id,
        )
        if not secondary and hybrid_used:
            secondary = _hybrid_chunk_search(
                db,
                owner_user_id=owner_user_id,
                query=" ".join(alt_terms) or query,
                limit=max(8, effective_limit // 2),
                cipher=cipher,
                embedding_service=embedding_service,
                vector_index=vector_index,
            )
        secondary = _dedupe_snippets(secondary, seen={_snip_key(s) for s in primary})

    merged = _dedupe_snippets([*primary, *secondary])[:effective_limit]
    coverage = len({s.file_uuid or s.name for s in merged})
    if not merged:
        gaps.append("未检索到相关资料")
    elif coverage < min(MIN_FILE_COVERAGE, max(1, effective_limit // 4)):
        gaps.append("文档覆盖不足，可能证据偏窄")
    if second_pass and not secondary:
        gaps.append("二次检索未补充到新资料")
    if hybrid_used:
        gaps.append("hybrid_primary")  # diagnostic marker (not a real gap)

    # Keep user-facing gaps clean: hybrid marker is meta only
    user_gaps = [g for g in gaps if g != "hybrid_primary"]

    return DeepRetrievalResult(
        snippets=merged,
        mode=("hybrid_" + plan.mode) if hybrid_used else plan.mode,
        primary_hits=len(primary),
        secondary_hits=len(secondary),
        file_coverage=coverage,
        expanded_terms=plan.expand_terms,
        second_pass_used=second_pass,
        gaps=user_gaps,
    )


def _hybrid_chunk_search(
    db: Session,
    *,
    owner_user_id: str,
    query: str,
    limit: int,
    cipher=None,
    embedding_service=None,
    vector_index=None,
) -> list[RetrievedSnippet]:
    """Best-effort hybrid chunk retrieval via knowledge_search.

    Returns empty list on any failure so callers fall back to lexical.
    """
    resolved_cipher = cipher
    if resolved_cipher is None:
        resolved_cipher = _try_resolve_cipher()
    if resolved_cipher is None:
        return []
    try:
        from ..knowledge_search import search_knowledge_chunks
    except Exception:
        return []
    try:
        chunks = search_knowledge_chunks(
            db,
            sso_user_id=owner_user_id or "system",
            query=query,
            cipher=resolved_cipher,
            top_k=limit,
            embedding_service=embedding_service,
            track_usage=False,
            vector_index=vector_index,
        )
    except Exception:
        return []
    snippets: list[RetrievedSnippet] = []
    for chunk in chunks or []:
        loc_parts = []
        section = str(getattr(chunk, "section_title", "") or "")
        page = getattr(chunk, "page_number", None)
        page_or_sheet = str(getattr(chunk, "page_or_sheet", "") or "")
        if section:
            loc_parts.append(section)
        if page is not None:
            loc_parts.append(f"第{page}页")
        if page_or_sheet and page_or_sheet not in loc_parts:
            loc_parts.append(page_or_sheet)
        location = " · ".join(loc_parts) if loc_parts else "知识库分块"
        snippets.append(
            RetrievedSnippet(
                name=str(getattr(chunk, "file_name", "") or "资料"),
                text=str(getattr(chunk, "chunk_text", "") or "")[:1200],
                location=location,
                file_uuid=str(getattr(chunk, "file_uuid", "") or ""),
            )
        )
    return snippets


def _try_resolve_cipher():
    """Optional ContentCipher from app settings; None when unavailable."""
    try:
        from ..config import get_settings
        from ..crypto import ContentCipher

        settings = get_settings()
        key = getattr(settings, "content_encryption_key", None) or getattr(
            settings, "CONTENT_ENCRYPTION_KEY", None
        )
        if not key:
            return None
        return ContentCipher(str(key))
    except Exception:
        return None


def build_citation_cards(snippets: Iterable[RetrievedSnippet]) -> list[dict]:
    cards: list[dict] = []
    for index, snip in enumerate(snippets, start=1):
        text = snip.text or ""
        is_inference = any(m in text for m in INFERENCE_MARKERS) and not any(
            m in text for m in FACT_MARKERS
        )
        cards.append(
            {
                "citation_id": snip.file_uuid or f"cite-{index}",
                "name": snip.name or "资料",
                "location": snip.location or "",
                "source_type": "knowledge",
                "document_version": snip.document_version if hasattr(snip, "document_version") else "",
                "is_inference": is_inference,
                "excerpt": text[:200],
            }
        )
    return cards


def no_evidence_answer(query: str) -> str:
    return (
        f"针对「{query.strip()}」，当前知识库未找到明确依据，"
        "因此无法给出制度性结论。【无依据拒答】"
        "请补充资料范围、文档名称，或改为咨询已发布的统一回复（FAQ）。"
    )


def mark_inference_sections(answer: str, has_evidence: bool) -> str:
    text = str(answer or "").strip()
    if not text:
        return text
    if not has_evidence:
        return no_evidence_answer(text[:40])
    # Ensure explicit separation of inference language
    if "【AI 推断】" in text or "【资料事实】" in text:
        return text
    return (
        "【资料事实】\n"
        + text
        + "\n\n【AI 推断】以上未在原文直接出现的归纳仅为辅助理解，"
        "不构成制度条款；正式执行请以原文与管理员解释为准。"
    )


def _tokenize(text: str) -> list[str]:
    raw = re.sub(r"[\s,，。！？、；;:：]+", " ", str(text or "")).strip().lower()
    parts = [p for p in raw.split(" ") if len(p) >= 2]
    # also split long CJK without spaces into bigrams-ish chunks of 2-4
    if not parts and raw:
        parts = [raw[i : i + 2] for i in range(0, min(len(raw), 12), 2) if raw[i : i + 2]]
    return parts[:12]


def _expand_terms(terms: list[str]) -> list[str]:
    out: list[str] = []
    for term in terms:
        for syn in SYNONYM_MAP.get(term, []):
            if syn not in out and syn not in terms:
                out.append(syn)
        # light product alias style: strip common suffixes
        if term.endswith("系统") and len(term) > 2:
            out.append(term[:-2])
    return out[:8]


def _second_pass_terms(query: str, expanded: list[str]) -> list[str]:
    base = _tokenize(query)
    # drop first term, add expanded + question keywords without particles
    filtered = [t for t in base[1:] if t not in {"如何", "怎么", "什么", "哪些", "是否"}]
    return (filtered + expanded + base[:1])[:10]


def _needs_second_pass(snippets: list[RetrievedSnippet], query: str) -> bool:
    if not snippets:
        return True
    coverage = len({s.file_uuid or s.name for s in snippets})
    total = sum(len(s.text) for s in snippets)
    if coverage < 2:
        return True
    if total < 60:
        return True
    # query has multi-aspect markers
    if any(m in query for m in ("以及", "并且", "同时", "对比", "分别")) and coverage < 3:
        return True
    return False


def _lexical_search(
    db: Session,
    *,
    query: str,
    terms: list[str],
    limit: int,
    owner_user_id: str,
    is_admin: bool = False,
) -> list[RetrievedSnippet]:
    terms = [t for t in terms if t][:8]
    if not terms:
        terms = _tokenize(query)[:4]
    if not terms:
        return []

    conditions = []
    for term in terms:
        conditions.append(KnowledgeFile.file_name.contains(term))
        conditions.append(KnowledgeFile.summary.contains(term))
        conditions.append(KnowledgeFile.category.contains(term))
    visibility = (
        True
        if is_admin
        else or_(
            KnowledgeFile.owner_user_id == owner_user_id,
            (
                (KnowledgeFile.usage_type == "official_knowledge")
                & KnowledgeFile.review_status.in_(("approved", "official"))
                & KnowledgeFile.permission_scope.in_(
                    ("company", "department", "project", "admin")
                )
            ),
        )
    )
    try:
        rows = list(
            db.scalars(
                select(KnowledgeFile)
                .where(
                    or_(*conditions),
                    visibility,
                    KnowledgeFile.deleted_at.is_(None),
                    KnowledgeFile.hard_deleted_at.is_(None),
                )
                .limit(max(limit * 2, 12))
            )
        )
    except Exception:
        return []

    # Prefer owner-visible / shared: if owner_user_id set, rank private first optional
    scored: list[tuple[int, KnowledgeFile]] = []
    for row in rows:
        name = str(getattr(row, "file_name", "") or "")
        summary = str(getattr(row, "summary", "") or "")
        blob = f"{name} {summary}".lower()
        score = sum(3 if term.lower() in name.lower() else 1 for term in terms if term.lower() in blob)
        if getattr(row, "owner_user_id", "") == owner_user_id:
            score += 1
        scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)

    snippets: list[RetrievedSnippet] = []
    for score, file_row in scored[:limit]:
        if score <= 0:
            continue
        name = str(
            getattr(file_row, "file_name", "")
            or getattr(file_row, "original_file_name", "")
            or "资料"
        )
        summary = str(getattr(file_row, "summary", "") or "").strip()
        version = str(getattr(file_row, "version", "") or "")
        text = summary or f"资料《{name}》与问题相关（匹配分 {score}），请结合原文确认。"
        loc = "资料库"
        if version:
            loc = f"资料库 · v{version}"
        snippets.append(
            RetrievedSnippet(
                name=name,
                text=text[:1200],
                location=loc,
                file_uuid=str(getattr(file_row, "uuid", "") or ""),
            )
        )
    return snippets


def _snip_key(s: RetrievedSnippet) -> str:
    return f"{s.file_uuid}|{s.name}|{s.text[:40]}"


def _dedupe_snippets(
    snippets: list[RetrievedSnippet],
    *,
    seen: set[str] | None = None,
) -> list[RetrievedSnippet]:
    out: list[RetrievedSnippet] = []
    used = set(seen or [])
    for snip in snippets:
        key = _snip_key(snip)
        # near-duplicate by same file + similar prefix
        soft = f"{snip.file_uuid or snip.name}|{snip.text[:24]}"
        if key in used or soft in used:
            continue
        used.add(key)
        used.add(soft)
        out.append(snip)
    return out


def _enforce_file_coverage(
    snippets: list[RetrievedSnippet],
    *,
    target: int,
) -> list[RetrievedSnippet]:
    if not snippets:
        return []
    by_file: dict[str, list[RetrievedSnippet]] = {}
    for snip in snippets:
        key = snip.file_uuid or snip.name
        by_file.setdefault(key, []).append(snip)
    # round-robin pick to diversify files
    out: list[RetrievedSnippet] = []
    files = list(by_file.keys())
    idx = 0
    while len(out) < len(snippets) and files:
        key = files[idx % len(files)]
        bucket = by_file[key]
        if bucket:
            out.append(bucket.pop(0))
        if not bucket:
            files = [f for f in files if f != key]
            if not files:
                break
            idx = 0
            continue
        idx += 1
        if len({s.file_uuid or s.name for s in out}) >= target and len(out) >= min(target, len(snippets)):
            # fill remaining by original order preference
            remaining = [s for b in by_file.values() for s in b]
            out.extend(remaining)
            break
    return _dedupe_snippets(out)
