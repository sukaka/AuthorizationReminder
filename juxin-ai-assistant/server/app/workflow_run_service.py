"""Durable adapter for audited workflow runs.

The original :class:`WorkflowEngine` remains the lightweight, ephemeral
runner used by existing callers.  This adapter gives the audited path the
same lifecycle semantics as every other AgentRun: a pinned workflow snapshot,
durable step boundaries, explicit human-review waiting, and replay from the
last safe checkpoint.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .agent_contracts import AgentEventType, AgentRunStage, AgentRunStatus
from .agent_runtime import ToolContext, ToolRegistry
from .agent_runtime.tools import (
    DocumentStructureValidateTool,
    DocumentTemplateSelectTool,
    FileParseTool,
    ReferenceSourceValidateTool,
    TaskModeDetectTool,
)
from .agent_run_service import AgentRunService, LeaseLostError
from .artifact_service import ArtifactService
from .crypto import ContentCipher
from .models import AgentRun, AgentRunStep, WorkflowWait
from .schemas import AuthScope, SessionPayload, UserPayload
from .skill_registry import SkillRegistry
from .skill_runner import SkillRunner
from .workflow_engine import (
    WorkflowEngine,
    WorkflowRunResult,
    get_owned_published_versioned_workflow,
    get_workflow_definition,
)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _bounded(value: Any, *, depth: int = 0) -> Any:
    """Keep persisted workflow diagnostics bounded and JSON serializable."""
    if depth > 5:
        return "[truncated]"
    if isinstance(value, str):
        return value[:12_000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, dict):
        return {
            str(key)[:128]: _bounded(item, depth=depth + 1)
            for key, item in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [_bounded(item, depth=depth + 1) for item in list(value)[:50]]
    return str(value)[:2_000]


def _canonical_hash(snapshot: dict[str, Any]) -> str:
    raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class WorkflowRunService:
    """Execute a workflow while persisting the unified AgentRun contract."""

    def __init__(
        self,
        db: Session,
        settings,
        *,
        worker_id: str | None = None,
        lease_ttl_seconds: int = 30,
    ) -> None:
        self.db = db
        self.settings = settings
        self.worker_id = worker_id or f"workflow-worker-{uuid4().hex}"
        self.lease_ttl_seconds = max(5, int(lease_ttl_seconds))
        self.runs = AgentRunService(
            db,
            ContentCipher(settings.content_encryption_key),
            key_version=settings.content_encryption_key_version,
        )

    @staticmethod
    def find_idempotent_run(
        db: Session,
        *,
        owner_user_id: str,
        workflow_id: str,
        idempotency_key: str,
        source: str | None = None,
        limit: int = 200,
    ) -> AgentRun | None:
        """Find a previously accepted scheduled run by its durable key.

        The key lives in the pinned runtime metadata rather than in a new
        database column, so this remains compatible with existing AgentRun
        rows and works on both SQLite and PostgreSQL JSON implementations.
        The bounded scan is intentional: schedule dispatch is a control-plane
        operation and must not issue an unbounded historical query.
        """
        if not owner_user_id or not workflow_id or not idempotency_key:
            return None
        rows = db.scalars(
            select(AgentRun)
            .where(
                AgentRun.owner_user_id == owner_user_id,
                AgentRun.run_type == "workflow",
            )
            .order_by(desc(AgentRun.created_at))
            .limit(max(1, min(int(limit), 1000)))
        )
        for row in rows:
            metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
            runtime = metadata.get("workflow_runtime")
            if not isinstance(runtime, dict) or str(runtime.get("workflow_id")) != str(workflow_id):
                continue
            routing = runtime.get("routing")
            if not isinstance(routing, dict):
                continue
            if source is not None and str(routing.get("source") or "") != str(source):
                continue
            if str(routing.get("idempotency_key") or "") == str(idempotency_key):
                return row
        return None

    def _resolve_definition(self, workflow_id: str, owner_user_id: str) -> tuple[dict[str, Any], str, int]:
        versioned = get_owned_published_versioned_workflow(
            self.db, workflow_id, owner_user_id=owner_user_id
        )
        if versioned is not None:
            return versioned, "versioned", int(versioned.get("version") or 1)

        # A custom workflow must be owned and published through the DB path.
        # Legacy file-backed custom definitions are therefore not executable
        # through the durable/audited endpoint.
        builtin = get_workflow_definition(workflow_id, self.settings)
        if builtin is None or bool(builtin.get("custom")):
            raise LookupError("workflow_not_found_or_not_published")
        return builtin, "builtin", 1

    @staticmethod
    def _snapshot(definition: dict[str, Any]) -> dict[str, Any]:
        return _bounded({
            "id": definition.get("id"),
            "name": definition.get("name") or definition.get("id"),
            "description": definition.get("description") or "",
            "steps": definition.get("steps") or [],
            "custom": bool(definition.get("custom")),
        })

    def _metadata(self, row: AgentRun) -> dict[str, Any]:
        value = row.metadata_json if isinstance(row.metadata_json, dict) else {}
        runtime = value.get("workflow_runtime")
        if not isinstance(runtime, dict):
            raise ValueError("workflow_runtime_metadata_missing")
        return runtime

    def _request(self, row: AgentRun) -> dict[str, Any]:
        payload = self.runs.decrypt_request(row)
        context = payload.get("context")
        if not isinstance(context, dict):
            context = {}
        return {
            "input_text": str(payload.get("input_text") or ""),
            "context": context.get("context") if isinstance(context.get("context"), dict) else {},
            "preferred_agent_id": str(context.get("preferred_agent_id") or ""),
            "egress_confirmed": bool(context.get("egress_confirmed")),
        }

    @staticmethod
    def _state(row: AgentRun) -> dict[str, Any]:
        checkpoint = row.checkpoint_json if isinstance(row.checkpoint_json, dict) else {}
        return {
            "next_step_index": max(0, int(checkpoint.get("next_step_index") or 0)),
            "step_outputs": dict(checkpoint.get("step_outputs") or {})
            if isinstance(checkpoint.get("step_outputs"), dict) else {},
            "steps": list(checkpoint.get("steps") or [])
            if isinstance(checkpoint.get("steps"), list) else [],
            "final": checkpoint.get("final"),
            "ctx_state": dict(checkpoint.get("ctx_state") or {})
            if isinstance(checkpoint.get("ctx_state"), dict) else {},
        }

    @staticmethod
    def _ctx_state(ctx: dict[str, Any]) -> dict[str, Any]:
        reserved = {
            "input_text", "context", "preferred_agent_id", "egress_confirmed",
            "run_id", "steps", "final", "_current_step_id", "_typed_registry",
        }
        return _bounded({
            key: value for key, value in ctx.items()
            if key not in reserved and not str(key).startswith("_")
        })

    @staticmethod
    def _resolve_reference(ctx: dict[str, Any], path: str) -> Any:
        current: Any = ctx
        parts = str(path or "").split(".")
        for index, part in enumerate(parts):
            if isinstance(current, dict) and part in current:
                current = current[part]
                continue
            # Workflow definitions address prior nodes as ``node.output``;
            # runtime context stores those outputs under ``steps``.
            if index == 0 and isinstance(ctx.get("steps"), dict) and part in ctx["steps"]:
                current = ctx["steps"][part]
                continue
            return None
        return current

    def _business_input(self, params: dict[str, Any], ctx: dict[str, Any]) -> Any:
        """Resolve the bounded input for a deterministic local business node."""
        for key in ("input_from", "items_from", "deliverable_from"):
            if params.get(key):
                return self._resolve_reference(ctx, str(params[key]))
        for key in ("input", "items", "deliverable"):
            if key in params:
                return params[key]
        return None

    def _exec_business_step(
        self,
        row: AgentRun,
        params: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        """Run one of the closed, provider-free 4.0 business primitives."""
        action = str(params.get("action") or "").strip().lower()
        value = self._business_input(params, ctx)
        workflow_context = ctx.get("context") if isinstance(ctx.get("context"), dict) else {}

        if action == "monthly_report":
            if not isinstance(value, dict):
                raise ValueError("monthly_report_input_required")
            period = params.get("period")
            if params.get("period_from"):
                period = self._resolve_reference(ctx, str(params["period_from"]))
            period = str(period or workflow_context.get("report_period") or "current")[:64]
            project_uuid = str(
                value.get("project_uuid") or value.get("uuid")
                or workflow_context.get("project_uuid") or ""
            ).strip()
            if not project_uuid:
                raise ValueError("monthly_report_project_required")
            metrics = value.get("metrics") if isinstance(value.get("metrics"), dict) else {}
            facts = value.get("facts") or value.get("key_facts") or []
            references = value.get("references") or value.get("evidence") or []
            facts = facts if isinstance(facts, list) else [facts]
            references = references if isinstance(references, list) else [references]
            issues: list[str] = []
            for index, fact in enumerate(facts):
                if isinstance(fact, dict) and not any(
                    fact.get(key) for key in ("reference_id", "source", "evidence_id")
                ):
                    issues.append(f"fact_{index}_missing_reference")
            source_snapshot_hash = _canonical_hash(_bounded(value))
            parameter_hash = _canonical_hash({
                "project_uuid": project_uuid,
                "period": period,
                "source_snapshot_hash": source_snapshot_hash,
            })
            output = {
                "title": f"{period} 月度经营报告",
                "project_uuid": project_uuid,
                "period": period,
                "sections": {
                    "overview": str(value.get("name") or value.get("title") or project_uuid)[:500],
                    "metrics": _bounded(metrics),
                    "facts": _bounded(facts),
                    "references": _bounded(references),
                },
                "quality": {"passed": not issues, "issues": issues},
                "source_snapshot_hash": source_snapshot_hash,
                "parameter_hash": parameter_hash,
                "skill_id": "local.monthly_business_report",
                "skill_version": "4.0.0-local",
            }
            return {"status": "ok", "action": action, "output": _bounded(output)}

        if action == "overdue_group":
            items = value
            if items is None:
                items = workflow_context.get("overdue_items")
            if isinstance(items, dict):
                items = items.get("items") or items.get("overdue_items")
            if not isinstance(items, list):
                raise ValueError("overdue_items_required")
            overdue_statuses = {"overdue", "late", "pending_overdue"}
            selected: list[dict[str, Any]] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                explicit = "overdue" in item or "status" in item
                is_overdue = bool(item.get("overdue")) or str(item.get("status") or "").lower() in overdue_statuses
                if explicit and not is_overdue:
                    continue
                selected.append(dict(item))
            selected.sort(key=lambda item: (
                str(item.get("due_at") or item.get("due_date") or "9999-12-31"),
                str(item.get("id") or item.get("uuid") or ""),
            ))
            grouped: dict[str, list[dict[str, Any]]] = {}
            for item in selected:
                owner = str(
                    item.get("owner_user_id") or item.get("owner")
                    or item.get("assignee") or "unassigned"
                )[:128]
                grouped.setdefault(owner, []).append(_bounded(item))
            groups = [
                {"owner": owner, "count": len(grouped[owner]), "items": grouped[owner]}
                for owner in sorted(grouped)
            ]
            output = {
                "overdue_count": len(selected),
                "groups": groups,
                "group_hash": _canonical_hash({"groups": groups}),
                "draft": f"共 {len(selected)} 项逾期事项，已按责任人分组。",
            }
            return {"status": "ok", "action": action, "output": _bounded(output)}

        if action == "validate_approval":
            if not isinstance(value, dict):
                raise ValueError("approved_deliverable_required")
            approval_status: Any = params.get("approval_status")
            if params.get("approval_status_from"):
                approval_status = self._resolve_reference(ctx, str(params["approval_status_from"]))
            approval_status = approval_status if approval_status is not None else workflow_context.get("approval_status")
            approved = approval_status is True or str(approval_status or "").lower() in {
                "approved", "confirmed", "succeeded", "success",
            }
            computed_hash = _canonical_hash(_bounded(value))
            expected_hash: Any = params.get("approval_param_hash")
            if params.get("approval_param_hash_from"):
                expected_hash = self._resolve_reference(ctx, str(params["approval_param_hash_from"]))
            expected_hash = expected_hash or workflow_context.get("approval_param_hash")
            declared_hash = value.get("approval_param_hash") or value.get("parameter_hash")
            hash_valid = not expected_hash or str(expected_hash) in {computed_hash, str(declared_hash or "")}
            if not approved:
                return {
                    "status": "blocked", "action": action,
                    "error": "approval_required", "approval_verified": False,
                    "output": {"approval_verified": False},
                }
            if not hash_valid:
                return {
                    "status": "blocked", "action": action,
                    "error": "approval_parameter_hash_mismatch", "approval_verified": False,
                    "output": {"approval_verified": False, "computed_hash": computed_hash},
                }
            output = {
                "approval_verified": True,
                "approval_status": "approved",
                "approval_param_hash": computed_hash,
                "input": _bounded(value),
            }
            return {"status": "ok", "action": action, "approval_verified": True, "output": output}

        if action == "archive_key":
            if not isinstance(value, dict):
                raise ValueError("archive_subject_required")
            requires_approval = bool(params.get("requires_approval", True))
            status = str(workflow_context.get("approval_status") or "").lower()
            approved = workflow_context.get("approval_status") is True or status in {
                "approved", "confirmed", "succeeded", "success",
            } or bool(ctx.get("approval_confirmed"))
            if not approved and isinstance(ctx.get("steps"), dict):
                approved = any(
                    isinstance(step_output, dict) and step_output.get("approval_verified")
                    for step_output in ctx["steps"].values()
                )
            if requires_approval and not approved:
                return {
                    "status": "blocked", "action": action,
                    "error": "approval_required", "output": {"archive_status": "blocked"},
                }
            subject = str(
                value.get("artifact_id") or value.get("artifact_uuid")
                or value.get("deliverable_uuid") or value.get("uuid")
                or value.get("id") or value.get("subject_id") or ""
            ).strip()
            if not subject:
                raise ValueError("archive_subject_id_required")
            version = int(value.get("version") or value.get("artifact_version") or 1)
            project_uuid = str(value.get("project_uuid") or workflow_context.get("project_uuid") or "")[:128]
            business_key = f"deliverable:{row.owner_user_id}:{subject}:v{version}"
            archive_idempotency_key = hashlib.sha256(business_key.encode("utf-8")).hexdigest()
            output = {
                "archive_status": "ok",
                "archive_business_key": business_key,
                "archive_idempotency_key": archive_idempotency_key,
                "subject_id": subject,
                "version": version,
                "project_uuid": project_uuid,
                "owner_user_id": str(row.owner_user_id),
                "evidence": {"input_hash": _canonical_hash(_bounded(value))},
            }
            return {"status": "ok", "action": action, "output": output}

        raise ValueError(f"unknown_business_action:{action}")

    @staticmethod
    def _workflow_registry() -> ToolRegistry:
        """Register the safe, structured tools available to workflow nodes.

        All calls still pass through ``ToolRegistry`` policy, invocation and
        idempotency enforcement; this list is deliberately explicit so a
        workflow definition cannot discover arbitrary Python callables.
        """

        registry = ToolRegistry()
        for tool in (
            DocumentStructureValidateTool(),
            DocumentTemplateSelectTool(),
            FileParseTool(),
            ReferenceSourceValidateTool(),
            TaskModeDetectTool(),
        ):
            registry.register(tool)
        return registry

    def _exec_typed_step(
        self,
        row: AgentRun,
        stype: str,
        params: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        if stype == "business":
            return self._exec_business_step(row, params, ctx)

        if stype == "approval":
            token = secrets.token_urlsafe(32)
            expires_at = params.get("approval_expires_at") or params.get("expires_at")
            if isinstance(expires_at, str) and expires_at.strip():
                try:
                    expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ValueError("approval_expires_at_invalid") from exc
            elif isinstance(params.get("expires_in_seconds"), (int, float)):
                expires_at = _utc_now() + timedelta(
                    seconds=max(1, min(int(params["expires_in_seconds"]), 7 * 24 * 3600))
                )
            elif not isinstance(expires_at, datetime):
                expires_at = _utc_now() + timedelta(hours=24)
            return {
                "status": "waiting_human",
                "approval_key": str(params.get("approval_key") or ctx.get("_current_step_id") or "approval"),
                "message": str(params.get("message") or "需要人工确认"),
                "required_role": str(params.get("required_role") or ""),
                "approval_token": token,
                "approval_token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
                "approval_expires_at": expires_at.isoformat() if expires_at else None,
            }

        if stype == "tool":
            registry = ctx.get("_typed_registry")
            if not isinstance(registry, ToolRegistry):
                raise ValueError("workflow_tool_registry_missing")
            name = str(params.get("name") or params.get("tool") or "").strip()
            if not name:
                raise ValueError("workflow_tool_name_required")
            tool_input = dict(params.get("input") or {})
            for field, source_key in (
                ("content", "content_from"),
                ("question", "question_from"),
                ("query", "query_from"),
            ):
                source = params.get(source_key)
                if source:
                    tool_input[field] = self._resolve_reference(ctx, str(source))
            if params.get("input_from"):
                resolved = self._resolve_reference(ctx, str(params["input_from"]))
                if isinstance(resolved, dict):
                    tool_input = {**tool_input, **resolved}
                elif resolved is not None:
                    tool_input["value"] = resolved

            workflow_context = ctx.get("context") if isinstance(ctx.get("context"), dict) else {}
            confirmed = workflow_context.get("confirmed_idempotency_keys")
            confirmed_keys = {
                str(item) for item in confirmed
                if str(item).strip()
            } if isinstance(confirmed, list) else set()
            idempotency_key = str(
                params.get("idempotency_key")
                or f"{row.uuid}:{ctx.get('_current_step_id') or name}"
            )
            result = registry.execute(
                name,
                tool_input,
                ToolContext(
                    user_id=str(row.owner_user_id),
                    db=self.db,
                    mode="workflow",
                    conversation_id=str(row.conversation_id or ""),
                    run_id=row.uuid,
                    idempotency_key=idempotency_key,
                    confirmed_idempotency_keys=confirmed_keys,
                    permissions={
                        str(item) for item in (workflow_context.get("permissions") or [])
                        if str(item).strip()
                    } if isinstance(workflow_context.get("permissions"), list) else set(),
                    tool_scopes={
                        str(item) for item in (workflow_context.get("tool_scopes") or [])
                        if str(item).strip()
                    } if isinstance(workflow_context.get("tool_scopes"), list) else set(),
                ),
            )
            if result.status == "success":
                return {
                    "status": "ok",
                    "tool_name": name,
                    "tool_status": result.status,
                    "payload": _bounded(result.payload),
                    "output": _bounded(result.payload),
                    "summary": _bounded(result.output_summary),
                    "replayed": bool(result.replayed),
                }
            if result.status == "confirmation_required":
                return {
                    "status": "waiting_human",
                    "tool_name": name,
                    "tool_status": result.status,
                    "message": result.error_message_safe or "工具需要人工确认",
                    "error_code": result.error_code,
                }
            return {
                "status": "error",
                "tool_name": name,
                "tool_status": result.status,
                "error": result.error_message_safe or result.error_code or "工具执行失败",
                "error_code": result.error_code,
            }

        if stype == "skill":
            skill_id = str(params.get("skill_id") or params.get("id") or "").strip()
            if not skill_id:
                raise ValueError("workflow_skill_id_required")
            skill = SkillRegistry.default().get(skill_id)
            workflow_context = ctx.get("context") if isinstance(ctx.get("context"), dict) else {}
            raw_input = params.get("input") if isinstance(params.get("input"), dict) else {}
            if params.get("input_from"):
                resolved = self._resolve_reference(ctx, str(params["input_from"]))
                if isinstance(resolved, dict):
                    raw_input = {**raw_input, **resolved}
                elif resolved is not None:
                    raw_input = {**raw_input, "question": str(resolved)}
            if "question" not in raw_input and "description" not in raw_input:
                raw_input = {**raw_input, "question": str(ctx.get("input_text") or "")}
            role = str(workflow_context.get("role") or "user")
            session = SessionPayload(
                user=UserPayload(
                    id=str(row.owner_user_id),
                    username=str(workflow_context.get("username") or row.owner_user_id),
                    role=role,
                ),
                scope=AuthScope(),
                apps=[str(item) for item in (workflow_context.get("apps") or [])],
            )
            result = SkillRunner(db=self.db).run(
                skill=skill,
                session=session,
                task_id=row.uuid,
                user_input=raw_input,
            )
            return {
                "status": "ok",
                "skill_id": skill.id,
                "skill_version": skill.version,
                "result": _bounded(result.get("result") or {}),
                "artifacts": _bounded(result.get("artifacts") or []),
                "output": _bounded(result.get("result") or {}),
            }

        if stype == "artifact":
            content = params.get("content")
            if params.get("content_from"):
                content = self._resolve_reference(ctx, str(params["content_from"]))
            if isinstance(content, (dict, list)):
                content = json.dumps(content, ensure_ascii=False, indent=2)
            content = str(content if content is not None else ctx.get("input_text") or "")
            artifact = ArtifactService(self.db).create_from_run(
                owner_user_id=str(row.owner_user_id),
                run_id=row.uuid,
                title=str(params.get("title") or "工作流成果"),
                content_markdown=content,
                artifact_type=str(params.get("artifact_type") or "markdown"),
                quality=_bounded(params.get("quality") or {}),
                context={"workflow_id": self._metadata(row).get("workflow_id")},
                actor=str(row.owner_user_id),
            )
            output = {
                "artifact_id": artifact.uuid,
                "title": artifact.title,
                "artifact_type": artifact.artifact_type,
                "version": int(artifact.version or 1),
            }
            return {"status": "ok", "artifact_id": artifact.uuid, "output": output}

        if stype == "project_read":
            workflow_context = ctx.get("context") if isinstance(ctx.get("context"), dict) else {}
            records = workflow_context.get("project_records")
            project_uuid = str(params.get("project_uuid") or "").strip()
            if params.get("project_uuid_from"):
                resolved = self._resolve_reference(ctx, str(params["project_uuid_from"]))
                if resolved is not None:
                    project_uuid = str(resolved).strip()
            if not project_uuid:
                raise ValueError("project_uuid_required")
            record: Any = None
            if isinstance(records, dict):
                record = records.get(project_uuid)
            elif isinstance(records, list):
                record = next(
                    (
                        item for item in records
                        if isinstance(item, dict)
                        and str(item.get("uuid") or item.get("project_uuid") or "") == project_uuid
                    ),
                    None,
                )
            if not isinstance(record, dict):
                raise ValueError("project_not_found")
            # Only expose a bounded, JSON-shaped snapshot to later nodes.
            output = _bounded(record)
            return {"status": "ok", "project_uuid": project_uuid, "output": output}

        if stype == "transform":
            operation = str(params.get("operation") or "set").strip().lower()
            allowed = {"set", "trim", "concat", "template", "json"}
            if operation not in allowed:
                raise ValueError("transform_operation_not_allowed")
            value: Any = params.get("value")
            if params.get("input_from"):
                value = self._resolve_reference(ctx, str(params["input_from"]))
            if operation == "set":
                output = value
            elif operation == "trim":
                output = str(value or "").strip()
            elif operation == "concat":
                inputs = params.get("inputs")
                if not isinstance(inputs, list):
                    inputs = [value]
                output = "".join(str(item) for item in inputs)
            elif operation == "template":
                template = str(params.get("template") or "")
                values = params.get("values") if isinstance(params.get("values"), dict) else {}
                output = template
                for key, item in values.items():
                    output = output.replace("{" + str(key) + "}", str(item))
            else:
                output = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if len(str(output)) > 12_000:
                raise ValueError("transform_output_too_large")
            return {"status": "ok", "operation": operation, "output": _bounded(output)}

        if stype == "notification":
            from .workflow_control import enqueue_notification

            payload = params.get("payload")
            if params.get("payload_from"):
                payload = self._resolve_reference(ctx, str(params["payload_from"]))
            if not isinstance(payload, dict):
                payload = {"message": str(payload or ctx.get("input_text") or "")[:4_000]}
            node_id = str(ctx.get("_current_step_id") or "notification")
            idempotency_key = str(
                params.get("idempotency_key") or f"{row.uuid}:{node_id}"
            )[:128]
            outbox, replayed = enqueue_notification(
                self.db,
                owner_user_id=str(row.owner_user_id),
                run_id=str(row.uuid),
                node_id=node_id,
                idempotency_key=idempotency_key,
                channel=str(params.get("channel") or "in_app"),
                recipient=str(params.get("recipient") or row.owner_user_id),
                payload=_bounded(payload),
            )
            return {
                "status": "ok",
                "outbox_id": outbox.uuid,
                "channel": outbox.channel,
                "recipient": outbox.recipient,
                "replayed": replayed,
                "output": {"notification_id": outbox.uuid},
            }

        if stype == "wait":
            from .workflow_control import create_wait

            node_id = str(ctx.get("_current_step_id") or "wait")
            wait_key = str(params.get("wait_key") or f"{row.uuid}:{node_id}")[:128]
            resume_at = params.get("resume_at")
            if isinstance(resume_at, str) and resume_at.strip():
                try:
                    resume_at = datetime.fromisoformat(resume_at.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ValueError("wait_resume_at_invalid") from exc
            elif not isinstance(resume_at, datetime):
                resume_at = None
            resume_expires_at = params.get("resume_expires_at") or params.get("expires_at")
            if isinstance(resume_expires_at, str) and resume_expires_at.strip():
                try:
                    resume_expires_at = datetime.fromisoformat(
                        resume_expires_at.replace("Z", "+00:00")
                    )
                except ValueError as exc:
                    raise ValueError("wait_resume_expires_at_invalid") from exc
            elif isinstance(params.get("expires_in_seconds"), (int, float)):
                resume_expires_at = _utc_now() + timedelta(
                    seconds=max(1, min(int(params["expires_in_seconds"]), 7 * 24 * 3600))
                )
            elif not isinstance(resume_expires_at, datetime):
                resume_expires_at = None
            wait, _created = create_wait(
                self.db,
                owner_user_id=str(row.owner_user_id),
                run_id=str(row.uuid),
                node_id=node_id,
                wait_key=wait_key,
                signal_key=str(params.get("signal_key") or ""),
                resume_at=resume_at,
                resume_expires_at=resume_expires_at,
                payload=_bounded(params.get("payload") or {}),
            )
            return {
                "status": "waiting_human",
                "wait_uuid": wait.uuid,
                "wait_key": wait.wait_key,
                "signal_key": wait.signal_key,
                "message": str(params.get("message") or "等待外部信号或定时恢复"),
                "resume_token": str(getattr(wait, "_resume_token_plain", "") or ""),
                "resume_expires_at": (
                    wait.resume_expires_at.isoformat() if wait.resume_expires_at else None
                ),
            }

        if stype == "subflow":
            workflow_id = str(params.get("workflow_id") or params.get("id") or "").strip()
            if not workflow_id:
                raise ValueError("subflow_workflow_id_required")
            definition = get_workflow_definition(workflow_id, self.settings)
            if definition is None or bool(definition.get("custom")):
                raise ValueError("subflow_must_be_builtin")
            context = dict(ctx.get("context") if isinstance(ctx.get("context"), dict) else {})
            depth = int(context.get("__workflow_subflow_depth") or 0)
            if depth >= 3:
                raise ValueError("subflow_depth_exceeded")
            node_id = str(ctx.get("_current_step_id") or "subflow")
            child_key = str(params.get("idempotency_key") or f"{row.uuid}:{node_id}")[:128]
            existing = self.find_idempotent_run(
                self.db,
                owner_user_id=str(row.owner_user_id),
                workflow_id=workflow_id,
                idempotency_key=child_key,
            )
            if existing is not None:
                nested = self._existing_result(existing, workflow_id)
                child_id = existing.uuid
            else:
                context["__workflow_parent_run_id"] = row.uuid
                context["__workflow_subflow_depth"] = depth + 1
                nested, child = self.start_and_run(
                    workflow_id=workflow_id,
                    owner_user_id=str(row.owner_user_id),
                    input_text=str(params.get("input") or ctx.get("input_text") or ""),
                    context=context,
                    preferred_agent_id=str(ctx.get("preferred_agent_id") or ""),
                    egress_confirmed=bool(ctx.get("egress_confirmed")),
                    routing_summary={
                        "source": "subflow",
                        "parent_run_id": row.uuid,
                        "parent_node_id": node_id,
                        "idempotency_key": child_key,
                    },
                    parent_run_id=row.uuid,
                    subflow_depth=depth + 1,
                )
                child_id = child.uuid
            if nested.status == "waiting_human":
                raise ValueError(f"subflow_child_waiting:{child_id}")
            if nested.status == "failed":
                return {
                    "status": "failed",
                    "workflow_id": workflow_id,
                    "child_run_id": child_id,
                    "output": _bounded(nested.outputs),
                    "error": str(nested.error or "subflow_failed")[:500],
                }
            return {
                "status": "ok",
                "workflow_id": workflow_id,
                "child_run_id": child_id,
                "output": _bounded(nested.outputs),
                "error": str(nested.error or "")[:500],
            }

        raise ValueError(f"unknown_typed_step:{stype}")

    def _checkpoint(
        self,
        *,
        index: int,
        state: dict[str, Any],
        ctx: dict[str, Any],
        awaiting_confirmation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "next_step_index": index,
            "step_outputs": state["step_outputs"],
            "steps": state["steps"],
            "final": state.get("final"),
            "ctx_state": self._ctx_state(ctx),
            "completed_steps": [str(item.get("id")) for item in state["steps"]
                                if isinstance(item, dict) and item.get("status") == "succeeded"],
        }
        if awaiting_confirmation is not None:
            payload["awaiting_confirmation"] = _bounded(awaiting_confirmation)
        return _bounded(payload)

    @staticmethod
    def _answer(logs: list[dict[str, Any]]) -> str:
        bits: list[str] = []
        for item in logs:
            output = item.get("output") if isinstance(item, dict) else None
            if isinstance(output, dict) and output.get("output"):
                bits.append(str(output["output"]))
        return "\n\n".join(bits)[:8_000]

    def _result_payload(
        self,
        row: AgentRun,
        runtime: dict[str, Any],
        *,
        status: str,
        logs: list[dict[str, Any]],
        outputs: dict[str, Any],
        error: str = "",
    ) -> dict[str, Any]:
        workflow = {
            "workflow_id": runtime["workflow_id"],
            "workflow_version": int(runtime["workflow_version"]),
            "definition_hash": runtime["definition_hash"],
            "status": status,
            "steps": logs,
            "outputs": outputs,
            "error": error[:500],
        }
        payload: dict[str, Any] = {
            "kind": "workflow",
            "workflow": _bounded(workflow),
            "workflow_id": runtime["workflow_id"],
            "workflow_version": int(runtime["workflow_version"]),
            "workflow_definition_hash": runtime["definition_hash"],
            "answer": self._answer(logs),
        }
        if error:
            payload["error"] = error[:500]
        return _bounded(payload)

    @staticmethod
    def _existing_result(row: AgentRun, workflow_id: str) -> WorkflowRunResult:
        """Rehydrate a child result without executing it a second time."""
        result = row.result_json if isinstance(row.result_json, dict) else {}
        workflow = result.get("workflow") if isinstance(result.get("workflow"), dict) else {}
        checkpoint = row.checkpoint_json if isinstance(row.checkpoint_json, dict) else {}
        status = str(row.status or "failed")
        public_status = (
            "succeeded" if status in {AgentRunStatus.SUCCEEDED.value, AgentRunStatus.COMPLETED.value}
            else "waiting_human" if status == AgentRunStatus.WAITING_CONFIRMATION.value
            else "partial" if status in {AgentRunStatus.PAUSED.value, AgentRunStatus.CANCELLED.value}
            else "failed"
        )
        outputs = workflow.get("outputs") if isinstance(workflow.get("outputs"), dict) else {}
        outputs = {**outputs, "run_id": row.uuid}
        logs = workflow.get("steps") if isinstance(workflow.get("steps"), list) else checkpoint.get("steps")
        return WorkflowRunResult(
            workflow_id=workflow_id,
            status=public_status,
            steps=logs if isinstance(logs, list) else [],
            outputs=outputs,
            error=str(result.get("error") or row.error_message_safe or "")[:500],
        )

    def start_and_run(
        self,
        *,
        workflow_id: str,
        owner_user_id: str,
        input_text: str,
        context: dict[str, Any] | None = None,
        preferred_agent_id: str = "",
        egress_confirmed: bool = False,
        routing_summary: dict[str, Any] | None = None,
        parent_run_id: str | None = None,
        subflow_depth: int = 0,
    ) -> tuple[WorkflowRunResult, AgentRun]:
        if int(subflow_depth) > 3:
            raise ValueError("subflow_depth_exceeded")
        definition, source, version = self._resolve_definition(workflow_id, owner_user_id)
        snapshot = self._snapshot(definition)
        runtime_meta = {
            "workflow_id": workflow_id,
            "workflow_source": source,
            "workflow_version": version,
            "definition_hash": _canonical_hash(snapshot),
            "definition": snapshot,
            "next_step_index": 0,
            "routing": _bounded(routing_summary or {}),
        }
        if parent_run_id:
            runtime_meta["parent_run_id"] = str(parent_run_id)
            runtime_meta["subflow_depth"] = int(subflow_depth)
        row = self.runs.create_run(
            owner_user_id=owner_user_id,
            input_text=input_text,
            run_type="workflow",
            title=f"工作流 · {workflow_id}"[:255],
            max_steps=max(32, len(snapshot.get("steps") or []) + 4),
            metadata={"source": "workflow_runtime", "workflow_runtime": runtime_meta},
            request_context={
                "context": _bounded(context or {}),
                "preferred_agent_id": preferred_agent_id,
                "egress_confirmed": egress_confirmed,
            },
        )
        self.runs.mark_running(row, stage=AgentRunStage.ROUTING)
        self.runs.append_event(
            row,
            event_type=AgentEventType.STAGE,
            stage=AgentRunStage.ROUTING,
            label="工作流已开始",
            progress=0,
            event_key=f"workflow-started-{row.attempt}",
        )
        self.db.flush()
        result = self._continue(row)
        return result, row

    def _continue_owned(self, row: AgentRun) -> WorkflowRunResult:
        runtime = self._metadata(row)
        definition = runtime.get("definition")
        if not isinstance(definition, dict):
            raise ValueError("workflow_definition_snapshot_missing")
        steps = definition.get("steps") if isinstance(definition.get("steps"), list) else []
        if row.status == AgentRunStatus.RETRYING.value:
            self.runs.mark_running(row, stage=AgentRunStage.EXECUTING)
        # A human-review checkpoint may be paused by ops.  The generic ops
        # route first moves the row back to ``running``; restore the durable
        # wait state before deciding whether to execute more steps so a
        # resume can never bypass approval.
        checkpoint = row.checkpoint_json if isinstance(row.checkpoint_json, dict) else {}
        if row.status == AgentRunStatus.RUNNING.value and checkpoint.get(
            "awaiting_confirmation"
        ):
            self.runs.transition_status(row, AgentRunStatus.WAITING_CONFIRMATION)
            row.stage = AgentRunStage.REVIEWING.value
            self.db.add(row)
            self.db.flush()
        if row.status == AgentRunStatus.WAITING_CONFIRMATION.value:
            state = self._state(row)
            return WorkflowRunResult(
                workflow_id=str(runtime["workflow_id"]), status="waiting_human",
                steps=state["steps"], outputs={"run_id": row.uuid, "steps": state["step_outputs"]},
            )
        if row.status in {AgentRunStatus.PAUSED.value, AgentRunStatus.CANCELLED.value}:
            state = self._state(row)
            return WorkflowRunResult(
                workflow_id=str(runtime["workflow_id"]), status="partial",
                steps=state["steps"], outputs={"run_id": row.uuid, "steps": state["step_outputs"]},
            )
        if row.status not in {AgentRunStatus.RUNNING.value, AgentRunStatus.CREATED.value}:
            state = self._state(row)
            status = "succeeded" if row.status in {
                AgentRunStatus.SUCCEEDED.value, AgentRunStatus.COMPLETED.value,
            } else "failed"
            return WorkflowRunResult(
                workflow_id=str(runtime["workflow_id"]), status=status,
                steps=state["steps"], outputs={"run_id": row.uuid, "steps": state["step_outputs"]},
                error=str(row.error_message_safe or ""),
            )

        request = self._request(row)
        state = self._state(row)
        ctx: dict[str, Any] = {
            "input_text": request["input_text"],
            "context": request["context"],
            "preferred_agent_id": request["preferred_agent_id"],
            "egress_confirmed": request["egress_confirmed"],
            "run_id": row.uuid,
            "steps": state["step_outputs"],
        }
        ctx.update(state["ctx_state"])
        ctx["final"] = state.get("final")
        ctx["_typed_registry"] = self._workflow_registry()
        engine = WorkflowEngine(
            self.db,
            typed_step_handler=lambda stype, params, typed_ctx: self._exec_typed_step(
                row, stype, params, typed_ctx
            ),
        )

        for index in range(state["next_step_index"], len(steps)):
            if row.status in {AgentRunStatus.PAUSED.value, AgentRunStatus.CANCELLED.value}:
                return WorkflowRunResult(
                    workflow_id=str(runtime["workflow_id"]), status="partial",
                    steps=state["steps"], outputs={"run_id": row.uuid, "steps": state["step_outputs"]},
                )
            step = steps[index] if isinstance(steps[index], dict) else {}
            sid = str(step.get("id") or f"step_{index}")
            stype = str(step.get("type") or "noop")
            params = step.get("params") if isinstance(step.get("params"), dict) else {}
            started = time.perf_counter()
            latency = 0
            try:
                ctx["_current_step_id"] = sid
                output = _bounded(engine._exec_step(stype, params, ctx))
                latency = int((time.perf_counter() - started) * 1000)
            except Exception as exc:
                latency = int((time.perf_counter() - started) * 1000)
                message = str(exc)[:500]
                log = {"id": sid, "type": stype, "status": "failed", "error": message}
                state["steps"].append(log)
                self.runs.add_step(
                    row, step_type=f"workflow:{stype}", status="failed", role="workflow",
                    output_summary={"summary": f"步骤 {sid} 执行失败", "error": message},
                    checkpoint={"step_id": sid, "step_index": index},
                    latency_ms=latency, error_code="workflow_step_failed", error_message_safe=message,
                )
                self.runs.mark_failed(row, code="workflow_step_failed", message=message)
                result = self._result_payload(
                    row, runtime, status="failed", logs=state["steps"],
                    outputs={"run_id": row.uuid, "steps": state["step_outputs"]}, error=message,
                )
                self.runs.append_event(
                    row, event_type=AgentEventType.FAILED, stage=AgentRunStage.FAILED,
                    label=f"工作流步骤失败：{sid}", progress=int(row.progress or 0),
                    content=message, event_key=f"workflow-failed-{row.attempt}-{index}",
                )
                self.runs.persist_safe_checkpoint(
                    row, checkpoint=self._checkpoint(index=index, state=state, ctx=ctx),
                    stage=AgentRunStage.FAILED, progress=int(row.progress or 0),
                    result=result, durable=True,
                )
                return WorkflowRunResult(
                    workflow_id=str(runtime["workflow_id"]), status="failed",
                    steps=state["steps"], outputs={"run_id": row.uuid, "steps": state["step_outputs"]},
                    error=message,
                )

            ctx.setdefault("steps", {})[sid] = output
            ctx["final"] = output
            state["step_outputs"][sid] = output
            state["final"] = output
            output_status = str(output.get("status") or "ok") if isinstance(output, dict) else "ok"
            step_status = (
                "waiting_confirmation" if output_status == "waiting_human"
                else "failed" if output_status in {"blocked", "error", "failed"}
                else "succeeded"
            )
            log: dict[str, Any] = {
                "id": sid, "type": stype, "status": step_status,
                "latency_ms": latency, "output": output,
            }
            if step_status == "failed":
                log["error"] = str((output or {}).get("error") or "workflow_step_failed")[:300]
            state["steps"].append(log)
            self.runs.add_step(
                row, step_type=f"workflow:{stype}", status=step_status, role="workflow",
                output_summary={"summary": f"步骤 {sid}：{step_status}", "output": output},
                checkpoint={"step_id": sid, "step_index": index}, latency_ms=latency,
                error_code="workflow_step_blocked" if step_status == "failed" else "",
                error_message_safe=str(log.get("error") or ""),
            )
            state["next_step_index"] = index + 1
            outputs = {"run_id": row.uuid, "final": state["final"], "steps": state["step_outputs"]}

            if step_status == "waiting_confirmation":
                self.runs.transition_status(row, AgentRunStatus.WAITING_CONFIRMATION)
                row.stage = AgentRunStage.REVIEWING.value
                result = self._result_payload(
                    row, runtime, status="waiting_human", logs=state["steps"], outputs=outputs,
                )
                self.runs.append_event(
                    row, event_type=AgentEventType.REVIEW, stage=AgentRunStage.REVIEWING,
                    label=str(output.get("message") or "等待人工确认")[:255],
                    progress=max(1, int((index + 1) * 100 / max(1, len(steps)))),
                    content=str(output.get("draft") or "")[:20_000],
                    event_key=f"workflow-review-{row.attempt}-{index}",
                )
                self.runs.persist_safe_checkpoint(
                    row,
                    checkpoint=self._checkpoint(
                        index=index + 1, state=state, ctx=ctx,
                        awaiting_confirmation={
                            "step_id": sid,
                            "message": output.get("message"),
                            "approval_token_hash": output.get("approval_token_hash", ""),
                            "approval_expires_at": output.get("approval_expires_at"),
                        },
                    ),
                    stage=AgentRunStage.REVIEWING,
                    progress=max(1, int((index + 1) * 100 / max(1, len(steps)))),
                    result=result, durable=True,
                )
                return WorkflowRunResult(
                    workflow_id=str(runtime["workflow_id"]), status="waiting_human",
                    steps=state["steps"], outputs=outputs,
                )

            if step_status == "failed":
                message = str(log.get("error") or "workflow_step_failed")[:500]
                self.runs.mark_failed(row, code="workflow_step_blocked", message=message)
                result = self._result_payload(
                    row, runtime, status="failed", logs=state["steps"], outputs=outputs, error=message,
                )
                self.runs.append_event(
                    row, event_type=AgentEventType.FAILED, stage=AgentRunStage.FAILED,
                    label=f"工作流步骤未通过：{sid}", content=message,
                    progress=int(row.progress or 0), event_key=f"workflow-blocked-{row.attempt}-{index}",
                )
                self.runs.persist_safe_checkpoint(
                    # The blocked step did not complete; retry must replay it,
                    # while previously succeeded boundaries remain reusable.
                    row, checkpoint=self._checkpoint(index=index, state=state, ctx=ctx),
                    stage=AgentRunStage.FAILED, progress=int(row.progress or 0),
                    result=result, durable=True,
                )
                return WorkflowRunResult(
                    workflow_id=str(runtime["workflow_id"]), status="failed",
                    steps=state["steps"], outputs=outputs, error=message,
                )

            progress = max(1, int((index + 1) * 100 / max(1, len(steps))))
            self.runs.append_event(
                row, event_type=AgentEventType.STAGE, stage=AgentRunStage.EXECUTING,
                label=f"工作流步骤完成：{sid}", progress=progress,
                event_key=f"workflow-step-{row.attempt}-{index}",
            )
            self.runs.persist_safe_checkpoint(
                row, checkpoint=self._checkpoint(index=index + 1, state=state, ctx=ctx),
                stage=AgentRunStage.EXECUTING, progress=progress, durable=True,
            )

        outputs = {"run_id": row.uuid, "final": state.get("final"), "steps": state["step_outputs"]}
        result = self._result_payload(
            row, runtime, status="succeeded", logs=state["steps"], outputs=outputs,
        )
        self.runs.mark_succeeded(row, result=result, progress=100)
        self.runs.append_event(
            row, event_type=AgentEventType.COMPLETED, stage=AgentRunStage.COMPLETED,
            label="工作流已完成", progress=100, quality={"passed": True, "issues": []},
            event_key=f"workflow-completed-{row.attempt}",
        )
        self.runs.persist_safe_checkpoint(
            row, checkpoint=self._checkpoint(index=len(steps), state=state, ctx=ctx),
            stage=AgentRunStage.COMPLETED, progress=100, result=result, durable=True,
        )
        return WorkflowRunResult(
            workflow_id=str(runtime["workflow_id"]), status="succeeded",
            steps=state["steps"], outputs=outputs,
        )

    def _continue(self, row: AgentRun) -> WorkflowRunResult:
        """Continue a run while holding its fencing lease.

        Every durable step/event/checkpoint mutation is performed through the
        bound ``AgentRunService``.  A second worker cannot mutate the same run
        while this worker's lease is valid, and an expired/replaced lease is
        rejected before the next mutation.
        """

        fencing_token = self.runs.acquire_lease(
            row.uuid,
            self.worker_id,
            ttl_seconds=self.lease_ttl_seconds,
        )
        if fencing_token is None:
            raise LeaseLostError("workflow_run_lease_unavailable")

        self.runs.bind_lease(self.worker_id, fencing_token)
        try:
            # ``acquire_lease`` uses an atomic SQL update; refresh the ORM row
            # before the first version-checked lifecycle mutation.
            self.db.refresh(row)
            return self._continue_owned(row)
        finally:
            self.runs.unbind_lease()
            try:
                released = self.runs.release_lease(
                    row.uuid, self.worker_id, fencing_token
                )
                if released:
                    self.db.refresh(row)
            except Exception:
                # A primary execution error must not be hidden by cleanup.  A
                # later worker can reclaim the lease after its TTL expires.
                pass

    def _owned(self, run_id: str, owner_user_id: str) -> AgentRun:
        row = self.runs.get_owned_run(run_id, owner_user_id)
        if row is None or row.run_type != "workflow":
            raise LookupError("workflow_run_not_found")
        self._metadata(row)
        return row

    def confirm(
        self,
        run_id: str,
        owner_user_id: str,
        approval_token: str = "",
    ) -> tuple[WorkflowRunResult, AgentRun]:
        row = self._owned(run_id, owner_user_id)
        if row.status != AgentRunStatus.WAITING_CONFIRMATION.value:
            raise ValueError("only_waiting_confirmation_can_confirm")
        checkpoint = dict(row.checkpoint_json or {})
        awaiting = checkpoint.get("awaiting_confirmation")
        if isinstance(awaiting, dict) and awaiting.get("approval_token_hash"):
            expires_at = awaiting.get("approval_expires_at")
            if expires_at:
                try:
                    expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                    if expiry.astimezone(UTC).replace(tzinfo=None) <= _utc_now():
                        raise ValueError("approval_token_expired")
                except ValueError as exc:
                    if str(exc) == "approval_token_expired":
                        raise
                    raise ValueError("approval_expires_at_invalid") from exc
            # Keep the confirmation endpoint backward-compatible for clients
            # released before one-time approval tokens were introduced. New
            # clients should always send the token; a supplied token is still
            # strictly checked and an expired token is never accepted.
            if approval_token:
                candidate = hashlib.sha256(str(approval_token).encode("utf-8")).hexdigest()
                if not hmac.compare_digest(
                    candidate, str(awaiting.get("approval_token_hash"))
                ):
                    raise ValueError("approval_token_invalid")
        waiting_step = self.db.scalar(select(AgentRunStep).where(
            AgentRunStep.run_id == row.uuid,
            AgentRunStep.status == "waiting_confirmation",
        ).order_by(desc(AgentRunStep.sequence)).limit(1))
        if waiting_step is not None:
            waiting_step.status = "succeeded"
            waiting_step.finished_at = _utc_now()
            waiting_step.output_summary_json = {
                **(waiting_step.output_summary_json or {}), "human_confirmed": True,
            }
            self.db.add(waiting_step)
            logs = checkpoint.get("steps") if isinstance(checkpoint.get("steps"), list) else []
            for log in logs:
                if isinstance(log, dict) and str(log.get("id")) == str(
                    (checkpoint.get("awaiting_confirmation") or {}).get("step_id")
                ):
                    log["status"] = "succeeded"
                    log["human_confirmed"] = True
            checkpoint["steps"] = logs
            checkpoint.pop("awaiting_confirmation", None)
            # Preserve the durable approval boundary for following business
            # nodes (for example the monthly-report archive key).  This is
            # restored into ``ctx`` by the next _continue call.
            ctx_state = checkpoint.get("ctx_state") if isinstance(checkpoint.get("ctx_state"), dict) else {}
            checkpoint["ctx_state"] = {**ctx_state, "approval_confirmed": True}
            row.checkpoint_json = checkpoint
            self.db.add(row)
        self.runs.transition_status(row, AgentRunStatus.RUNNING)
        row.stage = AgentRunStage.EXECUTING.value
        self.runs.append_event(
            row, event_type=AgentEventType.REVIEW, stage=AgentRunStage.REVIEWING,
            label="人工审核已确认，继续执行", progress=int(row.progress or 0),
            event_key=f"workflow-review-confirmed-{row.attempt}",
        )
        self.db.flush()
        return self._continue(row), row

    def resume(self, run_id: str, owner_user_id: str) -> tuple[WorkflowRunResult, AgentRun]:
        row = self._owned(run_id, owner_user_id)
        if row.status == AgentRunStatus.PAUSED.value:
            self.runs.resume_paused(row)
        elif row.status not in {
            AgentRunStatus.RUNNING.value, AgentRunStatus.RETRYING.value,
            AgentRunStatus.SUCCEEDED.value, AgentRunStatus.COMPLETED.value,
        }:
            raise ValueError("workflow_run_cannot_resume")
        self.db.flush()
        return self._continue(row), row

    def resume_wait(
        self,
        wait: WorkflowWait,
        owner_user_id: str,
        payload: dict[str, Any] | None = None,
    ) -> tuple[WorkflowRunResult, AgentRun]:
        """Consume a durable wait and continue from its checkpoint exactly once."""
        row = self._owned(wait.run_id, owner_user_id)
        if row.status != AgentRunStatus.WAITING_CONFIRMATION.value:
            raise ValueError("workflow_wait_run_not_waiting")
        checkpoint = dict(row.checkpoint_json or {})
        awaiting = checkpoint.get("awaiting_confirmation")
        if not isinstance(awaiting, dict) or str(awaiting.get("step_id")) != str(wait.node_id):
            raise ValueError("workflow_wait_checkpoint_mismatch")
        waiting_step = self.db.scalar(
            select(AgentRunStep)
            .where(
                AgentRunStep.run_id == row.uuid,
                AgentRunStep.status == "waiting_confirmation",
            )
            .order_by(desc(AgentRunStep.sequence))
            .limit(1)
        )
        if waiting_step is not None:
            waiting_step.status = "succeeded"
            waiting_step.finished_at = _utc_now()
            waiting_step.output_summary_json = {
                **(waiting_step.output_summary_json or {}),
                "wait_resumed": True,
                "resume_payload": _bounded(
                    payload if isinstance(payload, dict) else wait.payload_json or {}
                ),
            }
            self.db.add(waiting_step)
        checkpoint.pop("awaiting_confirmation", None)
        ctx_state = dict(checkpoint.get("ctx_state") or {})
        ctx_state["wait_payload"] = _bounded(payload if isinstance(payload, dict) else wait.payload_json or {})
        checkpoint["ctx_state"] = _bounded(ctx_state)
        logs = checkpoint.get("steps") if isinstance(checkpoint.get("steps"), list) else []
        for log in logs:
            if isinstance(log, dict) and str(log.get("id")) == str(wait.node_id):
                log["status"] = "succeeded"
                log["resumed"] = True
                log["resume_payload"] = _bounded(payload if isinstance(payload, dict) else wait.payload_json or {})
        checkpoint["steps"] = logs
        row.checkpoint_json = checkpoint
        self.runs.transition_status(row, AgentRunStatus.RUNNING)
        row.stage = AgentRunStage.EXECUTING.value
        self.runs.append_event(
            row,
            event_type=AgentEventType.REVIEW,
            stage=AgentRunStage.EXECUTING,
            label="等待已恢复，继续执行工作流",
            progress=int(row.progress or 0),
            event_key=f"workflow-wait-resumed-{wait.uuid}",
        )
        self.db.flush()
        return self._continue(row), row

    def retry(self, run_id: str, owner_user_id: str) -> tuple[WorkflowRunResult, AgentRun]:
        row = self._owned(run_id, owner_user_id)
        self.runs.retry(row)
        self.db.flush()
        return self._continue(row), row

    @staticmethod
    def snapshot(row: AgentRun) -> dict[str, Any]:
        result = row.result_json if isinstance(row.result_json, dict) else {}
        workflow = result.get("workflow") if isinstance(result.get("workflow"), dict) else {}
        return {
            "run_id": row.uuid,
            "status": row.status,
            "stage": row.stage,
            "progress": int(row.progress or 0),
            "workflow_id": result.get("workflow_id") or workflow.get("workflow_id"),
            "workflow_version": result.get("workflow_version") or workflow.get("workflow_version"),
            "workflow_definition_hash": result.get("workflow_definition_hash") or workflow.get("definition_hash"),
        }
