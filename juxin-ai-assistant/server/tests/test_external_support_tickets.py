from datetime import UTC, datetime


def _event(generation_db):
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_question_events import record_external_question

    return record_external_question(
        generation_db,
        cipher=ContentCipher(get_settings().content_encryption_key),
        source_channel="wecom_kf",
        external_identity_hash="customer-hash",
        conversation_key="kf-1",
        external_message_id="message-1",
        question="没有资料依据的问题",
        created_at=datetime.now(UTC),
    )


def test_handoff_ticket_is_idempotent_and_encrypts_wecom_recipient(generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_support_tickets import create_handoff_ticket

    cipher = ContentCipher(get_settings().content_encryption_key)
    event = _event(generation_db)
    ticket = create_handoff_ticket(
        generation_db,
        cipher=cipher,
        event=event,
        reason_code="NO_EVIDENCE",
        external_recipient_id="external-user-1",
    )
    duplicate = create_handoff_ticket(
        generation_db,
        cipher=cipher,
        event=event,
        reason_code="NO_EVIDENCE",
        external_recipient_id="external-user-1",
    )

    assert duplicate.uuid == ticket.uuid
    assert event.status == "HANDOFF"
    assert event.handoff_ticket_id == ticket.uuid
    assert ticket.status == "PENDING"
    assert ticket.recipient_ciphertext != b"external-user-1"
    assert ticket.recipient_nonce


def test_admin_can_claim_and_reply_to_external_ticket(client_for_user, generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_support_tickets import create_handoff_ticket

    event = _event(generation_db)
    ticket = create_handoff_ticket(
        generation_db,
        cipher=ContentCipher(get_settings().content_encryption_key),
        event=event,
        reason_code="NO_EVIDENCE",
        external_recipient_id="external-user-1",
    )
    generation_db.commit()
    client = client_for_user("engineer-1", role="admin")

    claimed = client.post(f"/api/ai/admin/external-support-tickets/{ticket.uuid}/claim")
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "ASSIGNED"
    assert claimed.json()["assigned_to"] == "engineer-1"

    replied = client.post(
        f"/api/ai/admin/external-support-tickets/{ticket.uuid}/reply",
        json={"message": "工程师已处理，请按步骤重新下载资料。"},
        headers={"Idempotency-Key": "reply-1"},
    )
    assert replied.status_code == 200, replied.text
    assert replied.json()["status"] == "REPLIED"
    assert replied.json()["messages"][0]["message"] == "工程师已处理，请按步骤重新下载资料。"


def test_admin_reply_requires_idempotency_key(client_for_user, generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_support_tickets import create_handoff_ticket

    event = _event(generation_db)
    ticket = create_handoff_ticket(
        generation_db,
        cipher=ContentCipher(get_settings().content_encryption_key),
        event=event,
        reason_code="NO_EVIDENCE",
        external_recipient_id="external-user-1",
    )
    generation_db.commit()
    client = client_for_user("engineer-1", role="admin")
    assert client.post(f"/api/ai/admin/external-support-tickets/{ticket.uuid}/claim").status_code == 200

    response = client.post(
        f"/api/ai/admin/external-support-tickets/{ticket.uuid}/reply",
        json={"message": "请先检查网络连接。"},
    )
    assert response.status_code == 400


def test_admin_reply_replays_without_second_message(client_for_user, generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_support_tickets import create_handoff_ticket
    from app.models import ExternalSupportTicketMessage
    from sqlalchemy import select

    event = _event(generation_db)
    ticket = create_handoff_ticket(
        generation_db,
        cipher=ContentCipher(get_settings().content_encryption_key),
        event=event,
        reason_code="NO_EVIDENCE",
        external_recipient_id="external-user-1",
    )
    generation_db.commit()
    client = client_for_user("engineer-1", role="admin")
    assert client.post(f"/api/ai/admin/external-support-tickets/{ticket.uuid}/claim").status_code == 200
    path = f"/api/ai/admin/external-support-tickets/{ticket.uuid}/reply"
    headers = {"Idempotency-Key": "reply-replay-1"}
    first = client.post(path, json={"message": "请先检查网络连接。"}, headers=headers)
    second = client.post(path, json={"message": "请先检查网络连接。"}, headers=headers)

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(list(generation_db.scalars(select(ExternalSupportTicketMessage)))) == 1
