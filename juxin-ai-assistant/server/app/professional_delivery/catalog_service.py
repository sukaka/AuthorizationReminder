import hashlib
import json
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher
from .catalog_schemas import (
    SkillSelectIn,
    SkillVersionCreateIn,
    TemplateVersionCreateIn,
)
from .models import (
    ApprovalFlowDefinition,
    ApprovalFlowVersion,
    CatalogMutationRecord,
    QualityRuleDefinition,
    QualityRuleVersion,
    SkillDefinition,
    SkillSelectionRecord,
    SkillVersion,
    TemplateDefinition,
    TemplateVersion,
)


class ProfessionalCatalogError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


@dataclass(frozen=True, slots=True)
class BuiltInCatalogResult:
    created_count: int
    cipher: ContentCipher
    key_version: str


@dataclass(frozen=True, slots=True)
class CatalogMutationResult:
    entity: SkillVersion | TemplateVersion
    replayed: bool
    changed: bool = True
    previous_content_hash: str = ""


@dataclass(frozen=True, slots=True)
class SkillSelectionResult:
    record: SkillSelectionRecord
    selected: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    confirmation_required: bool
    replayed: bool


_PROFESSIONAL_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "key": "security_ops_monthly_report",
        "name": "安全运营月报",
        "category": "security_operations",
        "description": "基于授权证据生成可审阅、可追溯的安全运营月报。",
        "deliverable_types": ["security_ops_monthly_report"],
        "keywords": ["安全运营", "安全月报", "月报"],
        "required_fields": ["period"],
        "input_fields": {
            "period": {"type": "string", "title": "报告周期", "minLength": 1},
        },
        "block_ids": [
            "monthly-overview",
            "operations-metrics",
            "major-incidents",
            "risks-and-plans",
        ],
        "sections": ["本月概览", "运营指标", "重大事件", "风险与计划"],
        "golden_input": {"period": "2026-07"},
    },
    {
        "key": "risk_assessment_process_review",
        "name": "风险评估流程评审",
        "category": "risk_governance",
        "description": "评审风险评估流程、控制点与证据完备性。",
        "deliverable_types": ["risk_assessment_process_review"],
        "keywords": ["风险评估", "流程评审", "控制点"],
        "required_fields": ["assessment_scope"],
        "input_fields": {
            "assessment_scope": {
                "type": "string",
                "title": "评估范围",
                "minLength": 1,
            },
        },
        "block_ids": [
            "review-scope",
            "current-process",
            "issue-list",
            "improvement-recommendations",
        ],
        "sections": ["评审范围", "流程现状", "问题清单", "改进建议"],
        "golden_input": {"assessment_scope": "核心业务系统风险评估流程"},
    },
    {
        "key": "incident_response_report",
        "name": "事件响应报告",
        "category": "incident_response",
        "description": "还原事件时间线、处置动作、影响和复盘结论。",
        "deliverable_types": ["incident_response_report"],
        "keywords": ["安全事件", "应急响应", "事件复盘"],
        "required_fields": ["incident_name"],
        "input_fields": {
            "incident_name": {
                "type": "string",
                "title": "事件名称",
                "minLength": 1,
            },
        },
        "block_ids": [
            "incident-summary",
            "incident-timeline",
            "impact-assessment",
            "response-retrospective",
        ],
        "sections": ["事件摘要", "时间线", "影响评估", "处置与复盘"],
        "golden_input": {"incident_name": "终端恶意程序告警处置"},
    },
    {
        "key": "security_baseline_check_report",
        "name": "安全基线检查报告",
        "category": "security_compliance",
        "description": "汇总基线检查范围、结果、风险和整改建议。",
        "deliverable_types": ["security_baseline_check_report"],
        "keywords": ["安全基线", "基线检查", "整改"],
        "required_fields": ["check_scope"],
        "input_fields": {
            "check_scope": {
                "type": "string",
                "title": "检查范围",
                "minLength": 1,
            },
        },
        "block_ids": [
            "check-scope",
            "result-summary",
            "issue-details",
            "remediation-recommendations",
        ],
        "sections": ["检查范围", "结果汇总", "问题明细", "整改建议"],
        "golden_input": {"check_scope": "生产环境 Linux 主机"},
    },
    {
        "key": "manual_document",
        "name": "手工文档",
        "category": "manual",
        "description": "用户明确选择后创建空白专业成果。",
        "deliverable_types": ["*"],
        "keywords": [],
        "required_fields": [],
        "input_fields": {},
        "block_ids": ["document-body", "references"],
        "sections": ["正文", "参考资料"],
        "golden_input": {},
    },
    {
        "key": "chat_capture",
        "name": "对话沉淀",
        "category": "manual",
        "description": "将已确认的对话内容沉淀为可版本化成果。",
        "deliverable_types": ["chat_capture"],
        "keywords": ["对话", "沉淀", "整理"],
        "required_fields": [],
        "input_fields": {},
        "block_ids": ["question", "conclusion", "references"],
        "sections": ["问题", "结论", "参考资料"],
        "golden_input": {},
    },
    {
        "key": "legacy_import",
        "name": "历史成果导入",
        "category": "manual",
        "description": "将历史文档导入专业成果工作流。",
        "deliverable_types": ["legacy_import"],
        "keywords": ["历史文档", "导入", "迁移"],
        "required_fields": [],
        "input_fields": {},
        "block_ids": ["import-notes", "original-content", "references"],
        "sections": ["导入说明", "原始内容", "参考资料"],
        "golden_input": {},
    },
)

_TEMPLATE_KEY_BY_SKILL = {
    "manual_document": "blank_document",
    "chat_capture": "chat_answer",
    "legacy_import": "legacy_document",
}

_BUILTIN_APPROVAL_FLOWS: tuple[dict[str, Any], ...] = (
    {
        "flow_key": "personal_standard_review",
        "name": "个人成果确认",
        "scope_policy": "personal",
        "deliverable_types": ["*"],
        "steps": [
            {
                "step_key": "confirm",
                "name": "本人确认",
                "roles": [],
                "required_approvals": 1,
            }
        ],
        "min_approvals": 1,
        "allow_author_approve": True,
        "reminder_config": {"enabled": False},
        "return_target": "author",
    },
    {
        "flow_key": "project_standard_review",
        "name": "项目成果复核",
        "scope_policy": "project",
        "deliverable_types": ["*"],
        "steps": [
            {
                "step_key": "review",
                "name": "项目复核",
                "roles": ["reviewer", "project_lead", "project_admin"],
                "required_approvals": 1,
            }
        ],
        "min_approvals": 1,
        "allow_author_approve": False,
        "reminder_config": {
            "enabled": True,
            "after_hours": 24,
            "repeat_hours": 24,
        },
        "return_target": "author",
    },
)

