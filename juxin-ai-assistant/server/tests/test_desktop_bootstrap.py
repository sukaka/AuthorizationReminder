import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def bootstrap_client() -> TestClient:
    # Given: the server is configured with a trusted public SSO portal origin.
    trusted_settings = Settings(auth_public_url="https://auth.example.test")
    app.dependency_overrides[get_settings] = lambda: trusted_settings
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_desktop_bootstrap_requires_no_session(
    bootstrap_client: TestClient,
) -> None:
    # When: a desktop client discovers capabilities without a session cookie.
    response = bootstrap_client.get("/api/ai/desktop/bootstrap")

    # Then: it receives only the public protocol contract and trusted portal URL.
    assert response.status_code == 200
    assert response.json() == {
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": "https://auth.example.test/portal",
        "workspaceUrl": "http://localhost:18093/",
    }


def test_desktop_bootstrap_ignores_forwarded_authority(
    bootstrap_client: TestClient,
) -> None:
    # When: an untrusted caller supplies forged proxy authority headers.
    response = bootstrap_client.get(
        "/api/ai/desktop/bootstrap",
        headers={
            "host": "attacker.example",
            "x-forwarded-proto": "http",
            "x-forwarded-host": "attacker.example",
        },
    )

    # Then: the response remains anchored to trusted configuration.
    assert response.status_code == 200
    assert response.json()["authPortalUrl"] == "https://auth.example.test/portal"
    assert response.json()["workspaceUrl"] == "http://localhost:18093/"
    assert "attacker.example" not in response.text


def test_desktop_bootstrap_ignores_internal_auth_service_url() -> None:
    # Given: the internal service address and public browser address are different.
    trusted_settings = Settings(
        auth_service_url="http://auth.internal:5180",
        auth_public_url="https://auth.example.test",
    )
    app.dependency_overrides[get_settings] = lambda: trusted_settings
    try:
        with TestClient(app) as client:
            # When: the desktop client requests public bootstrap metadata.
            response = client.get("/api/ai/desktop/bootstrap")
    finally:
        app.dependency_overrides.pop(get_settings, None)

    # Then: the internal Docker hostname is never exposed.
    assert response.json()["authPortalUrl"] == "https://auth.example.test/portal"
    assert "auth.internal" not in response.text


@pytest.mark.parametrize(
    "unsafe_url",
    [
        "http://auth.example.test",
        "https://user:pass@auth.example.test",
        "https://auth.example.test/path",
        "https://auth.example.test?next=evil",
        "https://auth.example.test#fragment",
        "https://auth.example.test:invalid",
    ],
)
def test_auth_public_url_rejects_unsafe_origins(unsafe_url: str) -> None:
    # When/Then: an operator attempts to configure a non-Origin or plaintext URL.
    with pytest.raises(ValidationError, match="AUTH_PUBLIC_URL"):
        Settings(auth_public_url=unsafe_url)


@pytest.mark.parametrize(
    ("configured_url", "normalized_url"),
    [
        ("http://localhost:5180/", "http://localhost:5180"),
        ("http://127.0.0.1:5180", "http://127.0.0.1:5180"),
        ("http://[::1]:5180", "http://[::1]:5180"),
        ("https://AUTH.EXAMPLE.TEST:443/", "https://auth.example.test"),
    ],
)
def test_auth_public_url_normalizes_safe_origins(
    configured_url: str,
    normalized_url: str,
) -> None:
    # When: a safe public or loopback development Origin is configured.
    settings = Settings(auth_public_url=configured_url)

    # Then: it is stored as a canonical Origin.
    assert settings.auth_public_url == normalized_url
