"""Human-handoff tickets for external customer support."""

from __future__ import annotations

import uuid as uuid_lib
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import ExternalQuestionEvent, ExternalSupportTicket, ExternalSupportTicketMessage


def create_handoff_ticket(
    db: Session,
    *,
    cipher: ContentCipher,
    event: ExternalQuestionEvent,
    reason_code: str,
    external_recipient_id: str = "",
    priority: str = "NORMAL",
) -> ExternalSupportTicket:
    """Create one ticket per event and atomically mark the event as handed off."""
    ticket = db.scalar(select(ExternalSupportTicket).where(
        ExternalSupportTicket.external_question_event_id == event.id,
    ))
    if ticket is not None:
        return ticket
    ticket_uuid = str(uuid_lib.uuid4())
    recipient = external_recipient_id.strip()
    encrypted = cipher.encrypt_json({"id": recipient}, f"{ticket_uuid}:recipient".encode()) if recipient else None
    ticket = ExternalSupportTicket(
        uuid=ticket_uuid,
        external_question_event_id=event.id,
        source_channel=event.source_channel,
        conversation_key=event.conversation_key,
        reason_code=reason_code.strip().upper() or "NO_EVIDENCE",
        priority=priority.strip().upper() or "NORMAL",
        recipient_ciphertext=encrypted.ciphertext if encrypted else None,
        recipient_nonce=encrypted.nonce if encrypted else None,
    )
    db.add(ticket)
    db.flush()
    event.status = "HANDOFF"
    event.handoff_ticket_id = ticket.uuid
    event.completed_at = datetime.now(UTC)
    db.flush()
    return ticket


def claim_ticket(db: Session, *, ticket_uuid: str, actor_id: str) -> ExternalSupportTicket | None:
    """Claim a pending ticket exactly once; its assignee cannot be overwritten."""
    now = datetime.now(UTC)
    result = db.execute(update(ExternalSupportTicket).where(
        ExternalSupportTicket.uuid == ticket_uuid,
        ExternalSupportTicket.status == "PENDING",
    ).values(status="ASSIGNED", assigned_to=actor_id, claimed_at=now))
    ticket = db.scalar(select(ExternalSupportTicket).where(ExternalSupportTicket.uuid == ticket_uuid))
    if ticket is None:
        return None
    if result.rowcount == 0 and ticket.assigned_to != actor_id:
        raise ValueError("ticket_already_claimed")
    return ticket


def add_engineer_reply(
    db: Session,
    *,
    cipher: ContentCipher,
    ticket: ExternalSupportTicket,
    actor_id: str,
    message: str,
) -> ExternalSupportTicketMessage:
    reply = message.strip()
    if not reply:
        raise ValueError("reply_required")
    if ticket.status == "PENDING":
        raise ValueError("ticket_must_be_claimed")
    message_uuid = str(uuid_lib.uuid4())
    payload = cipher.encrypt_json({"text": reply}, message_uuid.encode())
    row = ExternalSupportTicketMessage(
        uuid=message_uuid,
        ticket_id=ticket.id,
        sender_type="ENGINEER",
        sender_id=actor_id,
        message_ciphertext=payload.ciphertext,
        message_nonce=payload.nonce,
        delivery_status="STORED",
    )
    db.add(row)
    ticket.status = "REPLIED"
    ticket.replied_at = datetime.now(UTC)
    db.flush()
    return row


def decrypt_message(cipher: ContentCipher, row: ExternalSupportTicketMessage) -> str:
    return str(cipher.decrypt_json(
        EncryptedPayload(ciphertext=row.message_ciphertext, nonce=row.message_nonce), row.uuid.encode(),
    ).get("text") or "")


def decrypt_recipient(cipher: ContentCipher, ticket: ExternalSupportTicket) -> str:
    if not ticket.recipient_ciphertext or not ticket.recipient_nonce:
        return ""
    return str(cipher.decrypt_json(
        EncryptedPayload(ciphertext=ticket.recipient_ciphertext, nonce=ticket.recipient_nonce),
        f"{ticket.uuid}:recipient".encode(),
    ).get("id") or "")


def notify_assignees(*, settings, ticket: ExternalSupportTicket) -> int:
    """Notify explicitly configured internal WeCom accounts; no recipients means no send."""
    recipients = [item.strip() for item in str(
        getattr(settings, "external_support_notify_user_ids", "") or ""
    ).split(",") if item.strip()]
    if not recipients:
        return 0
    from .channel_gateway import ChannelReply
    from .channel_outbound import WecomHttpOutboundSender

    text = (
        f"【外部客户待处理】工单 {ticket.uuid}\n"
        f"渠道：{ticket.source_channel}\n原因：{ticket.reason_code}\n"
        "请在 AI 助手后台认领并查看加密问题内容后回复。"
    )
    sender = WecomHttpOutboundSender(settings)
    sent = 0
    for recipient in recipients:
        result = sender.send(
            reply=ChannelReply(text=text),
            external_user_id=recipient,
            metadata={"external_support_ticket_id": ticket.uuid},
        )
        sent += int(result.ok)
    return sent
