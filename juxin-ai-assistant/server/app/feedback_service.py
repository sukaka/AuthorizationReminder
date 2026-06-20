from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .crypto import ContentCipher
from .history_service import get_owned_record
from .models import FeedbackRecord
from .schemas import FeedbackType


def create_feedback(
    db: Session,
    user_id: str,
    generation_uuid: str,
    feedback_type: FeedbackType,
    content: str | None,
    cipher: ContentCipher,
    key_version: str,
) -> FeedbackRecord:
    generation = get_owned_record(db, user_id, generation_uuid)
    if generation.status != "COMPLETED":
        raise HTTPException(status_code=409, detail="仅可评价已完成的生成结果")
    duplicate = db.scalar(
        select(FeedbackRecord.id).where(
            FeedbackRecord.generation_id == generation.id,
            FeedbackRecord.sso_user_id == user_id,
            FeedbackRecord.feedback_type == feedback_type.value,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "FEEDBACK_DUPLICATE",
                "message": "该反馈类型已提交",
            },
        )

    record = FeedbackRecord(
        generation_id=generation.id,
        sso_user_id=user_id,
        feedback_type=feedback_type.value,
        key_version=key_version,
    )
    db.add(record)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "FEEDBACK_DUPLICATE",
                "message": "该反馈类型已提交",
            },
        ) from exc
    normalized_content = (content or "").strip()
    if normalized_content:
        encrypted = cipher.encrypt_json(
            {"content": normalized_content},
            record.uuid.encode(),
        )
        record.content_ciphertext = encrypted.ciphertext
        record.content_nonce = encrypted.nonce
    db.flush()
    return record
