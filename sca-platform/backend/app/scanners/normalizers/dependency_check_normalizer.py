from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import unquote

from ..base import NormalizedComponentData, NormalizedVulnerabilityData
from ..identity import gav_from_purl


def _identifier_values(rows: object) -> list[str]:
    if not isinstance(rows, list):
        return []
    values: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            value = str(row.get("id") or "")
        else:
            value = str(row or "")
        if value:
            values.append(value)
    return values


def _name_version_from_purl_or_filename(purl: str, filename: str) -> tuple[str, str]:
    if purl.startswith("pkg:maven/"):
        path_version = purl[len("pkg:maven/") :].split("?", 1)[0].split("#", 1)[0]
        path, separator, version = path_version.rpartition("@")
        parts = [unquote(item) for item in path.split("/") if item]
        if separator and parts:
            return parts[-1], unquote(version)
    lower = filename.lower()
    for suffix in (".jar", ".war", ".ear"):
        if lower.endswith(suffix):
            return filename[: -len(suffix)], ""
    return filename, ""


def normalize_dependency_check(
    path: Path,
) -> tuple[list[NormalizedComponentData], list[NormalizedVulnerabilityData]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    components: list[NormalizedComponentData] = []
    vulnerabilities: list[NormalizedVulnerabilityData] = []
    dependency_rows = data.get("dependencies", []) if isinstance(data, dict) else []
    for dependency in dependency_rows if isinstance(dependency_rows, list) else []:
        if not isinstance(dependency, dict):
            continue
        package_ids = _identifier_values(dependency.get("packages"))
        purl = next((item for item in package_ids if item.startswith("pkg:")), "")
        gav = gav_from_purl(purl)
        filename = str(dependency.get("fileName") or "")
        name, version = _name_version_from_purl_or_filename(purl, filename)
        sha1 = str(dependency.get("sha1") or "")
        cpes = [
            item
            for item in _identifier_values(dependency.get("vulnerabilityIds"))
            if item.startswith("cpe:")
        ]
        cpe = cpes[0] if cpes else ""
        source_file = str(dependency.get("filePath") or "")
        component = NormalizedComponentData(
            source_engine="dependency-check",
            package_name=name,
            normalized_name=name.lower(),
            ecosystem="maven" if purl.startswith("pkg:maven/") else "java",
            package_manager="maven" if purl.startswith("pkg:maven/") else "",
            version=version,
            version_normalized=version,
            purl=purl,
            cpe=cpe,
            source_file=source_file,
            evidence_file=source_file,
            evidence_text=json.dumps(dependency.get("evidenceCollected") or {}, ensure_ascii=False),
            confidence_score=0.94 if sha1 or gav or purl else 0.45,
            sha1=sha1,
            gav=gav,
        )
        components.append(component)

        vulnerability_rows = dependency.get("vulnerabilities", [])
        for vulnerability in vulnerability_rows if isinstance(vulnerability_rows, list) else []:
            if not isinstance(vulnerability, dict):
                continue
            vuln_id = str(vulnerability.get("name") or "")
            cvss = vulnerability.get("cvssv3")
            cvss_data = cvss if isinstance(cvss, dict) else {}
            references_value = vulnerability.get("references", [])
            reference_rows = references_value if isinstance(references_value, list) else []
            references = [
                str(item.get("url") or "")
                for item in reference_rows
                if isinstance(item, dict) and item.get("url")
            ]
            vulnerabilities.append(
                NormalizedVulnerabilityData(
                    source_engine="dependency-check",
                    vulnerability_id=vuln_id,
                    cve_id=vuln_id if vuln_id.startswith("CVE-") else "",
                    title=vuln_id,
                    description=str(vulnerability.get("description") or ""),
                    severity=str(vulnerability.get("severity") or "unknown").lower(),
                    cvss_score=float(cvss_data.get("baseScore") or 0),
                    cvss_vector=str(cvss_data.get("vectorString") or ""),
                    affected_package=name,
                    current_version=version,
                    references=references,
                    match_confidence=0.92 if sha1 or gav or purl else 0.38,
                    raw_source=json.dumps(vulnerability, ensure_ascii=False),
                    affected_purl=purl,
                    affected_cpe=cpe,
                    affected_sha1=sha1,
                    affected_gav=gav,
                    suppressed=bool(vulnerability.get("suppressed")),
                )
            )
    return components, vulnerabilities
