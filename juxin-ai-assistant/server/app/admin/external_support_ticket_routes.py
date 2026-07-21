from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher, EncryptedPayload
from ..database import get_db
from ..direct_action_service import DirectActionReplay, DirectActionService
from ..external_support_tickets import add_engineer_reply, claim_ticket, decrypt_message, decrypt_recipient
from ..feature_flags import channel_enabled
from ..models import ExternalQuestionEvent, ExternalSupportTicket, ExternalSupportTicketMessage
from ..schemas import SessionPayload
from .route_common import CipherDependency, write_request_audit


class ExternalSupportMessageOut(BaseModel):
    uuid: str
    sender_id: str
    message: str
    delivery_status: str
    created_at: datetime


class ExternalSupportTicketOut(BaseModel):
    uuid: str
    source_channel: str
    conversation_key: str
    reason_code: str
    status: str
    priority: str
    assigned_to: str
    question: str
    created_at: datetime
    claimed_at: datetime | None
    replied_at: datetime | None
    messages: list[ExternalSupportMessageOut]


class ExternalSupportTicketListOut(BaseModel):
    items: list[ExternalSupportTicketOut]
    total: int


class ExternalSupportReplyIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    resolve: bool = False


def _idempotency_key(request: Request) -> str:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key or len(key) > 128:
        raise HTTPException(status_code=400, detail="Idempotency-Key 请求头不能为空且长度不能超过 128")
    return key


def _replay_or_raise(replay: DirectActionReplay) -> ExternalSupportTicketOut:
    if replay.payload is not None:
        return ExternalSupportTicketOut.model_validate(replay.payload)
    raise HTTPException(
        status_code=replay.status_code,
        detail={"code": replay.error_code, "message": replay.error_message_safe},
    )


def _out(db: Session, cipher: ContentCipher, ticket: ExternalSupportTicket) -> ExternalSupportTicketOut:
    event = db.scalar(select(ExternalQuestionEvent).where(ExternalQuestionEvent.id == ticket.external_question_event_id))
    question = ""
    if event is not None:
        question = str(cipher.decrypt_json(
            EncryptedPayload(ciphertext=event.question_ciphertext, nonce=event.question_nonce), event.uuid.encode(),
        ).get("text") or "")
    messages = list(db.scalars(select(ExternalSupportTicketMessage).where(
        ExternalSupportTicketMessage.ticket_id == ticket.id,
    ).order_by(ExternalSupportTicketMessage.created_at.asc())))
    return ExternalSupportTicketOut(
        uuid=ticket.uuid,
        source_channel=ticket.source_channel,
        conversation_key=ticket.conversation_key,
        reason_code=ticket.reason_code,
        status=ticket.status,
        priority=ticket.priority,
        assigned_to=ticket.assigned_to,
        question=question,
        created_at=ticket.created_at,
        claimed_at=ticket.claimed_at,
        replied_at=ticket.replied_at,
        messages=[ExternalSupportMessageOut(
            uuid=row.uuid, sender_id=row.sender_id, message=decrypt_message(cipher, row),
            delivery_status=row.delivery_status, created_at=row.created_at,
        ) for row in messages],
    )