_QUALITY_RULE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "category": "structure_contract",
        "name": "结构契约",
        "evaluator_type": "required_blocks",
        "severity": "blocker",
        "blocking": True,
    },
    {
        "category": "facts_evidence",
        "name": "事实与证据",
        "evaluator_type": "fact_status_gate",
        "severity": "blocker",
        "blocking": True,
    },
    {
        "category": "project_scope",
        "name": "项目边界",
        "evaluator_type": "project_scope_gate",
        "severity": "blocker",
        "blocking": True,
    },
    {
        "category": "consistency",
        "name": "内容一致性",
        "evaluator_type": "declared_count_gate",
        "severity": "error",
        "blocking": True,
    },
    {
        "category": "professional_rules",
        "name": "专业规则",
        "evaluator_type": "forbidden_literals",
        "severity": "error",
        "blocking": True,
    },
    {
        "category": "format_expression",
        "name": "格式表达",
        "evaluator_type": "required_block_fields",
        "severity": "error",
        "blocking": True,
    },
    {
        "category": "sensitive_security",
        "name": "敏感与安全",
        "evaluator_type": "forbidden_literals",
        "severity": "blocker",
        "blocking": True,
    },
)

_ALLOWED_DSL_NODES = frozenset(
    {
        "document",
        "section",
        "paragraph",
        "field",
        "fact_ref",
        "table",
        "columns",
        "rows_from",
        "if",
        "all",
        "any",
        "repeat",
        "page_break",
        "toc",
        "references",
    }
)
_ALLOWED_CONDITION_OPERATORS = frozenset(
    {"eq", "ne", "in", "exists", "gt", "gte", "lt", "lte", "all", "any", "not"}
)
_UNSAFE_DSL_KEYS = frozenset(
    {
        "eval",
        "exec",
        "python",
        "jinja",
        "sql",
        "filesystem",
        "network",
        "command",
        "script",
        "import",
        "module",
        "query",
    }
)


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _canonical_hash(value: Any) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _skill_associated_data(version_uuid: str) -> bytes:
    return f"professional-skill-version:{version_uuid}".encode("utf-8")


def _template_seed_body(item: dict[str, Any]) -> dict[str, Any]:
    properties = dict(item["input_fields"])
    children: list[dict[str, Any]] = [
        {
            "type": "section",
            "id": block_id,
            "title": title,
            "children": [
                {
                    "type": "paragraph",
                    "block_id": block_id,
                    "text": "",
                }
            ],
        }
        for block_id, title in zip(
            item["block_ids"],
            item["sections"],
            strict=True,
        )
    ]
    children.extend([{"type": "page_break"}, {"type": "references"}])
    return {
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": list(item["required_fields"]),
        },
        "structure_dsl": {"type": "document", "children": children},
        "dynamic_tables": [],
        "conditional_sections": [],
        "style_theme": {"name": "juxin-professional"},
        "word_render_config": {"toc": True, "references": "endnotes"},
        "compatible_skill_version_uuids": [],
    }


def _skill_seed_body(
    item: dict[str, Any],
    *,
    default_template_version_uuid: str,
    quality_rule_version_ids: list[int],
) -> dict[str, Any]:
    input_properties = dict(item["input_fields"])
    expected_blocks = [
        {"block_id": block_id, "type": "paragraph"}
        for block_id in item["block_ids"]
    ]
    return {
        "input_schema": {
            "type": "object",
            "properties": input_properties,
            "required": list(item["required_fields"]),
        },
        "output_schema": {
            "type": "object",
            "properties": {"blocks": {"type": "array"}},
            "required": ["blocks"],
        },
        "plan_definition": {
            "steps": [
                {"step_key": "collect", "name": "受权取证"},
                {"step_key": "draft", "name": "生成初稿"},
                {"step_key": "verify", "name": "确定性验证"},
                {"step_key": "review", "name": "人工审阅"},
            ],
            "selection_rules": {
                "deliverable_types": item["deliverable_types"],
                "keywords": item["keywords"],
                "required_input_fields": item["required_fields"],
            },
            "examples": [{"objective": f"生成{item['name']}"}],
            "counterexamples": [{"objective": "绕过授权读取任意数据"}],
            "tests": [
                {"name": "authorized_sources_only", "expected": "pass"},
                {"name": "critical_facts_traceable", "expected": "pass"},
                {"name": "all_required_blocks_present", "expected": "pass"},
            ],
            "golden_samples": [
                {
                    "name": f"{item['name']}标准样例",
                    "input": dict(item["golden_input"]),
                    "expected_output": {
                        "schema_version": "1",
                        "blocks": expected_blocks,
                    },
                    "assertions": [
                        "all_required_blocks_present",
                        "critical_facts_traceable",
                        "project_scope_preserved",
                        "no_sensitive_literals",
                    ],
                }
            ],
        },
        "prompt_bundle": {
            "system": f"生成{item['name']}，仅使用已授权且可追溯的事实。",
            "instructions": [
                "不得虚构关键事实",
                "缺少证据时明确标记待确认",
                "必须按顺序输出区块：" + "、".join(item["block_ids"]),
            ],
        },
        "allowed_resource_types": ["knowledge_file", "project_context"],
        "allowed_tool_ids": ["knowledge.search", "calculator.deterministic"],
        "required_fact_policy": {
            "critical_numbers_require_source": True,
            "human_confirmation_required": True,
        },
        "quality_rule_set_version_ids": list(quality_rule_version_ids),
        "default_template_version_uuid": default_template_version_uuid,
        "review_checklist": ["关键事实均可追溯", "结论与证据一致", "待确认项已显式标记"],
    }


def _quality_rule_body(
    item: dict[str, Any],
    spec: dict[str, Any],
) -> dict[str, Any]:
    category = spec["category"]
    if category == "structure_contract":
        config = {"required_block_ids": list(item["block_ids"])}
    elif category == "facts_evidence":
        config = {
            "blocked_statuses": [
                "pending_confirmation",
                "unsupported",
                "conflicted",
                "stale",
                "revoked",
                "inaccessible",
            ],
            "critical_only": True,
        }
    elif category == "professional_rules":
        config = {"literals": ["待补充", "TBD", "TODO"]}
    elif category == "format_expression":
        config = {"required_fields": ["block_id", "type"]}
    elif category == "sensitive_security":
        config = {
            "literals": [
                "-----BEGIN PRIVATE KEY-----",
                "api_key=",
                "authorization: bearer",
            ]
        }
    else:
        config = {}
    return {
        "evaluator_type": spec["evaluator_type"],
        "config": config,
        "severity": spec["severity"],
        "blocking": spec["blocking"],
    }


