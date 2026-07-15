from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agent_contracts import AgentRunStage, AgentRunStatus
from ..crypto import ContentCipher, EncryptedPayload
from ..models import AgentRun, AgentRunStep, KnowledgeFile, WorkArtifactVersion
from ..project_context_models import ProjectFile
from .models import (
    ProfessionalModelStepToken,
    ProfessionalRunBinding,
    ReviewRun,
    SkillVersion,
    TemplateVersion,
)
from .runner_schemas import (
    ProfessionalModelResultIn,
    ProfessionalRunInputIn,
    ProfessionalRunStartIn,
)
from .run_store import ProfessionalRunStore
from .schemas import DeliverableVersionCreateIn, ReviewStartIn
from .service import (
    PROJECT_WRITER_ROLES,
    ProfessionalDeliveryError,
    create_deliverable_review,
    create_deliverable_version,
    deliverable_version_payload,
    get_visible_deliverable,
    review_run_payload,
)


TOKEN_TTL_MINUTES = 15
MIN_PROFESSIONAL_STEPS = 10
MODEL_METADATA_ALLOWLIST = frozenset(
    {"model_profile_uuid", "model_id", "provider", "latency_ms"}
)
PROFESSIONAL_STAGE_DEFINITIONS = (
    ("scenario", "识别任务场景", ("select_skill",)),
    ("scope", "确定交付范围", ("scope",)),
    ("completeness", "检查输入完整性", ("completeness",)),
    ("plan", "制定执行计划", ("plan",)),
    ("gather_facts", "收集材料并提取事实", ("gather", "extract_facts")),
    ("confirm_facts", "确认关键事实", ("confirm_facts",)),
    ("draft", "生成专业草稿", ("draft",)),
    ("review", "执行质量审查", ("review",)),
    ("persist", "保存成果版本", ("persist",)),
)
STAGE_SUMMARY_FALLBACKS = {
    "scenario": "等待识别任务场景",
    "scope": "等待确定交付范围",
    "completeness": "等待检查必要输入",
    "plan": "等待制定执行计划",
    "gather_facts": "等待收集材料并提取事实",
    "confirm_facts": "等待确认关键事实",
    "draft": "等待模型生成专业草稿",
    "review": "等待执行质量审查",
    "persist": "等待保存成果版本",
}


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _input_associated_data(run_uuid: str) -> bytes:
    return f"professional-run:{run_uuid}".encode("utf-8")


def _prompt_associated_data(skill_version_uuid: str) -> bytes:
    return f"professional-skill-version:{skill_version_uuid}".encode("utf-8")


def _require_write_access(access) -> None:
    if access.artifact.scope_type == "personal":
        return
    if access.member is None or access.member.role not in PROJECT_WRITER_ROLES:
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_WRITE_FORBIDDEN",
            "当前项目角色不能生成成果版本",
            403,
        )


