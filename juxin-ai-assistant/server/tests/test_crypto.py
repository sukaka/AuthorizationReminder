import base64

import pytest
from cryptography.exceptions import InvalidTag

from app.crypto import ContentCipher


TEST_KEY = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")


def test_content_cipher_round_trips_json_without_plaintext_leakage() -> None:
    cipher = ContentCipher(TEST_KEY)
    value = {"input": "完成统一登录接入", "count": 3}
    associated_data = b"generation-uuid"

    first = cipher.encrypt_json(value, associated_data)
    second = cipher.encrypt_json(value, associated_data)

    assert "完成统一登录接入".encode() not in first.ciphertext
    assert len(first.nonce) == 12
    assert first.nonce != second.nonce
    assert first.ciphertext != second.ciphertext
    assert cipher.decrypt_json(first, associated_data) == value


def test_content_cipher_rejects_wrong_associated_data() -> None:
    cipher = ContentCipher(TEST_KEY)
    encrypted = cipher.encrypt_json({"output": "结果"}, b"generation-a")

    with pytest.raises(InvalidTag):
        cipher.decrypt_json(encrypted, b"generation-b")


def test_content_cipher_requires_exactly_32_key_bytes() -> None:
    short_key = base64.urlsafe_b64encode(b"short").decode("ascii")

    with pytest.raises(ValueError, match="32 字节"):
        ContentCipher(short_key)
