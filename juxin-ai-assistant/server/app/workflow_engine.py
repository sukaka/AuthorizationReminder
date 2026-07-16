"""Low-code workflow skeleton (7.0 §11.4): serial / parallel / condition / human-review.

JSON definitions + file-backed custom workflows.
"""

from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_hub import get_agent_hub
from .agent_router import route_agents, route_result_to_dict
from .data_egress import DEST_EXTERNAL_AGENT, DEST_LOCAL, evaluate_egress
from .models import WorkflowDefinition, WorkflowVersion
from .workflow_static import (
    ALLOWED_BUSINESS_ACTIONS,
    ALLOWED_STEP_TYPES,
    validate_workflow_definition,
)


StepHandler = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]
TypedStepHandler = Callable[[str, dict[str, Any], dict[str, Any]], dict[str, Any]]

_CUSTOM_LOCK = threading.Lock()
_ALLOWED_STEP_TYPES = ALLOWED_STEP_TYPES
_ALLOWED_BUSINESS_ACTIONS = ALLOWED_BUSINESS_ACTIONS
_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")


def _validate_step_params(stype: str, params: dict[str, Any]) -> None:
    """Validate typed business parameters before a workflow can be saved.

    Business nodes are intentionally a small, closed set.  This keeps the
    workflow definition declarative and prevents custom definitions from
    smuggling arbitrary Python/provider actions into the durable runner.
    """
    if stype == "business":
        action = str(params.get("action") or "").strip().lower()
        if action not in _ALLOWED_BUSINESS_ACTIONS:
            raise ValueError(f"invalid_business_action:{action}")


@dataclass
class WorkflowRunResult:
    workflow_id: str
    status: str  # succeeded | failed | waiting_human | partial
    steps: list[dict[str, Any]] = field(default_factory=list)
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str = ""


def _custom_store_path(settings=None) -> Path:
    base = Path("./storage")
    if settings is not None:
        base = Path(getattr(settings, "knowledge_storage_dir", None) or "./storage")
    base.mkdir(parents=True, exist_ok=True)
    return base / "custom_workflows.json"


def load_custom_workflows(settings=None) -> dict[str, dict[str, Any]]:
    path = _custom_store_path(settings)
    with _CUSTOM_LOCK:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {}
            return {k: v for k, v in data.items() if isinstance(v, dict)}
        except Exception:
            return {}


def save_custom_workflow(definition: dict[str, Any], settings=None) -> dict[str, Any]:
    """Validate and persist a user workflow. Returns normalized definition."""
    static_result = validate_workflow_definition(definition)
    if not static_result["valid"]:
        first = static_result["errors"][0]
        if first["code"] == "invalid_business_action":
            raise ValueError(f"invalid_business_action:{first.get('details', {}).get('action', '')}")
        raise ValueError(f"workflow_static_validation_failed:{first['code']}")
    wf_id = str(definition.get("id") or "").strip().lower()
    if not _ID_RE.match(wf_id):
        raise ValueError("invalid_workflow_id")
    if wf_id in _default_workflows():
        raise ValueError("cannot_overwrite_builtin")
    name = str(definition.get("name") or wf_id).strip()[:128]
    description = str(definition.get("description") or "").strip()[:500]
    steps = definition.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps_required")
    if len(steps) > 30:
        raise ValueError("too_many_steps")
    normalized_steps: list[dict[str, Any]] = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"invalid_step_{i}")
        sid = str(step.get("id") or f"s{i + 1}").strip()
        stype = str(step.get("type") or "").strip()
        if stype not in _ALLOWED_STEP_TYPES:
            raise ValueError(f"invalid_step_type:{stype}")
        params = step.get("params") if isinstance(step.get("params"), dict) else {}
        _validate_step_params(stype, params)
        normalized_steps.append({"id": sid[:48], "type": stype, "params": params})
    row = {
        "id": wf_id,
        "name": name,
        "description": description,
        "steps": normalized_steps,
        "custom": True,
    }
    with _CUSTOM_LOCK:
        path = _custom_store_path(settings)
        existing = {}
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    existing = raw
            except Exception:
                existing = {}
        existing[wf_id] = row
        path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return row


def delete_custom_workflow(workflow_id: str, settings=None) -> bool:
    wf_id = str(workflow_id or "").strip().lower()
    if wf_id in _default_workflows():
        raise ValueError("cannot_delete_builtin")
    with _CUSTOM_LOCK:
        path = _custom_store_path(settings)
        if not path.exists():
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return False
        if not isinstance(data, dict) or wf_id not in data:
            return False
        del data[wf_id]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return True


