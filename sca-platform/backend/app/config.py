from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "聚信软件成分分析平台"
    app_env: str = "dev"
    app_version: str = "5.68.0"
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
    upload_chunk_max_bytes: int = 16 * 1024 * 1024
    archive_max_files: int = 20000
    archive_max_total_bytes: int = 4 * 1024 * 1024 * 1024
    archive_max_file_bytes: int = 512 * 1024 * 1024
    archive_max_compression_ratio: float = 200.0
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
    opensca_enabled: bool = True
    opensca_path: str = "/usr/local/bin/opensca"
    opensca_timeout: int = 900
    opensca_output_dir: str = "/data/scanner-results/opensca"
    syft_enabled: bool = True
    syft_path: str = "/usr/local/bin/syft"
    syft_timeout: int = 1800
    syft_output_dir: str = "/data/scanner-results/syft"
    syft_default_formats: str = "cyclonedx-json,spdx-json"
    trivy_enabled: bool = True
    trivy_path: str = "/usr/local/bin/trivy"
    trivy_timeout: int = 3600
    trivy_command_timeout: str = "30m"
    trivy_db_repositories: str = "ghcr.io/aquasecurity/trivy-db:2,public.ecr.aws/aquasecurity/trivy-db:2,mirror.gcr.io/aquasec/trivy-db:2"
    trivy_skip_db_update_on_cache: bool = True
    trivy_cache_dir: str = "/data/trivy-cache"
    trivy_output_dir: str = "/data/scanner-results/trivy"
    dependency_track_enabled: bool = True
    dependency_track_url: str = "http://dependency-track-apiserver:8080"
    dependency_track_api_key: str = ""
    dependency_track_timeout: int = 1800
    dependency_track_auto_create_project: bool = True
    dependency_track_upload_bom: bool = True
    dependency_track_fetch_findings: bool = True
    multi_engine_merge_enabled: bool = True
    low_confidence_auto_review: bool = True
    save_raw_reports: bool = True
    risk_monitor_interval_seconds: int = 6 * 60 * 60
    github_api_url: str = "https://api.github.com"
    maven_search_url: str = "https://search.maven.org/solrsearch/select"
    maven_repository_url: str = "https://repo1.maven.org/maven2"
    npm_registry_url: str = "https://registry.npmjs.org"
    pypi_api_url: str = "https://pypi.org/pypi"
    go_proxy_url: str = "https://proxy.golang.org"
    license_enrichment_enabled: bool = True
    license_enrichment_timeout_ms: int = 120000
    eol_api_url: str = "https://endoflife.date/api"
    notification_email_enabled: bool = False
    notification_email_to: str = ""
    openai_api_key: str = ""
    openai_api_url: str = "https://api.openai.com/v1/chat/completions"
    openai_model: str = "gpt-4o-mini"
    openai_timeout_ms: int = 120000
    devops_block_severities: str = "critical,high"
    sca_webhook_secret: str = ""
    github_webhook_secret: str = ""
    gitlab_webhook_secret: str = ""
    jenkins_webhook_secret: str = ""
    remediation_overdue_check_seconds: int = 60 * 60
    production_https_enabled: bool = True
    production_jwt_secure: bool = True
    backup_root: str = "/data/sca/backups"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
