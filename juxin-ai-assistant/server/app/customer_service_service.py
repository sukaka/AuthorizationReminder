"""Public-knowledge-only answer flow for signed customer-service callers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import hmac
import logging

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings
from .context.context_builder import ContextBuilder
from .crypto import ContentCipher, EncryptedPayload
from .external_answer_safety import prepare_external_answer
from .external_question_events import record_external_question
from .external_support_tickets import create_handoff_ticket, notify_assignees
from .knowledge_embedding import build_embedding_service
from .knowledge_search import RetrievedKnowledgeChunk, search_knowledge_chunks
from .models import ExternalQuestionEvent
from .server_model_client import generate_with_server_model


SOURCE_CHANNEL = "customer_service_api"
NO_EVIDENCE_ANSWER = "当前公开资料中未找到明确依据，已转交人工处理。"
UNSAFE_ANSWER = "当前无法安全地根据公开资料生成回复，已转交人工处理。"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CustomerServiceSource:
    file_uuid: str
    file_name: str


@dataclass(frozen=True)
class CustomerServiceResult:
    request_id: str
    message_id: str
    status: str
    answer: str
    sources: tuple[CustomerServiceSource, ...]
    handoff_required: bool
    ticket_id: str
    replayed: bool


def _scoped_hash(settings: Settings, *parts: str) -> str:
    secret = settings.audit_hash_salt.encode("utf-8")
    if len(secret) < 32:
        raise HTTPException(
            status_code=503,
            detail="CUSTOMER_SERVICE_SECURITY_NOT_CONFIGURED",
        )
    payload = "\x1f".join(parts).encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _stored_message_id(
    settings: Settings,
    credential_id: str,
    message_id: str,
) -> str:
    return _scoped_hash(settings, "message", credential_id, message_id)


def _decrypt_question(cipher: ContentCipher, event: ExternalQuestionEvent) -> str:
    return str(cipher.decrypt_json(
        EncryptedPayload(
            ciphertext=event.question_ciphertext,
            nonce=event.question_nonce,
        ),
        event.uuid.encode(),
    ).get("text") or "").strip()


def _encrypt_result(
    cipher: ContentCipher,
    event: ExternalQuestionEvent,
    *,
    answer: str,
    sources: list[CustomerServiceSource],
) -> None:
    encrypted = cipher.encrypt_json(
        {
            "answer": answer,
            "sources": [
                {"file_uuid": item.file_uuid, "file_name": item.file_name}
                for item in sources
            ],
        },
        f"{event.uuid}:answer".encode(),
    )
    event.answer_ciphertext = encrypted.ciphertext
    event.answer_nonce = encrypted.nonce


def _decrypt_result(
    cipher: ContentCipher,
    event: ExternalQuestionEvent,
) -> tuple[str, tuple[CustomerServiceSource, ...]]:
    if not event.answer_ciphertext or not event.answer_nonce:
        return "", ()
    payload = cipher.decrypt_json(
        EncryptedPayload(
            ciphertext=event.answer_ciphertext,
            nonce=event.answer_nonce,
        ),
        f"{event.uuid}:answer".encode(),
    )
    sources: list[CustomerServiceSource] = []
    for item in payload.get("sources") or []:
        if not isinstance(item, dict):
            continue
        file_uuid = str(item.get("file_uuid") or "").strip()
        file_name = str(item.get("file_name") or "").strip()
        if file_uuid and file_name:
            sources.append(CustomerServiceSource(file_uuid=file_uuid, file_name=file_name))
    return str(payload.get("answer") or ""), tuple(sources)


def _to_result(
    cipher: ContentCipher,
    event: ExternalQuestionEvent,
    *,
    external_message_id: str,
    replayed: bool,
) -> CustomerServiceResult:
    answer, sources = _decrypt_result(cipher, event)
    return CustomerServiceResult(
        request_id=event.uuid,
        message_id=external_message_id,
        status=event.status,
        answer=answer,
        sources=sources,
        handoff_required=event.status == "HANDOFF",
        ticket_id=event.handoff_ticket_id,
        replayed=replayed,
    )


def _dedupe_sources(chunks: list[RetrievedKnowledgeChunk]) -> list[CustomerServiceSource]:
    sources: list[CustomerServiceSource] = []
    seen: set[str] = set()
    for chunk in chunks:
        if chunk.file_uuid in seen:
            continue
        seen.add(chunk.file_uuid)
        sources.append(CustomerServiceSource(
            file_uuid=chunk.file_uuid,
            file_name=chunk.file_name,
        ))
        if len(sources) >= 5:
            break
    return sources


def _handoff(
    db: Session,
    *,
    cipher: ContentCipher,
    settings: Settings,
    event: ExternalQuestionEvent,
    customer_id: str,
    reason_code: str,
    answer: str,
) -> None:
    ticket = create_handoff_ticket(
        db,
        cipher=cipher,
        event=event,
        reason_code=reason_code,
        external_recipient_id=customer_id,
    )
    _encrypt_result(cipher, event, answer=answer, sources=[])
    db.commit()
    try:
        notify_assignees(settings=settings, ticket=ticket)
    except Exception:
        logger.warning(
            "customer-service handoff notification failed for ticket %s",
            ticket.uuid,
        )


def _assert_idempotent_match(
    *,
    cipher: ContentCipher,
    event: ExternalQuestionEvent,
    identity_hash: str,
    conversation_key: str,
    question: str,
) -> None:
    if (
        event.external_identity_hash != identity_hash
        or event.conversation_key != conversation_key
        or _decrypt_question(cipher, event) != question
    ):
        raise HTTPException(
            status_code=409,
            detail="CUSTOMER_SERVICE_IDEMPOTENCY_CONFLICT",
        )


async def answer_customer_service_message(
    db: Session,
    *,
    settings: Settings,
    credential_id: str,
    message_id: str,
    conversation_id: str,
    customer_id: str,
    message: str,
) -> CustomerServiceResult:
    question = " ".join(message.split())
    if not question:
        raise HTTPException(status_code=422, detail="message 不能为空")

    cipher = ContentCipher(settings.content_encryption_key)
    stored_message_id = _stored_message_id(settings, credential_id, message_id)
    identity_hash = _scoped_hash(settings, "customer", credential_id, customer_id)
    conversation_key = _scoped_hash(
        settings,
        "conversation",
        credential_id,
        conversation_id,
    )
    event = db.scalar(select(ExternalQuestionEvent).where(
        ExternalQuestionEvent.source_channel == SOURCE_CHANNEL,
        ExternalQuestionEvent.external_message_id == stored_message_id,
    ))
    replayed = event is not None
    if event is None:
        try:
            event = record_external_question(
                db,
                cipher=cipher,
                source_channel=SOURCE_CHANNEL,
                external_identity_hash=identity_hash,
                conversation_key=conversation_key,
                external_message_id=stored_message_id,
                question=question,
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            event = db.scalar(select(ExternalQuestionEvent).where(
                ExternalQuestionEvent.source_channel == SOURCE_CHANNEL,
                ExternalQuestionEvent.external_message_id == stored_message_id,
            ))
            if event is None:
                raise
            replayed = True

    _assert_idempotent_match(
        cipher=cipher,
        event=event,
        identity_hash=identity_hash,
        conversation_key=conversation_key,
        question=question,
    )
    if event.status in {"ANSWERED", "HANDOFF", "FAILED", "PROCESSING"}:
        return _to_result(
            cipher,
            event,
            external_message_id=message_id,
            replayed=True,
        )

    claim = db.execute(update(ExternalQuestionEvent).where(
        ExternalQuestionEvent.id == event.id,
        ExternalQuestionEvent.status == "RECEIVED",
    ).values(status="PROCESSING"))
    db.commit()
    if claim.rowcount != 1:
        db.refresh(event)
        return _to_result(
            cipher,
            event,
            external_message_id=message_id,
            replayed=True,
        )
    db.refresh(event)

    try:
        chunks = search_knowledge_chunks(
            db,
            sso_user_id=f"customer-service:{credential_id}",
            query=question,
            cipher=cipher,
            top_k=8,
            embedding_service=build_embedding_service(db, settings),
            track_usage=False,
            external_public_only=True,
        )
        if not chunks:
            _handoff(
                db,
                cipher=cipher,
                settings=settings,
                event=event,
                customer_id=customer_id,
                reason_code="NO_EVIDENCE",
                answer=NO_EVIDENCE_ANSWER,
            )
            return _to_result(
                cipher,
                event,
                external_message_id=message_id,
                replayed=replayed,
            )

        messages = ContextBuilder().build_messages(
            mode="knowledge",
            current_user_message=question,
            knowledge_chunks=chunks,
            personal_reference_chunks=[],
            recent_messages=[],
            require_knowledge_evidence=True,
            external_customer=True,
        )
        model_result = await generate_with_server_model(
            settings,
            messages,
            0.2,
            max_output_tokens=settings.customer_service_api_model_max_output_tokens,
        )
        answer = prepare_external_answer(
            model_result.output,
            source_file_names=[chunk.file_name for chunk in chunks],
        )
        if answer is None:
            _handoff(
                db,
                cipher=cipher,
                settings=settings,
                event=event,
                customer_id=customer_id,
                reason_code="UNSAFE_MODEL_OUTPUT",
                answer=UNSAFE_ANSWER,
            )
            return _to_result(
                cipher,
                event,
                external_message_id=message_id,
                replayed=replayed,
            )

        sources = _dedupe_sources(chunks)
        event.status = "ANSWERED"
        event.source_file_ids_json = [item.file_uuid for item in sources]
        event.completed_at = datetime.now(UTC)
        _encrypt_result(cipher, event, answer=answer, sources=sources)
        db.commit()
        return _to_result(
            cipher,
            event,
            external_message_id=message_id,
            replayed=replayed,
        )
    except HTTPException:
        db.rollback()
        failed = db.get(ExternalQuestionEvent, event.id)
        if failed is not None:
            failed.status = "FAILED"
            failed.completed_at = datetime.now(UTC)
            db.commit()
        raise
    except Exception as exc:
        db.rollback()
        failed = db.get(ExternalQuestionEvent, event.id)
        if failed is not None:
            failed.status = "FAILED"
            failed.completed_at = datetime.now(UTC)
            db.commit()
        raise HTTPException(
            status_code=503,
            detail="CUSTOMER_SERVICE_UPSTREAM_FAILED",
        ) from exc


def get_customer_service_result(
    db: Session,
    *,
    settings: Settings,
    credential_id: str,
    message_id: str,
) -> CustomerServiceResult | None:
    event = db.scalar(select(ExternalQuestionEvent).where(
        ExternalQuestionEvent.source_channel == SOURCE_CHANNEL,
        ExternalQuestionEvent.external_message_id
        == _stored_message_id(settings, credential_id, message_id),
    ))
    if event is None:
        return None
    return _to_result(
        ContentCipher(settings.content_encryption_key),
        event,
        external_message_id=message_id,
        replayed=True,
    )
