import hashlib
import hmac
import secrets
import uuid as uuid_lib
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher
from .models import GenerationRecord, Task, TaskField, TaskPromptBinding
from .prompt_client import PromptCenterClient, render_prompt
from .schemas import CompleteGenerationIn, PrepareGenerationIn, SessionPayload


@dataclass(frozen=True)
class PreparedGeneration:
    generation_uuid: str
    completion_token: str
    messages: list[dict[str, str]]
    temperature: float
    safety_notice: str


def _missing_required(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


async def prepare_generation(
    db: Session,
    session: SessionPayload,
    request: PrepareGenerationIn,
    prompt_client: PromptCenterClient,
    cipher: ContentCipher,
    key_version: str,
) -> PreparedGeneration:
    task = db.scalar(
        select(Task).where(Task.uuid == request.task_uuid, Task.status == "ACTIVE")
    )
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在或未启用")
    fields = list(db.scalars(
        select(TaskField)
        .where(TaskField.task_id == task.id)
        .order_by(TaskField.sort_order.asc(), TaskField.id.asc())
    ))
    allowed_keys = {field.field_key for field in fields}
    unknown_keys = sorted(set(request.inputs) - allowed_keys)
    if unknown_keys:
        raise HTTPException(
            status_code=422,
            detail=f"存在未定义字段：{'、'.join(unknown_keys)}",
        )
    missing_keys = [
        field.field_key
        for field in fields
        if field.required and (
            field.field_key not in request.inputs
            or _missing_required(request.inputs.get(field.field_key))
        )
    ]
    if missing_keys:
        raise HTTPException(
            status_code=422,
            detail=f"缺少必填字段：{'、'.join(missing_keys)}",
        )
    binding = db.scalar(
        select(TaskPromptBinding).where(
            TaskPromptBinding.task_id == task.id,
            TaskPromptBinding.status == "ACTIVE",
        )
    )
    if binding is None:
        raise HTTPException(status_code=409, detail="任务尚未绑定可用 Prompt")
    requested_version = (
        binding.pinned_version
        if binding.version_policy == "PINNED"
        else None
    )
    if binding.version_policy == "PINNED" and requested_version is None:
        raise HTTPException(status_code=409, detail="任务固定版本配置无效")
    try:
        prompt = await prompt_client.get_published(
            binding.prompt_external_id,
            requested_version,
        )
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="提示词中心暂不可用") from exc
    try:
        rendered_prompt = render_prompt(prompt["content"], request.inputs)
        prompt_version = int(prompt["version_no"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc) or "Prompt 配置无效") from exc

    generation_uuid = str(uuid_lib.uuid4())
    completion_token = secrets.token_urlsafe(32)
    encrypted = cipher.encrypt_json(
        {"inputs": request.inputs},
        generation_uuid.encode(),
    )
    record = GenerationRecord(
        uuid=generation_uuid,
        sso_user_id=str(session.user.id),
        username_snapshot=session.user.username,
        department_snapshot=session.scope.department or "",
        task_id=task.id,
        prompt_external_id=int(prompt["prompt_id"]),
        prompt_version=prompt_version,
        input_ciphertext=encrypted.ciphertext,
        input_nonce=encrypted.nonce,
        key_version=key_version,
        completion_token_hash=hashlib.sha256(completion_token.encode()).digest(),
        status="PENDING",
    )
    db.add(record)
    db.commit()
    return PreparedGeneration(
        generation_uuid=generation_uuid,
        completion_token=completion_token,
        messages=[
            {
                "role": "system",
                "content": (
                    f"你正在执行“{task.name}”。输出格式：{task.output_format}。"
                    f"{task.safety_notice}"
                ),
            },
            {"role": "user", "content": rendered_prompt},
        ],
        temperature=0.3,
        safety_notice=task.safety_notice,
    )


def complete_generation(
    db: Session,
    session: SessionPayload,
    generation_uuid: str,
    request: CompleteGenerationIn,
    cipher: ContentCipher,
) -> GenerationRecord:
    record = db.scalar(
        select(GenerationRecord)
        .where(GenerationRecord.uuid == generation_uuid)
        .with_for_update()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    if record.sso_user_id != str(session.user.id):
        raise HTTPException(status_code=403, detail="无权完成该生成记录")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail="生成记录状态不可变更")
    actual_hash = hashlib.sha256(request.completion_token.encode()).digest()
    if not hmac.compare_digest(record.completion_token_hash, actual_hash):
        raise HTTPException(status_code=403, detail="生成完成凭据无效")

    encrypted = cipher.encrypt_json(
        {"output": request.output},
        generation_uuid.encode(),
    )
    record.output_ciphertext = encrypted.ciphertext
    record.output_nonce = encrypted.nonce
    record.model_display_name = request.model_display_name
    record.model_id = request.model_id
    record.latency_ms = request.latency_ms
    record.usage_json = request.usage
    record.status = "COMPLETED"
    record.error_code = ""
    db.commit()
    return record
