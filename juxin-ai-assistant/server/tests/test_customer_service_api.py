from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.config import Settings, get_settings
from app.customer_service_security import (
    CustomerServiceSignatureError,
    sign_customer_service_request,
    verify_customer_service_signature,
)
from app.knowledge_search import RetrievedKnowledgeChunk
from app.models import ExternalQuestionEvent, ExternalSupportTicket
from app.server_model_client import ServerModelResult


CREDENTIAL_ID = "crm-prod"
SECRET = "customer-service-test-secret-32-bytes"
CREDENTIALS = json.dumps({CREDENTIAL_ID: {"secret": SECRET}})


def _settings():
    return get_settings().model_copy(update={
        "customer_service_api_enabled": True,
        "customer_service_api_credentials": CREDENTIALS,
    })


def _headers(payload: dict, *, secret: str = SECRET) -> dict[str, str]:
    timestamp, signature = sign_customer_service_request(payload, secret=secret)
    return {
        "X-Juxin-Credential": CREDENTIAL_ID,
        "X-Juxin-Timestamp": timestamp,
        "X-Juxin-Signature": signature,
    }


def _message(**updates) -> dict:
    payload = {
        "message_id": "crm-message-001",
        "conversation_id": "conversation-001",
        "customer_id": "customer-001",
        "message": "你们的客服时间是什么？",
        "metadata": {"locale": "zh-CN"},
    }
    payload.update(updates)
    return payload


def test_customer_service_signature_binds_payload_and_time_window():
    payload = _message()
    now = datetime.now(UTC)
    timestamp, signature = sign_customer_service_request(
        payload,
        secret=SECRET,
        timestamp=int(now.timestamp()),
    )

    verify_customer_service_signature(
        payload,
        timestamp_header=timestamp,
        signature_header=signature,
        secret=SECRET,
        now=now,
    )

    with pytest.raises(CustomerServiceSignatureError) as tampered:
        verify_customer_service_signature(
            {**payload, "message": "被篡改的问题"},
            timestamp_header=timestamp,
            signature_header=signature,
            secret=SECRET,
            now=now,
        )
    assert tampered.value.code == "signature_invalid"

    with pytest.raises(CustomerServiceSignatureError) as expired:
        verify_customer_service_signature(
            payload,
            timestamp_header=timestamp,
            signature_header=signature,
            secret=SECRET,
            now=now + timedelta(seconds=301),
        )
    assert expired.value.code == "timestamp_out_of_window"

    for malformed_timestamp in ("１23456789", "1" * 100):
        with pytest.raises(CustomerServiceSignatureError) as malformed:
            verify_customer_service_signature(
                payload,
                timestamp_header=malformed_timestamp,
                signature_header=signature,
                secret=SECRET,
                now=now,
            )
        assert malformed.value.code == "timestamp_invalid"


def test_customer_service_endpoint_is_disabled_by_default(generation_client):
    payload = _message()

    response = generation_client.post(
        "/api/ai/customer-service/v1/messages",
        json=payload,
        headers=_headers(payload),
    )

    assert response.status_code == 404


def test_customer_service_enabled_requires_encrypted_storage_configuration():
    with pytest.raises(ValidationError, match="CONTENT_ENCRYPTION_KEY"):
        Settings(
            customer_service_api_enabled=True,
            customer_service_api_credentials=CREDENTIALS,
            content_encryption_key="invalid",
        )

    with pytest.raises(ValidationError, match="AUDIT_HASH_SALT"):
        Settings(
            customer_service_api_enabled=True,
            customer_service_api_credentials=CREDENTIALS,
            audit_hash_salt="too-short",
        )


