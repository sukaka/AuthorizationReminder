import importlib
import zipfile
from io import BytesIO

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")
    monkeypatch.setenv("REPORT_ROOT", str(tmp_path / "reports"))
    monkeypatch.setenv("SBOM_ROOT", str(tmp_path / "sbom"))
    monkeypatch.setenv("TOOL_SYFT_PATH", str(tmp_path / "missing-syft"))
    monkeypatch.setenv("TOOL_TRIVY_PATH", str(tmp_path / "missing-trivy"))
    monkeypatch.setenv("TOOL_GRYPE_PATH", str(tmp_path / "missing-grype"))

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.report_service as report_service
    import app.sbom_service as sbom_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(report_service)
    importlib.reload(sbom_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def seed_project(database, models):
    with database.SessionLocal() as db:
        project = models.Project(name="报告项目", scan_note="v1.0")
        db.add(project)
        db.flush()
        component = models.Component(
            project_id=project.id,
            package_name="fastapi",
            package_version="0.115.6",
            ecosystem="pypi",
            license_name="MIT",
        )
        db.add(component)
        db.flush()
        db.add(
            models.VulnerabilityRecord(
                project_id=project.id,
                component_id=component.id,
                source="osv",
                advisory_id="CVE-2024-9999",
                cve_id="CVE-2024-9999",
                package_name="fastapi",
                package_version="0.115.6",
                ecosystem="pypi",
                cvss_score=8.8,
                severity="high",
                description="高危漏洞示例",
                fixed_version="0.115.7",
                published_at_text="2024-05-01T00:00:00Z",
                confidence_score=0.92,
                risk_priority="P1",
                risk_score=88,
                suggested_deadline="7 天内修复",
                priority_reason="高危且存在安全版本",
            )
        )
        db.commit()
        return project.id


def test_report_exports_generate_downloadable_files(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        for fmt, magic in [("docx", b"PK"), ("xlsx", b"PK"), ("pdf", b"%PDF")]:
            created = test_client.post(f"/api/sca/projects/{project_id}/reports", json={"format": fmt})
            assert created.status_code == 200
            report = created.json()
            assert report["format"] == fmt
            downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")
            assert downloaded.status_code == 200
            assert downloaded.content.startswith(magic)


def test_report_includes_management_summary_confidence_and_priority(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        created = test_client.post(f"/api/sca/projects/{project_id}/reports", json={"format": "docx"})
        report = created.json()
        downloaded = test_client.get(f"/api/sca/reports/{report['id']}/download")

    with zipfile.ZipFile(BytesIO(downloaded.content)) as archive:
        document = archive.read("word/document.xml").decode("utf-8")

    assert "本次扫描结论摘要" in document
    assert "漏洞可信度说明" in document
    assert "整改优先级清单" in document
    assert "开发修复建议" in document
    assert "pip install fastapi==0.115.7" in document


def test_sbom_export_uses_database_components_when_tool_is_unavailable(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id = seed_project(database, models)
        created = test_client.post(f"/api/sca/projects/{project_id}/sbom", json={"format": "cyclonedx"})
        assert created.status_code == 200
        sbom = created.json()
        assert sbom["format"] == "cyclonedx"
        assert sbom["component_count"] == 1
        downloaded = test_client.get(f"/api/sca/sbom/{sbom['id']}/download")
        assert downloaded.status_code == 200
        assert b"fastapi" in downloaded.content


def test_image_scan_reports_missing_tools_without_crashing(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        response = test_client.post("/api/sca/image-scans", json={"image_ref": "python:3.12-alpine", "scanner": "trivy"})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "tool_missing"
    assert data["risk_score"] == 0