def create_external_support_ticket_router(cipher_dependency: CipherDependency) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/external-support-tickets", response_model=ExternalSupportTicketListOut)
    async def list_tickets(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
        status: Literal["PENDING", "ASSIGNED", "REPLIED", "RESOLVED", "CLOSED"] | None = None,
    ) -> ExternalSupportTicketListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        statement = select(ExternalSupportTicket)
        if status:
            statement = statement.where(ExternalSupportTicket.status == status)
        rows = list(db.scalars(statement.order_by(ExternalSupportTicket.created_at.desc()).limit(200)))
        return ExternalSupportTicketListOut(items=[_out(db, cipher, row) for row in rows], total=len(rows))

    @router.post("/admin/external-support-tickets/{ticket_uuid}/claim", response_model=ExternalSupportTicketOut)
    async def claim(
        ticket_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> ExternalSupportTicketOut:
        await require_action("ai_assistant:admin", request, session, settings)
        try:
            ticket = claim_ticket(db, ticket_uuid=ticket_uuid, actor_id=str(session.user.id))
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="工单已被其他人员认领") from exc
        if ticket is None:
            raise HTTPException(status_code=404, detail="工单不存在")
        write_request_audit(db, session, request, settings, action="external_support_ticket.claim", entity_type="external_support_ticket", entity_uuid=ticket.uuid)
        db.commit()
        return _out(db, cipher, ticket)

    @router.post("/admin/external-support-tickets/{ticket_uuid}/reply", response_model=ExternalSupportTicketOut)
    async def reply(
        ticket_uuid: str,
        body: ExternalSupportReplyIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> ExternalSupportTicketOut:
        await require_action("ai_assistant:admin", request, session, settings)
        action_service = DirectActionService(db)
        invocation, replay = action_service.begin(
            user_id=str(session.user.id),
            action_name="external_support_ticket_reply",
            idempotency_key=_idempotency_key(request),
            request_payload={"ticket_uuid": ticket_uuid, "message": body.message, "resolve": body.resolve},
            timeout_seconds=30,
        )
        if replay is not None:
            return _replay_or_raise(replay)
        assert invocation is not None
        ticket = db.scalar(select(ExternalSupportTicket).where(ExternalSupportTicket.uuid == ticket_uuid))
        if ticket is None:
            action_service.fail(invocation, error_code="EXTERNAL_SUPPORT_TICKET_NOT_FOUND", error_message_safe="工单不存在")
            raise HTTPException(status_code=404, detail="工单不存在")
        if ticket.assigned_to != str(session.user.id):
            action_service.fail(invocation, error_code="EXTERNAL_SUPPORT_TICKET_NOT_ASSIGNED", error_message_safe="请先认领工单")
            raise HTTPException(status_code=409, detail="请先认领工单")
        try:
            row = add_engineer_reply(db, cipher=cipher, ticket=ticket, actor_id=str(session.user.id), message=body.message)
        except ValueError as exc:
            action_service.fail(invocation, error_code="EXTERNAL_SUPPORT_TICKET_INVALID_STATE", error_message_safe="工单当前状态不能回复")
            raise HTTPException(status_code=409, detail="工单当前状态不能回复") from exc
        if ticket.source_channel == "wecom_kf" and channel_enabled(settings, "wecom_kf"):
            recipient = decrypt_recipient(cipher, ticket)
            if recipient:
                try:
                    from ..wecom_kf import WecomKfClient

                    WecomKfClient(settings).send_text(
                        open_kfid=ticket.conversation_key, external_user_id=recipient, text=body.message,
                    )
                    row.delivery_status = "SENT"
                    row.delivered_at = datetime.now(UTC)
                except Exception as exc:
                    action_service.require_reconciliation(
                        invocation,
                        error_message_safe="企微发送结果未知，必须先对账，不能自动重发",
                    )
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "DIRECT_ACTION_RECONCILIATION_REQUIRED",
                            "message": "企微发送结果未知，必须先对账，不能自动重发",
                        },
                    ) from exc
        elif ticket.source_channel == "wechat_official":
            row.delivery_status = "H5_AVAILABLE"
            row.delivered_at = datetime.now(UTC)
        if body.resolve:
            ticket.status = "RESOLVED"
            ticket.resolved_at = datetime.now(UTC)
        write_request_audit(db, session, request, settings, action="external_support_ticket.reply", entity_type="external_support_ticket", entity_uuid=ticket.uuid)
        payload = _out(db, cipher, ticket).model_dump(mode="json")
        action_service.succeed(invocation, status_code=200, payload=payload)
        return ExternalSupportTicketOut.model_validate(payload)

    return router
