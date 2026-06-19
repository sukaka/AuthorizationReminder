from fastapi.testclient import TestClient

from app.main import app


def test_health_exposes_service_and_version() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "juxin-ai-assistant",
        "version": "1.0.0",
    }