def ensure_builtin_catalog(
    db: Session,
    *,
    cipher: ContentCipher,
    key_version: str,
) -> BuiltInCatalogResult:
    created_count = 0
    template_versions: dict[str, TemplateVersion] = {}

    for item in _PROFESSIONAL_CATALOG:
        template_key = _TEMPLATE_KEY_BY_SKILL.get(item["key"], item["key"])
        definition = db.scalar(
            select(TemplateDefinition).where(
                TemplateDefinition.template_key == template_key
            )
        )
        catalog_created = False
        if definition is None:
            definition = TemplateDefinition(
                template_key=template_key,
                name=item["name"],
                purpose=item["description"],
                deliverable_types_json=item["deliverable_types"],
                scope_type="system",
                status="published",
                created_by="system",
            )
            db.add(definition)
            db.flush()
            catalog_created = True
        body = _template_seed_body(item)
        content_hash = _canonical_hash(body)
        version = db.scalar(
            select(TemplateVersion).where(
                TemplateVersion.template_id == definition.id,
                TemplateVersion.content_hash == content_hash,
            )
        )
        if version is None:
            latest_version = int(
                db.scalar(
                    select(func.max(TemplateVersion.version)).where(
                        TemplateVersion.template_id == definition.id
                    )
                )
                or 0
            )
            version = TemplateVersion(
                template_id=definition.id,
                version=latest_version + 1,
                content_hash=content_hash,
                input_schema_json=body["input_schema"],
                structure_dsl_json=body["structure_dsl"],
                dynamic_tables_json=body["dynamic_tables"],
                conditional_sections_json=body["conditional_sections"],
                style_theme_json=body["style_theme"],
                word_render_config_json=body["word_render_config"],
                compatible_skill_version_ids_json=[],
                status="published",
                published_by="system",
                published_at=_utcnow(),
                created_by="system",
            )
            db.add(version)
            db.flush()
            catalog_created = True
        if definition.current_published_version_id != version.id:
            definition.current_published_version_id = version.id
            definition.status = "published"
        template_versions[template_key] = version
        if catalog_created:
            created_count += 1

    for item in _BUILTIN_APPROVAL_FLOWS:
        definition = db.scalar(
            select(ApprovalFlowDefinition).where(
                ApprovalFlowDefinition.flow_key == item["flow_key"]
            )
        )
        catalog_created = False
        if definition is None:
            definition = ApprovalFlowDefinition(
                flow_key=item["flow_key"],
                name=item["name"],
                scope_policy=item["scope_policy"],
                deliverable_types_json=item["deliverable_types"],
                status="published",
                created_by="system",
            )
            db.add(definition)
            db.flush()
            catalog_created = True
        version = db.scalar(
            select(ApprovalFlowVersion).where(
                ApprovalFlowVersion.flow_id == definition.id,
                ApprovalFlowVersion.version == 1,
            )
        )
        if version is None:
            body = {
                "steps": item["steps"],
                "min_approvals": item["min_approvals"],
                "allow_author_approve": item["allow_author_approve"],
                "reminder_config": item["reminder_config"],
                "return_target": item["return_target"],
            }
            version = ApprovalFlowVersion(
                flow_id=definition.id,
                version=1,
                content_hash=_canonical_hash(body),
                steps_json=body["steps"],
                min_approvals=body["min_approvals"],
                allow_author_approve=body["allow_author_approve"],
                reminder_config_json=body["reminder_config"],
                return_target=body["return_target"],
                status="published",
                published_by="system",
                published_at=_utcnow(),
                created_by="system",
            )
            db.add(version)
            db.flush()
            catalog_created = True
        if definition.current_published_version_id is None:
            definition.current_published_version_id = version.id
            definition.status = "published"
        if catalog_created:
            created_count += 1

    quality_rule_versions: dict[str, list[QualityRuleVersion]] = {}
    for item in _PROFESSIONAL_CATALOG:
        versions: list[QualityRuleVersion] = []
        for spec in _QUALITY_RULE_SPECS:
            rule_key = f"builtin.{item['key']}.{spec['category']}"
            definition = db.scalar(
                select(QualityRuleDefinition).where(
                    QualityRuleDefinition.rule_key == rule_key
                )
            )
            catalog_created = False
            if definition is None:
                definition = QualityRuleDefinition(
                    rule_key=rule_key,
                    name=f"{item['name']} · {spec['name']}",
                    category=spec["category"],
                    description=f"{item['name']}的{spec['name']}确定性质量门禁。",
                    status="published",
                    created_by="system",
                )
                db.add(definition)
                db.flush()
                catalog_created = True
            body = _quality_rule_body(item, spec)
            content_hash = _canonical_hash(body)
            version = db.scalar(
                select(QualityRuleVersion).where(
                    QualityRuleVersion.rule_id == definition.id,
                    QualityRuleVersion.content_hash == content_hash,
                )
            )
            if version is None:
                latest_version = int(
                    db.scalar(
                        select(func.max(QualityRuleVersion.version)).where(
                            QualityRuleVersion.rule_id == definition.id
                        )
                    )
                    or 0
                )
                version = QualityRuleVersion(
                    rule_id=definition.id,
                    version=latest_version + 1,
                    content_hash=content_hash,
                    evaluator_type=body["evaluator_type"],
                    config_json=body["config"],
                    severity=body["severity"],
                    blocking=body["blocking"],
                    status="published",
                    published_by="system",
                    published_at=_utcnow(),
                    created_by="system",
                )
                db.add(version)
                db.flush()
                catalog_created = True
            if definition.current_published_version_id != version.id:
                definition.current_published_version_id = version.id
                definition.status = "published"
            versions.append(version)
            if catalog_created:
                created_count += 1
        quality_rule_versions[item["key"]] = versions

    for item in _PROFESSIONAL_CATALOG:
        definition = db.scalar(
            select(SkillDefinition).where(SkillDefinition.skill_key == item["key"])
        )
        catalog_created = False
        if definition is None:
            definition = SkillDefinition(
                skill_key=item["key"],
                name=item["name"],
                category=item["category"],
                description=item["description"],
                scope_policy="both",
                status="published",
                created_by="system",
            )
            db.add(definition)
            db.flush()
            catalog_created = True
        template_key = _TEMPLATE_KEY_BY_SKILL.get(item["key"], item["key"])
        template_version = template_versions[template_key]
        body = _skill_seed_body(
            item,
            default_template_version_uuid=template_version.uuid,
            quality_rule_version_ids=[
                rule_version.id
                for rule_version in quality_rule_versions[item["key"]]
            ],
        )
        content_hash = _canonical_hash(body)
        version = db.scalar(
            select(SkillVersion).where(
                SkillVersion.skill_id == definition.id,
                SkillVersion.content_hash == content_hash,
            )
        )
        if version is None:
            latest_version = int(
                db.scalar(
                    select(func.max(SkillVersion.version)).where(
                        SkillVersion.skill_id == definition.id
                    )
                )
                or 0
            )
            version_uuid = str(uuid_lib.uuid4())
            encrypted = cipher.encrypt_json(
                body["prompt_bundle"],
                _skill_associated_data(version_uuid),
            )
            version = SkillVersion(
                uuid=version_uuid,
                skill_id=definition.id,
                version=latest_version + 1,
                content_hash=content_hash,
                input_schema_json=body["input_schema"],
                output_schema_json=body["output_schema"],
                plan_definition_json=body["plan_definition"],
                prompt_bundle_ciphertext=encrypted.ciphertext,
                prompt_bundle_nonce=encrypted.nonce,
                key_version=key_version,
                allowed_resource_types_json=body["allowed_resource_types"],
                allowed_tool_types_json=body["allowed_tool_ids"],
                fact_policy_json=body["required_fact_policy"],
                quality_policy_ids_json=body["quality_rule_set_version_ids"],
                default_template_version_id=template_version.id,
                review_checklist_json=body["review_checklist"],
                status="published",
                published_by="system",
                published_at=_utcnow(),
                created_by="system",
            )
            db.add(version)
            db.flush()
            catalog_created = True
        if definition.current_published_version_id != version.id:
            definition.current_published_version_id = version.id
            definition.status = "published"
        if catalog_created:
            created_count += 1

    db.flush()
    return BuiltInCatalogResult(
        created_count=created_count,
        cipher=cipher,
        key_version=key_version,
    )


