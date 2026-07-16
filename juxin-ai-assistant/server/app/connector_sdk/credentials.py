"""Credential helpers — mask for logs; encrypt at rest via ContentCipher."""

from __future__ import annotations

import base64
import re
from typing import Any

from ..crypto import ContentCipher, EncryptedPayload

_SECRET_HINT = re.compile(
    r"(api[_-]?key|token|secret|password|authorization|bearer|private[_-]?key)",
    re.I,
)


def mask_secret(value: str, *, visible: int = 4) -> str:
    """Mask a secret for logs/UI. Empty → empty; short → ****."""
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= visible * 2:
        return "*" * min(8, len(text))
    return f"{text[:visible]}…{'*' * 4}…{text[-visible:]}"


def redact_mapping(data: dict[str, Any], *, depth: int = 0) -> dict[str, Any]:
    """Recursively mask values whose keys look like secrets."""
    if depth > 6:
        return {"_truncated": True}
    out: dict[str, Any] = {}
    for key, value in data.items():
        k = str(key)
        if _SECRET_HINT.search(k) and isinstance(value, str):
            out[k] = mask_secret(value)
        elif isinstance(value, dict):
            out[k] = redact_mapping(value, depth=depth + 1)
        elif isinstance(value, list):
            out[k] = [
                redact_mapping(v, depth=depth + 1) if isinstance(v, dict) else v
                for v in value[:50]
            ]
        else:
            out[k] = value
    return out


class CredentialVault:
    """Thin vault over AES-GCM ContentCipher (per-deployment key)."""

    def __init__(self, encoded_key: str) -> None:
        self._cipher = ContentCipher(encoded_key)

    def seal(self, secrets: dict[str, object], *, aad: str = "agent-credential") -> dict[str, str]:
        payload = self._cipher.encrypt_json(secrets, aad.encode("utf-8"))
        return {
            "nonce_b64": base64.urlsafe_b64encode(payload.nonce).decode("ascii"),
            "ciphertext_b64": base64.urlsafe_b64encode(payload.ciphertext).decode("ascii"),
            "aad": aad,
        }

    def open(self, sealed: dict[str, str]) -> dict[str, object]:
        nonce = base64.urlsafe_b64decode(sealed["nonce_b64"].encode("ascii"))
        ciphertext = base64.urlsafe_b64decode(sealed["ciphertext_b64"].encode("ascii"))
        aad = (sealed.get("aad") or "agent-credential").encode("utf-8")
        return self._cipher.decrypt_json(
            EncryptedPayload(ciphertext=ciphertext, nonce=nonce),
            aad,
        )
