from __future__ import annotations

import json
from pathlib import Path

from app.scanners.identity import gav_from_purl, stable_component_keys
from app.scanners.normalizers.dependency_check_normalizer import normalize_dependency_check


def test_normalizes_dependency_check_component_and_vulnerability():
    fixture = Path(__file__).parent / "fixtures" / "dependency-check-report.json"

    components, vulnerabilities = normalize_dependency_check(fixture)

    assert len(components) == 1
    assert len(vulnerabilities) == 1
    component = components[0]
    vulnerability = vulnerabilities[0]
    assert component.source_engine == "dependency-check"
    assert component.package_name == "commons-text"
    assert component.version == "1.9"
    assert component.purl == "pkg:maven/org.apache.commons/commons-text@1.9"
    assert component.sha1 == "1111111111111111111111111111111111111111"
    assert component.gav == "org.apache.commons:commons-text:1.9"
    assert vulnerability.cve_id == "CVE-2022-42889"
    assert vulnerability.severity == "critical"
    assert vulnerability.cvss_score == 9.8
    assert vulnerability.affected_purl == component.purl
    assert vulnerability.affected_sha1 == component.sha1
    assert vulnerability.affected_gav == component.gav
    assert vulnerability.match_confidence >= 0.9


def test_cpe_only_match_is_low_confidence_and_suppression_is_preserved(tmp_path: Path):
    report = tmp_path / "report.json"
    report.write_text(
        json.dumps(
            {
                "dependencies": [
                    {
                        "fileName": "legacy.jar",
                        "vulnerabilityIds": ["cpe:2.3:a:vendor:legacy:1.0:*:*:*:*:*:*:*"],
                        "vulnerabilities": [
                            {
                                "name": "CVE-2020-0001",
                                "severity": "HIGH",
                                "suppressed": True,
                            }
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    components, vulnerabilities = normalize_dependency_check(report)

    assert components[0].package_name == "legacy"
    assert components[0].version == ""
    assert components[0].cpe == "cpe:2.3:a:vendor:legacy:1.0:*:*:*:*:*:*:*"
    assert vulnerabilities[0].affected_cpe == components[0].cpe
    assert vulnerabilities[0].match_confidence < 0.5
    assert vulnerabilities[0].suppressed is True


def test_gav_and_stable_component_keys_prefer_strong_identifiers():
    purl = "pkg:maven/org.apache.commons/commons-text@1.9?type=jar"

    assert gav_from_purl(purl) == "org.apache.commons:commons-text:1.9"
    assert stable_component_keys(
        sha1="ABC123",
        gav="Org.Example:Demo:1.0",
        purl="pkg:maven/org.example/demo@1.0",
        ecosystem="maven",
        name="Demo",
        version="1.0",
    ) == [
        "sha1:abc123",
        "gav:org.example:demo:1.0",
        "purl:pkg:maven/org.example/demo@1.0",
        "package:maven:demo@1.0",
    ]
