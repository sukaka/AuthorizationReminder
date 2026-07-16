"""Encrypted external customer questions and daily channel-aware hot-question reports."""

from __future__ import annotations

import re
import uuid as uuid_lib
from collections import Counter
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .hot_questions import _similar
from .models import ExternalHotQuestionReportItem, ExternalQuestionEvent
from .product_aliases import expand_product_aliases


def _normalize_question(question: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", expand_product_aliases(question).lower())


def _decrypt_question(cipher: ContentCipher, event: ExternalQuestionEvent) -> str:
    return str(cipher.decrypt_json(
        EncryptedPayload(ciphertext=event.question_ciphertext, nonce=event.question_nonce),
        event.uuid.encode(),
    ).get("text") or "").strip()


def record_external_question(
    db: Session,
    *,
    cipher: ContentCipher,
    source_channel: str,
    external_identity_hash: str,
    conversation_key: str,
    external_message_id: str,
    question: str,
    status: str = "RECEIVED",
    source_file_ids: list[str] | None = None,
    handoff_ticket_id: str = "",
    created_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> ExternalQuestionEvent:
    """Persist one external customer question once, without storing plaintext."""
    channel = source_channel.strip().lower()
    message_id = external_message_id.strip()
    if not channel or not message_id:
        raise ValueError("source_channel and external_message_id are required")
    existing = db.scalar(select(ExternalQuestionEvent).where(
        ExternalQuestionEvent.source_channel == channel,
        ExternalQuestionEvent.external_message_id == message_id,
    ))
    if existing is not None:
        return existing
    event_uuid = str(uuid_lib.uuid4())
    payload = cipher.encrypt_json({"text": question.strip()}, event_uuid.encode())
    event = ExternalQuestionEvent(
        uuid=event_uuid,
        source_channel=channel,
        external_identity_hash=external_identity_hash,
        conversation_key=conversation_key,
        external_message_id=message_id,
        question_ciphertext=payload.ciphertext,
        question_nonce=payload.nonce,
        status=status,
        source_file_ids_json=list(source_file_ids or []),
        handoff_ticket_id=handoff_ticket_id,
        created_at=created_at,
        completed_at=completed_at,
    )
    db.add(event)
    db.flush()
    return event


def generate_external_question_report(
    db: Session,
    *,
    period_type: str,
    period_start: datetime,
    period_end: datetime,
    source_channel: str,
    cipher: ContentCipher,
    limit: int = 20,
) -> int:
    """Replace one report scope, making scheduled reruns idempotent."""
    channel = source_channel.strip().lower()
    statement = select(ExternalQuestionEvent).where(
        ExternalQuestionEvent.created_at >= period_start,
        ExternalQuestionEvent.created_at < period_end,
    )
    if channel != "all":
        statement = statement.where(ExternalQuestionEvent.source_channel == channel)
    events = list(db.scalars(statement.order_by(ExternalQuestionEvent.created_at.asc())))
    db.execute(delete(ExternalHotQuestionReportItem).where(
        ExternalHotQuestionReportItem.period_type == period_type,
        ExternalHotQuestionReportItem.period_start == period_start,
        ExternalHotQuestionReportItem.period_end == period_end,
        ExternalHotQuestionReportItem.source_channel == channel,
    ))

    clusters: list[dict] = []
    for event in events:
        question = _decrypt_question(cipher, event)
        if not question:
            continue
        normalized = _normalize_question(question)
        target = next((item for item in clusters if _similar(normalized, item["normalized"])), None)
        if target is None:
            target = {"normalized": normalized, "questions": [], "events": []}
            clusters.append(target)
        target["questions"].append(question)
        target["events"].append(event)

    clusters.sort(key=lambda item: len(item["questions"]), reverse=True)
    for rank, cluster in enumerate(clusters[:limit], start=1):
        item_uuid = str(uuid_lib.uuid4())
        questions = cluster["questions"]
        events = cluster["events"]
        question_payload = cipher.encrypt_json({"text": questions[0]}, item_uuid.encode())
        samples_payload = cipher.encrypt_json({"items": questions[:10]}, f"{item_uuid}:samples".encode())
        source_ids = Counter(
            source_id for event in events for source_id in (event.source_file_ids_json or [])
        )
        direct_answers = sum(event.status == "ANSWERED" for event in events)
        handoffs = sum(event.status == "HANDOFF" or bool(event.handoff_ticket_id) for event in events)
        db.add(ExternalHotQuestionReportItem(
            uuid=item_uuid,
            period_type=period_type,
            period_start=period_start,
            period_end=period_end,
            source_channel=channel,
            rank=rank,
            question_count=len(events),
            direct_answer_count=direct_answers,
            handoff_count=handoffs,
            question_ciphertext=question_payload.ciphertext,
            question_nonce=question_payload.nonce,
            samples_ciphertext=samples_payload.ciphertext,
            samples_nonce=samples_payload.nonce,
            source_file_ids_json=[source_id for source_id, _ in source_ids.most_common(10)],
            analysis_summary=(
                f"共出现 {len(events)} 次，直接回答 {direct_answers} 次，"
                f"转人工 {handoffs} 次。"
            ),
        ))
    db.flush()
    return min(limit, len(clusters))