def _missing_required_fields(skill_version: SkillVersion, inputs: dict[str, Any]) -> list[str]:
    required = (skill_version.input_schema_json or {}).get("required") or []
    missing: list[str] = []
    for field in required:
        name = str(field)
        value = inputs.get(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(name)
    return missing


def _normalize_resource_refs(
    resource_refs: list[dict[str, Any]],
) -> list[dict[str, str]]:
    normalized_refs: list[dict[str, str]] = []
    for item in resource_refs:
        if not isinstance(item, dict):
            raise ProfessionalDeliveryError(
                "INVALID_RESOURCE_REFERENCE",
                "资源引用必须是结构化对象",
                422,
            )
        normalized = {
            "resource_type": str(item.get("resource_type") or "").strip()[:128],
            "resource_uuid": str(item.get("resource_uuid") or "").strip()[:128],
        }
        if not normalized.get("resource_type") or not normalized.get("resource_uuid"):
            raise ProfessionalDeliveryError(
                "INVALID_RESOURCE_REFERENCE",
                "资源引用缺少 resource_type 或 resource_uuid",
                422,
            )
        normalized_refs.append(normalized)
    return normalized_refs


class ProfessionalRunnerService:
    def __init__(
        self,
        db: Session,
        cipher: ContentCipher,
        *,
        key_version: str,
    ) -> None:
        self.db = db
        self.cipher = cipher
        self.key_version = key_version
        self.agent = ProfessionalRunStore(db, cipher, key_version=key_version)

    def _resolve_authorized_resources(
        self,
        *,
        access,
        skill: SkillVersion,
        owner_user_id: str,
        resource_refs: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        allowed_types = {
            str(item)
            for item in (skill.allowed_resource_types_json or [])
            if str(item)
        }
        resolved: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in _normalize_resource_refs(resource_refs):
            resource_type = item["resource_type"]
            resource_uuid = item["resource_uuid"]
            if resource_type not in allowed_types:
                raise ProfessionalDeliveryError(
                    "PROFESSIONAL_RESOURCE_TYPE_NOT_ALLOWED",
                    "当前 Skill 不允许引用该资源类型",
                    422,
                    {"resource_type": resource_type},
                )
            key = (resource_type, resource_uuid)
            if key in seen:
                continue
            seen.add(key)
            if resource_type == "project_context":
                if access.project is None or resource_uuid != access.project.uuid:
                    raise ProfessionalDeliveryError(
                        "PROFESSIONAL_RESOURCE_NOT_FOUND",
                        "资源不存在或不在当前成果授权范围内",
                        404,
                    )
                resolved.append(
                    {
                        "resource_type": resource_type,
                        "resource_uuid": access.project.uuid,
                    }
                )
                continue
            if resource_type != "knowledge_file":
                raise ProfessionalDeliveryError(
                    "PROFESSIONAL_RESOURCE_TYPE_UNSUPPORTED",
                    "当前执行器尚不支持该资源类型",
                    422,
                    {"resource_type": resource_type},
                )
            knowledge_file = self.db.scalar(
                select(KnowledgeFile).where(
                    KnowledgeFile.uuid == resource_uuid,
                    KnowledgeFile.status == "READY",
                    KnowledgeFile.deleted_at.is_(None),
                    KnowledgeFile.is_current_version.is_(True),
                    KnowledgeFile.reference_enabled.is_(True),
                )
            )
            is_allowed = False
            if knowledge_file is not None:
                if access.artifact.scope_type == "personal":
                    is_allowed = owner_user_id in {
                        knowledge_file.owner_user_id,
                        knowledge_file.sso_user_id,
                    }
                elif access.project is not None:
                    is_allowed = (
                        self.db.scalar(
                            select(ProjectFile.id).where(
                                ProjectFile.project_id == access.project.id,
                                ProjectFile.knowledge_file_id == knowledge_file.id,
                                ProjectFile.status == "active",
                            )
                        )
                        is not None
                    )
            if knowledge_file is None or not is_allowed:
                raise ProfessionalDeliveryError(
                    "PROFESSIONAL_RESOURCE_NOT_FOUND",
                    "资源不存在或不在当前成果授权范围内",
                    404,
                )
            resolved.append(
                {
                    "resource_type": resource_type,
                    "resource_uuid": knowledge_file.uuid,
                    "version_uuid": knowledge_file.uuid,
                    "content_hash": knowledge_file.content_sha256,
                }
            )
        return resolved

    def _binding_for_owner(
        self,
        run_uuid: str,
        owner_user_id: str,
    ) -> ProfessionalRunBinding:
        binding = self.db.scalar(
            select(ProfessionalRunBinding).where(
                ProfessionalRunBinding.agent_run_uuid == run_uuid,
                ProfessionalRunBinding.owner_user_id == owner_user_id,
            )
        )
        if binding is None:
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_NOT_FOUND",
                "专业成果任务不存在",
                404,
            )
        return binding

    def _run(self, binding: ProfessionalRunBinding) -> AgentRun:
        run = self.db.scalar(
            select(AgentRun).where(AgentRun.uuid == binding.agent_run_uuid)
        )
        if run is None:
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_NOT_FOUND",
                "专业成果任务不存在",
                404,
            )
        return run

    def _references(
        self,
        binding: ProfessionalRunBinding,
    ) -> tuple[WorkArtifactVersion, SkillVersion, TemplateVersion]:
        source = self.db.get(WorkArtifactVersion, binding.source_version_id)
        skill = self.db.get(SkillVersion, binding.skill_version_id)
        template = self.db.get(TemplateVersion, binding.template_version_id)
        if source is None or skill is None or template is None:
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_CONTEXT_INVALID",
                "专业成果任务绑定的版本不可用",
                409,
            )
        return source, skill, template

    def _decrypt_inputs(self, binding: ProfessionalRunBinding) -> dict[str, Any]:
        return self.cipher.decrypt_json(
            EncryptedPayload(binding.input_ciphertext, binding.input_nonce),
            _input_associated_data(binding.agent_run_uuid),
        )

    def _encrypt_inputs(
        self,
        binding: ProfessionalRunBinding,
        inputs: dict[str, Any],
    ) -> None:
        encrypted = self.cipher.encrypt_json(
            inputs,
            _input_associated_data(binding.agent_run_uuid),
        )
        binding.input_ciphertext = encrypted.ciphertext
        binding.input_nonce = encrypted.nonce

    def _prompt_bundle(self, skill: SkillVersion) -> dict[str, Any]:
        if skill.prompt_bundle_ciphertext is None or skill.prompt_bundle_nonce is None:
            raise ProfessionalDeliveryError(
                "SKILL_PROMPT_NOT_AVAILABLE",
                "Skill 提示配置不可用",
                409,
            )
        value = self.cipher.decrypt_json(
            EncryptedPayload(
                skill.prompt_bundle_ciphertext,
                skill.prompt_bundle_nonce,
            ),
            _prompt_associated_data(skill.uuid),
        )
        return value if isinstance(value, dict) else {}

    def _persist_checkpoint(
        self,
        run: AgentRun,
        binding: ProfessionalRunBinding,
        *,
        missing_fields: list[str] | None = None,
        step_uuid: str | None = None,
        request_hash: str | None = None,
        operation_state: dict[str, Any] | None = None,
    ) -> None:
        previous = dict(run.checkpoint_json or {})
        checkpoint = {
            "professional_phase": binding.current_phase,
            "professional_status": binding.status,
            "waiting_reason": binding.waiting_reason,
            "context_hash": binding.context_hash,
            "missing_fields": list(missing_fields or []),
            "model_step_uuid": step_uuid,
            "model_request_hash": request_hash,
            "operations": dict(previous.get("operations") or {}),
        }
        if operation_state:
            checkpoint["operations"].update(operation_state)
        self.agent.persist_safe_checkpoint(
            run,
            checkpoint=checkpoint,
            stage=(
                AgentRunStage.PLANNING
                if binding.waiting_reason == "input"
                else AgentRunStage.EXECUTING
            ),
            progress=35 if binding.waiting_reason == "input" else 70,
        )

    def _build_model_request(
        self,
        binding: ProfessionalRunBinding,
        *,
        step_uuid: str,
        one_time_token: str | None,
    ) -> dict[str, Any]:
        _, skill, _ = self._references(binding)
        prompt = self._prompt_bundle(skill)
        inputs = self._decrypt_inputs(binding)
        request_body = {
            "step_uuid": step_uuid,
            "model_profile_uuid": binding.model_profile_uuid,
            "system_prompt": str(prompt.get("system") or ""),
            "instructions": [
                str(item)
                for item in (prompt.get("instructions") or [])
                if isinstance(item, (str, int, float))
            ],
            "inputs": inputs,
            "output_schema": dict(skill.output_schema_json or {}),
            "context": dict(binding.execution_context_json or {}),
        }
        request_hash = canonical_hash(request_body)
        return {
            **request_body,
            "request_hash": request_hash,
            "one_time_token": one_time_token,
        }

    def _issue_model_request(
        self,
        run: AgentRun,
        binding: ProfessionalRunBinding,
        *,
        step: AgentRunStep,
    ) -> dict[str, Any]:
        plain_token = secrets.token_urlsafe(32)
        request = self._build_model_request(
            binding,
            step_uuid=step.uuid,
            one_time_token=plain_token,
        )
        attempt = int(
            self.db.scalar(
                select(ProfessionalModelStepToken.attempt)
                .where(
                    ProfessionalModelStepToken.agent_run_uuid == run.uuid,
                    ProfessionalModelStepToken.step_uuid == step.uuid,
                )
                .order_by(ProfessionalModelStepToken.attempt.desc())
                .limit(1)
            )
            or 0
        ) + 1
        self.db.add(
            ProfessionalModelStepToken(
                agent_run_uuid=run.uuid,
                step_uuid=step.uuid,
                attempt=attempt,
                token_hash=_token_hash(plain_token),
                request_hash=request["request_hash"],
                expires_at=_utc_now() + timedelta(minutes=TOKEN_TTL_MINUTES),
                metadata_json={
                    "request_kind": "professional_draft",
                    "model_profile_uuid": binding.model_profile_uuid,
                },
            )
        )
        self.db.flush()
        return request

    def _prepare_model_wait(
        self,
        run: AgentRun,
        binding: ProfessionalRunBinding,
        *,
        operation_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        for phase in ("plan", "gather", "extract_facts", "confirm_facts"):
            self.agent.add_step(
                run,
                step_type=phase,
                status="succeeded",
                role="professional_runner",
                output_summary={"summary": f"{phase} 已完成"},
            )
        step = self.agent.add_step(
            run,
            step_type="draft",
            status="waiting",
            role="model_bridge",
            input_summary={"context_hash": binding.context_hash},
        )
        binding.current_phase = "draft"
        binding.waiting_reason = "model"
        binding.status = "waiting_for_model"
        request = self._issue_model_request(run, binding, step=step)
        self.agent.transition_status(run, AgentRunStatus.WAITING_CONFIRMATION)
        self._persist_checkpoint(
            run,
            binding,
            step_uuid=step.uuid,
            request_hash=request["request_hash"],
            operation_state=operation_state,
        )
        return request

    def _complete_waiting_step(
        self,
        *,
        run_uuid: str,
        step_type: str,
        summary: str,
    ) -> None:
        step = self.db.scalar(
            select(AgentRunStep)
            .where(
                AgentRunStep.run_id == run_uuid,
                AgentRunStep.step_type == step_type,
                AgentRunStep.status == "waiting",
            )
            .order_by(AgentRunStep.sequence.desc())
            .limit(1)
        )
        if step is None:
            return
        now = _utc_now()
        step.status = "succeeded"
        step.output_summary_json = {"summary": summary}
        step.finished_at = now
        if step.started_at is not None:
            step.latency_ms = max(
                int(step.latency_ms or 0),
                int((now - step.started_at).total_seconds() * 1000),
            )

    def start(
        self,
        *,
        deliverable_uuid: str,
        body: ProfessionalRunStartIn,
        owner_user_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        request_hash = canonical_hash(
            {
                "deliverable_uuid": deliverable_uuid,
                "body": body.model_dump(mode="json"),
            }
        )
        existing = self.db.scalar(
            select(ProfessionalRunBinding).where(
                ProfessionalRunBinding.owner_user_id == owner_user_id,
                ProfessionalRunBinding.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            if existing.request_hash != request_hash:
                raise ProfessionalDeliveryError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "该幂等键已用于不同请求",
                    409,
                )
            return self.payload(existing, replayed=True)

        access = get_visible_deliverable(
            self.db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=owner_user_id,
            lock=True,
        )
        _require_write_access(access)
        artifact = access.artifact
        if artifact.row_version != body.row_version:
            raise ProfessionalDeliveryError(
                "DELIVERABLE_VERSION_CONFLICT",
                "成果已被其他操作更新，请刷新后重试",
                409,
                {"current_row_version": artifact.row_version},
            )
        source = self.db.scalar(
            select(WorkArtifactVersion).where(
                WorkArtifactVersion.uuid == body.source_version_uuid,
                WorkArtifactVersion.artifact_id == artifact.id,
            )
        )
        if source is None or source.id != artifact.current_version_id:
            raise ProfessionalDeliveryError(
                "SOURCE_VERSION_NOT_CURRENT",
                "只能基于成果当前版本启动专业任务",
                409,
            )
        if source.skill_version_id is None or source.template_version_id is None:
            raise ProfessionalDeliveryError(
                "DELIVERABLE_VERSION_NOT_AVAILABLE",
                "成果当前版本未绑定 Skill 或模板",
                409,
            )
        skill = self.db.get(SkillVersion, source.skill_version_id)
        template = self.db.get(TemplateVersion, source.template_version_id)
        if (
            skill is None
            or template is None
            or skill.status != "published"
            or template.status != "published"
        ):
            raise ProfessionalDeliveryError(
                "CATALOG_VERSION_NOT_PUBLISHED",
                "成果绑定的 Skill 或模板版本不可用于执行",
                409,
            )
        if body.max_steps < MIN_PROFESSIONAL_STEPS:
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_BUDGET_TOO_SMALL",
                "执行预算不足以完成固定专业流程",
                422,
                {"minimum_steps": MIN_PROFESSIONAL_STEPS},
            )
        resource_refs = self._resolve_authorized_resources(
            access=access,
            skill=skill,
            owner_user_id=owner_user_id,
            resource_refs=body.resource_refs,
        )
        run = self.agent.create_run(
            owner_user_id=owner_user_id,
            input_text="专业成果生成请求",
            run_type="professional_delivery",
            title=f"生成：{artifact.title}",
            max_steps=body.max_steps,
            max_model_calls=body.max_model_calls,
            metadata={"deliverable_uuid": artifact.uuid, "professional": True},
        )
        self.agent.mark_running(run, stage=AgentRunStage.PLANNING)
        execution_context = {
            "schema_version": "1.0",
            "run_uuid": run.uuid,
            "deliverable_uuid": artifact.uuid,
            "scope_type": artifact.scope_type,
            "project_uuid": access.project.uuid if access.project is not None else None,
            "actor": {
                "user_id": owner_user_id,
                "project_role": access.member.role if access.member is not None else "owner",
            },
            "versions": {
                "source": {"uuid": source.uuid, "content_hash": source.content_hash},
                "skill": {"uuid": skill.uuid, "content_hash": skill.content_hash},
                "template": {"uuid": template.uuid, "content_hash": template.content_hash},
            },
            "authorized_resources": resource_refs,
            "budgets": {
                "max_steps": body.max_steps,
                "max_model_calls": body.max_model_calls,
                "max_automatic_revisions": 2,
            },
        }
        encrypted = self.cipher.encrypt_json(
            body.inputs,
            _input_associated_data(run.uuid),
        )
        binding = ProfessionalRunBinding(
            agent_run_uuid=run.uuid,
            deliverable_id=artifact.id,
            source_version_id=source.id,
            skill_version_id=skill.id,
            template_version_id=template.id,
            owner_user_id=owner_user_id,
            project_id=artifact.project_id,
            request_hash=request_hash,
            idempotency_key=idempotency_key,
            input_ciphertext=encrypted.ciphertext,
            input_nonce=encrypted.nonce,
            key_version=self.key_version,
            execution_context_json=execution_context,
            context_hash=canonical_hash(execution_context),
            resource_refs_json=resource_refs,
            model_profile_uuid=body.model_profile_uuid,
            current_phase="select_skill",
            status="running",
        )
        self.db.add(binding)
        self.db.flush()
        for phase in ("select_skill", "scope"):
            self.agent.add_step(
                run,
                step_type=phase,
                status="succeeded",
                role="professional_runner",
                output_summary={"summary": f"{phase} 已完成"},
            )
        missing = _missing_required_fields(skill, body.inputs)
        self.agent.add_step(
            run,
            step_type="completeness",
            status="waiting" if missing else "succeeded",
            role="professional_runner",
            output_summary={"summary": "等待补充必要输入" if missing else "必要输入已齐全"},
        )
        pending_request = None
        if missing:
            binding.current_phase = "completeness"
            binding.waiting_reason = "input"
            binding.status = "waiting_for_input"
            self.agent.transition_status(run, AgentRunStatus.WAITING_CONFIRMATION)
            self._persist_checkpoint(run, binding, missing_fields=missing)
        else:
            pending_request = self._prepare_model_wait(run, binding)
        self.db.flush()
        return self.payload(
            binding,
            replayed=False,
            pending_request=pending_request,
        )

    def supply_input(
        self,
        *,
        run_uuid: str,
        body: ProfessionalRunInputIn,
        owner_user_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        run = self._run(binding)
        request_hash = canonical_hash(body.model_dump(mode="json"))
        operations = dict((run.checkpoint_json or {}).get("operations") or {})
        existing = operations.get("input") if isinstance(operations, dict) else None
        if isinstance(existing, dict) and existing.get("key") == idempotency_key:
            if existing.get("hash") != request_hash:
                raise ProfessionalDeliveryError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "该幂等键已用于不同请求",
                    409,
                )
            return self.payload(binding, replayed=True)
        if binding.status != "waiting_for_input":
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_NOT_WAITING_FOR_INPUT",
                "当前任务不在等待输入状态",
                409,
            )
        _, skill, _ = self._references(binding)
        merged = {**self._decrypt_inputs(binding), **body.inputs}
        missing = _missing_required_fields(skill, merged)
        self._encrypt_inputs(binding, merged)
        self.agent.transition_status(run, AgentRunStatus.RUNNING)
        operation_state = {"input": {"key": idempotency_key, "hash": request_hash}}
        pending_request = None
        if missing:
            binding.current_phase = "completeness"
            binding.waiting_reason = "input"
            binding.status = "waiting_for_input"
            self.agent.transition_status(run, AgentRunStatus.WAITING_CONFIRMATION)
            self._persist_checkpoint(
                run,
                binding,
                missing_fields=missing,
                operation_state=operation_state,
            )
        else:
            self._complete_waiting_step(
                run_uuid=run.uuid,
                step_type="completeness",
                summary="必要输入已补齐",
            )
            pending_request = self._prepare_model_wait(
                run,
                binding,
                operation_state=operation_state,
            )
        self.db.flush()
        return self.payload(
            binding,
            replayed=False,
            pending_request=pending_request,
        )

    def resume(
        self,
        *,
        run_uuid: str,
        owner_user_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        run = self._run(binding)
        operations = dict((run.checkpoint_json or {}).get("operations") or {})
        existing = operations.get("resume") if isinstance(operations, dict) else None
        if isinstance(existing, dict) and existing.get("key") == idempotency_key:
            return self.payload(binding, replayed=True)
        if binding.status != "waiting_for_model":
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_NOT_RESUMABLE",
                "当前任务不在等待模型状态",
                409,
            )
        step_uuid = str((run.checkpoint_json or {}).get("model_step_uuid") or "")
        step = self.db.scalar(
            select(AgentRunStep).where(
                AgentRunStep.uuid == step_uuid,
                AgentRunStep.run_id == run.uuid,
            )
        )
        if step is None:
            raise ProfessionalDeliveryError(
                "MODEL_STEP_NOT_FOUND",
                "待执行的模型步骤不存在",
                409,
            )
        now = _utc_now()
        active_tokens = list(
            self.db.scalars(
                select(ProfessionalModelStepToken).where(
                    ProfessionalModelStepToken.agent_run_uuid == run.uuid,
                    ProfessionalModelStepToken.step_uuid == step.uuid,
                    ProfessionalModelStepToken.consumed_at.is_(None),
                    ProfessionalModelStepToken.revoked_at.is_(None),
                )
            )
        )
        for token in active_tokens:
            token.revoked_at = now
        self.agent.transition_status(run, AgentRunStatus.RUNNING)
        request = self._issue_model_request(run, binding, step=step)
        self.agent.transition_status(run, AgentRunStatus.WAITING_CONFIRMATION)
        self._persist_checkpoint(
            run,
            binding,
            step_uuid=step.uuid,
            request_hash=request["request_hash"],
            operation_state={"resume": {"key": idempotency_key}},
        )
        self.db.flush()
        return self.payload(binding, replayed=False, pending_request=request)

    def accept_model_result(
        self,
        *,
        run_uuid: str,
        step_uuid: str,
        body: ProfessionalModelResultIn,
        owner_user_id: str,
        request_id: str,
    ) -> dict[str, Any]:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        run = self._run(binding)
        supplied_hash = _token_hash(body.one_time_token)
        token = self.db.scalar(
            select(ProfessionalModelStepToken).where(
                ProfessionalModelStepToken.agent_run_uuid == run_uuid,
                ProfessionalModelStepToken.step_uuid == step_uuid,
                ProfessionalModelStepToken.token_hash == supplied_hash,
            )
        )
        if token is None:
            raise ProfessionalDeliveryError(
                "MODEL_STEP_TOKEN_INVALID",
                "模型步骤令牌无效",
                409,
            )
        if token.revoked_at is not None:
            raise ProfessionalDeliveryError(
                "MODEL_STEP_TOKEN_REVOKED",
                "模型步骤令牌已撤销",
                409,
            )
        if token.consumed_at is not None:
            raise ProfessionalDeliveryError(
                "MODEL_STEP_TOKEN_USED",
                "模型步骤令牌已使用",
                409,
            )
        if token.expires_at <= _utc_now():
            raise ProfessionalDeliveryError(
                "MODEL_STEP_TOKEN_EXPIRED",
                "模型步骤令牌已过期",
                409,
            )
        if token.request_hash != body.request_hash:
            raise ProfessionalDeliveryError(
                "MODEL_REQUEST_HASH_MISMATCH",
                "模型结果与请求不匹配",
                409,
            )
        content_hash = canonical_hash(body.content)
        if content_hash != body.content_hash:
            raise ProfessionalDeliveryError(
                "MODEL_RESULT_HASH_MISMATCH",
                "模型结果内容哈希不匹配",
                422,
            )
        _, skill, _ = self._references(binding)
        required_output = (skill.output_schema_json or {}).get("required") or []
        missing_output = [str(key) for key in required_output if key not in body.content]
        if missing_output:
            raise ProfessionalDeliveryError(
                "MODEL_RESULT_SCHEMA_INVALID",
                "模型结果缺少必要字段",
                422,
                {"missing_fields": missing_output},
            )
        if binding.status != "waiting_for_model":
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_NOT_WAITING_FOR_MODEL",
                "当前任务不接受模型结果",
                409,
            )
        step = self.db.scalar(
            select(AgentRunStep).where(
                AgentRunStep.uuid == step_uuid,
                AgentRunStep.run_id == run_uuid,
            )
        )
        if step is None:
            raise ProfessionalDeliveryError(
                "MODEL_STEP_NOT_FOUND",
                "模型步骤不存在",
                404,
            )
        self.agent.transition_status(run, AgentRunStatus.RUNNING)
        artifact = get_visible_deliverable(
            self.db,
            deliverable_uuid=str(
                (binding.execution_context_json or {}).get("deliverable_uuid") or ""
            ),
            actor_user_id=owner_user_id,
            lock=True,
        ).artifact
        source, _, _ = self._references(binding)
        result = create_deliverable_version(
            self.db,
            deliverable_uuid=artifact.uuid,
            body=DeliverableVersionCreateIn(
                row_version=artifact.row_version,
                parent_version_uuid=source.uuid,
                content=body.content,
                content_summary=body.summary,
                change_summary=body.summary,
                creation_reason="professional_runner",
            ),
            actor_user_id=owner_user_id,
            idempotency_key=f"professional-run:{run.uuid}:persist",
            cipher=self.cipher,
            key_version=self.key_version,
        )
        review_result = create_deliverable_review(
            self.db,
            deliverable_uuid=artifact.uuid,
            body=ReviewStartIn(
                row_version=result.artifact.row_version,
                version_uuid=result.version.uuid,
                content_hash=result.version.content_hash,
            ),
            actor_user_id=owner_user_id,
            idempotency_key=f"professional-run:{run.uuid}:review",
            request_id=request_id,
            cipher=self.cipher,
            enforce_actor_review_access=False,
        )
        quality_review = review_run_payload(
            self.db,
            run=review_result.run,
            issues=review_result.issues,
        )
        token.consumed_at = _utc_now()
        token.output_hash = content_hash
        token.metadata_json = {
            key: body.model_metadata[key]
            for key in MODEL_METADATA_ALLOWLIST
            if key in body.model_metadata
        }
        step.status = "succeeded"
        step.output_summary_json = {
            "summary": "模型草稿已接收并通过确定性校验",
            "content_hash": content_hash,
        }
        step.finished_at = _utc_now()
        self.agent.add_step(
            run,
            step_type="review",
            status="succeeded",
            role="professional_runner",
            output_summary={
                "summary": (
                    "七层质量审查已通过"
                    if review_result.run.gates_passed
                    else "七层质量审查已完成，存在阻断问题"
                ),
                "review_uuid": review_result.run.uuid,
                "status": review_result.run.status,
                "gates_passed": review_result.run.gates_passed,
            },
        )
        self.agent.add_step(
            run,
            step_type="persist",
            status="succeeded",
            role="professional_runner",
            output_summary={"summary": "成果版本已持久化"},
        )
        binding.current_phase = "persist"
        binding.waiting_reason = ""
        binding.status = "completed"
        binding.created_version_id = result.version.id
        created_version = deliverable_version_payload(
            self.db,
            version=result.version,
            cipher=self.cipher,
        )
        self.agent.mark_succeeded(
            run,
            result={
                "professional": True,
                "deliverable_uuid": artifact.uuid,
                "created_version_uuid": result.version.uuid,
                "content_hash": result.version.content_hash,
                "quality_review_uuid": review_result.run.uuid,
                "quality_review_status": review_result.run.status,
                "quality_gates_passed": review_result.run.gates_passed,
            },
        )
        self.agent.persist_safe_checkpoint(
            run,
            checkpoint={
                "professional_phase": "persist",
                "professional_status": "completed",
                "waiting_reason": "",
                "context_hash": binding.context_hash,
                "created_version_uuid": result.version.uuid,
                "quality_review_uuid": review_result.run.uuid,
                "missing_fields": [],
            },
            stage=AgentRunStage.COMPLETED,
            progress=100,
        )
        self.db.flush()
        return self.payload(
            binding,
            replayed=False,
            created_version=created_version,
            quality_review=quality_review,
        )

    def payload(
        self,
        binding: ProfessionalRunBinding,
        *,
        replayed: bool,
        pending_request: dict[str, Any] | None = None,
        created_version: dict[str, Any] | None = None,
        quality_review: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run = self._run(binding)
        source, skill, template = self._references(binding)
        checkpoint = dict(run.checkpoint_json or {})
        missing_fields = [str(item) for item in (checkpoint.get("missing_fields") or [])]
        if binding.status == "waiting_for_model" and pending_request is None:
            step_uuid = str(checkpoint.get("model_step_uuid") or "")
            if step_uuid:
                pending_request = self._build_model_request(
                    binding,
                    step_uuid=step_uuid,
                    one_time_token=None,
                )
        if binding.created_version_id is not None and created_version is None:
            version = self.db.get(WorkArtifactVersion, binding.created_version_id)
            if version is not None:
                created_version = deliverable_version_payload(
                    self.db,
                    version=version,
                    cipher=self.cipher,
                )
        if quality_review is None:
            quality_review = self._quality_review_payload(checkpoint)
        return {
            "run_uuid": run.uuid,
            "deliverable_uuid": str(
                (binding.execution_context_json or {}).get("deliverable_uuid") or ""
            ),
            "status": binding.status,
            "phase": binding.current_phase,
            "source_version_uuid": source.uuid,
            "skill_version_uuid": skill.uuid,
            "template_version_uuid": template.uuid,
            "context_hash": binding.context_hash,
            "missing_fields": missing_fields,
            "pending_model_request": pending_request,
            "created_version": created_version,
            "quality_review": quality_review,
            "replayed": replayed,
        }

    def _quality_review_payload(
        self,
        checkpoint: dict[str, Any],
    ) -> dict[str, Any] | None:
        review_uuid = str(checkpoint.get("quality_review_uuid") or "")
        if not review_uuid:
            return None
        review = self.db.scalar(
            select(ReviewRun).where(ReviewRun.uuid == review_uuid)
        )
        if review is None:
            raise ProfessionalDeliveryError(
                "PROFESSIONAL_RUN_CONTEXT_INVALID",
                "专业成果任务绑定的质量审查不存在",
                409,
            )
        return review_run_payload(self.db, run=review)

    def detail_summary(
        self,
        *,
        run_uuid: str,
        owner_user_id: str,
    ) -> dict[str, Any] | None:
        binding = self.db.scalar(
            select(ProfessionalRunBinding).where(
                ProfessionalRunBinding.agent_run_uuid == run_uuid,
                ProfessionalRunBinding.owner_user_id == owner_user_id,
            )
        )
        if binding is None:
            return None
        run = self._run(binding)
        source, skill, template = self._references(binding)
        checkpoint = dict(run.checkpoint_json or {})
        missing_fields = [
            str(item) for item in (checkpoint.get("missing_fields") or [])
        ]
        created_version_uuid = None
        if binding.created_version_id is not None:
            version = self.db.get(WorkArtifactVersion, binding.created_version_id)
            created_version_uuid = version.uuid if version is not None else None
        pending_request = None
        if binding.status == "waiting_for_model":
            step_uuid = str(checkpoint.get("model_step_uuid") or "")
            if step_uuid:
                pending_request = self._build_model_request(
                    binding,
                    step_uuid=step_uuid,
                    one_time_token=None,
                )
        allowed_actions: list[str]
        if binding.status == "waiting_for_input":
            allowed_actions = ["supply_input", "cancel"]
        elif binding.status == "waiting_for_model":
            allowed_actions = ["resume", "cancel"]
        elif binding.status == "running":
            allowed_actions = ["cancel"]
        elif binding.status == "completed":
            allowed_actions = ["open_deliverable"]
        else:
            allowed_actions = []
        return {
            "run_uuid": run.uuid,
            "deliverable_uuid": str(
                (binding.execution_context_json or {}).get("deliverable_uuid") or ""
            ),
            "status": binding.status,
            "phase": binding.current_phase,
            "source_version_uuid": source.uuid,
            "skill_version_uuid": skill.uuid,
            "template_version_uuid": template.uuid,
            "context_hash": binding.context_hash,
            "missing_fields": missing_fields,
            "pending_model_request": pending_request,
            "created_version_uuid": created_version_uuid,
            "quality_review": self._quality_review_payload(checkpoint),
            "allowed_actions": allowed_actions,
            "stages": self._stage_projection(run, binding),
        }

    def detail(
        self,
        *,
        run_uuid: str,
        owner_user_id: str,
    ) -> dict[str, Any]:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        run = self._run(binding)
        professional = self.detail_summary(
            run_uuid=run_uuid,
            owner_user_id=owner_user_id,
        )
        return {
            "run": self.agent.public_run(run),
            "steps": [
                self.agent.public_step(step)
                for step in self.agent.list_steps(run_uuid)
            ],
            "events": [
                self.agent.public_event(event)
                for event in self.agent.list_events(run_uuid)
            ],
            "result": dict(run.result_json or {}),
            "professional": professional,
        }

    def event_payloads(
        self,
        *,
        run_uuid: str,
        owner_user_id: str,
        after_sequence: int = 0,
    ) -> list[dict[str, Any]]:
        self._binding_for_owner(run_uuid, owner_user_id)
        return [
            self.agent.public_event(event)
            for event in self.agent.list_events(
                run_uuid,
                after_sequence=after_sequence,
            )
        ]

    def public_run(
        self,
        *,
        run_uuid: str,
        owner_user_id: str,
    ) -> dict[str, Any]:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        return self.agent.public_run(self._run(binding))

    def _stage_projection(
        self,
        run: AgentRun,
        binding: ProfessionalRunBinding,
    ) -> list[dict[str, Any]]:
        rows = list(
            self.db.scalars(
                select(AgentRunStep)
                .where(AgentRunStep.run_id == run.uuid)
                .order_by(AgentRunStep.sequence.asc())
            )
        )
        now = _utc_now()
        stages: list[dict[str, Any]] = []
        for key, label, step_types in PROFESSIONAL_STAGE_DEFINITIONS:
            related = [row for row in rows if row.step_type in step_types]
            statuses = {row.status for row in related}
            if not related:
                status = "pending"
            elif "failed" in statuses:
                status = "failed"
            elif "cancelled" in statuses:
                status = "cancelled"
            elif statuses & {"waiting", "running", "queued"}:
                status = "waiting" if "waiting" in statuses else "running"
            elif statuses == {"succeeded"}:
                status = "succeeded"
            else:
                status = related[-1].status

            duration_ms = sum(
                self._step_duration_ms(step, now=now) for step in related
            )
            summaries: list[str] = []
            for step in related:
                summary = str(
                    (step.output_summary_json or {}).get("summary")
                    or step.error_message_safe
                    or ""
                ).strip()
                if summary and summary not in summaries:
                    summaries.append(summary)
            recover_action = None
            if key == "completeness" and binding.status == "waiting_for_input":
                recover_action = "supply_input"
            elif key == "draft" and binding.status == "waiting_for_model":
                recover_action = "resume"
            elif key == "persist" and binding.status == "completed":
                recover_action = "open_deliverable"
            stages.append(
                {
                    "key": key,
                    "label": label,
                    "status": status,
                    "duration_ms": duration_ms,
                    "summary": "；".join(summaries)
                    or STAGE_SUMMARY_FALLBACKS[key],
                    "recover_action": recover_action,
                }
            )
        return stages

    @staticmethod
    def _step_duration_ms(step: AgentRunStep, *, now: datetime) -> int:
        recorded = max(0, int(step.latency_ms or 0))
        if step.started_at is None:
            return recorded
        end = step.finished_at or now
        measured = max(0, int((end - step.started_at).total_seconds() * 1000))
        return max(recorded, measured)

    def cancel(self, *, run_uuid: str, owner_user_id: str) -> None:
        binding = self._binding_for_owner(run_uuid, owner_user_id)
        if binding.status in {"completed", "failed", "cancelled"}:
            return
        run = self._run(binding)
        now = _utc_now()
        tokens = list(
            self.db.scalars(
                select(ProfessionalModelStepToken).where(
                    ProfessionalModelStepToken.agent_run_uuid == run_uuid,
                    ProfessionalModelStepToken.consumed_at.is_(None),
                    ProfessionalModelStepToken.revoked_at.is_(None),
                )
            )
        )
        for token in tokens:
            token.revoked_at = now
        active_steps = list(
            self.db.scalars(
                select(AgentRunStep).where(
                    AgentRunStep.run_id == run_uuid,
                    AgentRunStep.status.in_({"queued", "running", "waiting"}),
                )
            )
        )
        for step in active_steps:
            step.status = "cancelled"
            step.finished_at = now
            step.output_summary_json = {"summary": "任务已取消，已有材料与草稿已保留"}
            if step.started_at is not None:
                step.latency_ms = max(
                    int(step.latency_ms or 0),
                    int((now - step.started_at).total_seconds() * 1000),
                )
        binding.status = "cancelled"
        binding.waiting_reason = ""
        self.agent.mark_cancelled(run)
        checkpoint = dict(run.checkpoint_json or {})
        checkpoint.update(
            {
                "professional_phase": binding.current_phase,
                "professional_status": "cancelled",
                "waiting_reason": "",
                "context_hash": binding.context_hash,
                "missing_fields": list(checkpoint.get("missing_fields") or []),
            }
        )
        self.agent.persist_safe_checkpoint(
            run,
            checkpoint=checkpoint,
            stage=AgentRunStage.CANCELLED,
            progress=int(run.progress or 0),
        )
