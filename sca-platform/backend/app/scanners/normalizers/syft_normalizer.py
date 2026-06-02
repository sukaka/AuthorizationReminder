from __future__ import annotations

import json
from pathlib import Path

from ..base import NormalizedComponentData


def normalize_syft_cyclonedx(path: Path) -> list[NormalizedComponentData]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows: list[NormalizedComponentData] = []
    for component in data.get("components", []) if isinstance(data, dict) else []:
        name = str(component.get("name") or "")
        version = str(component.get("version") or "")
        purl = str(component.get("purl") or "")
        licenses = component.get("licenses") or []
        license_name = ""
        if licenses and isinstance(licenses[0], dict):
            license_name = str((licenses[0].get("license") or {}).get("id") or "")
        rows.append(
            NormalizedComponentData(
                source_engine="syft",
                package_name=name,
                normalized_name=name.lower(),
                version=version,
                version_normalized=version,
                purl=purl,
                license=license_name,
                confidence_score=0.9 if purl else 0.72,
            )
        )
    return rows

