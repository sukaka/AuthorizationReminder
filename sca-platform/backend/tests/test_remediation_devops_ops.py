import importlib

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")
    monkeypatch.setenv("DEVOPS_BLOCK_SEVERITIES", "critical,high")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.remediation_service as remediation_service
    import app.devops_service as devops_service
    import app.ops_service as ops_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(remediation_service)
    importlib.reload(devops_service)
    importlib.reload(ops_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def seed_vulnerability(database, models, severity="high"):
    with database.SessionLocal() as db:
        project = models.Project(name="闭环项目", scan_note="release")
        db.add(project)
        db.flush()
        component = models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="npm")
        db.add(component)
        db.flush()
        vulnerability = models.VulnerabilityRecord(
            project_id=project.id,
            component_id=component.id,
            source="osv",
            advisory_id="CVE-2026-1000",
            cve_id="CVE-2026-1000",
            package_name="demo-lib",
            package_version="1.0.0",
            ecosystem="npm",
            cvss_score=8.1,
            severity=severity,
            description="demo",
            fixed_version="1.0.1",
            has_poc=True,
        )
        db.add(vulnerability)
        db.commit()
        return project.id, vulnerability.id


def test_remediation_ticket_lifecycle_and_ignore(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id, vulnerability_id = seed_vulnerability(database, models)
        created = test_client.post(
            f"/api/sca/projects/{project_id}/remediation/tickets",
            json={"vulnerability_id": vulnerability_id, "assignee": "sec_owner", "due_date": "2026-06-07", "priority": "P1"},
        )
        ticket_id = created.json()["id"]
        moved = test_client.post(f"/api/sca/remediation/tickets/{ticket_id}/transition", json={"status": "修复中", "comment": "开始处理"})
        verified = test_client.post(f"/api/sca/remediation/tickets/{ticket_id}/verify", json={"verification_result": "pass", "comment": "复测通过"})
        ignored = test_client.post(
            f"/api/sca/projects/{project_id}/remediation/whitelist",
            json={"vulnerability_id": vulnerability_id, "reason": "业务隔离", "expires_at": "2026-12-31"},
        )
        tickets = test_client.get(f"/api/sca/projects/{project_id}/remediation/tickets").json()

    assert created.status_code == 200
    assert moved.json()["status"] == "修复中"
    assert verified.json()["status"] == "已修复"
    assert ignored.json()["reason"] == "业务隔离"
    assert tickets["total"] == 1


def test_devops_webhook_blocks_high_risk_and_records_event(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id, _vulnerability_id = seed_vulnerability(database, models, severity="critical")
        response = test_client.post(
            "/api/sca/devops/webhooks/gitlab",
            json={"project_id": project_id, "pipeline_id": "gl-1", "ref": "main", "commit_sha": "abc", "source": "gitlab"},
        )
        events = test_client.get("/api/sca/devops/events").json()
        dashboard = test_client.get("/api/sca/devops/dashboard").json()

    assert response.status_code == 200
    assert response.json()["decision"] == "blocked"
    assert events["items"][0]["block_reason"]
    assert dashboard["blocked_count"] == 1


def test_ops_config_and_backup_job(monkeypatch, tmp_path):
    client, _main, _models, _database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        config = test_client.get("/api/sca/ops/config").json()
        backup = test_client.post("/api/sca/ops/backups", json={"scope": "database", "target": "local"}).json()
        backups = test_client.get("/api/sca/ops/backups").json()

    assert config["https_enabled"] is True
    assert config["jwt_secure"] is True
    assert "postgresql" in config["optimizations"]
    assert backup["status"] == "planned"
    assert backups["items"][0]["scope"] == "database"
