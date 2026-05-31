from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .config import Settings


def production_config(settings: Settings) -> dict:
    return {
        "https_enabled": settings.production_https_enabled,
        "jwt_secure": settings.production_jwt_secure,
        "reverse_proxy": "nginx",
        "backup_root": settings.backup_root,
        "optimizations": [
            "postgresql",
            "redis",
            "nginx",
            "celery",
        ],
        "monitoring": ["health/ready", "docker logs", "backup job records", "reverse proxy access log"],
    }


def plan_backup_path(settings: Settings, scope: str) -> str:
    root = Path(settings.backup_root)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return str(root / f"sca-{scope}-{timestamp}.backup")
