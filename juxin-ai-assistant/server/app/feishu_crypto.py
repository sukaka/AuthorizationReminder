"""Feishu event encrypt/decrypt helpers (AES-256-CBC).

Compatible with Feishu open platform Encrypt Key scheme:
  key = SHA256(encrypt_key)
  ciphertext = base64( random_16 | msg | pad )
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any


def _pkcs7_unpad(data: bytes) -> bytes:
    if not data:
        raise ValueError("empty_ciphertext")
    pad = data[-1]
    if pad < 1 or pad > 32:
        raise ValueError("bad_padding")
    if data[-pad:] != bytes([pad]) * pad:
        raise ValueError("bad_padding")
    return data[:-pad]


def decrypt_feishu_encrypt(encrypt_key: str, encrypt_b64: str) -> bytes:
    """Decrypt Feishu `encrypt` field to raw plaintext bytes."""
    key = hashlib.sha256(encrypt_key.encode("utf-8")).digest()
    raw = base64.b64decode(encrypt_b64)
    if len(raw) < 16:
        raise ValueError("ciphertext_too_short")
    # Prefer cryptography lib (already a project dependency)
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("cryptography_required") from exc

    iv = raw[:16]
    encrypted = raw[16:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(encrypted) + decryptor.finalize()
    return _pkcs7_unpad(padded)


def decrypt_feishu_payload(encrypt_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """If payload contains encrypt field, decrypt and return JSON object.

    Unencrypted payloads are returned unchanged.
    """
    encrypt_b64 = payload.get("encrypt")
    if not encrypt_b64:
        return payload
    if not encrypt_key:
        raise ValueError("feishu_encrypt_key_missing")
    plain = decrypt_feishu_encrypt(str(encrypt_key), str(encrypt_b64))
    # Feishu plaintext may include 16-byte random prefix before JSON in some versions;
    # try JSON parse from first brace.
    text = plain.decode("utf-8", errors="replace")
    brace = text.find("{")
    if brace > 0:
        text = text[brace:]
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("decrypted_not_object")
    return data


def encrypt_feishu_for_test(encrypt_key: str, obj: dict[str, Any]) -> str:
    """Test helper: produce encrypt field for unit tests."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    import os

    key = hashlib.sha256(encrypt_key.encode("utf-8")).digest()
    iv = os.urandom(16)
    plain = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    pad_len = 16 - (len(plain) % 16)
    padded = plain + bytes([pad_len]) * pad_len
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(iv + encrypted).decode("ascii")
