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


def test_auth_dev_bypass_rejects_non_loopback_public_origin() -> None:
    with pytest.raises(ValidationError, match="AUTH_DEV_BYPASS"):
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="s" * 32,
            public_url="https://app.example.com",
        )


def test_auth_dev_bypass_rejects_production_environment() -> None:
    with pytest.raises(ValidationError, match="AUTH_DEV_BYPASS"):
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="s" * 32,
            environment="production",
        )


def test_enabled_feishu_channel_requires_all_verification_secrets() -> None:
    with pytest.raises(ValidationError, match="飞书渠道缺少配置"):
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="s" * 32,
            feishu_channel_enabled=True,
            feishu_app_id="app-id",
            feishu_app_secret="app-secret",
            feishu_verification_token="",
            feishu_encrypt_key="encrypt-key",
        )


def test_enabled_wecom_channel_requires_aes_encryption_key() -> None:
    with pytest.raises(ValidationError, match="WECOM_ENCODING_AES_KEY"):
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="s" * 32,
            wecom_channel_enabled=True,
            wecom_token="token",
            wecom_encoding_aes_key="short",
        )
