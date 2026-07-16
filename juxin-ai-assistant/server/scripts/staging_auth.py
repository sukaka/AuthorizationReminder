"""Authentication headers for opt-in staging verification scripts."""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit


_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RELEASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _validate_header_value(name: str, value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise ValueError(f"{name}_missing")
    if "\r" in cleaned or "\n" in cleaned:
        raise ValueError(f"{name}_invalid")
    return cleaned


def normalize_release_id(
    release_id: str | None,
    *,
    required: bool = False,
) -> str | None:
    """Return one stable artifact correlation identity or fail closed."""

    cleaned = str(release_id or "").strip()
    if not cleaned:
        if required:
            raise ValueError("release_id_missing")
        return None
    if not _RELEASE_ID.fullmatch(cleaned):
        raise ValueError("release_id_invalid")
    return cleaned


def validate_bearer_transport(*, base_url: str, bearer_token_env: str = "") -> str:
    """Fail closed before a bearer token can be sent over an unsafe target.

    Local development keeps its existing HTTP/test-header path.  Once a
    bearer environment variable is selected, the target must be a complete
    HTTPS origin without URL user-info, so an operator cannot accidentally
    leak a staging credential over plaintext or embed credentials in a URL.
    """
    base = _validate_header_value("base_url", base_url).rstrip("/")
    if not bearer_token_env.strip():
        return base
    parsed = urlsplit(base)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ValueError("bearer_transport_requires_https")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("bearer_transport_userinfo_forbidden")
    return base


def build_headers(
    *,
    user_id: str,
    role: str,
    bearer_token_env: str = "",
) -> dict[str, str]:
    """Return test headers, or a bearer header when explicitly configured.

    The bearer value is read only from the named environment variable and is
    never included in script output.  Test headers retain local-dev backwards
    compatibility but are intentionally omitted for bearer-authenticated runs.
    """
    user_id = _validate_header_value("user_id", user_id)
    role = _validate_header_value("role", role)
    env_name = bearer_token_env.strip()
    if not env_name:
        return {"X-Test-User-ID": user_id, "X-Test-Role": role}
    if not _ENV_NAME.fullmatch(env_name):
        raise ValueError("bearer_token_env_invalid")
    token = os.environ.get(env_name, "").strip()
    if not token:
        raise ValueError(f"bearer_token_env_missing:{env_name}")
    if "\r" in token or "\n" in token:
        raise ValueError("bearer_token_invalid")
    return {"Authorization": f"Bearer {token}"}
