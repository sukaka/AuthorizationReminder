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
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(main)
    return TestClient(main.app)


def test_health_exposes_app_metadata(monkeypatch, tmp_path):
    with build_client(monkeypatch, tmp_path) as client:
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["version"] == "0.1.0"


def test_me_uses_dev_bypass_for_local_scaffold(monkeypatch, tmp_path):
    with build_client(monkeypatch, tmp_path) as client:
        response = client.get("/api/sca/me")

        assert response.status_code == 200
        assert response.json()["username"] == "dev_admin"
        assert "sca" in response.json()["app_access"]


def test_overview_returns_bootstrap_counts(monkeypatch, tmp_path):
    with build_client(monkeypatch, tmp_path) as client:
        response = client.get("/api/sca/overview")

        assert response.status_code == 200
        assert response.json()["project_count"] == 0
        assert response.json()["component_count"] == 0
