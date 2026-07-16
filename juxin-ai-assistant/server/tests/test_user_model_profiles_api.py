import base64

import pytest


def test_user_model_profile_crud_hides_api_key(client_for_user) -> None:
    client = client_for_user("user-model-owner")

    created = client.post(
        "/api/ai/model-profiles",
        json={
            "display_name": "我的 DeepSeek",
            "base_url": "https://api.deepseek.com",
            "model_id": "deepseek-chat",
            "api_key": "sk-user-secret",
            "temperature": 0.2,
            "max_output_tokens": 4096,
            "timeout_seconds": 120,
            "is_default": True,
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["display_name"] == "我的 DeepSeek"
    assert payload["model_id"] == "deepseek-chat"
    assert payload["has_api_key"] is True
    assert payload["is_default"] is True
    assert "sk-user-secret" not in created.text

    listed = client.get("/api/ai/model-profiles")
    assert listed.status_code == 200
    body = listed.json()
    assert body["items"][0]["uuid"] == payload["uuid"]
    assert body["items"][0]["has_api_key"] is True
    assert "sk-user-secret" not in listed.text

    removed = client.delete(f"/api/ai/model-profiles/{payload['uuid']}")
    assert removed.status_code == 204
    assert client.get("/api/ai/model-profiles").json()["items"] == []


def test_model_profiles_are_isolated_by_user(client_for_user) -> None:
    owner = client_for_user("model-owner")
    other = client_for_user("model-other")

    created = owner.post(
        "/api/ai/model-profiles",
        json={
            "display_name": "Owner 模型",
            "base_url": "https://model.owner/v1",
            "model_id": "owner-chat",
            "api_key": "sk-owner-secret",
            "is_default": True,
        },
    )
    assert created.status_code == 201

    assert other.get("/api/ai/model-profiles").json()["items"] == []
    assert other.delete(f"/api/ai/model-profiles/{created.json()['uuid']}").status_code == 404


def test_user_model_profile_api_key_is_encrypted_at_rest(
    client_for_user,
    generation_db,
) -> None:
    from app.crypto import ContentCipher, EncryptedPayload
    from app.models import UserModelProfile

    client = client_for_user("encrypted-model-user")
    created = client.post(
        "/api/ai/model-profiles",
        json={
            "display_name": "加密模型",
            "base_url": "https://model.example/v1",
            "model_id": "secure-chat",
            "api_key": "sk-encrypted-secret",
            "is_default": True,
        },
    )

    assert created.status_code == 201
    record = generation_db.query(UserModelProfile).one()
    assert record.api_key_ciphertext != b"sk-encrypted-secret"
    assert record.api_key_nonce
    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))
    decrypted = cipher.decrypt_json(
        EncryptedPayload(record.api_key_ciphertext, record.api_key_nonce),
        record.uuid.encode(),
    )
    assert decrypted == {"api_key": "sk-encrypted-secret"}


@pytest.mark.parametrize(
    "base_url",
    [
        "http://127.0.0.1:8080",
        "http://10.0.0.8/v1",
        "http://[::1]/v1",
        "https://metadata.internal/v1",
        "https://localhost:11434/v1",
    ],
)
def test_user_model_profile_rejects_private_model_endpoint(client_for_user, base_url: str) -> None:
    response = client_for_user("ssrf-model-user").post(
        "/api/ai/model-profiles",
        json={
            "display_name": "不安全模型",
            "base_url": base_url,
            "model_id": "unsafe-chat",
            "api_key": "sk-test",
        },
    )

    assert response.status_code == 422
    assert "内部网络" in response.text
