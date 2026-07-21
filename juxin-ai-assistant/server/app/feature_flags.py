"""Simple gray-release feature flags store (file-backed, admin writable)."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

_lock = threading.Lock()
_DEFAULTS: dict[str, Any] = {
    "langgraph_runtime": False,
    "langgraph_runtime_mode": "shadow",
    "hybrid_retrieve_preferred": True,
    "multi_agent_complex_tasks": True,
    "learning_auto_publish": False,
    "channel_async_run": False,
    "channel_durable_jobs": True,
    "channel_drain_interval_seconds": 30,
    "channel_drain_batch": 10,
    # The workflow control worker is opt-in until a local operator enables it.
    # It never contacts an external provider; notifications use the local sink.
    "workflow_control_worker": False,
    "workflow_worker_interval_seconds": 5,
    "workflow_worker_batch": 20,
    "role_assistant_model_polish": True,
    "channels": {
        "web": True,
        "desktop": True,
        "feishu": False,
        "wecom": False,
        "wecom_kf": False,
    },
    "export_formats": ["docx", "xlsx", "pptx", "pdf", "md"],
    "rollout_percent": 100,
    "runtime_shadow_enabled": False,
    "runtime_shadow_sample_percent": 0,
    "runtime_shadow_max_mismatch_percent": 0,
}

_BOOL_KEYS = {
    "langgraph_runtime",
    "hybrid_retrieve_preferred",
    "multi_agent_complex_tasks",
    "learning_auto_publish",
    "channel_async_run",
    "channel_durable_jobs",
    "workflow_control_worker",
    "role_assistant_model_polish",
    "runtime_shadow_enabled",
}
_PERCENT_KEYS = {"rollout_percent", "runtime_shadow_sample_percent", "runtime_shadow_max_mismatch_percent"}
_CHANNEL_KEYS = set(_DEFAULTS["channels"])
_LANGGRAPH_RUNTIME_MODES = {"shadow", "real"}
_CHANNEL_ENV_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    "wecom": (
        ("WECOM_CORP_ID", "wecom_corp_id"),
        ("WECOM_SECRET", "wecom_secret"),
        ("WECOM_TOKEN", "wecom_token"),
        ("WECOM_ENCODING_AES_KEY", "wecom_encoding_aes_key"),
        ("WECOM_AGENT_ID", "wecom_agent_id"),
    ),
    "wecom_kf": (
        ("WECOM_KF_CORP_ID", "wecom_kf_corp_id"),
        ("WECOM_KF_SECRET", "wecom_kf_secret"),
        ("WECOM_KF_TOKEN", "wecom_kf_token"),
        ("WECOM_KF_ENCODING_AES_KEY", "wecom_kf_encoding_aes_key"),
        ("WECOM_KF_IDENTITY_HASH_SALT", "wecom_kf_identity_hash_salt"),
    ),
}
_CHANNEL_LABELS = {"wecom": "企业微信", "wecom_kf": "企业微信客服"}


def _store_path(settings=None) -> Path:
    base = Path("./storage")
    if settings is not None:
        base = Path(getattr(settings, "knowledge_storage_dir", None) or "./storage")
    base.mkdir(parents=True, exist_ok=True)
    return base / "feature_flags.json"


def _validate_value(key: str, value: Any) -> None:
    if key in _BOOL_KEYS and not isinstance(value, bool):
        raise ValueError(f"{key} must be boolean")
    if key in _PERCENT_KEYS:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise ValueError(f"{key} must be between 0 and 100")
    if key in {
        "channel_drain_interval_seconds",
        "channel_drain_batch",
        "workflow_worker_interval_seconds",
        "workflow_worker_batch",
    }:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 3600:
            raise ValueError(f"{key} must be a positive integer")
    if key == "channels":
        if not isinstance(value, dict) or any(name not in _CHANNEL_KEYS or not isinstance(enabled, bool) for name, enabled in value.items()):
            raise ValueError("channels must contain known boolean flags")
    if key == "export_formats":
        if not isinstance(value, list) or any(not isinstance(fmt, str) or fmt not in _DEFAULTS["export_formats"] for fmt in value):
            raise ValueError("export_formats contains an unsupported format")
    if key == "langgraph_runtime_mode" and value not in _LANGGRAPH_RUNTIME_MODES:
        raise ValueError("langgraph_runtime_mode must be 'shadow' or 'real'")


def _sanitize(data: dict[str, Any]) -> dict[str, Any]:
    merged = dict(_DEFAULTS)
    for key, value in data.items():
        if key == "channels" and isinstance(value, dict):
            channels = dict(_DEFAULTS["channels"])
            for channel, enabled in value.items():
                if channel in _CHANNEL_KEYS and isinstance(enabled, bool):
                    channels[channel] = enabled
            merged["channels"] = channels
            continue
        if key in _BOOL_KEYS | _PERCENT_KEYS | {
            "channel_drain_interval_seconds",
            "channel_drain_batch",
            "workflow_worker_interval_seconds",
            "workflow_worker_batch",
            "export_formats",
            "langgraph_runtime_mode",
        }:
            try:
                _validate_value(key, value)
            except ValueError:
                continue
        merged[key] = value
    return merged


def load_feature_flags(settings=None) -> dict[str, Any]:
    path = _store_path(settings)
    with _lock:
        if not path.exists():
            return dict(_DEFAULTS)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return dict(_DEFAULTS)
            return _sanitize(data)
        except Exception:
            return dict(_DEFAULTS)


def channel_enabled(settings, channel: str) -> bool:
    """Return the live file-backed channel switch without exposing credentials."""
    channels = load_feature_flags(settings).get("channels") or {}
    return bool(channels.get(channel, False)) if isinstance(channels, dict) else False


def channel_configuration(settings, channel: str) -> dict[str, Any]:
    """Return only configuration readiness and safe environment-variable names."""
    missing = [
        env_name
        for env_name, field_name in _CHANNEL_ENV_FIELDS.get(channel, ())
        if not str(getattr(settings, field_name, "") or "").strip()
    ]
    if channel == "wecom":
        encoding_key = str(getattr(settings, "wecom_encoding_aes_key", "") or "").strip()
        if encoding_key and len(encoding_key) != 43:
            missing.append("WECOM_ENCODING_AES_KEY")
    elif channel == "wecom_kf":
        encoding_key = str(getattr(settings, "wecom_kf_encoding_aes_key", "") or "").strip()
        if encoding_key and len(encoding_key) != 43:
            missing.append("WECOM_KF_ENCODING_AES_KEY")
        identity_salt = str(getattr(settings, "wecom_kf_identity_hash_salt", "") or "")
        if identity_salt and len(identity_salt) < 32:
            missing.append("WECOM_KF_IDENTITY_HASH_SALT")
        if not bool(getattr(settings, "knowledge_redis_enabled", False)):
            missing.append("KNOWLEDGE_REDIS_ENABLED")
    unique_missing = list(dict.fromkeys(missing))
    return {"configured": not unique_missing, "missing": unique_missing}


def channel_configuration_summary(settings) -> dict[str, dict[str, Any]]:
    return {
        channel: channel_configuration(settings, channel)
        for channel in _CHANNEL_ENV_FIELDS
    }


def validate_channel_enable_updates(updates: dict[str, Any], settings) -> None:
    channels = updates.get("channels")
    if not isinstance(channels, dict):
        return
    for channel, enabled in channels.items():
        if channel not in _CHANNEL_ENV_FIELDS or enabled is not True:
            continue
        configuration = channel_configuration(settings, channel)
        if configuration["configured"]:
            continue
        missing = ", ".join(configuration["missing"])
        label = _CHANNEL_LABELS[channel]
        raise ValueError(
            f"{label}缺少或存在无效的 .env 配置：{missing}；修改 .env 后请重启 API"
        )


def save_feature_flags(updates: dict[str, Any], settings=None) -> dict[str, Any]:
    if not isinstance(updates, dict):
        raise ValueError("feature flags must be an object")
    for key, value in updates.items():
        if key == "channels" and isinstance(value, dict):
            _validate_value(key, value)
        elif key in _BOOL_KEYS | _PERCENT_KEYS | {
            "channel_drain_interval_seconds",
            "channel_drain_batch",
            "workflow_worker_interval_seconds",
            "workflow_worker_batch",
            "export_formats",
            "langgraph_runtime_mode",
        }:
            _validate_value(key, value)
    current = load_feature_flags(settings)
    for key, value in (updates or {}).items():
        if key == "channels" and isinstance(value, dict) and isinstance(current.get("channels"), dict):
            channels = dict(current["channels"])
            channels.update(value)
            current["channels"] = channels
        else:
            current[key] = value
    current = _sanitize(current)
    # safety: never auto-publish learning by accidental true without explicit key
    if "learning_auto_publish" not in (updates or {}):
        current["learning_auto_publish"] = False
    path = _store_path(settings)
    with _lock:
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current
