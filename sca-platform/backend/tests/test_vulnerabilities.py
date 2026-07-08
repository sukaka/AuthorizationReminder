import importlib
from datetime import datetime, timedelta, timezone

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
    import app.celery_app as celery_app
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(vulnerability_service)
    importlib.reload(celery_app)
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


def test_query_component_vulnerabilities_enqueues_async_task(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    enqueued = {}

    def fake_apply_async(*, args, task_id):
        enqueued["args"] = args
        enqueued["task_id"] = task_id

    monkeypatch.setattr(main.query_project_vulnerabilities_task, "apply_async", fake_apply_async)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="漏洞项目", scan_note="demo")
            db.add(project)
            db.flush()
            db.add(
                models.UploadFileRecord(
                    project_id=project.id,
                    upload_id="upload-vuln-async",
                    original_filename="demo.zip",
                    stored_filename="demo.zip",
                    storage_path="/tmp/demo.zip",
                    status="scanned",
                )
            )
            db.add(models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="pypi"))
            db.commit()
            project_id = project.id

        response = test_client.post(f"/api/sca/projects/{project_id}/vulnerabilities/query")

    assert response.status_code == 202
    data = response.json()
    assert data["task_id"] > 0
    assert data["status"] == "queued"
    assert data["message"] == "漏洞查询任务已入队，请稍后刷新查看结果"
    assert enqueued["args"] == [data["task_id"]]


def test_query_component_vulnerabilities_times_out_stale_running_task(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    enqueued = {}

    def fake_apply_async(*, args, task_id):
        enqueued["args"] = args
        enqueued["task_id"] = task_id

    monkeypatch.setattr(main.query_project_vulnerabilities_task, "apply_async", fake_apply_async)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="陈旧漏洞任务项目", scan_note="demo")
            db.add(project)
            db.flush()
            upload = models.UploadFileRecord(
                project_id=project.id,
                upload_id="upload-stale-vuln",
                original_filename="demo.zip",
                stored_filename="demo.zip",
                storage_path="/tmp/demo.zip",
                status="scanned",
            )
            db.add(upload)
            db.flush()
            db.add(models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="pypi"))
            stale_task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                celery_task_id="lost-vuln-task",
                task_type="vulnerability_query_task",
                engine_name="juxin-vuln-intel",
                status="running",
                progress=87,
                summary="正在查询漏洞情报：120/131 typedarray",
                timeout_seconds=60,
                started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=20),
            )
            db.add(stale_task)
            db.commit()
            project_id = project.id
            stale_task_id = stale_task.id

        response = test_client.post(f"/api/sca/projects/{project_id}/vulnerabilities/query")

        assert response.status_code == 202
        data = response.json()
        assert data["task_id"] != stale_task_id
        assert data["status"] == "queued"
        assert enqueued["args"] == [data["task_id"]]

        with database.SessionLocal() as db:
            old_task = db.get(models.ScanTask, stale_task_id)
            assert old_task.status == "timeout"
            assert old_task.progress == 100
            assert "任务执行中断" in old_task.summary


def test_list_scan_tasks_marks_stale_running_task_timeout(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="陈旧扫描日志项目", scan_note="demo")
            db.add(project)
            db.flush()
            upload = models.UploadFileRecord(
                project_id=project.id,
                upload_id="upload-stale-list",
                original_filename="demo.zip",
                stored_filename="demo.zip",
                storage_path="/tmp/demo.zip",
                status="scanned",
            )
            db.add(upload)
            db.flush()
            task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                celery_task_id="lost-list-task",
                task_type="vulnerability_query_task",
                engine_name="juxin-vuln-intel",
                status="running",
                progress=87,
                summary="正在查询漏洞情报：120/131 typedarray",
                timeout_seconds=60,
                started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=20),
            )
            db.add(task)
            db.commit()
            project_id = project.id
            task_id = task.id

        response = test_client.get(f"/api/sca/projects/{project_id}/scan-tasks")

    assert response.status_code == 200
    rows = response.json()
    stale_row = next(row for row in rows if row["id"] == task_id)
    assert stale_row["status"] == "timeout"
    assert stale_row["progress"] == 100
    assert "任务执行中断" in stale_row["summary"]


def test_project_vulnerability_query_task_persists_results(monkeypatch, tmp_path):
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

    celery_tasks = importlib.import_module("app.celery_app")
    monkeypatch.setattr(celery_tasks, "query_component_vulnerabilities", fake_query)

    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="异步漏洞项目", scan_note="demo")
            db.add(project)
            db.flush()
            upload = models.UploadFileRecord(
                project_id=project.id,
                upload_id="upload-vuln-worker",
                original_filename="demo.zip",
                stored_filename="demo.zip",
                storage_path="/tmp/demo.zip",
                status="scanned",
            )
            db.add(upload)
            db.flush()
            db.add(models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="pypi"))
            task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                celery_task_id="vuln-task",
                task_type="vulnerability_query_task",
                engine_name="juxin-vuln-intel",
                status="queued",
                summary="等待漏洞查询任务执行",
            )
            db.add(task)
            db.commit()
            task_id = task.id
            project_id = project.id

        result = celery_tasks.query_project_vulnerabilities_task(task_id)
        vulnerability_response = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities")

    assert result["status"] == "success"
    assert result["vulnerabilities"] == 1
    data = vulnerability_response.json()
    assert data["total"] == 1
    assert data["items"][0]["cve_id"] == "CVE-2024-0001"


