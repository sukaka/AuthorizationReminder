import base64
import binascii
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信 AI 助手"
    app_version: str = "1.1.0"
    database_url: str = "sqlite+pysqlite:///./juxin-ai-assistant-dev.db"
    auth_service_url: str = "http://auth:5180"
    auth_public_url: str = "http://localhost:5180"
    auth_system_key: str = "ai-assistant"
    auth_cookie_name: str = "juxin_auth_token"
    auth_fetch_timeout_ms: int = Field(default=5000, ge=1000, le=30000)
    auth_dev_bypass: bool = False
    web_spa_enabled: bool = False
    web_static_dir: str = "../apps/desktop/dist"
    prompt_center_url: str = "http://prompt-center-api:5189"
    prompt_center_runtime_token: str = ""
    content_encryption_key: str = ""
    content_encryption_key_version: str = "v1"
    audit_hash_salt: str = ""
    ai_local_binding_secret: str = ""
    public_url: str = "http://localhost:18093"
    cors_origins: str = "http://localhost:18093,http://127.0.0.1:18093"
    export_storage_dir: str = "./exports"
    knowledge_storage_dir: str = "./storage"
    web_search_provider: str = "duckduckgo-html"
    server_model_base_url: str = ""
    server_model_api_key: str = ""
    server_model_id: str = ""
    server_model_display_name: str = "服务端模型"
    server_model_timeout_seconds: int = Field(default=300, ge=5, le=600)
    server_model_max_output_tokens: int = Field(default=8192, ge=1, le=200000)
    embedding_model_api_key: str = ""
    embedding_model_timeout_seconds: int = Field(default=30, ge=3, le=300)
    qdrant_enabled: bool = False
    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "juxin_official_knowledge"
    qdrant_timeout_seconds: float = Field(default=3.0, ge=0.2, le=30.0)
    knowledge_redis_enabled: bool = False
    knowledge_redis_url: str = "redis://ai-assistant-redis:6379/0"
    knowledge_cache_prefix: str = "juxin:ai:knowledge"
    query_embedding_cache_ttl_seconds: int = Field(default=86400, ge=60, le=604800)
    vector_result_cache_ttl_seconds: int = Field(default=1800, ge=30, le=86400)
    knowledge_keyword_index_enabled: bool = False
    knowledge_keyword_index_dir: str = "/data/ai-assistant/keyword-index/current"

    # Desktop update publishing
    desktop_update_storage_dir: str = "/var/lib/juxin-ai-assistant/desktop-updates"
    desktop_update_max_bytes: int = Field(
        default=1_073_741_824,
        ge=1_048_576,
        le=2_147_483_648,
    )
    desktop_update_public_base_url: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("auth_public_url")
    @classmethod
    def validate_auth_public_url(cls, value: str) -> str:
        return normalize_auth_public_url(value)

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if len(self.ai_local_binding_secret) < 32:
            raise ValueError("AI_LOCAL_BINDING_SECRET 至少需要 32 个字符")
        if self.ai_local_binding_secret in {
            self.content_encryption_key,
            self.audit_hash_salt,
            self.prompt_center_runtime_token,
        }:
            raise ValueError("AI_LOCAL_BINDING_SECRET 必须使用独立密钥")
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
            if len(self.audit_hash_salt) < 32:
                raise ValueError("AUDIT_HASH_SALT 至少需要 32 个字符")
            if self.audit_hash_salt == self.content_encryption_key:
                raise ValueError("AUDIT_HASH_SALT 不得复用 CONTENT_ENCRYPTION_KEY")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def normalize_auth_public_url(raw: str) -> str:
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("AUTH_PUBLIC_URL 必须是安全的公开 Origin") from exc
    is_loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    is_allowed_scheme = parsed.scheme == "https" or (
        parsed.scheme == "http" and is_loopback
    )
    if (
        not is_allowed_scheme
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("AUTH_PUBLIC_URL 必须是安全的公开 Origin")
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    default_port = 443 if parsed.scheme == "https" else 80
    authority = host if port in {None, default_port} else f"{host}:{port}"
    return f"{parsed.scheme}://{authority}"
