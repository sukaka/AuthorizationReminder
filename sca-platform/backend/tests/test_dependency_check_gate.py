from __future__ import annotations

import json

from app import models
from app.scanners.base import NormalizedComponentData, NormalizedVulnerabilityData
from app.scanners.merger.component_merger import merge_components
from app.scanners.merger.vulnerability_merger import merge_vulnerabilities
from app.scanners.normalizers.dependency_track_normalizer import normalize_dependency_track_findings
from app.scanners.normalizers.trivy_normalizer import normalize_trivy


def dependency_check_row() -> NormalizedVulnerabilityData:
    return NormalizedVulnerabilityData(
        source_engine="dependency-check",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="commons-text",
        current_version="1.9",
        affected_purl="pkg:maven/org.apache.commons/commons-text@1.9",
        affected_gav="org.apache.commons:commons-text:1.9",
        affected_sha1="1111111111111111111111111111111111111111",
        match_confidence=0.92,
    )


def test_dependency_check_only_is_not_gate_eligible():
    merged = merge_vulnerabilities([dependency_check_row()])[0]

    assert merged["confirmation_status"] == "single_source"
    assert merged["gate_eligible"] is False
    assert merged["need_manual_review"] is True


def test_dependency_check_plus_trivy_is_cross_confirmed_by_shared_purl():
    trivy = NormalizedVulnerabilityData(
        source_engine="trivy",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="commons-text",
        current_version="1.9",
        affected_purl="pkg:maven/org.apache.commons/commons-text@1.9",
    )

    merged = merge_vulnerabilities([dependency_check_row(), trivy])

    assert len(merged) == 1
    assert merged[0]["confirmation_status"] == "cross_confirmed"
    assert merged[0]["confirmation_engines"] == ["dependency-check", "trivy"]
    assert merged[0]["gate_eligible"] is True


def test_same_cve_on_different_components_does_not_cross_confirm():
    trivy = NormalizedVulnerabilityData(
        source_engine="trivy",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="other-lib",
        current_version="1.9",
        affected_purl="pkg:maven/example/other-lib@1.9",
    )

    merged = merge_vulnerabilities([dependency_check_row(), trivy])

    assert len(merged) == 2
    assert all(item["confirmation_status"] == "single_source" for item in merged)


def test_suppressed_dependency_check_finding_is_rejected():
    row = dependency_check_row()
    row.suppressed = True

    merged = merge_vulnerabilities([row])[0]

    assert merged["confirmation_status"] == "rejected"
    assert merged["gate_eligible"] is False
    assert merged["review_reason"] == "已由 suppression 排除"


def test_components_merge_when_any_stable_identity_matches():
    dependency_check = NormalizedComponentData(
        source_engine="dependency-check",
        package_name="commons-text",
        normalized_name="commons-text",
        ecosystem="maven",
        version="1.9",
        purl="pkg:maven/org.apache.commons/commons-text@1.9",
        gav="org.apache.commons:commons-text:1.9",
        sha1="1111111111111111111111111111111111111111",
    )
    trivy = NormalizedComponentData(
        source_engine="trivy",
        package_name="commons-text",
        normalized_name="commons-text",
        ecosystem="maven",
        version="1.9",
        sha1="1111111111111111111111111111111111111111",
    )

    merged = merge_components([dependency_check, trivy])

    assert len(merged) == 1
    assert merged[0]["detected_by_engines"] == ["dependency-check", "trivy"]


def test_trivy_and_dependency_track_findings_preserve_affected_purl(tmp_path):
    trivy_report = tmp_path / "trivy.json"
    trivy_report.write_text(
        json.dumps(
            {
                "Results": [
                    {
                        "Target": "pom.xml",
                        "Vulnerabilities": [
                            {
                                "VulnerabilityID": "CVE-2022-42889",
                                "PkgName": "commons-text",
                                "InstalledVersion": "1.9",
                                "PkgIdentifier": {
                                    "PURL": "pkg:maven/org.apache.commons/commons-text@1.9"
                                },
                            }
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    _components, trivy_vulnerabilities = normalize_trivy(trivy_report)
    dtrack_vulnerabilities = normalize_dependency_track_findings(
        [
            {
                "vulnerability": {"vulnId": "CVE-2022-42889"},
                "component": {
                    "name": "commons-text",
                    "version": "1.9",
                    "purl": "pkg:maven/org.apache.commons/commons-text@1.9",
                },
            }
        ]
    )

    assert trivy_vulnerabilities[0].affected_purl == "pkg:maven/org.apache.commons/commons-text@1.9"
    assert dtrack_vulnerabilities[0].affected_purl == "pkg:maven/org.apache.commons/commons-text@1.9"


def test_confirmation_and_stable_identity_columns_exist():
    assert {"sha1", "gav"} <= set(models.NormalizedComponent.__table__.columns.keys())
    assert {"sha1", "gav"} <= set(models.MergedComponent.__table__.columns.keys())
    assert {
        "affected_purl",
        "affected_cpe",
        "affected_sha1",
        "affected_gav",
        "suppressed",
    } <= set(models.NormalizedVulnerability.__table__.columns.keys())
    expected_confirmation_columns = {
        "confirmation_status",
        "confirmation_engines",
        "gate_eligible",
        "review_reason",
    }
    assert expected_confirmation_columns <= set(models.MergedVulnerability.__table__.columns.keys())
    assert expected_confirmation_columns <= set(models.VulnerabilityRecord.__table__.columns.keys())
