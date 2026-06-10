from __future__ import annotations

from dataclasses import asdict

from ..base import NormalizedComponentData
from ..identity import group_by_shared_keys, stable_component_keys
from .confidence_engine import component_confidence


def _keys(item: NormalizedComponentData) -> list[str]:
    keys = stable_component_keys(
        sha1=item.sha1,
        gav=item.gav,
        purl=item.purl,
        ecosystem=item.ecosystem,
        name=item.normalized_name or item.package_name,
        version=item.version,
    )
    if keys:
        return keys
    if item.cpe:
        return [f"cpe-candidate:{item.cpe.lower()}"]
    return [f"name:{(item.normalized_name or item.package_name).lower()}@{item.version}"]


def merge_components(rows: list[NormalizedComponentData]) -> list[dict[str, object]]:
    merged: list[dict[str, object]] = []
    for group in group_by_shared_keys(rows, _keys):
        best = max(
            group,
            key=lambda item: (
                bool(item.sha1),
                bool(item.gav),
                bool(item.purl),
                bool(item.cpe),
                item.confidence_score,
            ),
        )
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
