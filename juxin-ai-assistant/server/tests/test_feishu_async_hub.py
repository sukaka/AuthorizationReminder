"""Feishu encrypt, async channel queue, HTTP agent hub, role assistants."""

from __future__ import annotations

import json

import respx
from httpx import Response

from app.channel_gateway import get_channel_gateway
from app.feishu_crypto import decrypt_feishu_payload, encrypt_feishu_for_test
from app.feature_flags import save_feature_flags


def test_feishu_encrypt_roundtrip() -> None:
    key = "test-encrypt-key-please-change"
    original = {
        "type": "url_verification",
        "challenge": "c-xyz",
        "token": "t",
    }
    enc = encrypt_feishu_for_test(key, original)
    restored = decrypt_feishu_payload(key, {"encrypt": enc})
    assert restored["challenge"] == "c-xyz"
    assert restored["type"] == "url_verification"


def test_feishu_webhook_decrypt_challenge(generation_client, tmp_path, monkeypatch) -> None:
    from app import feature_flags as ff
    from app import channel_webhook_routes as cwr

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    save_feature_flags({"channels": {"feishu": True}})
    key = "unit-test-feishu-key"
    monkeypatch.setattr(
        cwr,
        "decrypt_feishu_payload",
        lambda encrypt_key, payload: decrypt_feishu_payload(key, payload),
    )
    # Also allow empty settings key by using our lambda that ignores encrypt_key
    enc = encrypt_feishu_for_test(key, {"type": "url_verification", "challenge": "hello-challenge"})
    resp = generation_client.post(
        "/api/ai/channels/webhooks/feishu",
        json={"encrypt": enc},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["challenge"] == "hello-challenge"
    assert resp.json()["action"] == "url_verification"


def test_feishu_filters_bot_sender() -> None:
    gw = get_channel_gateway()
    msg = gw.normalize(
        "feishu",
        {
            "event": {
                "sender": {"sender_type": "app", "sender_id": {"open_id": "ou_bot"}},
                "message": {
                    "message_type": "text",
                    "chat_id": "oc_1",
                    "content": '{"text":"bot"}',
                },
            }
        },
    )
    assert msg is None
    human = gw.normalize(
        "feishu",
        {
            "event": {
                "sender": {"sender_type": "user", "sender_id": {"open_id": "ou_u"}},
                "message": {
                    "message_type": "text",
                    "message_id": "om_1",
                    "chat_id": "oc_1",
                    "content": '{"text":"人工消息"}',
                },
            }
        },
    )
    assert human is not None
    assert human.text == "人工消息"


def test_channel_async_queue_flag(generation_client, tmp_path, monkeypatch) -> None:
    from app import feature_flags as ff
    from app import channel_outbound as co

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    monkeypatch.setattr(co, "_outbox_path", lambda settings=None: tmp_path / "outbox.jsonl")
    save_feature_flags(
        {
            "channels": {"feishu": True},
            "channel_async_run": True,
        }
    )
    resp = generation_client.post(
        "/api/ai/channels/webhooks/feishu",
        json={
            "event": {
                "sender": {"sender_type": "user", "sender_id": {"open_id": "ou_async"}},
                "message": {
                    "message_id": "om_async_1",
                    "chat_id": "oc_a",
                    "message_type": "text",
                    "content": '{"text":"异步处理我"}',
                },
            }
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["action"] == "queued"
    assert body["job_key"]
    # wait briefly for background thread via TestClient - may complete later
    status = generation_client.get("/api/ai/channels/webhooks/queue-status")
    assert status.status_code == 200


@respx.mock
def test_register_http_agent(generation_client) -> None:
    route = respx.post("https://agents.example.test/invoke").mock(
        return_value=Response(200, json={"output": "remote-ok"})
    )
    created = generation_client.post(
        "/api/ai/agent-hub/agents/http",
        json={
            "agent_id": "ext.demo",
            "name": "Demo",
            "description": "remote",
            "endpoint": "https://agents.example.test/invoke",
        },
        headers={"X-Test-Role": "admin"},
    )
    assert created.status_code == 201, created.text
    inv = generation_client.post(
        "/api/ai/agent-hub/agents/ext.demo/invoke",
        json={"input_text": "hi"},
    )
    assert inv.status_code == 200, inv.text
    assert inv.json()["output"] == "remote-ok"
    assert route.called
    deleted = generation_client.delete(
        "/api/ai/agent-hub/agents/ext.demo",
        headers={"X-Test-Role": "admin"},
    )
    assert deleted.status_code == 204


def test_role_assistants_api(generation_client) -> None:
    resp = generation_client.get("/api/ai/role-assistants")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"]
    codes = {i["code"] for i in body["items"]}
    assert "security_ops" in codes
    assert "knowledge" in codes
    assert len(body["templates"]) >= 5
