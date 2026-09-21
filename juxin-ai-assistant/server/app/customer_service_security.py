"""HMAC authentication for the external customer-service API."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import hmac
import json
from typing import Any


CREDENTIAL_HEADER = "X-Juxin-Credential"
TIMESTAMP_HEADER = "X-Juxin-Timestamp"
SIGNATURE_HEADER = "X-Juxin-Signature"
SIGNATURE_VERSION = "v1"


@dataclass(frozen=True)
class CustomerServiceCredential:
    credential_id: str
    secret: str


class CustomerServiceSignatureError(ValueError):
    """Stable, non-sensitive reason for rejecting a signed request."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def parse_customer_service_credentials(raw: str) -> dict[str, CustomerServiceCredential]:
    text = str(raw or "").strip()
    if not text:
        raise CustomerServiceSignatureError("credentials_not_configured")
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise CustomerServiceSignatureError("credentials_config_invalid") from exc
    if not isinstance(parsed, dict) or not parsed or len(parsed) > 64:
        raise CustomerServiceSignatureError("credentials_config_invalid")

    credentials: dict[str, CustomerServiceCredential] = {}
    for credential_id, value in parsed.items():
        normalized_id = str(credential_id or "").strip()
        if (
            not normalized_id
            or len(normalized_id) > 64
            or normalized_id == "*"
            or normalized_id in credentials
        ):
            raise CustomerServiceSignatureError("credential_id_invalid")
        if not isinstance(value, dict):
            raise CustomerServiceSignatureError("credential_config_invalid")
        secret = str(value.get("secret") or "")
        if len(secret.encode("utf-8")) < 32:
            raise CustomerServiceSignatureError("credential_secret_invalid")
        credentials[normalized_id] = CustomerServiceCredential(
            credential_id=normalized_id,
            secret=secret,
        )
    return credentials


def resolve_customer_service_credential(
    raw: str,
    *,
    credential_id: str | None,
) -> CustomerServiceCredential:
    credential = parse_customer_service_credentials(raw).get(
        str(credential_id or "").strip()
    )
    if credential is None:
        raise CustomerServiceSignatureError("credential_not_allowed")
    return credential


def canonical_customer_service_payload(payload: Mapping[str, Any]) -> bytes:
    try:
        encoded = json.dumps(
            dict(payload),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise CustomerServiceSignatureError("payload_not_json") from exc
    return encoded.encode("utf-8")


def sign_customer_service_request(
    payload: Mapping[str, Any],
    *,
    secret: str,
    timestamp: int | None = None,
) -> tuple[str, str]:
    key = str(secret or "").encode("utf-8")
    if len(key) < 32:
        raise CustomerServiceSignatureError("signing_secret_not_configured")
    resolved_timestamp = int(
        timestamp if timestamp is not None else datetime.now(UTC).timestamp()
    )
    raw_timestamp = str(resolved_timestamp)
    signing_input = (
        raw_timestamp.encode("ascii")
        + b"."
        + canonical_customer_service_payload(payload)
    )
    digest = hmac.new(key, signing_input, hashlib.sha256).hexdigest()
    return raw_timestamp, f"{SIGNATURE_VERSION}={digest}"


def verify_customer_service_signature(
    payload: Mapping[str, Any],
    *,
    timestamp_header: str | None,
    signature_header: str | None,
    secret: str,
    now: datetime | None = None,
    tolerance_seconds: int = 300,
) -> None:
    key = str(secret or "").encode("utf-8")
    if len(key) < 32:
        raise CustomerServiceSignatureError("signing_secret_not_configured")

    raw_timestamp = str(timestamp_header or "").strip()
    if (
        not 1 <= len(raw_timestamp) <= 12
        or any(character not in "0123456789" for character in raw_timestamp)
    ):
        raise CustomerServiceSignatureError("timestamp_invalid")
    timestamp = int(raw_timestamp)
    current = (now or datetime.now(UTC)).astimezone(UTC)
    if abs(int(current.timestamp()) - timestamp) > max(1, int(tolerance_seconds)):
        raise CustomerServiceSignatureError("timestamp_out_of_window")

    supplied = str(signature_header or "").strip()
    version, separator, digest = supplied.partition("=")
    if separator != "=" or version != SIGNATURE_VERSION or len(digest) != 64:
        raise CustomerServiceSignatureError("signature_format_invalid")
    try:
        bytes.fromhex(digest)
    except ValueError as exc:
        raise CustomerServiceSignatureError("signature_format_invalid") from exc

    signing_input = (
        raw_timestamp.encode("ascii")
        + b"."
        + canonical_customer_service_payload(payload)
    )
    expected = hmac.new(key, signing_input, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, expected):
        raise CustomerServiceSignatureError("signature_invalid")