def _default_template_uuid(db: Session, version: SkillVersion) -> str | None:
    if version.default_template_version_id is None:
        return None
    template = db.get(TemplateVersion, version.default_template_version_id)
    return template.uuid if template is not None else None


def skill_version_summary(db: Session, version: SkillVersion) -> dict[str, Any]:
    return {
        "version_uuid": version.uuid,
        "version": version.version,
        "content_hash": version.content_hash,
        "status": version.status,
        "default_template_version_uuid": _default_template_uuid(db, version),
        "published_at": version.published_at,
    }


def skill_summary(
    db: Session,
    definition: SkillDefinition,
    version: SkillVersion,
) -> dict[str, Any]:
    return {
        "skill_uuid": definition.uuid,
        "skill_key": definition.skill_key,
        "name": definition.name,
        "category": definition.category,
        "description": definition.description,
        "scope_policy": definition.scope_policy,
        "status": definition.status,
        "current_version": skill_version_summary(db, version),
    }


def skill_version_detail(
    db: Session,
    definition: SkillDefinition,
    version: SkillVersion,
) -> dict[str, Any]:
    return {
        **skill_summary(db, definition, version),
        **skill_version_summary(db, version),
        "input_schema": version.input_schema_json or {},
        "output_schema": version.output_schema_json or {},
        "plan_definition": version.plan_definition_json or {},
        "prompt_bundle_present": bool(
            version.prompt_bundle_ciphertext and version.prompt_bundle_nonce
        ),
        "allowed_resource_types": version.allowed_resource_types_json or [],
        "allowed_tool_ids": version.allowed_tool_types_json or [],
        "required_fact_policy": version.fact_policy_json or {},
        "quality_rule_set_version_ids": version.quality_policy_ids_json or [],
        "review_checklist": version.review_checklist_json or [],
        "created_by": version.created_by,
        "created_at": version.created_at,
    }


def template_version_summary(version: TemplateVersion) -> dict[str, Any]:
    return {
        "version_uuid": version.uuid,
        "version": version.version,
        "content_hash": version.content_hash,
        "status": version.status,
        "published_at": version.published_at,
    }


def supports_deliverable_type(
    supported_types: list[Any] | None,
    deliverable_type: str | None,
) -> bool:
    if not deliverable_type:
        return True
    supported = {
        str(value).strip()
        for value in supported_types or []
        if str(value).strip()
    }
    return "*" in supported or deliverable_type in supported


def approval_flow_version_summary(version: ApprovalFlowVersion) -> dict[str, Any]:
    return {
        "version_uuid": version.uuid,
        "version": version.version,
        "content_hash": version.content_hash,
        "steps": version.steps_json or [],
        "min_approvals": version.min_approvals,
        "allow_author_approve": version.allow_author_approve,
        "reminder_config": version.reminder_config_json or {},
        "return_target": version.return_target,
        "status": version.status,
        "published_at": version.published_at,
    }


def approval_flow_summary(
    definition: ApprovalFlowDefinition,
    version: ApprovalFlowVersion,
) -> dict[str, Any]:
    return {
        "flow_uuid": definition.uuid,
        "flow_key": definition.flow_key,
        "name": definition.name,
        "scope_policy": definition.scope_policy,
        "deliverable_types": definition.deliverable_types_json or [],
        "status": definition.status,
        "current_version": approval_flow_version_summary(version),
    }


def list_published_approval_flows(
    db: Session,
    *,
    scope_type: str,
    deliverable_type: str | None,
) -> list[dict[str, Any]]:
    definitions = list(
        db.scalars(
            select(ApprovalFlowDefinition)
            .where(ApprovalFlowDefinition.status == "published")
            .order_by(ApprovalFlowDefinition.flow_key)
        )
    )
    items: list[dict[str, Any]] = []
    for definition in definitions:
        if definition.scope_policy not in {"both", scope_type}:
            continue
        if not supports_deliverable_type(
            definition.deliverable_types_json,
            deliverable_type,
        ):
            continue
        version = db.get(
            ApprovalFlowVersion,
            definition.current_published_version_id,
        )
        if version is None or version.status != "published":
            continue
        items.append(approval_flow_summary(definition, version))
    return items


def template_summary(
    definition: TemplateDefinition,
    version: TemplateVersion,
) -> dict[str, Any]:
    return {
        "template_uuid": definition.uuid,
        "template_key": definition.template_key,
        "name": definition.name,
        "purpose": definition.purpose,
        "deliverable_types": definition.deliverable_types_json or [],
        "scope_type": definition.scope_type,
        "status": definition.status,
        "current_version": template_version_summary(version),
    }


