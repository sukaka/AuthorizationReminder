import base64
import binascii
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信 AI 助手"
    app_version: str = "1.0.0"
    database_url: str = "sqlite+pysqlite:///./juxin-ai-assistant-dev.db"
    auth_service_url: str = "http://auth:5180"
    auth_system_key: str = "ai-assistant"
    auth_cookie_name: str = "juxin_auth_token"
    auth_fetch_timeout_ms: int = Field(default=5000, ge=1000, le=30000)
    auth_dev_bypass: bool = False
    prompt_center_url: str = "http://prompt-center-api:5189"
    prompt_center_runtime_token: str = ""
    content_encryption_key: str = ""
    content_encryption_key_version: str = "v1"
    public_url: str = "http://localhost:18093"
    cors_origins: str = "http://localhost:18093,http://127.0.0.1:18093"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if not self.auth_dev_bypass:
            if len(self.prompt_center_runtime_token) < 32:
                raise ValueError("PROMPT_CENTER_RUNTIME_TOKEN 至少需要 32 个字符")
            normalized_key = self.content_encryption_key.strip()
            padded_key = normalized_key + ("=" * (-len(normalized_key) % 4))
            try:
                decoded_key = base64.b64decode(
                    padded_key.encode("ascii"),
                    altchars=b"-_",
                    validate=True,
                )
            except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
                raise ValueError(
                    "CONTENT_ENCRYPTION_KEY 必须是 32 字节 URL-safe base64"
                ) from exc
            if len(decoded_key) != 32:
                raise ValueError("CONTENT_ENCRYPTION_KEY 必须是 32 字节 URL-safe base64")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
