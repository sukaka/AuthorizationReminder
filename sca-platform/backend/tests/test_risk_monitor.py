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


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeRegistryClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url):
        if "registry.npmjs.org" in url:
            return FakeResponse(
                {
                    "dist-tags": {"latest": "0.21.4"},
                    "time": {
                        "0.21.1": "2020-12-21T19:24:23.120Z",
                        "0.21.4": "2021-03-09T16:52:11.012Z",
                    },
                }
            )
        if "pypi.org" in url:
            return FakeResponse(
                {
                    "info": {"version": "7.4.3" if "chardet" in url else "2.32.5"},
                    "releases": {
                        "2.32.3": [{"upload_time_iso_8601": "2024-05-29T15:42:24.000Z"}],
                        "2.32.5": [{"upload_time_iso_8601": "2025-08-18T20:46:00.000Z"}],
                        "7.4.3": [{"upload_time_iso_8601": "2026-04-01T10:15:30.000Z"}],
                    },
                }
            )
        return FakeResponse({})


def test_version_compare_handles_semver_and_prerelease():
    from app.risk_monitor_service import compare_versions

    assert compare_versions("1.2.3", "1.2.4") < 0
    assert compare_versions("2.0.0", "1.9.9") > 0
    assert compare_versions("1.0.0-rc1", "1.0.0") < 0
    assert compare_versions("v1.10.0", "1.9.9") > 0


def test_monitor_uses_normalized_npm_version_for_publish_date(monkeypatch):
    from app.config import Settings
    from app.models import Component
    from app import risk_monitor_service

    monkeypatch.setattr(risk_monitor_service.httpx, "Client", FakeRegistryClient)
    component = Component(
        package_name="axios",
        package_version="^0.21.1",
        version_normalized="0.21.1",
        declared_version="^0.21.1",
        ecosystem="npm",
    )

    data = risk_monitor_service.monitor_component_update(component, Settings())

    assert data["current_version"] == "0.21.1"
    assert data["latest_version"] == "0.21.4"
    assert data["current_version_published_at"] == "2020-12-21"
    assert data["component_age_years"] > 0


def test_monitor_uses_resolved_pypi_version_for_publish_date(monkeypatch):
    from app.config import Settings
    from app.models import Component
    from app import risk_monitor_service

    monkeypatch.setattr(risk_monitor_service.httpx, "Client", FakeRegistryClient)
    component = Component(
        package_name="requests",
        package_version=">=2.32",
        version_normalized="2.32.3",
        resolved_version="2.32.3",
        declared_version=">=2.32",
        ecosystem="pypi",
    )

    data = risk_monitor_service.monitor_component_update(component, Settings())

    assert data["current_version"] == "2.32.3"
    assert data["latest_version"] == "2.32.5"
    assert data["current_version_published_at"] == "2024-05-29"
    assert data["component_age_years"] > 0


def test_monitor_infers_latest_version_when_manifest_has_no_version(monkeypatch):
    from app.config import Settings
    from app.models import Component
    from app import risk_monitor_service

    monkeypatch.setattr(risk_monitor_service.httpx, "Client", FakeRegistryClient)
    component = Component(
        package_name="chardet",
        package_version="unknown",
        version_normalized="unknown",
        declared_version="",
        resolved_version="",
        version_detected=False,
        ecosystem="pypi",
    )

    data = risk_monitor_service.monitor_component_update(component, Settings())

    assert data["current_version"] == "7.4.3"
    assert data["latest_version"] == "7.4.3"
    assert data["update_available"] is False
    assert data["version_delta"] == "none"
    assert data["current_version_published_at"] == "2026-04-01"
    assert data["component_age_years"] > 0
    assert "未声明版本" in data["recommendation"]
    assert "默认安装" in data["recommendation"]


def test_component_list_overlays_inferred_version_from_latest_snapshot(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="推断版本项目", scan_note="demo")
            db.add(project)
            db.flush()
            component = models.Component(
                project_id=project.id,
                package_name="chardet",
                package_version="unknown",
                version_normalized="unknown",
                ecosystem="pypi",
                normalized_name="chardet",
                source_file="requirements.txt",
                version_detected=False,
                need_manual_version_confirm=True,
                version_lock_status="未锁定版本风险",
                version_risk_type="版本缺失风险",
                risk_explanation="版本缺失，按默认安装行为推断为最新版本。",
            )
            db.add(component)
            db.flush()
            db.add(
                models.RiskMonitorSnapshot(
                    project_id=project.id,
                    component_id=component.id,
                    component_name=component.package_name,
                    current_version="7.4.3",
                    latest_version="7.4.3",
                    latest_source="pypi",
                    current_version_published_at="2026-04-01",
                    component_age_years=0.2,
                    recommendation="未声明版本，按默认安装行为以最新版本 7.4.3 作为当前推断版本；建议补充 lock 文件。",
                )
            )
            db.commit()
            project_id = project.id

        rows = test_client.get(f"/api/sca/projects/{project_id}/components").json()
        completeness = test_client.get(f"/api/sca/projects/{project_id}/scan-completeness").json()

    assert rows[0]["package_name"] == "chardet"
    assert rows[0]["package_version"] == "7.4.3"
    assert rows[0]["resolved_version"] == "7.4.3"
    assert rows[0]["version_risk_type"] == "版本缺失风险"
    assert "推断" in rows[0]["risk_explanation"]
    assert completeness["unknown_version_count"] == 0
    assert completeness["manual_confirm_count"] == 1


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