def template_version_detail(
    definition: TemplateDefinition,
    version: TemplateVersion,
) -> dict[str, Any]:
    return {
        **template_summary(definition, version),
        **template_version_summary(version),
        "input_schema": version.input_schema_json or {},
        "structure_dsl": version.structure_dsl_json or {},
        "dynamic_tables": version.dynamic_tables_json or [],
        "conditional_sections": version.conditional_sections_json or [],
        "style_theme": version.style_theme_json or {},
        "word_render_config": version.word_render_config_json or {},
        "compatible_skill_version_uuids": (
            version.compatible_skill_version_ids_json or []
        ),
        "created_by": version.created_by,
        "created_at": version.created_at,
    }


def list_published_skills(
    db: Session,
    *,
    scope_type: str,
    deliverable_type: str | None,
) -> list[dict[str, Any]]:
    definitions = list(
        db.scalars(
            select(SkillDefinition)
            .where(SkillDefinition.status == "published")
            .order_by(SkillDefinition.category, SkillDefinition.skill_key)
        )
    )
    items: list[dict[str, Any]] = []
    for definition in definitions:
        if definition.scope_policy not in {"both", scope_type}:
            continue
        version = db.get(SkillVersion, definition.current_published_version_id)
        if version is None or version.status != "published":
            continue
        rules = (version.plan_definition_json or {}).get("selection_rules") or {}
        supported = rules.get("deliverable_types") or []
        if not supports_deliverable_type(supported, deliverable_type):
            continue
        items.append(skill_summary(db, definition, version))
    return items


def list_published_templates(
    db: Session,
    *,
    scope_type: str,
    deliverable_type: str | None,
) -> list[dict[str, Any]]:
    definitions = list(
        db.scalars(
            select(TemplateDefinition)
            .where(TemplateDefinition.status == "published")
            .order_by(TemplateDefinition.template_key)
        )
    )
    items: list[dict[str, Any]] = []
    for definition in definitions:
        if definition.scope_type not in {"system", scope_type}:
            continue
        supported = definition.deliverable_types_json or []
        if not supports_deliverable_type(supported, deliverable_type):
            continue
        version = db.get(TemplateVersion, definition.current_published_version_id)
        if version is None or version.status != "published":
            continue
        items.append(template_summary(definition, version))
    return items


def get_skill_version(
    db: Session,
    *,
    skill_uuid: str,
    version_uuid: str,
    include_draft: bool,
) -> tuple[SkillDefinition, SkillVersion]:
    definition = db.scalar(
        select(SkillDefinition).where(SkillDefinition.uuid == skill_uuid)
    )
    if definition is None:
        raise ProfessionalCatalogError("SKILL_NOT_FOUND", "Skill 不存在", 404)
    version = db.scalar(
        select(SkillVersion).where(
            SkillVersion.uuid == version_uuid,
            SkillVersion.skill_id == definition.id,
        )
    )
    if version is None or (version.status != "published" and not include_draft):
        raise ProfessionalCatalogError("SKILL_VERSION_NOT_FOUND", "Skill 版本不存在", 404)
    return definition, version


def get_template_version(
    db: Session,
    *,
    template_uuid: str,
    version_uuid: str,
    include_draft: bool,
) -> tuple[TemplateDefinition, TemplateVersion]:
    definition = db.scalar(
        select(TemplateDefinition).where(TemplateDefinition.uuid == template_uuid)
    )
    if definition is None:
        raise ProfessionalCatalogError("TEMPLATE_NOT_FOUND", "模板不存在", 404)
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.uuid == version_uuid,
            TemplateVersion.template_id == definition.id,
        )
    )
    if version is None or (version.status != "published" and not include_draft):
        raise ProfessionalCatalogError("TEMPLATE_VERSION_NOT_FOUND", "模板版本不存在", 404)
    return definition, version


def _existing_mutation(
    db: Session,
    *,
    actor_user_id: str,
    operation: str,
    idempotency_key: str,
    request_hash: str,
) -> CatalogMutationRecord | None:
    existing = db.scalar(
        select(CatalogMutationRecord).where(
            CatalogMutationRecord.actor_user_id == actor_user_id,
            CatalogMutationRecord.operation == operation,
            CatalogMutationRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None and existing.request_hash != request_hash:
        raise ProfessionalCatalogError(
            "IDEMPOTENCY_KEY_REUSED",
            "同一 Idempotency-Key 不能用于不同请求",
            409,
        )
    return existing


def _record_mutation(
    db: Session,
    *,
    actor_user_id: str,
    operation: str,
    idempotency_key: str,
    request_hash: str,
    entity_type: str,
    entity_uuid: str,
) -> None:
    db.add(
        CatalogMutationRecord(
            actor_user_id=actor_user_id,
            operation=operation,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            entity_type=entity_type,
            entity_uuid=entity_uuid,
        )
    )


def create_skill_version(
    db: Session,
    *,
    skill_uuid: str,
    body: SkillVersionCreateIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> CatalogMutationResult:
    definition = db.scalar(
        select(SkillDefinition).where(SkillDefinition.uuid == skill_uuid)
    )
    if definition is None:
        raise ProfessionalCatalogError("SKILL_NOT_FOUND", "Skill 不存在", 404)
    body_json = body.model_dump(mode="json")
    request_hash = _canonical_hash({"skill_uuid": skill_uuid, "body": body_json})
    operation = "skill_version_create"
    existing = _existing_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if existing is not None:
        version = db.scalar(
            select(SkillVersion).where(SkillVersion.uuid == existing.entity_uuid)
        )
        if version is None:
            raise ProfessionalCatalogError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录指向的 Skill 版本不存在",
                500,
            )
        previous = db.scalar(
            select(SkillVersion).where(
                SkillVersion.skill_id == definition.id,
                SkillVersion.version == version.version - 1,
            )
        )
        return CatalogMutationResult(
            entity=version,
            replayed=True,
            changed=False,
            previous_content_hash=previous.content_hash if previous else "",
        )

    template_version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.uuid == body.default_template_version_uuid,
            TemplateVersion.status == "published",
        )
    )
    if template_version is None:
        raise ProfessionalCatalogError(
            "DEFAULT_TEMPLATE_VERSION_NOT_FOUND",
            "默认模板版本不存在或尚未发布",
            422,
        )
    previous = db.get(SkillVersion, definition.current_published_version_id)
    next_version = int(
        db.scalar(
            select(func.max(SkillVersion.version)).where(
                SkillVersion.skill_id == definition.id
            )
        )
        or 0
    ) + 1
    version_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        body.prompt_bundle,
        _skill_associated_data(version_uuid),
    )
    version = SkillVersion(
        uuid=version_uuid,
        skill_id=definition.id,
        version=next_version,
        content_hash=_canonical_hash(body_json),
        input_schema_json=body.input_schema,
        output_schema_json=body.output_schema,
        plan_definition_json=body.plan_definition,
        prompt_bundle_ciphertext=encrypted.ciphertext,
        prompt_bundle_nonce=encrypted.nonce,
        key_version=key_version,
        allowed_resource_types_json=body.allowed_resource_types,
        allowed_tool_types_json=body.allowed_tool_ids,
        fact_policy_json=body.required_fact_policy,
        quality_policy_ids_json=body.quality_rule_set_version_ids,
        default_template_version_id=template_version.id,
        review_checklist_json=body.review_checklist,
        status="draft",
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    _record_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        entity_type="professional_skill_version",
        entity_uuid=version.uuid,
    )
    return CatalogMutationResult(
        entity=version,
        replayed=False,
        previous_content_hash=previous.content_hash if previous else "",
    )


