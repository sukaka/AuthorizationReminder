from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def _use_public_web_settings(monkeypatch, *, origins: str = "https://ai.example.com") -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "false")
    monkeypatch.setenv("CORS_ORIGINS", origins)
    get_settings.cache_clear()


def test_public_web_requires_auth_for_session(monkeypatch):
    _use_public_web_settings(monkeypatch)

    with TestClient(app) as client:
        response = client.get("/api/ai/session")

    assert response.status_code == 401


def test_public_web_exposes_health_below_the_https_api_prefix(monkeypatch):
    _use_public_web_settings(monkeypatch)

    with TestClient(app) as client:
        response = client.get("/api/ai/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_public_web_blocks_untrusted_write_origin(monkeypatch):
    _use_public_web_settings(monkeypatch)

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/logout",
            headers={"Origin": "https://evil.example.com"},
        )

    assert response.status_code == 403
    assert response.json()["code"] == "ORIGIN_FORBIDDEN"


def test_public_web_blocks_cross_origin_bearer_write(monkeypatch):
    _use_public_web_settings(monkeypatch)

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/logout",
            headers={
                "Origin": "https://evil.example.com",
                "Authorization": "Bearer stolen-token",
            },
        )

    assert response.status_code == 403
    assert response.json()["code"] == "ORIGIN_FORBIDDEN"


def test_public_web_allows_trusted_write_origin(monkeypatch):
    _use_public_web_settings(monkeypatch)

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/logout",
            headers={"Origin": "https://ai.example.com"},
        )

    assert response.status_code in {204, 503}


def teardown_function():
    get_settings.cache_clear()