def test_project_vulnerability_query_uses_inferred_snapshot_version_and_logs_sources(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)
    queried_versions = []

    def fake_query(component, settings):
        from app.vulnerability_service import VulnerabilityFinding

        queried_versions.append(component.package_version)
        return [
            VulnerabilityFinding(
                source="osv",
                advisory_id="OSV-2026-1",
                cve_id="CVE-2026-0001",
                package_name=component.package_name,
                package_version=component.package_version,
                ecosystem=component.ecosystem,
                cvss_score=9.1,
                severity="critical",
                description="远程代码执行漏洞",
                fixed_version="5.0.0",
                published_at="2026-01-01T00:00:00Z",
            )
        ]

    celery_tasks = importlib.import_module("app.celery_app")
    monkeypatch.setattr(celery_tasks, "query_component_vulnerabilities", fake_query)

    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="推断漏洞版本项目", scan_note="demo")
            db.add(project)
            db.flush()
            upload = models.UploadFileRecord(
                project_id=project.id,
                upload_id="upload-inferred-vuln",
                original_filename="demo.zip",
                stored_filename="demo.zip",
                storage_path="/tmp/demo.zip",
                status="scanned",
            )
            db.add(upload)
            db.flush()
            component = models.Component(
                project_id=project.id,
                package_name="rsa",
                package_version="unknown",
                version_normalized="unknown",
                ecosystem="pypi",
                version_detected=False,
                need_manual_version_confirm=True,
            )
            db.add(component)
            db.flush()
            db.add(
                models.RiskMonitorSnapshot(
                    project_id=project.id,
                    component_id=component.id,
                    component_name="rsa",
                    current_version="4.9.1",
                    latest_version="4.9.1",
                    latest_source="pypi",
                    current_version_published_at="2025-04-16",
                    component_age_years=1.1,
                    recommendation="未声明版本，按默认安装行为以最新版本 4.9.1 作为当前推断版本。",
                )
            )
            task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                celery_task_id="vuln-inferred-task",
                task_type="vulnerability_query_task",
                engine_name="juxin-vuln-intel",
                status="queued",
                summary="等待漏洞查询任务执行",
            )
            db.add(task)
            db.commit()
            task_id = task.id
            project_id = project.id

        result = celery_tasks.query_project_vulnerabilities_task(task_id)
        vulnerabilities = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities").json()
        logs = test_client.get(f"/api/sca/projects/{project_id}/scan-logs").json()

    assert result["status"] == "success"
    assert queried_versions == ["4.9.1"]
    assert vulnerabilities["items"][0]["package_version"] == "4.9.1"
    coverage_log = " ".join(row["message"] for row in logs)
    assert "漏洞源覆盖检查" in coverage_log
    assert "CVE/NVD" in coverage_log
    assert "OSV" in coverage_log
    assert "GHSA" in coverage_log


def test_list_vulnerabilities_overlays_inferred_version_for_existing_unknown_record(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="历史漏洞版本项目", scan_note="demo")
            db.add(project)
            db.flush()
            component = models.Component(
                project_id=project.id,
                package_name="requests",
                package_version="unknown",
                version_normalized="unknown",
                ecosystem="pypi",
                version_detected=False,
                need_manual_version_confirm=True,
            )
            db.add(component)
            db.flush()
            db.add(
                models.RiskMonitorSnapshot(
                    project_id=project.id,
                    component_id=component.id,
                    component_name="requests",
                    current_version="2.34.2",
                    latest_version="2.34.2",
                    latest_source="pypi",
                    current_version_published_at="2026-05-14",
                    component_age_years=0.1,
                    recommendation="未声明版本，按默认安装行为以最新版本 2.34.2 作为当前推断版本。",
                )
            )
            db.add(
                models.VulnerabilityRecord(
                    project_id=project.id,
                    component_id=component.id,
                    source="nvd",
                    advisory_id="CVE-2006-0697",
                    cve_id="CVE-2006-0697",
                    package_name="requests",
                    package_version="unknown",
                    ecosystem="pypi",
                    cvss_score=10,
                    severity="critical",
                    description="历史记录仍为 unknown",
                    fixed_version="",
                )
            )
            db.commit()
            project_id = project.id

        response = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities")

    assert response.json()["items"][0]["package_version"] == "2.34.2"


def test_github_advisory_query_runs_without_token(monkeypatch):
    from app.config import Settings
    from app.models import Component
    from app import vulnerability_service

    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "ghsa_id": "GHSA-demo-1234",
                    "cve_id": "CVE-2026-1234",
                    "summary": "demo advisory",
                    "cvss": {"score": 7.5},
                    "severity": "high",
                    "published_at": "2026-02-01T00:00:00Z",
                    "html_url": "https://github.com/advisories/GHSA-demo-1234",
                    "references": ["https://example.com/poc"],
                    "vulnerabilities": [
                        {
                            "package": {"name": "requests", "ecosystem": "pypi"},
                            "patched_versions": "<2.0.0",
                        }
                    ],
                }
            ]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, params=None, headers=None):
            captured["url"] = url
            captured["params"] = params or {}
            captured["headers"] = headers or {}
            return FakeResponse()

    monkeypatch.setattr(vulnerability_service.httpx, "Client", FakeClient)
    component = Component(project_id=1, package_name="requests", normalized_name="requests", package_version="1.0.0", ecosystem="pypi")

    findings = vulnerability_service.query_github(component, Settings(github_token=""))

    assert captured["url"].endswith("/advisories")
    assert "Authorization" not in captured["headers"]
    assert captured["params"]["affects"] == "requests"
    assert findings[0].source == "github"
    assert findings[0].advisory_id == "GHSA-demo-1234"
    assert findings[0].cve_id == "CVE-2026-1234"


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