def _normalize_workflow_definition(
    definition: dict[str, Any],
    *,
    allowed_project_ids: set[str] | None = None,
    strict_project_scope: bool = False,
) -> dict[str, Any]:
    static_result = validate_workflow_definition(
        definition,
        allowed_project_ids=allowed_project_ids,
        strict_project_scope=strict_project_scope,
    )
    if not static_result["valid"]:
        first = static_result["errors"][0]
        raise ValueError(f"workflow_static_validation_failed:{first['code']}")
    wf_id = str(definition.get("id") or "").strip().lower()
    if not _ID_RE.match(wf_id):
        raise ValueError("invalid_workflow_id")
    if wf_id in _default_workflows():
        raise ValueError("cannot_overwrite_builtin")
    name = str(definition.get("name") or wf_id).strip()[:128]
    description = str(definition.get("description") or "").strip()[:500]
    steps = definition.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps_required")
    if len(steps) > 30:
        raise ValueError("too_many_steps")
    normalized_steps: list[dict[str, Any]] = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"invalid_step_{i}")
        sid = str(step.get("id") or f"s{i + 1}").strip()
        stype = str(step.get("type") or "").strip()
        if stype not in _ALLOWED_STEP_TYPES:
            raise ValueError(f"invalid_step_type:{stype}")
        params = step.get("params") if isinstance(step.get("params"), dict) else {}
        _validate_step_params(stype, params)
        normalized_steps.append({"id": sid[:48], "type": stype, "params": params})
    return {
        "id": wf_id,
        "name": name,
        "description": description,
        "steps": normalized_steps,
        "custom": True,
    }


def _persisted_workflow_out(definition: WorkflowDefinition, version: WorkflowVersion) -> dict[str, Any]:
    row = dict(version.definition_json or {})
    row.update({
        "id": definition.workflow_id,
        "name": definition.name,
        "description": definition.description,
        "custom": True,
        "version": version.version,
        "status": version.status,
        "current_version": definition.current_version,
    })
    return row


def save_versioned_workflow(
    db: Session,
    definition: dict[str, Any],
    *,
    owner_user_id: str,
    allowed_project_ids: set[str] | None = None,
) -> dict[str, Any]:
    normalized = _normalize_workflow_definition(
        definition,
        allowed_project_ids=allowed_project_ids,
        strict_project_scope=allowed_project_ids is not None,
    )
    row = db.scalar(
        select(WorkflowDefinition).where(WorkflowDefinition.workflow_id == normalized["id"])
    )
    if row is None:
        row = WorkflowDefinition(
            workflow_id=normalized["id"], owner_user_id=owner_user_id,
            name=normalized["name"], description=normalized["description"],
        )
        db.add(row)
        db.flush()
    elif row.owner_user_id != owner_user_id:
        raise LookupError("workflow_not_found")
    else:
        row.name = normalized["name"]
        row.description = normalized["description"]
    next_version = int(db.scalar(
        select(WorkflowVersion.version)
        .where(WorkflowVersion.workflow_definition_id == row.id)
        .order_by(WorkflowVersion.version.desc())
        .limit(1)
    ) or 0) + 1
    version = WorkflowVersion(
        workflow_definition_id=row.id, version=next_version,
        definition_json=normalized, status="draft", created_by=owner_user_id,
    )
    db.add(version)
    db.flush()
    return _persisted_workflow_out(row, version)


def publish_versioned_workflow(
    db: Session,
    workflow_id: str,
    *,
    owner_user_id: str,
    allowed_project_ids: set[str] | None = None,
) -> dict[str, Any] | None:
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.owner_user_id == owner_user_id,
    ))
    if row is None:
        return None
    version = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_definition_id == row.id,
    ).order_by(WorkflowVersion.version.desc()).limit(1))
    if version is None:
        return None
    static_result = validate_workflow_definition(
        version.definition_json or {},
        allowed_project_ids=allowed_project_ids,
        strict_project_scope=allowed_project_ids is not None,
    )
    if not static_result["valid"]:
        first = static_result["errors"][0]
        raise ValueError(f"workflow_static_validation_failed:{first['code']}")
    db.execute(
        WorkflowVersion.__table__.update().where(
            WorkflowVersion.workflow_definition_id == row.id,
            WorkflowVersion.status == "published",
        ).values(status="archived")
    )
    version.status = "published"
    row.status = "published"
    row.current_version = version.version
    db.flush()
    return _persisted_workflow_out(row, version)


