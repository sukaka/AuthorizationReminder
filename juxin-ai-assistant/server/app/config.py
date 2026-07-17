import base64
import binascii
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信 AI 助手"
    app_version: str = "5.1.0"
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
    # Controlled workflow adapters may opt into a signed, non-SSO event
    # ingress.  ``disabled`` keeps the endpoint fail-closed by default.
    workflow_event_signature_mode: str = "disabled"
    # JSON object: credential id -> secret + owner_user_ids + optional
    # project_ids.  Deployment mode requires this explicit scope map.
    workflow_event_signature_credentials: str = ""
    workflow_event_signature_secret: str = ""
    workflow_event_signature_tolerance_seconds: int = Field(default=300, ge=1, le=3600)
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

    # WeChat Official Account external H5. Secrets are injected at deployment.
    wechat_external_enabled: bool = False
    wechat_official_account_app_id: str = ""
    wechat_official_account_app_secret: str = ""
    wechat_oauth_redirect_uri: str = ""
    wechat_external_h5_origin: str = ""
    wechat_external_session_secret: str = ""
    wechat_openid_hash_salt: str = ""
    wechat_external_redis_prefix: str = "juxin:ai:wechat-external"
    wechat_external_hourly_question_limit: int = Field(default=15, ge=1, le=100)
    wechat_external_daily_question_limit: int = Field(default=30, ge=1, le=500)
    wechat_external_download_token_ttl_seconds: int = Field(default=300, ge=60, le=3600)
    wechat_external_model_max_output_tokens: int = Field(default=1200, ge=64, le=8192)

    # WeCom customer service (微信客服). Secrets are injected at deployment.
    wecom_kf_enabled: bool = False
    wecom_kf_corp_id: str = ""
    wecom_kf_secret: str = ""
    wecom_kf_token: str = ""
    wecom_kf_encoding_aes_key: str = ""
    wecom_kf_identity_hash_salt: str = ""

    # Internal WeCom app used only to notify configured support staff.
    wecom_corp_id: str = ""
    wecom_secret: str = ""
    wecom_agent_id: str = ""
    external_support_notify_user_ids: str = ""

    # 7.0 vendor connectors (optional — empty = dry-run in Agent Hub)
    kimi_api_key: str = ""
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model: str = "moonshot-v1-8k"
    jimeng_api_key: str = ""
    jimeng_endpoint: str = ""

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
        signature_mode = self.workflow_event_signature_mode.strip().lower()
        if signature_mode not in {"disabled", "required"}:
            raise ValueError(
                "WORKFLOW_EVENT_SIGNATURE_MODE 必须是 disabled 或 required"
            )
        self.workflow_event_signature_mode = signature_mode
        if signature_mode == "required":
            if self.workflow_event_signature_credentials.strip():
                # Parse the scope map during startup so malformed JSON or an
                # empty owner allowlist cannot enable a partially configured
                # ingress.  Import lazily to keep config utilities light.
                from .workflow_event_security import (
                    WorkflowEventSignatureError,
                    parse_workflow_event_credentials,
                )

                try:
                    parse_workflow_event_credentials(
                        self.workflow_event_signature_credentials
                    )
                except WorkflowEventSignatureError as exc:
                    raise ValueError(
                        f"WORKFLOW_EVENT_SIGNATURE_CREDENTIALS 配置无效: {exc.code}"
                    ) from exc
            elif len(self.workflow_event_signature_secret) < 32:
                raise ValueError(
                    "WORKFLOW_EVENT_SIGNATURE_CREDENTIALS 必须配置；"
                    "仅开发 bypass 可使用 WORKFLOW_EVENT_SIGNATURE_SECRET"
                )
            elif not self.auth_dev_bypass:
                raise ValueError(
                    "生产 signed event 必须配置 WORKFLOW_EVENT_SIGNATURE_CREDENTIALS"
                )
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
        if self.wechat_external_enabled:
            required = {
                "WECHAT_OFFICIAL_ACCOUNT_APP_ID": self.wechat_official_account_app_id,
                "WECHAT_OFFICIAL_ACCOUNT_APP_SECRET": self.wechat_official_account_app_secret,
                "WECHAT_OAUTH_REDIRECT_URI": self.wechat_oauth_redirect_uri,
                "WECHAT_EXTERNAL_H5_ORIGIN": self.wechat_external_h5_origin,
                "WECHAT_EXTERNAL_SESSION_SECRET": self.wechat_external_session_secret,
                "WECHAT_OPENID_HASH_SALT": self.wechat_openid_hash_salt,
            }
            missing = [name for name, value in required.items() if not value.strip()]
            if missing:
                raise ValueError(f"公众号外部访问缺少配置: {', '.join(missing)}")
            if not self.knowledge_redis_enabled:
                raise ValueError("公众号外部访问要求 KNOWLEDGE_REDIS_ENABLED=true")
            if len(self.wechat_external_session_secret) < 32:
                raise ValueError("WECHAT_EXTERNAL_SESSION_SECRET 至少需要 32 个字符")
            if len(self.wechat_openid_hash_salt) < 32:
                raise ValueError("WECHAT_OPENID_HASH_SALT 至少需要 32 个字符")
            if not self.wechat_oauth_redirect_uri.startswith("https://"):
                raise ValueError("WECHAT_OAUTH_REDIRECT_URI 必须使用 HTTPS")
            if not self.wechat_external_h5_origin.startswith("https://"):
                raise ValueError("WECHAT_EXTERNAL_H5_ORIGIN 必须使用 HTTPS")
        if self.wecom_kf_enabled:
            required = {
                "WECOM_KF_CORP_ID": self.wecom_kf_corp_id,
                "WECOM_KF_SECRET": self.wecom_kf_secret,
                "WECOM_KF_TOKEN": self.wecom_kf_token,
                "WECOM_KF_ENCODING_AES_KEY": self.wecom_kf_encoding_aes_key,
                "WECOM_KF_IDENTITY_HASH_SALT": self.wecom_kf_identity_hash_salt,
            }
            missing = [name for name, value in required.items() if not value.strip()]
            if missing:
                raise ValueError(f"微信客服缺少配置: {', '.join(missing)}")
            if not self.knowledge_redis_enabled:
                raise ValueError("微信客服要求 KNOWLEDGE_REDIS_ENABLED=true")
            if len(self.wecom_kf_identity_hash_salt) < 32:
                raise ValueError("WECOM_KF_IDENTITY_HASH_SALT 至少需要 32 个字符")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        origins = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        h5_origin = self.wechat_external_h5_origin.strip().rstrip("/")
        if self.wechat_external_enabled and h5_origin and h5_origin not in origins:
            origins.append(h5_origin)
        return origins


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
