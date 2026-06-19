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
        )


def test_production_settings_accept_unpadded_32_byte_content_key() -> None:
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode("ascii").rstrip("=")

    settings = Settings(
        auth_dev_bypass=False,
        prompt_center_runtime_token="r" * 32,
        content_encryption_key=encoded,
    )

    assert settings.content_encryption_key == encoded
