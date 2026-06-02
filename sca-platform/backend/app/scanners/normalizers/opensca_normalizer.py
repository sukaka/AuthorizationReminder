from __future__ import annotations

import json
from pathlib import Path

from ..base import NormalizedComponentData, NormalizedVulnerabilityData


def normalize_opensca(path: Path) -> tuple[list[NormalizedComponentData], list[NormalizedVulnerabilityData]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    components: list[NormalizedComponentData] = []
    vulnerabilities: list[NormalizedVulnerabilityData] = []
    for row in data.get("components", []) if isinstance(data, dict) else []:
        name = str(row.get("name") or row.get("packageName") or "")
        version = str(row.get("version") or "")
        components.append(
            NormalizedComponentData(
                source_engine="opensca",
                package_name=name,
                normalized_name=name.lower(),
                ecosystem=str(row.get("ecosystem") or row.get("language") or "unknown").lower(),
                package_manager=str(row.get("packageManager") or ""),
                version=version,
                version_normalized=version,
                purl=str(row.get("purl") or ""),
                license=str(row.get("license") or ""),
                confidence_score=0.82,
            )
        )
    for row in data.get("vulnerabilities", []) if isinstance(data, dict) else []:
        vuln_id = str(row.get("cve") or row.get("id") or row.get("vulnerabilityId") or "")
        vulnerabilities.append(
            NormalizedVulnerabilityData(
                source_engine="opensca",
                vulnerability_id=vuln_id,
                cve_id=vuln_id if vuln_id.startswith("CVE-") else "",
                title=str(row.get("title") or vuln_id),
                description=str(row.get("description") or ""),
                severity=str(row.get("severity") or "unknown").lower(),
                cvss_score=float(row.get("cvss") or row.get("cvssScore") or 0),
                affected_package=str(row.get("packageName") or row.get("component") or ""),
                affected_version_range=str(row.get("affectedVersionRange") or ""),
                current_version=str(row.get("version") or ""),
                fixed_versions=[str(row.get("fixedVersion") or "")] if row.get("fixedVersion") else [],
                references=[str(item) for item in row.get("references", []) or []] if isinstance(row.get("references"), list) else [],
                match_confidence=0.72,
                raw_source=json.dumps(row, ensure_ascii=False),
            )
        )
    return components, vulnerabilities
