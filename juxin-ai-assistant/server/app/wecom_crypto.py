"""WeCom (企业微信) callback signature + AES message crypto (WXBizMsgCrypt-compatible)."""

from __future__ import annotations

import base64
import hmac
import hashlib
import struct
import xml.etree.ElementTree as ET
from typing import Any


def _pkcs7_pad(data: bytes, block: int = 32) -> bytes:
    pad = block - (len(data) % block)
    return data + bytes([pad]) * pad


def _pkcs7_unpad(data: bytes) -> bytes:
    if not data:
        raise ValueError("empty")
    pad = data[-1]
    if pad < 1 or pad > 32:
        raise ValueError("bad_padding")
    return data[:-pad]


def encoding_aes_key_to_bytes(encoding_aes_key: str) -> bytes:
    key = (encoding_aes_key or "").strip()
    # Official EncodingAESKey is 43 chars; pad to base64
    padded = key + ("=" * ((4 - len(key) % 4) % 4))
    raw = base64.b64decode(padded)
    if len(raw) != 32:
        raise ValueError("encoding_aes_key_must_decode_to_32_bytes")
    return raw


def wecom_signature(token: str, timestamp: str, nonce: str, encrypt: str) -> str:
    items = sorted([str(token), str(timestamp), str(nonce), str(encrypt)])
    return hashlib.sha1("".join(items).encode("utf-8")).hexdigest()


def verify_wecom_signature(
    *,
    token: str,
    timestamp: str,
    nonce: str,
    encrypt: str,
    msg_signature: str,
) -> bool:
    if not token or not msg_signature:
        return False
    return hmac.compare_digest(wecom_signature(token, timestamp, nonce, encrypt), msg_signature)


def _verify_encrypted_callback(
    *, token: str, timestamp: str, nonce: str, encrypt: str, msg_signature: str
) -> None:
    if not token or not timestamp or not nonce or not msg_signature:
        raise ValueError("missing_signature")
    if not verify_wecom_signature(
        token=token,
        timestamp=timestamp,
        nonce=nonce,
        encrypt=encrypt,
        msg_signature=msg_signature,
    ):
        raise ValueError("bad_signature")


def decrypt_wecom_message(
    *,
    encoding_aes_key: str,
    corp_id: str,
    encrypt_b64: str,
) -> str:
    """Decrypt WeCom Encrypt field → plaintext XML/text."""
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    aes_key = encoding_aes_key_to_bytes(encoding_aes_key)
    iv = aes_key[:16]
    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    raw = base64.b64decode(encrypt_b64)
    plain = _pkcs7_unpad(decryptor.update(raw) + decryptor.finalize())
    # random(16) + msg_len(4 network order) + msg + receiveid
    if len(plain) < 20:
        raise ValueError("plaintext_too_short")
    msg_len = struct.unpack("!I", plain[16:20])[0]
    msg = plain[20 : 20 + msg_len]
    receive_id = plain[20 + msg_len :].decode("utf-8", errors="replace")
    if corp_id and receive_id and receive_id != corp_id:
        # Some callbacks use suite id; only warn by raising when both set and mismatch hard
        if receive_id != corp_id:
            raise ValueError(f"receive_id_mismatch:{receive_id}")
    return msg.decode("utf-8")


def encrypt_wecom_message(
    *,
    encoding_aes_key: str,
    corp_id: str,
    plaintext: str,
) -> str:
    """Test helper / reply encrypt."""
    import os

    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    aes_key = encoding_aes_key_to_bytes(encoding_aes_key)
    iv = aes_key[:16]
    random = os.urandom(16)
    msg = plaintext.encode("utf-8")
    body = random + struct.pack("!I", len(msg)) + msg + corp_id.encode("utf-8")
    padded = _pkcs7_pad(body, 32)
    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(encrypted).decode("ascii")


def parse_wecom_xml(xml_text: str) -> dict[str, str]:
    root = ET.fromstring(xml_text)
    out: dict[str, str] = {}
    for child in root:
        out[child.tag] = (child.text or "").strip()
    return out


def extract_wecom_inbound(
    *,
    body: str,
    content_type: str,
    token: str,
    encoding_aes_key: str,
    corp_id: str,
    msg_signature: str = "",
    timestamp: str = "",
    nonce: str = "",
) -> dict[str, Any]:
    """Normalize inbound JSON/XML (plain or encrypted) to dict for ChannelGateway."""
    ct = (content_type or "").lower()
    if "json" in ct:
        import json

        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError("invalid_json")
        encrypt = str(data.get("Encrypt") or data.get("encrypt") or "")
        if encrypt:
            _verify_encrypted_callback(
                token=token, timestamp=timestamp, nonce=nonce,
                encrypt=encrypt, msg_signature=msg_signature,
            )
            plain = decrypt_wecom_message(
                encoding_aes_key=encoding_aes_key,
                corp_id=corp_id,
                encrypt_b64=encrypt,
            )
            # plain may be XML
            if plain.lstrip().startswith("<"):
                return parse_wecom_xml(plain)
            return {"Content": plain}
        return data

    # XML path
    fields = parse_wecom_xml(body)
    encrypt = fields.get("Encrypt") or ""
    if encrypt and encoding_aes_key:
        _verify_encrypted_callback(
            token=token, timestamp=timestamp, nonce=nonce,
            encrypt=encrypt, msg_signature=msg_signature,
        )
        plain = decrypt_wecom_message(
            encoding_aes_key=encoding_aes_key,
            corp_id=corp_id,
            encrypt_b64=encrypt,
        )
        if plain.lstrip().startswith("<"):
            return parse_wecom_xml(plain)
        return {"Content": plain}
    return fields
