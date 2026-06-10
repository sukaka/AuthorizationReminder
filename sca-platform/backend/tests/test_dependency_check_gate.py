from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.scanners.base import NormalizedComponentData, NormalizedVulnerabilityData
from app.scanners.merger.component_merger import merge_components
from app.scanners.merger.vulnerability_merger import merge_vulnerabilities
from app.scanners.normalizers.dependency_track_normalizer import normalize_dependency_track_findings
from app.scanners.normalizers.trivy_normalizer import normalize_trivy


def _session_factory(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dependency-check-gate.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


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


def _seed_promotion_rows(db, *, external_source: str = ""):
    project = models.Project(name=f"promotion-{external_source or 'single'}")
    upload = models.UploadFileRecord(
        project=project,
        upload_id=f"promotion-{external_source or 'single'}-u1",
        original_filename="source.zip",
    )
    scan = models.ScanTask(project=project, upload_file=upload, status="success")
    component = models.Component(
        project=project,
        package_name="commons-text",
        package_version="1.9",
        normalized_name="commons-text",
        version_normalized="1.9",
        ecosystem="maven",
        purl="pkg:maven/org.apache.commons/commons-text@1.9",
    )
    db.add_all([project, upload, scan, component])
    db.flush()
    if external_source:
        db.add(
            models.VulnerabilityRecord(
                project_id=project.id,
                component_id=component.id,
                source=external_source,
                advisory_id="CVE-2022-42889",
                cve_id="CVE-2022-42889",
                package_name="commons-text",
                package_version="1.9",
                ecosystem="maven",
                severity="critical",
                match_status="affected",
                needs_human_review=False,
                gate_eligible=True,
            )
        )
    db.add(
        models.MergedVulnerability(
            project_id=project.id,
            scan_id=scan.id,
            vulnerability_id="CVE-2022-42889",
            cve_id="CVE-2022-42889",
            detected_by_engines='["dependency-check"]',
            vulnerability_sources_json=json.dumps(
                [
                    {
                        "source_engine": "dependency-check",
                        "affected_purl": component.purl,
                        "affected_package": component.package_name,
                        "current_version": component.package_version,
                        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-42889"],
                    }
                ]
            ),
            confirmation_status="single_source",
            gate_eligible=False,
            need_manual_review=True,
            review_reason="Dependency-Check 单引擎发现，等待其他引擎确认",
        )
    )
    db.commit()
    return project.id, scan.id


def test_single_source_dependency_check_is_promoted_as_pending_review(tmp_path: Path):
    from app.scanner_result_service import promote_dependency_check_findings

    Session = _session_factory(tmp_path)
    with Session() as db:
        project_id, scan_id = _seed_promotion_rows(db)

        created = promote_dependency_check_findings(db, project_id, scan_id)
        db.commit()

        finding = db.query(models.VulnerabilityRecord).filter_by(project_id=project_id).one()
        assert created == 1
        assert finding.source == "dependency-check"
        assert finding.match_status == "unknown"
        assert finding.needs_human_review is True
        assert finding.gate_eligible is False
        assert finding.confirmation_status == "single_source"


def test_external_vulnerability_remains_gate_eligible_when_dependency_check_confirms(tmp_path: Path):
    from app.scanner_result_service import promote_dependency_check_findings

    Session = _session_factory(tmp_path)
    with Session() as db:
        project_id, scan_id = _seed_promotion_rows(db, external_source="osv")

        created = promote_dependency_check_findings(db, project_id, scan_id)
        db.commit()

        external = db.query(models.VulnerabilityRecord).filter_by(project_id=project_id).one()
        assert created == 0
        assert external.gate_eligible is True
        assert external.match_status == "affected"
        assert external.needs_human_review is False
        assert external.confirmation_status == "cross_confirmed"
        assert set(json.loads(external.confirmation_engines)) == {"dependency-check", "osv"}
