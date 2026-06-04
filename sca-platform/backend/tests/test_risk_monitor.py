import importlib

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sca-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("APP_VERSION", "0.1.0")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.risk_monitor_service as risk_monitor_service
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(risk_monitor_service)
    importlib.reload(main)
    return TestClient(main.app), main, models, database


def test_version_compare_handles_semver_and_prerelease():
    from app.risk_monitor_service import compare_versions

    assert compare_versions("1.2.3", "1.2.4") < 0
    assert compare_versions("2.0.0", "1.9.9") > 0
    assert compare_versions("1.0.0-rc1", "1.0.0") < 0
    assert compare_versions("v1.10.0", "1.9.9") > 0


def test_project_monitor_persists_snapshot_alert_and_change(monkeypatch, tmp_path):
    client, main, models, database = build_client(monkeypatch, tmp_path)

    def fake_monitor(component, settings):
        return {
            "component_name": component.package_name,
            "current_version": component.package_version,
            "latest_version": "1.2.0",
            "latest_source": "npm",
            "update_available": True,
            "version_delta": "minor",
            "eol_status": "active",
            "eol_date": "",
            "recommendation": "建议升级到 1.2.0",
            "current_version_published_at": "2024-01-15",
            "component_age_years": 2.4,
            "raw": {"dist-tags": {"latest": "1.2.0"}},
        }

    monkeypatch.setattr(main, "monitor_component_update", fake_monitor)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="监测项目", scan_note="demo")
            db.add(project)
            db.flush()
            db.add(models.Component(project_id=project.id, package_name="demo-lib", package_version="1.0.0", ecosystem="npm"))
            db.commit()
            project_id = project.id

        response = test_client.post(f"/api/sca/projects/{project_id}/risk-monitor/run")
        snapshots = test_client.get(f"/api/sca/projects/{project_id}/risk-monitor/snapshots").json()
        alerts = test_client.get(f"/api/sca/projects/{project_id}/risk-monitor/alerts").json()
        changes = test_client.get(f"/api/sca/projects/{project_id}/risk-monitor/changes").json()

    assert response.status_code == 200
    assert response.json()["updated_components"] == 1
    assert snapshots[0]["latest_version"] == "1.2.0"
    assert snapshots[0]["current_version_published_at"] == "2024-01-15"
    assert snapshots[0]["component_age_years"] == 2.4
    assert alerts[0]["level"] == "medium"
    assert changes[0]["change_type"] == "version_update"


def test_monitor_trend_returns_daily_alert_counts(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="趋势项目", scan_note="demo")
            db.add(project)
            db.flush()
            component = models.Component(project_id=project.id, package_name="demo", package_version="1.0.0", ecosystem="pypi")
            db.add(component)
            db.flush()
            db.add(models.RiskAlert(project_id=project.id, component_id=component.id, level="high", title="高危提醒", message="demo"))
            db.commit()
            project_id = project.id

        trend = test_client.get(f"/api/sca/projects/{project_id}/risk-monitor/trend").json()

    assert trend["items"][0]["total"] == 1
    assert trend["items"][0]["high"] == 1
