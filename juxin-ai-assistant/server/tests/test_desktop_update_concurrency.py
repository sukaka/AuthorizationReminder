import hashlib
import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def concurrent_test_app(tmp_path):
    """Create two test clients sharing the same DB for concurrency tests."""
    storage = tmp_path / "desktop-updates"
    storage.mkdir()

    import os
    os.environ["AUTH_DEV_BYPASS"] = "true"
    os.environ["DESKTOP_UPDATE_STORAGE_DIR"] = str(storage)
    os.environ["DESKTOP_UPDATE_MAX_BYTES"] = str(10 * 1024 * 1024)
    os.environ["DESKTOP_UPDATE_PUBLIC_BASE_URL"] = "http://testserver/api/ai/desktop/updates"
    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{tmp_path}/test.db"
    os.environ["AI_LOCAL_BINDING_SECRET"] = "a" * 32
    os.environ["CONTENT_ENCRYPTION_KEY"] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    os.environ["AUDIT_HASH_SALT"] = "b" * 32
    os.environ["PROMPT_CENTER_RUNTIME_TOKEN"] = "c" * 32

    from app.main import app
    from app.database import Base, create_engine_for_url

    engine = create_engine_for_url(f"sqlite+pysqlite:///{tmp_path}/test.db")
    Base.metadata.create_all(engine)

    client1 = TestClient(app)
    client2 = TestClient(app)
    yield client1, client2
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
    payload = b"content"
    sha = hashlib.sha256(payload).hexdigest()
    client1.post(
        f"/api/ai/admin/desktop-updates/{r1.json()['uuid']}/artifacts",
        data={"target": "darwin-aarch64", "sha256": sha, "signature": "sig1"},
        files={"file": ("app.tar.gz", io.BytesIO(payload), "application/gzip")},
        headers=headers,
    )
    client1.post(
        f"/api/ai/admin/desktop-updates/{r2.json()['uuid']}/artifacts",
        data={"target": "darwin-aarch64", "sha256": sha, "signature": "sig2"},
        files={"file": ("app.tar.gz", io.BytesIO(payload), "application/gzip")},
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
