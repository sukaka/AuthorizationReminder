from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信软件成分分析平台"
    app_env: str = "dev"
    app_version: str = "0.1.0"
    database_url: str = "sqlite:///./sca-dev.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    auth_service_url: str = "http://localhost:5180"
    auth_system_key: str = "sca"
    auth_cookie_name: str = "juxin_auth_token"
    auth_fetch_timeout_ms: int = 5000
    auth_dev_bypass: bool = False
    cors_origins: str = Field(default="http://localhost:18089,http://127.0.0.1:18089")
    upload_root: str = "/data/sca/uploads"
    upload_max_bytes: int = 200 * 1024 * 1024
    celery_task_always_eager: bool = False
    osv_api_url: str = "https://api.osv.dev"
    nvd_api_url: str = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    nvd_api_key: str = ""
    github_advisory_url: str = "https://api.github.com/advisories"
    github_token: str = ""
    vulnerability_fetch_timeout_ms: int = 8000
    report_root: str = "/data/sca/reports"
    sbom_root: str = "/data/sca/sbom"
    tool_syft_path: str = "syft"
    tool_trivy_path: str = "trivy"
    tool_grype_path: str = "grype"
    risk_monitor_interval_seconds: int = 6 * 60 * 60
    github_api_url: str = "https://api.github.com"
    maven_search_url: str = "https://search.maven.org/solrsearch/select"
    npm_registry_url: str = "https://registry.npmjs.org"
    pypi_api_url: str = "https://pypi.org/pypi"
    go_proxy_url: str = "https://proxy.golang.org"
    eol_api_url: str = "https://endoflife.date/api"
    notification_email_enabled: bool = False
    notification_email_to: str = ""
    openai_api_key: str = ""
    openai_api_url: str = "https://api.openai.com/v1/chat/completions"
    openai_model: str = "gpt-4o-mini"
    openai_timeout_ms: int = 30000

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