def rollback_versioned_workflow(
    db: Session, workflow_id: str, version_number: int, *, owner_user_id: str
) -> dict[str, Any] | None:
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.owner_user_id == owner_user_id,
    ))
    if row is None:
        return None
    version = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_definition_id == row.id,
        WorkflowVersion.version == version_number,
    ))
    if version is None:
        return None
    db.execute(WorkflowVersion.__table__.update().where(
        WorkflowVersion.workflow_definition_id == row.id,
        WorkflowVersion.status == "published",
    ).values(status="archived"))
    version.status = "published"
    row.status = "published"
    row.current_version = version.version
    db.flush()
    return _persisted_workflow_out(row, version)


def get_published_versioned_workflow(db: Session, workflow_id: str) -> dict[str, Any] | None:
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.status == "published",
    ))
    if row is None:
        return None
    version = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_definition_id == row.id,
        WorkflowVersion.version == row.current_version,
    ))
    return _persisted_workflow_out(row, version) if version is not None else None


def get_owned_published_versioned_workflow(
    db: Session, workflow_id: str, *, owner_user_id: str
) -> dict[str, Any] | None:
    """Return only the owner's currently published workflow snapshot.

    The owner check is intentionally part of this helper so a durable run
    cannot accidentally pin another user's draft or an unpublished version.
    """
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.owner_user_id == owner_user_id,
        WorkflowDefinition.status == "published",
    ))
    if row is None or not row.current_version:
        return None
    version = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_definition_id == row.id,
        WorkflowVersion.version == row.current_version,
        WorkflowVersion.status == "published",
    ))
    return _persisted_workflow_out(row, version) if version is not None else None


def get_owned_versioned_workflow(
    db: Session, workflow_id: str, *, owner_user_id: str
) -> dict[str, Any] | None:
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.owner_user_id == owner_user_id,
    ))
    if row is None:
        return None
    version_number = row.current_version or db.scalar(select(WorkflowVersion.version).where(
        WorkflowVersion.workflow_definition_id == row.id,
    ).order_by(WorkflowVersion.version.desc()).limit(1))
    version = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_definition_id == row.id,
        WorkflowVersion.version == version_number,
    ))
    return _persisted_workflow_out(row, version) if version is not None else None


def list_versioned_workflows(db: Session, *, owner_user_id: str) -> list[dict[str, Any]]:
    definitions = db.scalars(select(WorkflowDefinition).where(
        WorkflowDefinition.owner_user_id == owner_user_id,
    ).order_by(WorkflowDefinition.id.asc())).all()
    return [item for row in definitions if (item := get_owned_versioned_workflow(
        db, row.workflow_id, owner_user_id=owner_user_id
    )) is not None]


def delete_versioned_workflow(db: Session, workflow_id: str, *, owner_user_id: str) -> bool:
    row = db.scalar(select(WorkflowDefinition).where(
        WorkflowDefinition.workflow_id == workflow_id,
        WorkflowDefinition.owner_user_id == owner_user_id,
    ))
    if row is None:
        return False
    db.delete(row)
    return True


