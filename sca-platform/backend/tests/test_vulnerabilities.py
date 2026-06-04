import importlib

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")
    monkeypatch.setenv("VULNERABILITY_FETCH_TIMEOUT_MS", "50")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.vulnerability_service as vulnerability_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(vulnerability_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def test_normalizes_osv_records_to_required_fields():
    from app.vulnerability_service import normalize_osv_vulnerability

    record = normalize_osv_vulnerability(
        {
            "id": "GHSA-abcd-1234",
            "aliases": ["CVE-2024-12345"],
            "summary": "test summary",
            "details": "test details",
            "published": "2024-02-01T00:00:00Z",
            "severity": [{"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}],
            "affected": [{"ranges": [{"events": [{"fixed": "1.2.3"}]}]}],
            "database_specific": {"github_reviewed": True},
        },
        source="osv",
        component_name="demo-lib",
        component_version="1.0.0",
        ecosystem="PyPI",
    )

    assert record.cve_id == "CVE-2024-12345"
    assert record.cvss_score == 9.8
    assert record.severity == "critical"
    assert record.fixed_version == "1.2.3"
    assert record.has_poc is True


def test_query_component_vulnerabilities_persists_results(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)

    def fake_query(component, settings):
        from app.vulnerability_service import VulnerabilityFinding

        return [
            VulnerabilityFinding(
                source="osv",
                advisory_id="OSV-2024-1",
                cve_id="CVE-2024-0001",
                package_name=component.package_name,
                package_version=component.package_version,
                ecosystem=component.ecosystem,
                cvss_score=9.1,
                severity="critical",
                description="远程代码执行漏洞",
                fixed_version="2.0.0",
                published_at="2024-01-01T00:00:00Z",
                has_poc=True,
                exploited_in_wild=False,
                detail_url="https://osv.dev/vulnerability/OSV-2024-1",
            )
        ]

    monkeypatch.setattr(main, "query_component_vulnerabilities", fake_query)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="漏洞项目", scan_note="demo")
            db.add(project)
            db.flush()
            db.add(models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="pypi"))
            db.commit()
            project_id = project.id

        response = test_client.post(f"/api/sca/projects/{project_id}/vulnerabilities/query")

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["cve_id"] == "CVE-2024-0001"
    assert data["items"][0]["severity"] == "critical"


def test_project_vulnerability_query_uses_threadpool(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    called = {}

    async def fake_run_in_threadpool(fn, *args, **kwargs):
        called["function"] = fn.__name__
        return fn(*args, **kwargs)

    monkeypatch.setattr(main, "run_in_threadpool", fake_run_in_threadpool)

    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="线程池漏洞项目", scan_note="demo")
            db.add(project)
            db.commit()
            project_id = project.id

        response = test_client.post(f"/api/sca/projects/{project_id}/vulnerabilities/query")

    assert response.status_code == 200
    assert called["function"] == "_query_project_vulnerabilities_blocking"


def test_vulnerability_stats_and_trend(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="统计项目", scan_note="demo")
            db.add(project)
            db.flush()
            component = models.Component(project_id=project.id, package_name="demo", package_version="1.0.0", ecosystem="npm")
            db.add(component)
            db.flush()
            db.add(
                models.VulnerabilityRecord(
                    project_id=project.id,
                    component_id=component.id,
                    source="nvd",
                    advisory_id="CVE-2024-0002",
                    cve_id="CVE-2024-0002",
                    package_name="demo",
                    package_version="1.0.0",
                    ecosystem="npm",
                    cvss_score=7.5,
                    severity="high",
                    description="demo",
                    fixed_version="1.0.1",
                    published_at_text="2024-03-01T00:00:00Z",
                )
            )
            db.add(
                models.VulnerabilityRecord(
                    project_id=project.id,
                    component_id=component.id,
                    source="nvd",
                    advisory_id="CVE-2024-REVIEW",
                    cve_id="CVE-2024-REVIEW",
                    package_name="demo",
                    package_version="1.0.0",
                    ecosystem="npm",
                    cvss_score=9.8,
                    severity="critical",
                    description="needs review",
                    fixed_version="",
                    published_at_text="2024-03-02T00:00:00Z",
                    match_status="unknown",
                    needs_human_review=True,
                    confidence_score=0.35,
                )
            )
            db.commit()
            project_id = project.id

        stats = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities/stats").json()
        trend = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities/trend").json()

    assert stats["total"] == 2
    assert stats["by_severity"]["high"] == 1
    assert stats["by_severity"]["critical"] == 0
    assert trend["items"][0]["month"] == "2024-03"
