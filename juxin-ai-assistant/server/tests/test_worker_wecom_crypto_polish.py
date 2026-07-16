"""Channel worker status, WeCom crypto, role polish fallback."""

from __future__ import annotations

import base64
import os

from app.channel_job_worker import scheduler_status
from app.role_assistant_routes import polish_role_document
from app.wecom_crypto import (
    decrypt_wecom_message,
    encrypt_wecom_message,
    extract_wecom_inbound,
    verify_wecom_signature,
    wecom_signature,
)


def _test_aes_key() -> str:
    # 32 bytes → base64 without padding often 43 chars
    raw = b"0123456789abcdef0123456789abcdef"
    return base64.b64encode(raw).decode("ascii").rstrip("=")


def test_wecom_encrypt_decrypt_roundtrip() -> None:
    key = _test_aes_key()
    corp = "ww_corp_test"
    plain_xml = "<xml><Content><![CDATA[你好企微]]></Content><FromUserName><![CDATA[zhang]]></FromUserName></xml>"
    enc = encrypt_wecom_message(encoding_aes_key=key, corp_id=corp, plaintext=plain_xml)
    out = decrypt_wecom_message(encoding_aes_key=key, corp_id=corp, encrypt_b64=enc)
    assert "你好企微" in out
    assert "zhang" in out


def test_wecom_signature_and_extract() -> None:
    token = "tok"
    key = _test_aes_key()
    corp = "ww1"
    plain = "<xml><Content><![CDATA[VPN]]></Content><FromUserName><![CDATA[u1]]></FromUserName><AgentID>100</AgentID></xml>"
    encrypt = encrypt_wecom_message(encoding_aes_key=key, corp_id=corp, plaintext=plain)
    ts, nonce = "1710000000", "n1"
    sig = wecom_signature(token, ts, nonce, encrypt)
    assert verify_wecom_signature(
        token=token, timestamp=ts, nonce=nonce, encrypt=encrypt, msg_signature=sig
    )
    xml_body = f"<xml><Encrypt><![CDATA[{encrypt}]]></Encrypt></xml>"
    payload = extract_wecom_inbound(
        body=xml_body,
        content_type="application/xml",
        token=token,
        encoding_aes_key=key,
        corp_id=corp,
        msg_signature=sig,
        timestamp=ts,
        nonce=nonce,
    )
    assert payload.get("Content") == "VPN"
    assert payload.get("FromUserName") == "u1"


def test_wecom_encrypted_callback_rejects_missing_signature() -> None:
    key = _test_aes_key()
    encrypted = encrypt_wecom_message(
        encoding_aes_key=key,
        corp_id="ww1",
        plaintext="<xml><Content><![CDATA[资料查询]]></Content></xml>",
    )

    with pytest.raises(ValueError, match="missing_signature"):
        extract_wecom_inbound(
            body=f"<xml><Encrypt><![CDATA[{encrypted}]]></Encrypt></xml>",
            content_type="application/xml",
            token="tok",
            encoding_aes_key=key,
            corp_id="ww1",
        )


def test_scheduler_status() -> None:
    st = scheduler_status()
    assert "interval_seconds" in st
    assert "pending_async" in st


import pytest


@pytest.mark.asyncio
async def test_polish_falls_back_without_model() -> None:
    from app.config import get_settings

    settings = get_settings()
    skeleton = "# 标题\n\n# 基本信息\n\n待确认\n"
    text, mode = await polish_role_document(
        settings=settings,
        role_name="项目经理助手",
        template_name="周报",
        title="周报",
        topic="冲刺",
        notes="",
        skeleton=skeleton,
    )
    assert text == skeleton
    assert mode == "skeleton"


def test_role_generate_polish_flag_false(generation_client) -> None:
    resp = generation_client.post(
        "/api/ai/role-assistants/knowledge/generate",
        json={
            "topic": "差旅制度",
            "notes": "需引用正式版本",
            "polish_with_model": False,
            "create_artifact": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["polish_mode"] == "skeleton"
    assert body["polished"] is False
    assert "差旅" in body["title"] or "差旅" in body["content_markdown"]


def test_queue_status_includes_worker(generation_client) -> None:
    resp = generation_client.get("/api/ai/channels/webhooks/queue-status")
    assert resp.status_code == 200
    assert "worker" in resp.json()