def _default_workflows() -> dict[str, dict[str, Any]]:
    return {
        "simple_route_invoke": {
            "id": "simple_route_invoke",
            "name": "智能路由并调用",
            "description": "按路由选 Agent，再执行一次 invoke。",
            "steps": [
                {"id": "route", "type": "route", "params": {}},
                {
                    "id": "invoke",
                    "type": "invoke",
                    "params": {"agent_from": "route.selected_agent_id"},
                },
                {"id": "archive", "type": "set", "params": {"key": "archived", "value": True}},
            ],
        },
        "serial_summary_echo": {
            "id": "serial_summary_echo",
            "name": "串行：摘要→回声",
            "description": "先 summary 再 echo，演示串行步骤。",
            "steps": [
                {
                    "id": "summary",
                    "type": "invoke",
                    "params": {"agent_id": "local.summary"},
                },
                {
                    "id": "echo",
                    "type": "invoke",
                    "params": {
                        "agent_id": "local.echo",
                        "input_from": "summary.output",
                    },
                },
            ],
        },
        "parallel_dual": {
            "id": "parallel_dual",
            "name": "并行：摘要+回声",
            "description": "并行跑 summary 与 echo，再合并。",
            "steps": [
                {
                    "id": "parallel",
                    "type": "parallel",
                    "params": {
                        "branches": [
                            {
                                "id": "sum",
                                "steps": [
                                    {
                                        "id": "s1",
                                        "type": "invoke",
                                        "params": {"agent_id": "local.summary"},
                                    }
                                ],
                            },
                            {
                                "id": "ech",
                                "steps": [
                                    {
                                        "id": "e1",
                                        "type": "invoke",
                                        "params": {"agent_id": "local.echo"},
                                    }
                                ],
                            },
                        ]
                    },
                },
                {"id": "merge", "type": "merge", "params": {"from": "parallel"}},
            ],
        },
        "human_review_gate": {
            "id": "human_review_gate",
            "name": "人工审核门",
            "description": "生成草稿后进入 waiting_human。",
            "steps": [
                {
                    "id": "draft",
                    "type": "invoke",
                    "params": {"agent_id": "local.summary"},
                },
                {
                    "id": "review",
                    "type": "human_review",
                    "params": {"message": "请人工确认草稿后再发送"},
                },
            ],
        },
        "vendor_kimi_jimeng": {
            "id": "vendor_kimi_jimeng",
            "name": "厂商：Kimi 分析 + 即梦封面",
            "description": "串行调用 kimi.chat 与 jimeng.image（无密钥时 dry-run）。",
            "steps": [
                {
                    "id": "egress",
                    "type": "egress_check",
                    "params": {"destination": "external_agent"},
                },
                {
                    "id": "analyze",
                    "type": "invoke",
                    "params": {"agent_id": "kimi.chat"},
                },
                {
                    "id": "cover",
                    "type": "invoke",
                    "params": {
                        "agent_id": "jimeng.image",
                        "input_from": "analyze.output",
                    },
                },
                {
                    "id": "review",
                    "type": "human_review",
                    "params": {"message": "请审核分析结果与视觉素材后再归档"},
                },
            ],
        },
        "condition_route_demo": {
            "id": "condition_route_demo",
            "name": "条件：长文走 Kimi",
            "description": "输入较长时走 kimi.chat，否则 local.summary。",
            "steps": [
                {
                    "id": "branch",
                    "type": "condition",
                    "params": {
                        "if": "input_text_len_gt",
                        "threshold": 40,
                        "then_agent": "kimi.chat",
                        "else_agent": "local.summary",
                    },
                },
                {
                    "id": "invoke",
                    "type": "invoke",
                    "params": {"agent_from": "branch.selected_agent_id"},
                },
            ],
        },
        "project_dossier": {
            "id": "project_dossier",
            "name": "项目档案整理",
            "description": "读取受控项目资料，标准化为 JSON，并生成可追溯成果。",
            "steps": [
                {
                    "id": "read_project",
                    "type": "project_read",
                    "params": {"project_uuid_from": "context.project_uuid"},
                },
                {
                    "id": "normalize",
                    "type": "transform",
                    "params": {"operation": "json", "input_from": "read_project.output"},
                },
                {
                    "id": "create_artifact",
                    "type": "artifact",
                    "params": {
                        "title": "项目档案",
                        "content_from": "normalize.output",
                        "artifact_type": "markdown",
                    },
                },
            ],
        },
        "review_and_notify": {
            "id": "review_and_notify",
            "name": "审核后通知",
            "description": "先生成成果，人工确认后写入通知 Outbox。",
            "steps": [
                {
                    "id": "create_artifact",
                    "type": "artifact",
                    "params": {"title": "待审核成果", "content_from": "input_text"},
                },
                {
                    "id": "review",
                    "type": "approval",
                    "params": {"message": "请审核成果后继续发送通知"},
                },
                {
                    "id": "notify",
                    "type": "notification",
                    "params": {
                        "channel": "in_app",
                        "payload_from": "create_artifact.output",
                    },
                },
            ],
        },
        "scheduled_weekly_brief": {
            "id": "scheduled_weekly_brief",
            "name": "定时周报摘要",
            "description": "按调度触发读取项目资料并生成周报成果；发送由独立 Outbox 节点负责。",
            "steps": [
                {
                    "id": "read_project",
                    "type": "project_read",
                    "params": {"project_uuid_from": "context.project_uuid"},
                },
                {
                    "id": "summarize",
                    "type": "transform",
                    "params": {"operation": "json", "input_from": "read_project.output"},
                },
                {
                    "id": "create_artifact",
                    "type": "artifact",
                    "params": {
                        "title": "项目周报摘要",
                        "content_from": "summarize.output",
                        "artifact_type": "markdown",
                    },
                },
            ],
        },
        "monthly_business_report": {
            "id": "monthly_business_report",
            "name": "月度经营报告",
            "description": "读取受控项目快照，生成可追溯月报，经人工审核后归档。",
            "steps": [
                {
                    "id": "read_project",
                    "type": "project_read",
                    "params": {"project_uuid_from": "context.project_uuid"},
                },
                {
                    "id": "report_skill",
                    "type": "business",
                    "params": {
                        "action": "monthly_report",
                        "input_from": "read_project.output",
                        "period_from": "context.report_period",
                    },
                },
                {
                    "id": "create_draft",
                    "type": "artifact",
                    "params": {
                        "title": "月度经营报告草稿",
                        "content_from": "report_skill.output",
                        "artifact_type": "markdown",
                    },
                },
                {
                    "id": "approval",
                    "type": "approval",
                    "params": {
                        "approval_key": "monthly_business_report",
                        "message": "请审核月度经营报告后继续归档",
                    },
                },
                {
                    "id": "archive",
                    "type": "business",
                    "params": {
                        "action": "archive_key",
                        "input_from": "create_draft.output",
                    },
                },
            ],
        },
        "overdue_item_reminder": {
            "id": "overdue_item_reminder",
            "name": "逾期事项提醒",
            "description": "按逾期事项和责任人确定性分组，审核后写入站内通知 Outbox。",
            "steps": [
                {
                    "id": "group_overdue",
                    "type": "business",
                    "params": {
                        "action": "overdue_group",
                        "items_from": "context.overdue_items",
                    },
                },
                {
                    "id": "create_draft",
                    "type": "artifact",
                    "params": {
                        "title": "逾期事项提醒草稿",
                        "content_from": "group_overdue.output",
                        "artifact_type": "markdown",
                    },
                },
                {
                    "id": "approval",
                    "type": "approval",
                    "params": {
                        "approval_key": "overdue_item_reminder",
                        "message": "请确认逾期事项提醒后发送站内通知",
                    },
                },
                {
                    "id": "notify",
                    "type": "notification",
                    "params": {
                        "channel": "in_app",
                        "payload_from": "group_overdue.output",
                    },
                },
            ],
        },
        "approved_deliverable_archive": {
            "id": "approved_deliverable_archive",
            "name": "已审批交付物归档",
            "description": "校验审批状态和参数哈希，生成稳定归档业务键并保留证据链。",
            "steps": [
                {
                    "id": "validate_approval",
                    "type": "business",
                    "params": {
                        "action": "validate_approval",
                        "input_from": "context.approved_deliverable",
                        "approval_status_from": "context.approval_status",
                        "approval_param_hash_from": "context.approval_param_hash",
                    },
                },
                {
                    "id": "archive",
                    "type": "business",
                    "params": {
                        "action": "archive_key",
                        "input_from": "context.approved_deliverable",
                        "requires_approval": False,
                    },
                },
                {
                    "id": "save_deliverable",
                    "type": "artifact",
                    "params": {
                        "title": "已审批交付物归档",
                        "content_from": "context.approved_deliverable",
                        "artifact_type": "markdown",
                    },
                },
                {
                    "id": "notify_owner",
                    "type": "notification",
                    "params": {
                        "channel": "in_app",
                        "payload_from": "archive.output",
                    },
                },
            ],
        },
    }


