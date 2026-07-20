from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.model_endpoint_security import validate_user_model_endpoint


def _settings(**overrides):
    values = {
        "auth_dev_bypass": False,
        "user_model_custom_endpoint_enabled": True,
        "user_model_allowed_hosts": "api.example.com",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_custom_model_endpoint_is_disabled_by_default():
    with pytest.raises(HTTPException) as exc_info:
        validate_user_model_endpoint(
            "https://api.example.com/v1",
            _settings(user_model_custom_endpoint_enabled=False),
        )
    assert exc_info.value.detail == "USER_MODEL_CUSTOM_ENDPOINT_DISABLED"


def test_custom_model_endpoint_requires_https_and_exact_allowlist():
    with pytest.raises(HTTPException):
        validate_user_model_endpoint("http://api.example.com/v1", _settings())
    with pytest.raises(HTTPException):
        validate_user_model_endpoint("https://other.example.com/v1", _settings())


def test_custom_model_endpoint_rejects_private_dns_target(monkeypatch):
    monkeypatch.setattr(
        "app.model_endpoint_security.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("10.0.0.8", 443))],
    )
    with pytest.raises(HTTPException) as exc_info:
        validate_user_model_endpoint("https://api.example.com/v1", _settings())
    assert exc_info.value.detail == "MODEL_ENDPOINT_PRIVATE_NETWORK"


def test_custom_model_endpoint_accepts_allowlisted_public_dns(monkeypatch):
    monkeypatch.setattr(
        "app.model_endpoint_security.socket.getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    assert validate_user_model_endpoint(
        "https://api.example.com/v1/",
        _settings(),
    ) == "https://api.example.com/v1"
