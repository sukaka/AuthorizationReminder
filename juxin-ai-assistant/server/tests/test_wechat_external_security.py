from datetime import datetime

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.wechat_external_auth import openid_hash, safe_return_to
from app.wechat_external_quota import SHANGHAI, WechatExternalQuota


def test_openid_is_hmac_hashed_and_return_url_is_local_only() -> None:
    assert openid_hash("openid-1", "s" * 32) != "openid-1"
    assert openid_hash("openid-1", "s" * 32) == openid_hash("openid-1", "s" * 32)
    assert safe_return_to("/documents") == "/documents"
    assert safe_return_to("https://attacker.example") == "/"
    assert safe_return_to("//attacker.example") == "/"


def test_quota_fails_closed_without_redis() -> None:
    quota = WechatExternalQuota(
        url="redis://unused",
        prefix="test:wechat",
        hourly_limit=15,
        daily_limit=30,
        client=None,
    )
    # Explicitly clear the optional Redis client so this remains deterministic.
    quota.client = None
    with pytest.raises(HTTPException) as error:
        quota.reserve("visitor-1", now=datetime.now(SHANGHAI))
    assert error.value.status_code == 503


def test_external_routes_are_hidden_when_feature_is_disabled(client) -> None:
    response = client.get("/api/wechat/external/bootstrap")

    assert response.status_code == 404


def test_enabled_external_channel_requires_redis_and_adds_h5_origin_to_cors() -> None:
    values = {
        "wechat_external_enabled": True,
        "wechat_official_account_app_id": "wx-test",
        "wechat_official_account_app_secret": "secret",
        "wechat_oauth_redirect_uri": "https://api.example.com/api/wechat/external/oauth/callback",
        "wechat_external_h5_origin": "https://h5.example.com",
        "wechat_external_session_secret": "s" * 32,
        "wechat_openid_hash_salt": "h" * 32,
    }
    with pytest.raises(ValueError, match="KNOWLEDGE_REDIS_ENABLED"):
        Settings(**values)

    settings = Settings(**values, knowledge_redis_enabled=True)
    assert "https://h5.example.com" in settings.allowed_origins