def all_workflows(settings=None) -> dict[str, dict[str, Any]]:
    merged = dict(_default_workflows())
    for key, val in load_custom_workflows(settings).items():
        merged[key] = val
    return merged


def list_workflow_definitions(settings=None) -> list[dict[str, Any]]:
    return [
        {
            "id": w["id"],
            "name": w["name"],
            "description": w.get("description") or "",
            "step_count": len(w.get("steps") or []),
            "custom": bool(w.get("custom")),
        }
        for w in all_workflows(settings).values()
    ]


def get_workflow_definition(workflow_id: str, settings=None) -> dict[str, Any] | None:
    return all_workflows(settings).get(workflow_id)


def _resolve_path(ctx: dict[str, Any], path: str) -> Any:
    cur: Any = ctx
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


class WorkflowEngine:
    def __init__(
        self,
        db: Session | None = None,
        *,
        typed_step_handler: TypedStepHandler | None = None,
    ) -> None:
        self.db = db
        self.hub = get_agent_hub()
        self.typed_step_handler = typed_step_handler

    def run(
        self,
        workflow_id: str,
        *,
        input_text: str,
        context: dict[str, Any] | None = None,
        preferred_agent_id: str = "",
        egress_confirmed: bool = False,
        owner_user_id: str = "",
    ) -> WorkflowRunResult:
        # Versioned custom workflows are private resources.  The lightweight
        # compatibility runner must carry the caller's owner identity just as
        # the durable runner does; otherwise a caller who knows another
        # workflow ID could execute its published DB snapshot.
        definition = (
            get_owned_published_versioned_workflow(
                self.db, workflow_id, owner_user_id=owner_user_id
            )
            if self.db is not None and owner_user_id
            else None
        )
        if definition is None:
            # The JSON custom-workflow store predates owner-scoped, durable
            # workflow versions and is a process-wide file.  Never use it as
            # a fallback when a database-backed caller is present: doing so
            # would let a caller who knows an old workflow ID execute a
            # workflow that has no owner binding.  Built-ins are immutable
            # and safe to resolve locally; the file store remains available
            # only to the explicitly legacy, DB-less runner.
            if self.db is not None:
                definition = _default_workflows().get(workflow_id)
            else:
                definition = get_workflow_definition(workflow_id)
                if definition is None:
                    # try custom store without settings
                    definition = get_workflow_definition(workflow_id, None)
        if definition is None:
            return WorkflowRunResult(
                workflow_id=workflow_id,
                status="failed",
                error="workflow_not_found",
            )
        run_id = str(uuid.uuid4())
        ctx: dict[str, Any] = {
            "input_text": input_text,
            "context": context or {},
            "preferred_agent_id": preferred_agent_id,
            "egress_confirmed": egress_confirmed,
            "run_id": run_id,
            "steps": {},
        }
        step_logs: list[dict[str, Any]] = []
        try:
            status = self._run_steps(definition.get("steps") or [], ctx, step_logs)
            return WorkflowRunResult(
                workflow_id=workflow_id,
                status=status,
                steps=step_logs,
                outputs={
                    "run_id": run_id,
                    "final": ctx.get("final"),
                    "steps": ctx.get("steps"),
                },
            )
        except Exception as exc:
            return WorkflowRunResult(
                workflow_id=workflow_id,
                status="failed",
                steps=step_logs,
                error=str(exc)[:500],
                outputs={"run_id": run_id, "steps": ctx.get("steps")},
            )

    def _run_steps(
        self,
        steps: list[dict[str, Any]],
        ctx: dict[str, Any],
        step_logs: list[dict[str, Any]],
    ) -> str:
        for step in steps:
            sid = str(step.get("id") or f"step_{len(step_logs)}")
            stype = str(step.get("type") or "noop")
            params = step.get("params") if isinstance(step.get("params"), dict) else {}
            started = time.perf_counter()
            try:
                out = self._exec_step(stype, params, ctx)
                latency = int((time.perf_counter() - started) * 1000)
                ctx.setdefault("steps", {})[sid] = out
                ctx["final"] = out
                out_status = str(out.get("status") or "ok")
                step_status = "succeeded"
                if out_status == "waiting_human":
                    step_status = "waiting_human"
                elif out_status in {"blocked", "error", "failed"}:
                    step_status = "failed"
                step_logs.append(
                    {
                        "id": sid,
                        "type": stype,
                        "status": step_status,
                        "latency_ms": latency,
                        "output": out,
                        "error": str(out.get("error") or "")[:300] if step_status == "failed" else "",
                    }
                )
                if out_status == "waiting_human":
                    return "waiting_human"
                if step_status == "failed":
                    return "failed"
            except Exception as exc:
                step_logs.append(
                    {
                        "id": sid,
                        "type": stype,
                        "status": "failed",
                        "error": str(exc)[:300],
                    }
                )
                raise
        return "succeeded"

    def _exec_step(self, stype: str, params: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
        if stype in {
            "tool",
            "skill",
            "artifact",
            "approval",
            "project_read",
            "transform",
            "notification",
            "wait",
            "subflow",
            "business",
        }:
            if self.typed_step_handler is None:
                raise ValueError("typed_step_requires_durable_runtime")
            return self.typed_step_handler(stype, params, ctx)
        if stype == "noop":
            return {"status": "ok"}
        if stype == "set":
            key = str(params.get("key") or "value")
            val = params.get("value")
            ctx[key] = val
            return {"status": "ok", key: val}
        if stype == "route":
            if self.db is None:
                # fallback: pick local.summary or echo
                hub = self.hub
                pick = "local.summary" if hub.get("local.summary") else "local.echo"
                return {
                    "status": "ok",
                    "selected_agent_id": pick,
                    "routing_reasons": ["no_db_fallback"],
                }
            result = route_agents(
                self.db,
                input_text=str(ctx.get("input_text") or ""),
                preferred_agent_id=str(ctx.get("preferred_agent_id") or params.get("preferred_agent_id") or ""),
                required_capabilities=params.get("capabilities") if isinstance(params.get("capabilities"), list) else None,
                allow_external=bool(params.get("allow_external", True)),
            )
            data = route_result_to_dict(result)
            data["status"] = "ok"
            data["selected_agent_id"] = result.selected_agent_id
            return data
        if stype == "invoke":
            agent_id = str(params.get("agent_id") or "")
            if params.get("agent_from"):
                # agent_from like "route.selected_agent_id" or "branch.selected_agent_id"
                path = str(params["agent_from"])
                resolved = None
                if "." in path:
                    step_id, _, key = path.partition(".")
                    resolved = (ctx.get("steps") or {}).get(step_id, {}).get(key)
                if resolved:
                    agent_id = str(resolved)
            if not agent_id:
                raise ValueError("invoke_missing_agent_id")
            input_text = str(ctx.get("input_text") or "")
            if params.get("input_from"):
                path = str(params["input_from"])
                step_id, _, key = path.partition(".")
                alt = (ctx.get("steps") or {}).get(step_id, {}).get(key)
                if alt is not None:
                    input_text = str(alt)
            # egress for external
            agent = self.hub.get(agent_id)
            endpoint = agent.descriptor.endpoint if agent else ""
            dest = DEST_LOCAL if agent_id.startswith("local.") or not endpoint else DEST_EXTERNAL_AGENT
            decision = evaluate_egress(
                input_text,
                destination=dest,
                confirmed=bool(ctx.get("egress_confirmed")),
            )
            if not decision.allowed:
                return {
                    "status": "blocked",
                    "error": "egress_denied",
                    "agent_id": agent_id,
                    "reasons": decision.reasons,
                }
            send = decision.redacted_text if decision.redaction_applied else input_text
            result = self.hub.invoke(agent_id, input_text=send, context=ctx.get("context") or {})
            return {
                "status": "ok" if not result.get("error") else "error",
                "agent_id": agent_id,
                "output": result.get("output") or result.get("error") or "",
                "raw": result,
            }
        if stype == "parallel":
            branches = params.get("branches") if isinstance(params.get("branches"), list) else []
            if not branches:
                return {"status": "ok", "branches": {}, "execution_mode": "serial"}

            normalized = [
                (
                    str(branch.get("id") or f"b{index}"),
                    branch.get("steps") if isinstance(branch.get("steps"), list) else [],
                )
                for index, branch in enumerate(branches)
                if isinstance(branch, dict)
            ]
            is_safe = all(self._branch_is_parallel_safe(steps) for _, steps in normalized)
            mode = "parallel" if is_safe and len(normalized) > 1 else "serial"
            if mode == "parallel":
                max_workers = min(
                    len(normalized),
                    max(1, min(int(params.get("max_workers") or len(normalized)), 8)),
                )
                with ThreadPoolExecutor(
                    max_workers=max_workers,
                    thread_name_prefix="workflow-branch",
                ) as executor:
                    futures = [
                        executor.submit(self._run_parallel_branch, bid, steps, ctx)
                        for bid, steps in normalized
                    ]
                    # Resolve futures in definition order so persisted output is deterministic.
                    results = [future.result() for future in futures]
            else:
                results = [self._run_parallel_branch(bid, steps, ctx) for bid, steps in normalized]

            return {
                "status": "ok",
                "branches": {bid: result for bid, result in results},
                "execution_mode": mode,
            }


        if stype == "merge":
            src = str(params.get("from") or "parallel")
            parallel_out = (ctx.get("steps") or {}).get(src) or {}
            branches = parallel_out.get("branches") if isinstance(parallel_out, dict) else {}
            merged = {
                bid: (b.get("final") or {})
                for bid, b in (branches or {}).items()
            }
            return {"status": "ok", "merged": merged}
        if stype == "condition":
            text = str(ctx.get("input_text") or "")
            pred = str(params.get("if") or params.get("predicate") or "contains")
            # Agent selection form: if input_text_len_gt → then_agent / else_agent
            if pred in {"input_text_len_gt", "len_gt"}:
                threshold = int(params.get("threshold") or 40)
                take_then = len(text) > threshold
                then_agent = str(params.get("then_agent") or "kimi.chat")
                else_agent = str(params.get("else_agent") or "local.summary")
                selected = then_agent if take_then else else_agent
                return {
                    "status": "ok",
                    "branch": "then" if take_then else "else",
                    "predicate": pred,
                    "threshold": threshold,
                    "input_len": len(text),
                    "selected_agent_id": selected,
                }
            # Nested steps form: contains → then/else step lists
            match = str(params.get("contains") or "")
            then_steps = params.get("then") if isinstance(params.get("then"), list) else []
            else_steps = params.get("else") if isinstance(params.get("else"), list) else []
            take_then = bool(match and match in text)
            chosen = then_steps if take_then else else_steps
            blog: list[dict[str, Any]] = []
            if chosen:
                self._run_steps(chosen, ctx, blog)
            return {
                "status": "ok",
                "branch": "then" if take_then else "else",
                "steps": blog,
                "selected_agent_id": str(
                    params.get("then_agent" if take_then else "else_agent") or ""
                ),
            }
        if stype == "human_review":
            return {
                "status": "waiting_human",
                "message": str(params.get("message") or "需要人工确认"),
                "draft": (ctx.get("final") or {}).get("output"),
            }
        if stype == "egress_check":
            dest = str(params.get("destination") or DEST_EXTERNAL_AGENT)
            decision = evaluate_egress(
                str(ctx.get("input_text") or ""),
                destination=dest,
                confirmed=bool(ctx.get("egress_confirmed")),
            )
            return {
                "status": "ok" if decision.allowed else "blocked",
                "allowed": decision.allowed,
                "level": int(decision.level),
                "reasons": decision.reasons,
            }
        raise ValueError(f"unknown_step_type:{stype}")

    @staticmethod
    def _branch_is_parallel_safe(steps: list[dict[str, Any]]) -> bool:
        """Only run branches concurrently when they do not share runtime state."""
        for step in steps:
            if not isinstance(step, dict):
                return False
            stype = str(step.get("type") or "noop")
            params = step.get("params") if isinstance(step.get("params"), dict) else {}
            if stype in {"route", "tool", "skill", "artifact", "approval", "human_review"}:
                return False
            if stype == "condition":
                for key in ("then", "else"):
                    nested = params.get(key)
                    if isinstance(nested, list) and not WorkflowEngine._branch_is_parallel_safe(nested):
                        return False
            elif stype == "parallel":
                nested_branches = params.get("branches")
                if not isinstance(nested_branches, list):
                    return False
                if not all(
                    isinstance(branch, dict)
                    and WorkflowEngine._branch_is_parallel_safe(
                        branch.get("steps") if isinstance(branch.get("steps"), list) else []
                    )
                    for branch in nested_branches
                ):
                    return False
            elif stype not in {"noop", "set", "invoke", "merge", "egress_check"}:
                return False
        return True

    def _run_parallel_branch(
        self,
        branch_id: str,
        steps: list[dict[str, Any]],
        parent_ctx: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        try:
            branch_ctx = copy.deepcopy(parent_ctx)
        except (TypeError, ValueError):
            # Runtime registries may contain non-copyable handles; safe branches only
            # mutate their own step map, so retain a shallow fallback for those contexts.
            branch_ctx = dict(parent_ctx)
            branch_ctx["steps"] = copy.deepcopy(parent_ctx.get("steps") or {})
        branch_ctx["steps"] = copy.deepcopy(parent_ctx.get("steps") or {})
        branch_logs: list[dict[str, Any]] = []
        status = self._run_steps(steps, branch_ctx, branch_logs)
        return branch_id, {
            "status": status,
            "steps": branch_logs,
            "final": branch_ctx.get("final"),
        }
