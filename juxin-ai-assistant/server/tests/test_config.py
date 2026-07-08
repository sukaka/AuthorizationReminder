import base64

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_settings_require_decodable_32_byte_content_key() -> None:
    with pytest.raises(ValidationError, match="32 字节 URL-safe base64"):
        Settings(
            auth_dev_bypass=False,
            prompt_center_runtime_token="r" * 32,
            content_encryption_key="!" * 43,
            audit_hash_salt="a" * 32,
        )


def test_production_settings_accept_unpadded_32_byte_content_key() -> None:
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode("ascii").rstrip("=")

    settings = Settings(
        auth_dev_bypass=False,
        prompt_center_runtime_token="r" * 32,
        content_encryption_key=encoded,
        audit_hash_salt="a" * 32,
    )

    assert settings.content_encryption_key == encoded


def test_production_settings_require_independent_audit_hash_salt() -> None:
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")

    with pytest.raises(ValidationError, match="AUDIT_HASH_SALT"):
        Settings(
            auth_dev_bypass=False,
            prompt_center_runtime_token="r" * 32,
            content_encryption_key=encoded,
            audit_hash_salt=encoded,
        )


def test_production_settings_require_local_binding_secret() -> None:
    # Given: all other production secrets are valid.
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")

    # When/Then: an absent local binding signer fails configuration closed.
    with pytest.raises(ValidationError, match="AI_LOCAL_BINDING_SECRET"):
        Settings(
            auth_dev_bypass=False,
            prompt_center_runtime_token="r" * 32,
            content_encryption_key=encoded,
            audit_hash_salt="a" * 32,
            ai_local_binding_secret="",
        )


def test_development_settings_have_no_implicit_local_binding_secret() -> None:
    # Given/When/Then: bypassing SSO never enables an empty token-signing key.
    with pytest.raises(ValidationError, match="AI_LOCAL_BINDING_SECRET"):
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="",
        )
