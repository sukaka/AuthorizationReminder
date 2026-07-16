import base64
import binascii
import json
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


@dataclass(frozen=True)
class EncryptedPayload:
    ciphertext: bytes
    nonce: bytes


class ContentCipher:
    def __init__(self, encoded_key: str):
        normalized = str(encoded_key or "").strip()
        padded = normalized + ("=" * (-len(normalized) % 4))
        try:
            key = base64.urlsafe_b64decode(padded.encode("ascii"))
        except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
            raise ValueError("内容加密密钥必须是 32 字节") from exc
        if len(key) != 32:
            raise ValueError("内容加密密钥必须是 32 字节")
        self._cipher = AESGCM(key)

    def encrypt_json(
        self,
        value: dict[str, object],
        associated_data: bytes,
    ) -> EncryptedPayload:
        nonce = os.urandom(12)
        raw = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return EncryptedPayload(
            ciphertext=self._cipher.encrypt(nonce, raw, associated_data),
            nonce=nonce,
        )

    def decrypt_json(
        self,
        payload: EncryptedPayload,
        associated_data: bytes,
    ) -> dict[str, object]:
        raw = self._cipher.decrypt(
            payload.nonce,
            payload.ciphertext,
            associated_data,
        )
        return json.loads(raw.decode("utf-8"))

    def encrypt_bytes(
        self,
        value: bytes,
        associated_data: bytes,
    ) -> EncryptedPayload:
        """Encrypt bounded binary assets with the same authenticated key boundary."""
        if not isinstance(value, bytes):
            raise TypeError("加密内容必须是 bytes")
        nonce = os.urandom(12)
        return EncryptedPayload(
            ciphertext=self._cipher.encrypt(nonce, value, associated_data),
            nonce=nonce,
        )

    def decrypt_bytes(
        self,
        payload: EncryptedPayload,
        associated_data: bytes,
    ) -> bytes:
        return self._cipher.decrypt(
            payload.nonce,
            payload.ciphertext,
            associated_data,
        )
