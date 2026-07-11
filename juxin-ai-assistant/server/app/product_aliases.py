"""Product name aliases used by knowledge retrieval.

Keep business-owned aliases in PRODUCT_ALIASES.  Retrieval expands either the
English abbreviation or any Chinese name to the complete alias group.
"""

from __future__ import annotations


PRODUCT_ALIASES: dict[str, tuple[str, ...]] = {
    "WDSP": ("WEB动态安全管理平台", "Web 动态安全管理平台"),
    "CCMP": ("等保合规云管平台",),
    "WAF": ("WEB应用防火墙", "Web 应用防火墙"),
    "WAAP": ("API安全网关", "API 安全网关"),
}


def expand_product_aliases(query: str) -> str:
    normalized = "".join(query.lower().split())
    matched: list[str] = []
    for abbreviation, names in PRODUCT_ALIASES.items():
        candidates = (abbreviation, *names)
        if any("".join(candidate.lower().split()) in normalized for candidate in candidates):
            matched.extend(candidates)
    if not matched:
        return query
    additions = " ".join(dict.fromkeys(matched))
    return f"{query} {additions}".strip()
