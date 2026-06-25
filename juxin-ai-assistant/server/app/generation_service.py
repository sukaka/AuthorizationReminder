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

from .context_builder import (
    ContextSection,
    build_messages,
    build_untrusted_content_block,
    estimate_context_usage,
)
from .crypto import ContentCipher
from .document_governance import render_document_governance
from .field_validation import FieldValidationError, validate_task_inputs
from .knowledge import KnowledgeRetriever, RetrievedKnowledge
from .models import GenerationRecord, Task, TaskField, TaskPromptBinding
from .prompt_client import PromptCenterClient, render_prompt
from .quality_rules import (
    is_trusted_quality_rule,
    parse_quality_rule_tags,
)
from .schemas import (
    CompleteGenerationIn,
    GenerationFailureIn,
    PrepareGenerationIn,
    SessionPayload,
)
from .sensitive import SensitiveDetector

QUALITY_RULE_MAX_COUNT = 20
QUALITY_RULE_MAX_CHARS = 32_000
QUALITY_RULE_SOURCE_NOTICE = "来源：公司治理知识库，作为强约束执行。"
REFERENCE_KNOWLEDGE_LIMIT = 8


@dataclass(frozen=True)
class PreparedGeneration:
    generation_uuid: str
    completion_token: str
    messages: list[dict[str, str]]
    temperature: float
    safety_notice: str
    context_usage: dict[str, int | str]


def _is_trusted_quality_rule(
    item: RetrievedKnowledge,
    assistant_code: str,
) -> bool:
    return is_trusted_quality_rule(
        item.tags,
        assistant_code=assistant_code,
        created_by=item.created_by,
        updated_by=item.updated_by,
    )


def _render_quality_rules(
    items: list[RetrievedKnowledge],
    assistant_code: str,
) -> tuple[str, list[RetrievedKnowledge]]:
    trusted = [
        item
        for item in items
        if _is_trusted_quality_rule(item, assistant_code)
    ]
    trusted.sort(
        key=lambda item: (
            (
                parsed.key
                if (
                    parsed := parse_quality_rule_tags(
                        item.tags,
                        expected_assistant_code=assistant_code,
                    )
                )
                else ""
            ),
            item.title,
            item.uuid,
        )
    )
    rendered: list[str] = []
    selected: list[RetrievedKnowledge] = []
    used_chars = 0
    content_max_chars = QUALITY_RULE_MAX_CHARS - len(QUALITY_RULE_SOURCE_NOTICE) - 1
    for item in trusted[:QUALITY_RULE_MAX_COUNT]:
        entry = f"[{item.title}]\n{item.content}"
        separator_chars = 2 if rendered else 0
        remaining = content_max_chars - used_chars - separator_chars
        if remaining <= 0:
            break
        rendered.append(entry[:remaining])
        selected.append(item)
        used_chars += separator_chars + min(len(entry), remaining)
        if len(entry) > remaining:
            break
    return "\n\n".join(rendered), selected


async def prepare_generation(
    db: Session,
    session: SessionPayload,
    request: PrepareGenerationIn,
    prompt_client: PromptCenterClient,
    cipher: ContentCipher,
    key_version: str,
    sensitive_detector: SensitiveDetector,
    knowledge_retriever: KnowledgeRetriever,
) -> tuple[PreparedGeneration, GenerationRecord]:
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
        if binding.version_policy in {"PINNED", "ROLLOUT"}
        else None
    )
    if (
        binding.version_policy in {"PINNED", "ROLLOUT"}
        and requested_version is None
    ):
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
        limit=None,
    )
    assistant_code = task.assistant.code
    quality_rules = [
        item
        for item in knowledge_items
        if _is_trusted_quality_rule(item, assistant_code)
    ]
    reference_items = [
        item
        for item in knowledge_items
        if not _is_trusted_quality_rule(item, assistant_code)
    ][:REFERENCE_KNOWLEDGE_LIMIT]
    rendered_quality_rules, injected_quality_rules = _render_quality_rules(
        quality_rules,
        assistant_code,
    )
    injected_knowledge_items = injected_quality_rules + reference_items
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
    user_input_block = build_untrusted_content_block(
        title="员工输入",
        content="\n".join(input_lines),
        source="user_input",
    )
    sections = [
        ContextSection(
            kind="system",
            title="公司安全规则",
            content="不得编造事实，不得泄露秘密，输出必须由员工复核。",
        ),
        ContextSection(
            kind="system",
            title="任务 Prompt",
            content=rendered_prompt,
        ),
        ContextSection(
            kind="system",
            title="输出格式",
            content=f"{task.output_format}。{task.safety_notice}",
        ),
        ContextSection(kind="user", title="员工输入", content=user_input_block),
    ]
    if reference_items:
        reference_content = "\n\n".join(
            f"[{item.title}]\n{item.content}"
            for item in reference_items
        )
        sections.append(
            ContextSection(
                kind="user",
                title="参考知识",
                content=build_untrusted_content_block(
                    title="参考知识",
                    content=reference_content,
                    source="knowledge:task-reference",
                ),
            )
        )
    governance = render_document_governance(
        formal_document=task.formal_document,
        document_type=task.document_type,
    )
    if governance:
        sections.append(
            ContextSection(kind="system", title="文档治理规则", content=governance)
        )
    if rendered_quality_rules:
        sections.append(
            ContextSection(
                kind="system",
                title="必须遵守的质量规则",
                content=f"{QUALITY_RULE_SOURCE_NOTICE}\n{rendered_quality_rules}",
            )
        )
    messages = build_messages(sections)
    context_usage = estimate_context_usage([
        message["content"]
        for message in messages
    ])

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
                "matched_keywords": list(item.matched_keywords),
                "score": item.score,
                "priority": item.priority,
                "clipped": item.clipped,
            }
            for item in injected_knowledge_items
        ],
    )
    db.add(record)
    db.flush()
    return (
        PreparedGeneration(
            generation_uuid=generation_uuid,
            completion_token=completion_token,
            messages=messages,
            temperature=0.3,
            safety_notice=task.safety_notice,
            context_usage=context_usage,
        ),
        record,
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
    db.flush()
    return record


def fail_generation(
    db: Session,
    session: SessionPayload,
    generation_uuid: str,
    request: GenerationFailureIn,
) -> GenerationRecord:
    record = db.scalar(
        select(GenerationRecord)
        .where(GenerationRecord.uuid == generation_uuid)
        .with_for_update()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="生成记录不存在")
    if record.sso_user_id != str(session.user.id):
        raise HTTPException(status_code=403, detail="无权更新该生成记录")
    if record.status != "PENDING":
        raise HTTPException(status_code=409, detail="生成记录状态不可变更")
    actual_hash = hashlib.sha256(request.completion_token.encode()).digest()
    if not hmac.compare_digest(record.completion_token_hash, actual_hash):
        raise HTTPException(status_code=403, detail="生成完成凭据无效")

    record.status = "FAILED"
    record.error_code = request.error_code[:64]
    record.error_message_safe = _sanitize_generation_error_message(
        request.error_message or request.error_code
    )
    record.finished_at = datetime.now(UTC)
    db.flush()
    return record


def _sanitize_generation_error_message(message: str) -> str:
    forbidden_terms = ("api key", "apikey", "token", "authorization", "secret")
    sanitized = message.strip()
    lowered = sanitized.lower()
    if any(term in lowered for term in forbidden_terms):
        return "本地模型调用失败，请检查模型配置后重试"
    return sanitized[:500]
