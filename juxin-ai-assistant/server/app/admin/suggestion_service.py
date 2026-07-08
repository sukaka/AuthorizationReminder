import uuid as uuid_lib
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..governance_models import TaskSuggestion
from ..models import Task
from .errors import GovernanceError
from .schemas import (
    ReviewDecision,
    SuggestionCreateIn,
    SuggestionOut,
    SuggestionReviewIn,
)


def _suggestion_or_error(
    db: Session,
    suggestion_uuid: str,
) -> TaskSuggestion:
    suggestion = db.scalar(
        select(TaskSuggestion).where(TaskSuggestion.uuid == suggestion_uuid)
    )
    if suggestion is None:
        raise GovernanceError(404, "SUGGESTION_NOT_FOUND", "建议不存在")
    return suggestion


def _task_for_uuid(db: Session, task_uuid: str | None) -> Task | None:
    if task_uuid is None:
        return None
    task = db.scalar(select(Task).where(Task.uuid == task_uuid))
    if task is None:
        raise GovernanceError(422, "SUGGESTION_TASK_INVALID", "建议任务不存在")
    return task


def create_suggestion(
    db: Session,
    body: SuggestionCreateIn,
    actor_id: str,
    managed_departments: list[str],
    cipher: ContentCipher,
    key_version: str,
) -> TaskSuggestion:
    if body.department_code not in managed_departments:
        raise GovernanceError(
            403,
            "DEPARTMENT_SCOPE_FORBIDDEN",
            "只能为所管理部门提交建议",
        )
    task = _task_for_uuid(db, body.task_uuid)
    suggestion_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"content": body.content},
        suggestion_uuid.encode(),
    )
    suggestion = TaskSuggestion(
        uuid=suggestion_uuid,
        sso_user_id=actor_id,
        department_code=body.department_code,
        suggestion_type=body.suggestion_type.value,
        task_id=task.id if task is not None else None,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        status="PENDING",
    )
    db.add(suggestion)
    db.flush()
    return suggestion


def suggestion_out(
    db: Session,
    suggestion: TaskSuggestion,
    cipher: ContentCipher,
    *,
    decrypt_content: bool,
) -> SuggestionOut:
    task_uuid = (
        db.scalar(select(Task.uuid).where(Task.id == suggestion.task_id))
        if suggestion.task_id is not None
        else None
    )
    content = None
    review_comment = None
    if decrypt_content:
        payload = cipher.decrypt_json(
            EncryptedPayload(
                suggestion.content_ciphertext,
                suggestion.content_nonce,
            ),
            suggestion.uuid.encode(),
        )
        content = str(payload.get("content", ""))
        if (
            suggestion.review_comment_ciphertext is not None
            and suggestion.review_comment_nonce is not None
        ):
            review_payload = cipher.decrypt_json(
                EncryptedPayload(
                    suggestion.review_comment_ciphertext,
                    suggestion.review_comment_nonce,
                ),
                f"{suggestion.uuid}:review".encode(),
            )
            review_comment = str(review_payload.get("comment", ""))
    return SuggestionOut(
        uuid=suggestion.uuid,
        sso_user_id=suggestion.sso_user_id,
        department_code=suggestion.department_code,
        suggestion_type=suggestion.suggestion_type,
        task_uuid=task_uuid,
        status=suggestion.status,
        reviewed_by=suggestion.reviewed_by,
        reviewed_at=suggestion.reviewed_at,
        content=content,
        review_comment=review_comment,
    )


def list_suggestions(
    db: Session,
    cipher: ContentCipher,
) -> list[SuggestionOut]:
    rows = db.scalars(
        select(TaskSuggestion).order_by(
            TaskSuggestion.created_at.desc(),
            TaskSuggestion.id.desc(),
        )
    ).all()
    return [
        suggestion_out(db, row, cipher, decrypt_content=True)
        for row in rows
    ]


def review_suggestion(
    db: Session,
    suggestion_uuid: str,
    body: SuggestionReviewIn,
    actor_id: str,
    cipher: ContentCipher,
) -> TaskSuggestion:
    review_status = (
        "APPROVED"
        if body.decision is ReviewDecision.APPROVE
        else "REJECTED"
    )
    values: dict[str, str | datetime | bytes | None] = {
        "status": review_status,
        "reviewed_by": actor_id,
        "reviewed_at": datetime.now(UTC),
    }
    if body.comment:
        encrypted = cipher.encrypt_json(
            {"comment": body.comment},
            f"{suggestion_uuid}:review".encode(),
        )
        values["review_comment_ciphertext"] = encrypted.ciphertext
        values["review_comment_nonce"] = encrypted.nonce
    result = db.execute(
        update(TaskSuggestion)
        .where(
            TaskSuggestion.uuid == suggestion_uuid,
            TaskSuggestion.status == "PENDING",
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        suggestion_id = db.scalar(
            select(TaskSuggestion.id).where(
                TaskSuggestion.uuid == suggestion_uuid
            )
        )
        if suggestion_id is None:
            raise GovernanceError(
                404,
                "SUGGESTION_NOT_FOUND",
                "建议不存在",
            )
        raise GovernanceError(
            409,
            "SUGGESTION_ALREADY_REVIEWED",
            "建议已完成审核",
        )
    suggestion = db.scalar(
        select(TaskSuggestion)
        .where(TaskSuggestion.uuid == suggestion_uuid)
        .execution_options(populate_existing=True)
    )
    if suggestion is None:
        raise GovernanceError(404, "SUGGESTION_NOT_FOUND", "建议不存在")
    return suggestion
