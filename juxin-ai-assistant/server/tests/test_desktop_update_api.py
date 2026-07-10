import hashlib
import io
import base64

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def test_app_with_storage(tmp_path, monkeypatch):
    """Create a test app with temporary storage."""
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

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings.cache_clear()
        engine.dispose()


def _admin_auth_headers():
    """Build admin auth headers for dev bypass mode."""
    import json, base64
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


def test_admin_create_and_list_releases(test_app_with_storage):
    client = test_app_with_storage
    headers = _admin_auth_headers()

    # Create release
    resp = client.post(
        "/api/ai/admin/desktop-updates",
        json={
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "测试自动更新",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["agent_version"] == "1.0.1"
    assert data["channel"] == "lan-test"
    assert data["status"] == "DRAFT"
    release_uuid = data["uuid"]

    # List releases
    resp = client.get("/api/ai/admin/desktop-updates", headers=headers)
    assert resp.status_code == 200
    releases = resp.json()
    assert len(releases) >= 1

    assert any(item["uuid"] == release_uuid for item in releases)


def test_admin_upload_and_publish(test_app_with_storage):
    client = test_app_with_storage
    headers = _admin_auth_headers()

    # Create release
    resp = client.post(
        "/api/ai/admin/desktop-updates",
        json={
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "测试",
        },
        headers=headers,
    )
    release_uuid = resp.json()["uuid"]

    # Upload artifact
    payload = b"signed-updater-content"
    sha = hashlib.sha256(payload).hexdigest()
    resp = client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/artifacts",
        data={
            "target": "darwin-aarch64",
            "sha256": sha,
            "signature": "tauri-public-signature",
        },
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload), "application/gzip")},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["sha256"] == sha

    # Publish
    resp = client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/publish",
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "PUBLISHED"


def test_public_latest_returns_204_when_no_release(test_app_with_storage):
    client = test_app_with_storage
    resp = client.get("/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json")
    assert resp.status_code == 204


def test_public_latest_after_publish(test_app_with_storage):
    client = test_app_with_storage
    headers = _admin_auth_headers()

    # Create and publish
    resp = client.post(
        "/api/ai/admin/desktop-updates",
        json={
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "测试自动更新",
        },
        headers=headers,
    )
    release_uuid = resp.json()["uuid"]

    payload = b"signed-content"
    sha = hashlib.sha256(payload).hexdigest()
    client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/artifacts",
        data={
            "target": "darwin-aarch64",
            "sha256": sha,
            "signature": "sig",
        },
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload), "application/gzip")},
        headers=headers,
    )
    client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/publish",
        headers=headers,
    )

    # Check public manifest
    resp = client.get("/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "1.0.1"
    assert data["notes"] == "测试自动更新"
    assert data["platforms"]["darwin-aarch64"]["signature"] == "sig"


def test_public_latest_returns_204_after_withdraw(test_app_with_storage):
    client = test_app_with_storage
    headers = _admin_auth_headers()

    resp = client.post(
        "/api/ai/admin/desktop-updates",
        json={
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "test",
        },
        headers=headers,
    )
    release_uuid = resp.json()["uuid"]

    payload = b"content"
    sha = hashlib.sha256(payload).hexdigest()
    client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/artifacts",
        data={
            "target": "darwin-aarch64",
            "sha256": sha,
            "signature": "sig",
        },
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload), "application/gzip")},
        headers=headers,
    )
    client.post(f"/api/ai/admin/desktop-updates/{release_uuid}/publish", headers=headers)
    client.post(f"/api/ai/admin/desktop-updates/{release_uuid}/withdraw", headers=headers)

    resp = client.get("/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json")
    assert resp.status_code == 204


def test_public_file_download_range(test_app_with_storage):
    client = test_app_with_storage
    headers = _admin_auth_headers()

    resp = client.post(
        "/api/ai/admin/desktop-updates",
        json={
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "test",
        },
        headers=headers,
    )
    release_uuid = resp.json()["uuid"]

    payload = b"hello-world-updater-test"
    sha = hashlib.sha256(payload).hexdigest()
    client.post(
        f"/api/ai/admin/desktop-updates/{release_uuid}/artifacts",
        data={
            "target": "darwin-aarch64",
            "sha256": sha,
            "signature": "sig",
        },
        files={"file": ("聚信 AI 助手.app.tar.gz", io.BytesIO(payload), "application/gzip")},
        headers=headers,
    )
    client.post(f"/api/ai/admin/desktop-updates/{release_uuid}/publish", headers=headers)

    # Get manifest to find download URL
    manifest = client.get("/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json")
    download_url = manifest.json()["platforms"]["darwin-aarch64"]["url"]

    # Full download
    resp = client.get(download_url)
    assert resp.status_code == 200
    assert resp.content == payload

    # Range request
    resp = client.get(download_url, headers={"Range": "bytes=0-4"})
    assert resp.status_code == 206
    assert resp.content == b"hello"