def _validate_json_schema(schema: dict[str, Any], *, label: str) -> None:
    if schema.get("type") != "object":
        raise ProfessionalCatalogError(
            "CATALOG_SCHEMA_INVALID",
            f"{label} 顶层 type 必须为 object",
            422,
        )
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict) or not isinstance(required, list):
        raise ProfessionalCatalogError(
            "CATALOG_SCHEMA_INVALID",
            f"{label} 的 properties/required 格式无效",
            422,
        )
    if any(not isinstance(item, str) or item not in properties for item in required):
        raise ProfessionalCatalogError(
            "CATALOG_SCHEMA_INVALID",
            f"{label} 的 required 必须引用 properties 字段",
            422,
        )


def _validate_skill_for_publish(db: Session, version: SkillVersion) -> None:
    _validate_json_schema(version.input_schema_json or {}, label="input_schema")
    _validate_json_schema(version.output_schema_json or {}, label="output_schema")
    plan = version.plan_definition_json or {}
    if not isinstance(plan.get("steps"), list) or not plan["steps"]:
        raise ProfessionalCatalogError(
            "SKILL_PLAN_INVALID",
            "Skill plan_definition.steps 不能为空",
            422,
        )
    for field in ("examples", "counterexamples", "tests"):
        if not isinstance(plan.get(field), list) or not plan[field]:
            raise ProfessionalCatalogError(
                "SKILL_PLAN_INVALID",
                f"Skill plan_definition.{field} 不能为空",
                422,
            )
    if not isinstance(plan.get("selection_rules"), dict):
        raise ProfessionalCatalogError(
            "SKILL_PLAN_INVALID",
            "Skill selection_rules 格式无效",
            422,
        )
    if not isinstance(version.fact_policy_json, dict):
        raise ProfessionalCatalogError(
            "SKILL_FACT_POLICY_INVALID",
            "Skill fact policy 格式无效",
            422,
        )
    template = db.get(TemplateVersion, version.default_template_version_id)
    if template is None or template.status != "published":
        raise ProfessionalCatalogError(
            "DEFAULT_TEMPLATE_VERSION_NOT_PUBLISHED",
            "默认模板版本必须已发布",
            422,
        )


def publish_skill_version(
    db: Session,
    *,
    skill_uuid: str,
    version_uuid: str,
    actor_user_id: str,
    idempotency_key: str,
) -> CatalogMutationResult:
    definition, version = get_skill_version(
        db,
        skill_uuid=skill_uuid,
        version_uuid=version_uuid,
        include_draft=True,
    )
    request_hash = _canonical_hash(
        {"skill_uuid": skill_uuid, "version_uuid": version_uuid}
    )
    operation = "skill_version_publish"
    existing = _existing_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if existing is not None:
        return CatalogMutationResult(entity=version, replayed=True, changed=False)
    if version.status not in {"draft", "published"}:
        raise ProfessionalCatalogError(
            "SKILL_VERSION_NOT_PUBLISHABLE",
            "当前 Skill 版本不能发布",
            409,
        )
    _validate_skill_for_publish(db, version)
    changed = version.status != "published" or (
        definition.current_published_version_id != version.id
    )
    version.status = "published"
    version.published_by = actor_user_id
    version.published_at = version.published_at or _utcnow()
    definition.status = "published"
    definition.current_published_version_id = version.id
    _record_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        entity_type="professional_skill_version",
        entity_uuid=version.uuid,
    )
    return CatalogMutationResult(entity=version, replayed=False, changed=changed)


def create_template_version(
    db: Session,
    *,
    template_uuid: str,
    body: TemplateVersionCreateIn,
    actor_user_id: str,
    idempotency_key: str,
) -> CatalogMutationResult:
    definition = db.scalar(
        select(TemplateDefinition).where(TemplateDefinition.uuid == template_uuid)
    )
    if definition is None:
        raise ProfessionalCatalogError("TEMPLATE_NOT_FOUND", "模板不存在", 404)
    body_json = body.model_dump(mode="json")
    request_hash = _canonical_hash({"template_uuid": template_uuid, "body": body_json})
    operation = "template_version_create"
    existing = _existing_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if existing is not None:
        version = db.scalar(
            select(TemplateVersion).where(TemplateVersion.uuid == existing.entity_uuid)
        )
        if version is None:
            raise ProfessionalCatalogError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录指向的模板版本不存在",
                500,
            )
        previous = db.scalar(
            select(TemplateVersion).where(
                TemplateVersion.template_id == definition.id,
                TemplateVersion.version == version.version - 1,
            )
        )
        return CatalogMutationResult(
            entity=version,
            replayed=True,
            changed=False,
            previous_content_hash=previous.content_hash if previous else "",
        )
    next_version = int(
        db.scalar(
            select(func.max(TemplateVersion.version)).where(
                TemplateVersion.template_id == definition.id
            )
        )
        or 0
    ) + 1
    previous = db.get(TemplateVersion, definition.current_published_version_id)
    version = TemplateVersion(
        template_id=definition.id,
        version=next_version,
        content_hash=_canonical_hash(body_json),
        input_schema_json=body.input_schema,
        structure_dsl_json=body.structure_dsl,
        dynamic_tables_json=body.dynamic_tables,
        conditional_sections_json=body.conditional_sections,
        style_theme_json=body.style_theme,
        word_render_config_json=body.word_render_config,
        compatible_skill_version_ids_json=body.compatible_skill_version_uuids,
        status="draft",
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    _record_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        entity_type="professional_template_version",
        entity_uuid=version.uuid,
    )
    return CatalogMutationResult(
        entity=version,
        replayed=False,
        previous_content_hash=previous.content_hash if previous else "",
    )


