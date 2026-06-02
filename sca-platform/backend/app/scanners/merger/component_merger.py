from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict

from ..base import NormalizedComponentData
from .confidence_engine import component_confidence


def _key(item: NormalizedComponentData) -> tuple[str, str, str]:
    if item.purl:
        return ("purl", item.purl, "")
    if item.ecosystem and item.normalized_name and item.version:
        return ("eco", item.ecosystem, f"{item.normalized_name}@{item.version}")
    if item.package_manager and item.package_name and item.version:
        return ("pm", item.package_manager, f"{item.package_name}@{item.version}")
    if item.cpe:
        return ("cpe", item.cpe, "")
    return ("name", item.normalized_name or item.package_name, item.version)


def merge_components(rows: list[NormalizedComponentData]) -> list[dict[str, object]]:
    grouped: dict[tuple[str, str, str], list[NormalizedComponentData]] = defaultdict(list)
    for row in rows:
        grouped[_key(row)].append(row)
    merged: list[dict[str, object]] = []
    for group in grouped.values():
        best = max(group, key=lambda item: (bool(item.purl), bool(item.cpe), item.confidence_score))
        engines = sorted({item.source_engine for item in group if item.source_engine})
        score, level = component_confidence(
            len(engines),
            any(item.purl for item in group),
            any(item.evidence_file and "lock" in item.evidence_file.lower() for item in group),
            best.version or "unknown",
        )
        merged.append(
            {
                **asdict(best),
                "detected_by_engines": engines,
                "engine_count": len(engines),
                "evidence_list": [asdict(item) for item in group],
                "merged_confidence_score": score,
                "confidence_level": level,
            }
        )
    return merged