def test_customer_service_answers_from_public_knowledge_and_replays_idempotently(
    generation_client,
    generation_db,
    monkeypatch,
):
    from app.main import app
    from app import customer_service_service

    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    model_calls = 0
    search_options: dict = {}

    def fake_search(*args, **kwargs):
        search_options.update(kwargs)
        return [RetrievedKnowledgeChunk(
            chunk_id="chunk-1",
            file_uuid="public-file-1",
            file_name="客户服务说明.pdf",
            chunk_text="客服服务时间为每天 9:00 至 18:00。",
            page_number=3,
            section_title="服务时间",
            chunk_index=0,
            score=10,
        )]

    async def fake_generate(*args, **kwargs):
        nonlocal model_calls
        model_calls += 1
        return ServerModelResult(
            output="客服服务时间为每天 9:00 至 18:00。",
            model_display_name="测试模型",
            model_id="test-model",
            usage={},
            latency_ms=5,
        )

    monkeypatch.setattr(customer_service_service, "search_knowledge_chunks", fake_search)
    monkeypatch.setattr(customer_service_service, "build_embedding_service", lambda *args: object())
    monkeypatch.setattr(customer_service_service, "generate_with_server_model", fake_generate)
    payload = _message()

    try:
        first = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload),
        )
        replay = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload),
        )
        get_payload = {"message_id": payload["message_id"]}
        status = generation_client.get(
            f"/api/ai/customer-service/v1/messages/{payload['message_id']}",
            headers=_headers(get_payload),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert first.status_code == 200, first.text
    assert replay.status_code == 200, replay.text
    assert first.json()["status"] == "ANSWERED"
    assert first.json()["answer"].startswith("客服服务时间为每天 9:00 至 18:00。")
    assert first.json()["sources"] == [{
        "file_uuid": "public-file-1",
        "file_name": "客户服务说明.pdf",
    }]
    assert replay.json()["request_id"] == first.json()["request_id"]
    assert replay.json()["answer"] == first.json()["answer"]
    assert replay.json()["replayed"] is True
    assert model_calls == 1
    assert search_options["external_public_only"] is True
    assert search_options["track_usage"] is False

    event = generation_db.scalar(select(ExternalQuestionEvent))
    assert event is not None
    assert payload["message_id"] not in event.external_message_id
    assert payload["message"].encode() not in event.question_ciphertext
    assert first.json()["answer"].encode() not in event.answer_ciphertext

    assert status.status_code == 200, status.text
    assert status.json()["answer"] == first.json()["answer"]
    assert status.json()["replayed"] is True


def test_customer_service_rejects_bad_signature_and_idempotency_collision(
    generation_client,
    monkeypatch,
):
    from app.main import app
    from app import customer_service_service

    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(customer_service_service, "search_knowledge_chunks", lambda *args, **kwargs: [])
    monkeypatch.setattr(customer_service_service, "build_embedding_service", lambda *args: object())
    monkeypatch.setattr(customer_service_service, "notify_assignees", lambda **kwargs: 0)
    payload = _message()

    try:
        bad_signature = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload, secret="wrong-customer-service-secret-32-bytes"),
        )
        first = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload),
        )
        collided = _message(message="同一个消息编号对应了另一条问题")
        conflict = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=collided,
            headers=_headers(collided),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert bad_signature.status_code == 401
    assert bad_signature.json()["detail"] == "CUSTOMER_SERVICE_SIGNATURE_INVALID"
    assert first.status_code == 200
    assert first.json()["status"] == "HANDOFF"
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "CUSTOMER_SERVICE_IDEMPOTENCY_CONFLICT"


def test_customer_service_without_public_evidence_creates_one_handoff(
    generation_client,
    generation_db,
    monkeypatch,
):
    from app.main import app
    from app import customer_service_service

    settings = _settings()
    app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(customer_service_service, "search_knowledge_chunks", lambda *args, **kwargs: [])
    monkeypatch.setattr(customer_service_service, "build_embedding_service", lambda *args: object())
    monkeypatch.setattr(customer_service_service, "notify_assignees", lambda **kwargs: 0)
    payload = _message(message_id="crm-message-handoff")

    try:
        first = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload),
        )
        replay = generation_client.post(
            "/api/ai/customer-service/v1/messages",
            json=payload,
            headers=_headers(payload),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert first.status_code == 200, first.text
    assert first.json()["status"] == "HANDOFF"
    assert first.json()["handoff_required"] is True
    assert first.json()["ticket_id"]
    assert replay.json()["ticket_id"] == first.json()["ticket_id"]
    assert replay.json()["replayed"] is True
    assert len(list(generation_db.scalars(select(ExternalSupportTicket)))) == 1
