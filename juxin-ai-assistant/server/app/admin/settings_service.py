import re
from typing import Final

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..governance_models import SystemSetting
from .errors import GovernanceError
from .schemas import JsonScalar, SettingsUpdateIn


ALLOWED_SETTING_KEYS: Final[frozenset[str]] = frozenset(
    {
        "global_safety_notice",
        "sensitive_detection_enabled",
        "history_retention_days",
        "knowledge_limit",
        "default_temperature",
        "support_contact",
    }
)
SECRET_LIKE_KEY: Final[re.Pattern[str]] = re.compile(
    r"key|token|secret|password|credential",
    re.IGNORECASE,
)


def _validate_keys(keys: set[str]) -> None:
    invalid = {
        key
        for key in keys
        if key not in ALLOWED_SETTING_KEYS or SECRET_LIKE_KEY.search(key)
    }
    if invalid:
        raise GovernanceError(
            422,
            "SETTING_KEY_NOT_ALLOWED",
            "包含不允许的系统设置键",
        )


def list_settings(db: Session) -> dict[str, JsonScalar]:
    rows = db.scalars(
        select(SystemSetting)
        .where(SystemSetting.status == "ACTIVE")
        .order_by(SystemSetting.setting_key)
    ).all()
    return {
        row.setting_key: row.value_json.get("value")
        for row in rows
    }


def update_settings(
    db: Session,
    body: SettingsUpdateIn,
    actor_id: str,
) -> dict[str, JsonScalar]:
    values = body.root
    _validate_keys(set(values))
    existing = {
        row.setting_key: row
        for row in db.scalars(
            select(SystemSetting).where(
                SystemSetting.setting_key.in_(list(values))
            )
        ).all()
    }
    for key, value in values.items():
        row = existing.get(key)
        if row is None:
            row = SystemSetting(
                setting_key=key,
                value_json={"value": value},
                status="ACTIVE",
                created_by=actor_id,
                updated_by=actor_id,
            )
            db.add(row)
        else:
            row.value_json = {"value": value}
            row.status = "ACTIVE"
            row.updated_by = actor_id
    db.flush()
    return list_settings(db)
