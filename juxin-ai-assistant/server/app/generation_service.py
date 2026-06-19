import hashlib
import hmac
import json
import secrets
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher
from .field_validation import FieldValidationError, validate_task_inputs
from .knowledge import KnowledgeRetriever
from .models import GenerationRecord, Task, TaskField, TaskPromptBinding
from .prompt_client import PromptCenterClient, render_prompt
from .schemas import CompleteGenerationIn, PrepareGenerationIn, SessionPayload
from .sensitive import SensitiveDetector


@dataclass(frozen=True)
class PreparedGeneration:
    generation_uuid: str
    completion_token: str
    messages: list[dict[str, str]]
    temperature: float
    safety_notice: str


async def prepare_generation(
    db: Session,
    session: SessionPayload,
    request: PrepareGenerationIn,
    prompt_client: PromptCenterClient,
    cipher: ContentCipher,
    key_version: str,
    sensitive_detector: SensitiveDetector,
    knowledge_retriever: KnowledgeRetriever,
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
    try:
        normalized_inputs = validate_task_inputs(
            [
                {
                    "field_key": field.field_key,
                    "field_type": field.field_type,
                    "required": field.required,
                    "options_json": field.options_json or [],
                    "validation_json": field.validation_json or {},
                }
                for field in fields
            ],
            request.inputs,
        )
    except FieldValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "TASK_INPUT_INVALID",
                "message": str(exc),
            },
        ) from exc
    sensitive_scan = sensitive_detector.scan(normalized_inputs)
    if sensitive_scan.findings and not sensitive_detector.is_confirmed(
        sensitive_scan,
        request.sensitive_confirmation_digest,
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SENSITIVE_CONFIRMATION_REQUIRED",
                "message": "检测到敏感信息，请确认后继续",
                "findings": [
                    {
                        "code": finding.code,
                        "field": finding.field,
                        "preview": finding.preview,
                    }
                    for finding in sensitive_scan.findings
                ],
                "confirmation_digest": sensitive_scan.confirmation_digest,
            },
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
        rendered_prompt = render_prompt(prompt["content"], normalized_inputs)
        prompt_version = int(prompt["version_no"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc) or "Prompt 配置无效") from exc
    knowledge_items = knowledge_retriever.retrieve(
        db,
        task.id,
        normalized_inputs,
    )
    field_by_key = {field.field_key: field for field in fields}
    input_lines = []
    for key, value in normalized_inputs.items():
        label = field_by_key[key].label
        rendered_value = (
            json.dumps(value, ensure_ascii=False)
            if isinstance(value, (list, dict))
            else str(value)
        )
        input_lines.append(f"{label}：{rendered_value}")
    if knowledge_items:
        input_lines.extend(
            [
                "",
                "----- 参考知识开始 -----",
                *[
                    f"[{item.title}]\n{item.content}"
                    for item in knowledge_items
                ],
                "----- 参考知识结束 -----",
            ]
        )

    generation_uuid = str(uuid_lib.uuid4())
    completion_token = secrets.token_urlsafe(32)
    encrypted = cipher.encrypt_json(
        {"inputs": normalized_inputs},
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
        knowledge_refs_json=[
            {
                "uuid": item.uuid,
                "title": item.title,
                "score": item.score,
            }
            for item in knowledge_items
        ],
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
                    "公司安全规则：不得编造事实，不得泄露秘密，输出必须由员工复核。"
                    f"\n\n任务 Prompt：\n{rendered_prompt}"
                    f"\n\n输出格式：{task.output_format}。{task.safety_notice}"
                ),
            },
            {"role": "user", "content": "\n".join(input_lines)},
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
    record.error_message_safe = ""
    record.finished_at = datetime.now(UTC)
    db.commit()
    return record
