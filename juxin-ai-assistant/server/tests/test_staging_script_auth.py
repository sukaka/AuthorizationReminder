"""Staging script authentication must be explicit and secret-safe."""

from __future__ import annotations

import pytest

from scripts.staging_auth import (
    build_headers,
    normalize_release_id,
    validate_bearer_transport,
)


def test_default_headers_keep_local_dev_compatibility() -> None:
    assert build_headers(user_id="dev", role="admin") == {
        "X-Test-User-ID": "dev",
        "X-Test-Role": "admin",
    }


def test_bearer_header_uses_only_named_environment_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STAGING_TEST_TOKEN", "not-printed")

    assert build_headers(
        user_id="ignored",
        role="ignored",
        bearer_token_env="STAGING_TEST_TOKEN",
    ) == {"Authorization": "Bearer not-printed"}


def test_missing_bearer_environment_variable_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MISSING_STAGING_TOKEN", raising=False)

    with pytest.raises(ValueError, match="bearer_token_env_missing:MISSING_STAGING_TOKEN"):
        build_headers(
            user_id="dev",
            role="admin",
            bearer_token_env="MISSING_STAGING_TOKEN",
        )


@pytest.mark.parametrize("kwargs", [{"user_id": "", "role": "admin"}, {"user_id": "dev", "role": ""}])
def test_header_identity_cannot_be_empty(kwargs: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="_missing"):
        build_headers(**kwargs)


def test_bearer_environment_name_and_value_reject_header_injection(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="bearer_token_env_invalid"):
        build_headers(user_id="dev", role="admin", bearer_token_env="BAD-NAME")
    monkeypatch.setenv("STAGING_TEST_TOKEN", "token\nforged")
    with pytest.raises(ValueError, match="bearer_token_invalid"):
        build_headers(user_id="dev", role="admin", bearer_token_env="STAGING_TEST_TOKEN")


def test_local_transport_remains_compatible_without_bearer() -> None:
    assert validate_bearer_transport(base_url="http://127.0.0.1:18093") == "http://127.0.0.1:18093"


def test_bearer_transport_requires_https_and_rejects_url_userinfo() -> None:
    with pytest.raises(ValueError, match="bearer_transport_requires_https"):
        validate_bearer_transport(
            base_url="http://staging.example.test",
            bearer_token_env="STAGING_TEST_TOKEN",
        )
    with pytest.raises(ValueError, match="bearer_transport_userinfo_forbidden"):
        validate_bearer_transport(
            base_url="https://operator:secret@staging.example.test",
            bearer_token_env="STAGING_TEST_TOKEN",
        )


def test_bearer_transport_accepts_https_origin() -> None:
    assert validate_bearer_transport(
        base_url="https://staging.example.test/api/",
        bearer_token_env="STAGING_TEST_TOKEN",
    ) == "https://staging.example.test/api"


def test_release_identity_is_normalized_and_can_be_required() -> None:
    assert normalize_release_id(" release-20260714.001 ") == "release-20260714.001"
    assert normalize_release_id("") is None
    with pytest.raises(ValueError, match="release_id_missing"):
        normalize_release_id("", required=True)


@pytest.mark.parametrize(
    "value",
    ["contains space", "line\nfeed", "-starts-with-separator", "x" * 129],
)
def test_release_identity_rejects_unstable_values(value: str) -> None:
    with pytest.raises(ValueError, match="release_id_invalid"):
        normalize_release_id(value)