def _reject_unsafe_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key.strip().casefold() in _UNSAFE_DSL_KEYS:
                raise ProfessionalCatalogError(
                    "TEMPLATE_DSL_UNSAFE",
                    f"模板 DSL 包含不允许的字段: {key}",
                    422,
                )
            _reject_unsafe_keys(child)
    elif isinstance(value, list):
        for child in value:
            _reject_unsafe_keys(child)


def _validate_condition(condition: Any) -> None:
    if not isinstance(condition, dict):
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_INVALID",
            "模板条件必须是对象",
            422,
        )
    operator = condition.get("op")
    if operator not in _ALLOWED_CONDITION_OPERATORS:
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_UNSAFE",
            f"模板条件操作符不受支持: {operator}",
            422,
        )
    if operator in {"all", "any"}:
        children = condition.get("conditions")
        if not isinstance(children, list) or not children:
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                f"{operator} 条件必须包含 conditions",
                422,
            )
        for child in children:
            _validate_condition(child)
    elif operator == "not":
        _validate_condition(condition.get("condition"))
    elif not isinstance(condition.get("path"), str):
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_INVALID",
            f"{operator} 条件必须包含 path",
            422,
        )


def _validate_dsl_node(node: Any) -> None:
    if not isinstance(node, dict):
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_INVALID",
            "模板 DSL 节点必须是对象",
            422,
        )
    node_type = node.get("type")
    if node_type not in _ALLOWED_DSL_NODES:
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_UNSAFE",
            f"模板 DSL 节点不受支持: {node_type}",
            422,
        )
    if node_type == "if":
        _validate_condition(node.get("condition"))
    if node_type in {"field", "fact_ref", "repeat", "rows_from"}:
        if not isinstance(node.get("path") or node.get("rows_from"), str):
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                f"{node_type} 节点必须声明数据路径",
                422,
            )
    if node_type == "table":
        if not isinstance(node.get("columns"), list) or not isinstance(
            node.get("rows_from"), str
        ):
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                "table 节点必须声明 columns 和 rows_from",
                422,
            )
    children = node.get("children", [])
    if not isinstance(children, list):
        raise ProfessionalCatalogError(
            "TEMPLATE_DSL_INVALID",
            "模板 DSL children 必须是数组",
            422,
        )
    for child in children:
        _validate_dsl_node(child)


def _validate_template_for_publish(version: TemplateVersion) -> None:
    _validate_json_schema(version.input_schema_json or {}, label="input_schema")
    structure = version.structure_dsl_json or {}
    _reject_unsafe_keys(structure)
    _reject_unsafe_keys(version.dynamic_tables_json or [])
    _reject_unsafe_keys(version.conditional_sections_json or [])
    _validate_dsl_node(structure)
    for table in version.dynamic_tables_json or []:
        if not isinstance(table, dict) or not isinstance(table.get("rows_from"), str):
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                "动态表必须声明 rows_from",
                422,
            )
        if not isinstance(table.get("columns"), list):
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                "动态表 columns 必须是数组",
                422,
            )
    for section in version.conditional_sections_json or []:
        if not isinstance(section, dict):
            raise ProfessionalCatalogError(
                "TEMPLATE_DSL_INVALID",
                "条件章节格式无效",
                422,
            )
        _validate_condition(section.get("condition"))


def publish_template_version(
    db: Session,
    *,
    template_uuid: str,
    version_uuid: str,
    actor_user_id: str,
    idempotency_key: str,
) -> CatalogMutationResult:
    definition, version = get_template_version(
        db,
        template_uuid=template_uuid,
        version_uuid=version_uuid,
        include_draft=True,
    )
    request_hash = _canonical_hash(
        {"template_uuid": template_uuid, "version_uuid": version_uuid}
    )
    operation = "template_version_publish"
    existing = _existing_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if existing is not None:
        return CatalogMutationResult(entity=version, replayed=True, changed=False)
    if version.status not in {"draft", "published"}:
        raise ProfessionalCatalogError(
            "TEMPLATE_VERSION_NOT_PUBLISHABLE",
            "当前模板版本不能发布",
            409,
        )
    _validate_template_for_publish(version)
    changed = version.status != "published" or (
        definition.current_published_version_id != version.id
    )
    version.status = "published"
    version.published_by = actor_user_id
    version.published_at = version.published_at or _utcnow()
    definition.status = "published"
    definition.current_published_version_id = version.id
    _record_mutation(
        db,
        actor_user_id=actor_user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        entity_type="professional_template_version",
        entity_uuid=version.uuid,
    )
    return CatalogMutationResult(entity=version, replayed=False, changed=changed)


def _candidate_payload(
    db: Session,
    definition: SkillDefinition,
    version: SkillVersion,
) -> dict[str, Any]:
    return {
        "skill_uuid": definition.uuid,
        "skill_key": definition.skill_key,
        "name": definition.name,
        "version_uuid": version.uuid,
        "version": version.version,
        "content_hash": version.content_hash,
        "default_template_version_uuid": _default_template_uuid(db, version),
        "score": 0.0,
        "reasons": [],
        "source": "rule",
    }


def _visible_published_versions(
    db: Session,
    *,
    scope_type: str,
) -> tuple[dict[str, tuple[SkillDefinition, SkillVersion]], list[tuple[SkillDefinition, SkillVersion]]]:
    rows = list(
        db.execute(
            select(SkillDefinition, SkillVersion).where(
                SkillVersion.skill_id == SkillDefinition.id,
                SkillDefinition.status == "published",
                SkillVersion.status == "published",
            )
        )
    )
    visible = [
        (definition, version)
        for definition, version in rows
        if definition.scope_policy in {"both", scope_type}
    ]
    by_uuid = {version.uuid: (definition, version) for definition, version in visible}
    current = [
        (definition, version)
        for definition, version in visible
        if definition.current_published_version_id == version.id
    ]
    return by_uuid, current


