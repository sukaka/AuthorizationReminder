import hashlib
import io
import base64

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def concurrent_test_app(tmp_path, monkeypatch):
    """Create two test clients sharing the same DB for concurrency tests."""
    storage = tmp_path / "desktop-updates"
    storage.mkdir()

    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("DESKTOP_UPDATE_STORAGE_DIR", str(storage))
    monkeypatch.setenv("DESKTOP_UPDATE_MAX_BYTES", str(10 * 1024 * 1024))
    monkeypatch.setenv("DESKTOP_UPDATE_PUBLIC_BASE_URL", "http://testserver/api/ai/desktop/updates")
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", "desktop-update-local-binding-key")
    monkeypatch.setenv(
        "CONTENT_ENCRYPTION_KEY",
        base64.urlsafe_b64encode(b"k" * 32).decode("ascii"),
    )
    monkeypatch.setenv("AUDIT_HASH_SALT", "b" * 32)
    monkeypatch.setenv("PROMPT_CENTER_RUNTIME_TOKEN", "c" * 32)

    from app.config import get_settings
    from app.main import app
    from app.database import Base, create_engine_for_url, get_db
    from sqlalchemy.orm import Session

    get_settings.cache_clear()
    engine = create_engine_for_url(f"sqlite+pysqlite:///{tmp_path}/test.db")
    Base.metadata.create_all(engine)

    def override_get_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    client1 = TestClient(app)
    client2 = TestClient(app)
    try:
        yield client1, client2
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings.cache_clear()
        client1.close()
        client2.close()
        engine.dispose()


def _admin_headers():
    import json
    import base64
    payload = {
        "user": {
            "id": "admin-001",
            "login_name": "admin",
            "display_name": "管理员",
            "email": "admin@example.com",
        },
        "permissions": ["ai_assistant:admin", "ai_assistant:employee"],
    }
    token = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    return {"Cookie": f"juxin_auth_token={token}"}


def test_concurrent_publish_picks_highest_version_only(concurrent_test_app):
    client1, client2 = concurrent_test_app
    headers = _admin_headers()

    # Create two releases on same channel
    r1 = client1.post("/api/ai/admin/desktop-updates", json={
        "agent_version": "1.0.1",
        "channel": "lan-test",
        "release_notes": "first",
    }, headers=headers)
    assert r1.status_code == 201

    r2 = client1.post("/api/ai/admin/desktop-updates", json={
        "agent_version": "1.0.2",
        "channel": "lan-test",
        "release_notes": "second",
    }, headers=headers)
    assert r2.status_code == 201

    # Upload artifacts
    payload_v1 = b"content-v1"
    sha_v1 = hashlib.sha256(payload_v1).hexdigest()
    client1.post(
        f"/api/ai/admin/desktop-updates/{r1.json()['uuid']}/artifacts",
        data={"target": "darwin-aarch64", "sha256": sha_v1, "signature": "sig1"},
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload_v1), "application/gzip")},
        headers=headers,
    )
    payload_v2 = b"content-v2"
    sha_v2 = hashlib.sha256(payload_v2).hexdigest()
    client1.post(
        f"/api/ai/admin/desktop-updates/{r2.json()['uuid']}/artifacts",
        data={"target": "darwin-aarch64", "sha256": sha_v2, "signature": "sig2"},
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload_v2), "application/gzip")},
        headers=headers,
    )

    # Publish both - 1.0.2 should work, 1.0.1 should fail (lower than published)
    pub2 = client1.post(f"/api/ai/admin/desktop-updates/{r2.json()['uuid']}/publish", headers=headers)
    assert pub2.status_code == 200

    pub1 = client1.post(f"/api/ai/admin/desktop-updates/{r1.json()['uuid']}/publish", headers=headers)
    # Should fail because 1.0.1 is lower than 1.0.2
    assert pub1.status_code >= 400

    # Verify latest returns 1.0.2
    latest = client1.get("/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json")
    assert latest.status_code == 200
    assert latest.json()["version"] == "1.0.2"
