import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import Assistant, GenerationRecord, Task


@dataclass(frozen=True)
class HistoryFilters:
    task_uuid: str | None = None
    assistant_code: str | None = None
    status: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


def _apply_filters(
    statement: Select,
    user_id: str,
    filters: HistoryFilters,
) -> Select:
    statement = statement.where(GenerationRecord.sso_user_id == user_id)
    if filters.task_uuid:
        statement = statement.where(Task.uuid == filters.task_uuid)
    if filters.assistant_code:
        statement = statement.where(Assistant.code == filters.assistant_code)
    if filters.status:
        statement = statement.where(GenerationRecord.status == filters.status)
    else:
        statement = statement.where(GenerationRecord.status != "DELETED")
    if filters.created_from:
        statement = statement.where(
            GenerationRecord.created_at >= filters.created_from
        )
    if filters.created_to:
        statement = statement.where(
            GenerationRecord.created_at <= filters.created_to
        )
    return statement


def list_history(
    db: Session,
    user_id: str,
    filters: HistoryFilters,
    *,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, object]], int]:
    joined = (
        select(GenerationRecord, Task, Assistant)
        .join(Task, Task.id == GenerationRecord.task_id)
        .join(Assistant, Assistant.id == Task.assistant_id)
    )
    count_statement = (
        select(func.count(GenerationRecord.id))
        .join(Task, Task.id == GenerationRecord.task_id)
        .join(Assistant, Assistant.id == Task.assistant_id)
    )
    total = db.scalar(_apply_filters(count_statement, user_id, filters)) or 0
    rows = db.execute(
        _apply_filters(joined, user_id, filters)
        .order_by(GenerationRecord.created_at.desc(), GenerationRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [
        {
            "uuid": record.uuid,
            "task_uuid": task.uuid,
            "task_name": task.name,
            "assistant_code": assistant.code,
            "assistant_name": assistant.name,
            "status": record.status,
            "model_display_name": record.model_display_name,
            "model_id": record.model_id,
            "prompt_version": record.prompt_version,
            "latency_ms": record.latency_ms,
            "usage": record.usage_json or {},
            "created_at": record.created_at,
            "finished_at": record.finished_at,
        }
        for record, task, assistant in rows
    ], total


def get_owned_record(
    db: Session,
    user_id: str,
    generation_uuid: str,
    *,
    lock: bool = False,
) -> GenerationRecord:
    statement = select(GenerationRecord).where(
        GenerationRecord.uuid == generation_uuid,
        GenerationRecord.sso_user_id == user_id,
        GenerationRecord.status != "DELETED",
    )
    if lock:
        statement = statement.with_for_update()
    record = db.scalar(statement)
    if record is None:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    return record


def get_history_detail(
    db: Session,
    user_id: str,
    generation_uuid: str,
    cipher: ContentCipher,
) -> dict[str, object]:
    record = get_owned_record(db, user_id, generation_uuid)
    task, assistant = db.execute(
        select(Task, Assistant)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .where(Task.id == record.task_id)
    ).one()
    input_payload = cipher.decrypt_json(
        EncryptedPayload(record.input_ciphertext, record.input_nonce),
        record.uuid.encode(),
    )
    output = None
    if record.output_ciphertext is not None and record.output_nonce is not None:
        output_payload = cipher.decrypt_json(
            EncryptedPayload(record.output_ciphertext, record.output_nonce),
            record.uuid.encode(),
        )
        output = output_payload.get("output")
    parent_uuid = None
    if record.parent_generation_id:
        parent_uuid = db.scalar(
            select(GenerationRecord.uuid).where(
                GenerationRecord.id == record.parent_generation_id
            )
        )
    return {
        "uuid": record.uuid,
        "parent_generation_uuid": parent_uuid,
        "task_uuid": task.uuid,
        "task_name": task.name,
        "assistant_code": assistant.code,
        "assistant_name": assistant.name,
        "status": record.status,
        "input": input_payload.get("inputs", {}),
        "output": output,
        "model_display_name": record.model_display_name,
        "model_id": record.model_id,
        "prompt_version": record.prompt_version,
        "knowledge_refs": record.knowledge_refs_json or [],
        "latency_ms": record.latency_ms,
        "usage": record.usage_json or {},
        "created_at": record.created_at,
        "finished_at": record.finished_at,
    }


def tombstone_history(
    db: Session,
    user_id: str,
    generation_uuid: str,
    cipher: ContentCipher,
) -> None:
    record = get_owned_record(db, user_id, generation_uuid, lock=True)
    tombstone = cipher.encrypt_json(
        {"deleted": True},
        record.uuid.encode(),
    )
    record.input_ciphertext = tombstone.ciphertext
    record.input_nonce = tombstone.nonce
    record.output_ciphertext = tombstone.ciphertext
    record.output_nonce = tombstone.nonce
    record.completion_token_hash = hashlib.sha256(
        secrets.token_bytes(32)
    ).digest()
    record.model_display_name = ""
    record.model_id = ""
    record.usage_json = {}
    record.knowledge_refs_json = []
    record.error_code = ""
    record.error_message_safe = ""
    record.status = "DELETED"
    db.commit()


def load_regeneration_source(
    db: Session,
    user_id: str,
    generation_uuid: str,
    cipher: ContentCipher,
) -> tuple[GenerationRecord, Task, dict[str, object]]:
    parent = get_owned_record(db, user_id, generation_uuid)
    task = db.get(Task, parent.task_id)
    if task is None or task.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="原任务当前不可用")
    payload = cipher.decrypt_json(
        EncryptedPayload(parent.input_ciphertext, parent.input_nonce),
        parent.uuid.encode(),
    )
    return parent, task, dict(payload.get("inputs") or {})
