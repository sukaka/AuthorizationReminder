from __future__ import annotations

import json

from ..base import NormalizedComponentData, NormalizedVulnerabilityData


def normalize_dependency_track_components(rows: list[dict[str, object]]) -> list[NormalizedComponentData]:
    normalized: list[NormalizedComponentData] = []
    for row in rows:
        normalized.append(
            NormalizedComponentData(
                source_engine="dependency-track",
                package_name=str(row.get("name") or ""),
                normalized_name=str(row.get("name") or "").lower(),
                version=str(row.get("version") or ""),
                purl=str(row.get("purl") or ""),
                cpe=str(row.get("cpe") or ""),
                license=str(row.get("license") or ""),
                confidence_score=0.86 if row.get("purl") else 0.68,
            )
        )
    return normalized


def normalize_dependency_track_findings(rows: list[dict[str, object]]) -> list[NormalizedVulnerabilityData]:
    normalized: list[NormalizedVulnerabilityData] = []
    for row in rows:
        vuln = row.get("vulnerability") if isinstance(row.get("vulnerability"), dict) else {}
        component = row.get("component") if isinstance(row.get("component"), dict) else {}
        vuln_id = str(vuln.get("vulnId") or vuln.get("source") or "")
        normalized.append(
            NormalizedVulnerabilityData(
                source_engine="dependency-track",
                vulnerability_id=vuln_id,
                cve_id=vuln_id if vuln_id.startswith("CVE-") else "",
                title=str(vuln.get("title") or vuln_id),
                description=str(vuln.get("description") or ""),
                severity=str(vuln.get("severity") or "unknown").lower(),
                cvss_score=float(vuln.get("cvssV3BaseScore") or vuln.get("cvssV2BaseScore") or 0),
                affected_package=str(component.get("name") or ""),
                current_version=str(component.get("version") or ""),
                references=[str(item) for item in vuln.get("references", []) or []] if isinstance(vuln.get("references"), list) else [],
                match_confidence=0.8,
                raw_source=json.dumps(row, ensure_ascii=False),
                affected_purl=str(component.get("purl") or ""),
                affected_cpe=str(component.get("cpe") or ""),
            )
        )
    return normalized
