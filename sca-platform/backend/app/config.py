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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
