import hashlib
import hmac
import re
from dataclasses import dataclass
from typing import Final, TypeAlias

from sqlalchemy.orm import Session

from .governance_models import AuditLog


JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]

ALLOWED_METADATA_KEYS: Final[frozenset[str]] = frozenset(
    {
        "task_uuid",
        "assistant_code",
        "generation_uuid",
        "prompt_external_id",
        "prompt_version",
        "status",
        "feedback_type",
        "event",
        "model_id",
        "provider",
        "latency_ms",
        "error_code",
        "setting_key",
        "suggestion_uuid",
        "record_count",
        "risk_confirmation",
        "from_version",
        "to_version",
    }
)
SENSITIVE_KEY_FRAGMENTS: Final[frozenset[str]] = frozenset(
    {
        "api_key",
        "authorization",
        "cookie",
        "token",
        "secret",
        "password",
        "credential",
        "input",
        "output",
        "prompt",
        "content",
        "body",
        "note",
        "message",
        "payload",
        "raw",
        "text",
    }
)
SENSITIVE_KEY_EXEMPTIONS: Final[frozenset[str]] = frozenset(
    {
        "prompt_external_id",
        "prompt_version",
    }
)
CAMEL_CASE_BOUNDARY: Final[re.Pattern[str]] = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])"
)
KEY_SEPARATOR: Final[re.Pattern[str]] = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True, slots=True)
class AuditActor:
    sso_user_id: str
    username: str


@dataclass(frozen=True, slots=True)
class AuditRequest:
    ip_address: str
    user_agent: str


@dataclass(frozen=True, slots=True)
class AuditEvent:
    action: str
    entity_type: str
    entity_uuid: str
    result: str
    metadata: dict[str, JsonValue]


def _normalized_key(key: str) -> str:
    separated = CAMEL_CASE_BOUNDARY.sub("_", key.strip())
    return KEY_SEPARATOR.sub("_", separated.casefold()).strip("_")


def _is_sensitive_key(key: str) -> bool:
    normalized = _normalized_key(key)
    if normalized in SENSITIVE_KEY_EXEMPTIONS:
        return False
    return any(
        fragment in normalized
        for fragment in SENSITIVE_KEY_FRAGMENTS
    )


def _remove_sensitive_fields(value: JsonValue) -> JsonValue:
    match value:
        case dict() as mapping:
            return {
                key: _remove_sensitive_fields(item)
                for key, item in mapping.items()
                if not _is_sensitive_key(key)
            }
        case list() as items:
            return [_remove_sensitive_fields(item) for item in items]
        case str() | int() | float() | bool() | None:
            return value


def sanitize_metadata(value: dict[str, JsonValue]) -> dict[str, JsonValue]:
    """Keep approved audit dimensions and recursively remove sensitive fields."""
    return {
        key: _remove_sensitive_fields(item)
        for key, item in value.items()
        if key in ALLOWED_METADATA_KEYS
        and not _is_sensitive_key(key)
    }


def stable_request_hash(value: str, salt: str) -> str:
    """Return a stable, keyed representation of a request attribute."""
    return hmac.new(
        salt.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def write_audit(
    db: Session,
    actor: AuditActor,
    request: AuditRequest,
    event: AuditEvent,
    *,
    hash_salt: str,
) -> AuditLog:
    """Add a body-free audit row to the caller-owned database transaction."""
    record = AuditLog(
        sso_user_id=actor.sso_user_id,
        username_snapshot=actor.username,
        action=event.action,
        entity_type=event.entity_type,
        entity_uuid=event.entity_uuid,
        result=event.result,
        metadata_json=sanitize_metadata(event.metadata),
        ip_hash=stable_request_hash(request.ip_address, hash_salt),
        user_agent_hash=stable_request_hash(request.user_agent, hash_salt),
    )
    db.add(record)
    return record