def _add_candidate(
    candidates: dict[str, dict[str, Any]],
    *,
    base: dict[str, Any],
    score: float,
    reason: str,
    source: str,
    priority: int,
) -> None:
    candidate = candidates.get(base["version_uuid"])
    if candidate is None:
        candidate = {**base, "_priority": priority}
        candidates[base["version_uuid"]] = candidate
    if reason not in candidate["reasons"]:
        candidate["reasons"].append(reason)
    if priority > candidate["_priority"]:
        candidate["_priority"] = priority
        candidate["source"] = source
    candidate["score"] = max(float(candidate["score"]), round(min(score, 1.0), 3))


def _selection_response(
    record: SkillSelectionRecord,
    *,
    replayed: bool,
) -> SkillSelectionResult:
    candidates = list(record.candidate_versions_json or [])
    selected = None
    if record.selected_skill_version_id is not None:
        selected = next(
            (
                candidate
                for candidate in candidates
                if candidate.get("selected") is True
            ),
            None,
        )
    confirmation_required = (
        record.selection_source == "model_suggestion"
        and record.selected_skill_version_id is None
    )
    return SkillSelectionResult(
        record=record,
        selected=selected,
        candidates=candidates,
        confirmation_required=confirmation_required,
        replayed=replayed,
    )


def select_skill_version(
    db: Session,
    *,
    body: SkillSelectIn,
    actor_user_id: str,
    idempotency_key: str,
    project_id: int | None,
) -> SkillSelectionResult:
    body_json = body.model_dump(mode="json")
    request_hash = _canonical_hash(body_json)
    existing = db.scalar(
        select(SkillSelectionRecord).where(
            SkillSelectionRecord.actor_user_id == actor_user_id,
            SkillSelectionRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalCatalogError(
                "IDEMPOTENCY_KEY_REUSED",
                "同一 Idempotency-Key 不能用于不同请求",
                409,
            )
        return _selection_response(existing, replayed=True)

    by_uuid, current = _visible_published_versions(db, scope_type=body.scope_type)

    def exact_version(version_uuid: str, label: str) -> tuple[SkillDefinition, SkillVersion]:
        found = by_uuid.get(version_uuid)
        if found is None:
            raise ProfessionalCatalogError(
                "SKILL_VERSION_NOT_AVAILABLE",
                f"{label}的 Skill 版本不存在、未发布或不可见",
                422,
            )
        return found

    candidates: dict[str, dict[str, Any]] = {}
    explicit_pair = None
    task_pair = None
    if body.explicit_skill_version_uuid:
        explicit_pair = exact_version(body.explicit_skill_version_uuid, "显式选择")
        _add_candidate(
            candidates,
            base=_candidate_payload(db, *explicit_pair),
            score=1.0,
            reason="用户显式选择",
            source="explicit",
            priority=4,
        )
    if body.task_bound_skill_version_uuid:
        task_pair = exact_version(body.task_bound_skill_version_uuid, "任务绑定")
        _add_candidate(
            candidates,
            base=_candidate_payload(db, *task_pair),
            score=0.98,
            reason="任务固定绑定",
            source="task_binding",
            priority=3,
        )

    objective = body.objective.casefold()
    input_keys = set(body.input_fields)
    for definition, version in current:
        rules = (version.plan_definition_json or {}).get("selection_rules") or {}
        deliverable_types = rules.get("deliverable_types") or []
        exact_type = body.deliverable_type in deliverable_types
        wildcard = "*" in deliverable_types
        keywords = [str(item) for item in rules.get("keywords") or []]
        keyword_hits = [item for item in keywords if item.casefold() in objective]
        required = {str(item) for item in rules.get("required_input_fields") or []}
        if not exact_type and not wildcard and not keyword_hits:
            continue
        score = 0.65 if exact_type else 0.2 if wildcard else 0.35
        score += min(len(keyword_hits) * 0.1, 0.2)
        if required:
            score += 0.15 * len(required & input_keys) / len(required)
        elif exact_type:
            score += 0.1
        reasons = []
        if exact_type:
            reasons.append("成果类型规则匹配")
        elif wildcard:
            reasons.append("通用 Skill 兜底")
        if keyword_hits:
            reasons.append(f"目标关键词匹配: {', '.join(keyword_hits)}")
        if required and required.issubset(input_keys):
            reasons.append("必填输入已齐备")
        for reason in reasons or ["规则候选"]:
            _add_candidate(
                candidates,
                base=_candidate_payload(db, definition, version),
                score=score,
                reason=reason,
                source="rule",
                priority=2,
            )

    model_pairs: list[tuple[SkillDefinition, SkillVersion]] = []
    for version_uuid in body.model_suggested_skill_version_uuids:
        pair = exact_version(version_uuid, "模型建议")
        model_pairs.append(pair)
        _add_candidate(
            candidates,
            base=_candidate_payload(db, *pair),
            score=0.55,
            reason="模型建议候选，需用户确认",
            source="model_suggestion",
            priority=1,
        )

    ordered = sorted(
        candidates.values(),
        key=lambda item: (-int(item["_priority"]), -float(item["score"]), item["skill_key"]),
    )
    if not ordered:
        raise ProfessionalCatalogError(
            "SKILL_SELECTION_EMPTY",
            "没有找到可用的 Skill 版本",
            422,
        )

    selected_uuid: str | None = None
    selection_source = ""
    if explicit_pair is not None:
        selected_uuid = explicit_pair[1].uuid
        selection_source = "explicit"
    elif task_pair is not None:
        selected_uuid = task_pair[1].uuid
        selection_source = "task_binding"
    else:
        best_rule = next((item for item in ordered if item["source"] == "rule"), None)
        if best_rule is not None:
            selected_uuid = best_rule["version_uuid"]
            selection_source = "rule"
        elif model_pairs:
            selection_source = "model_suggestion"
            if body.user_confirmed:
                selected_uuid = model_pairs[0][1].uuid

    selected_version = by_uuid[selected_uuid][1] if selected_uuid else None
    persisted_candidates: list[dict[str, Any]] = []
    for candidate in ordered:
        clean = {key: value for key, value in candidate.items() if key != "_priority"}
        clean["selected"] = candidate["version_uuid"] == selected_uuid
        persisted_candidates.append(clean)
    record = SkillSelectionRecord(
        actor_user_id=actor_user_id,
        scope_type=body.scope_type,
        project_id=project_id,
        deliverable_type=body.deliverable_type,
        request_hash=request_hash,
        candidate_versions_json=persisted_candidates,
        selected_skill_version_id=selected_version.id if selected_version else None,
        selection_source=selection_source,
        user_confirmed=body.user_confirmed,
        idempotency_key=idempotency_key,
        selected_at=_utcnow(),
    )
    db.add(record)
    db.flush()
    return _selection_response(record, replayed=False)
