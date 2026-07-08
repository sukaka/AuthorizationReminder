from __future__ import annotations

import json
from pathlib import Path

from ..base import NormalizedComponentData, NormalizedVulnerabilityData


def normalize_trivy(path: Path) -> tuple[list[NormalizedComponentData], list[NormalizedVulnerabilityData]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    components: dict[tuple[str, str], NormalizedComponentData] = {}
    vulnerabilities: list[NormalizedVulnerabilityData] = []
    for result in data.get("Results", []) if isinstance(data, dict) else []:
        target = str(result.get("Target") or "")
        for vuln in result.get("Vulnerabilities", []) or []:
            pkg = str(vuln.get("PkgName") or "")
            version = str(vuln.get("InstalledVersion") or "")
            package_identifier = vuln.get("PkgIdentifier")
            package_identifier_data = package_identifier if isinstance(package_identifier, dict) else {}
            purl = str(package_identifier_data.get("PURL") or "")
            key = (pkg, version)
            components.setdefault(
                key,
                NormalizedComponentData(
                    source_engine="trivy",
                    package_name=pkg,
                    normalized_name=pkg.lower(),
                    version=version,
                    version_normalized=version,
                    source_file=target,
                    evidence_file=target,
                    evidence_text=purl,
                    purl=purl,
                    confidence_score=0.86,
                ),
            )
            vuln_id = str(vuln.get("VulnerabilityID") or "")
            vulnerabilities.append(
                NormalizedVulnerabilityData(
                    source_engine="trivy",
                    vulnerability_id=vuln_id,
                    cve_id=vuln_id if vuln_id.startswith("CVE-") else "",
                    title=str(vuln.get("Title") or vuln_id),
                    description=str(vuln.get("Description") or ""),
                    severity=str(vuln.get("Severity") or "unknown").lower(),
                    cvss_score=float((vuln.get("CVSS") or {}).get("nvd", {}).get("V3Score") or 0),
                    affected_package=pkg,
                    current_version=version,
                    fixed_versions=[str(vuln.get("FixedVersion") or "")] if vuln.get("FixedVersion") else [],
                    references=[str(item) for item in vuln.get("References", []) or []],
                    match_confidence=0.82 if version else 0.45,
                    raw_source=json.dumps(vuln, ensure_ascii=False),
                    affected_purl=purl,
                )
            )
    return list(components.values()), vulnerabilities
