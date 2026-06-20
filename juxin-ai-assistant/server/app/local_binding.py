import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Final

from pydantic import BaseModel, ConfigDict, ValidationError


LOCAL_BINDING_AUDIENCE: Final = "juxin-ai-assistant-local"
LOCAL_BINDING_TTL_SECONDS: Final = 120
LOCAL_BINDING_CLOCK_SKEW_SECONDS: Final = 15


@dataclass(frozen=True, slots=True)
class LocalBindingTokenError(Exception):
    """Raised when a local binding token cannot establish an identity."""


class LocalBindingClaims(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    sub: str
    aud: str
    iat: int
    exp: int


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padded = value + ("=" * (-len(value) % 4))
    return base64.b64decode(
        padded.encode("ascii"),
        altchars=b"-_",
        validate=True,
    )


def issue_local_binding_token(user_id: str, secret: str, now: int | None = None) -> str:
    issued_at = int(time.time()) if now is None else now
    claims = LocalBindingClaims(
        sub=user_id,
        aud=LOCAL_BINDING_AUDIENCE,
        iat=issued_at,
        exp=issued_at + LOCAL_BINDING_TTL_SECONDS,
    )
    header = _encode(b'{"alg":"HS256","typ":"JWT"}')
    payload = _encode(claims.model_dump_json().encode("utf-8"))
    signing_input = f"{header}.{payload}"
    signature = _encode(hmac.new(
        secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest())
    return f"{signing_input}.{signature}"


def verify_local_binding_token(token: str, secret: str, now: int | None = None) -> str:
    try:
        header_segment, payload_segment, signature_segment = token.split(".")
        header = json.loads(_decode(header_segment))
        claims = LocalBindingClaims.model_validate_json(_decode(payload_segment))
        supplied_signature = _decode(signature_segment)
    except (
        ValueError,
        UnicodeEncodeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
        ValidationError,
    ) as exc:
        raise LocalBindingTokenError from exc

    if header != {"alg": "HS256", "typ": "JWT"}:
        raise LocalBindingTokenError
    signing_input = f"{header_segment}.{payload_segment}"
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise LocalBindingTokenError

    current_time = int(time.time()) if now is None else now
    valid_lifetime = 0 < claims.exp - claims.iat <= LOCAL_BINDING_TTL_SECONDS
    valid_time = (
        claims.iat <= current_time + LOCAL_BINDING_CLOCK_SKEW_SECONDS
        and claims.exp > current_time
    )
    valid_subject = bool(claims.sub.strip()) and len(claims.sub) <= 160
    if claims.aud != LOCAL_BINDING_AUDIENCE or not valid_lifetime or not valid_time or not valid_subject:
        raise LocalBindingTokenError
    return claims.sub
