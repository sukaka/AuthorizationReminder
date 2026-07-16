"""Fail-closed static validation and preview for declarative workflows.

This module deliberately has no database/provider dependency.  The route layer
supplies the caller's project UUID allow-list, while runtime project access is
still enforced by the durable typed-node runner.
"""

from __future__ import annotations

import re
from typing import Any


ALLOWED_STEP_TYPES = frozenset(
    {
        "route",
        "invoke",
        "parallel",
        "merge",
        "condition",
        "human_review",
        "egress_check",
        "set",
        "noop",
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
    }
)

ALLOWED_BUSINESS_ACTIONS = frozenset(
    {"monthly_report", "overdue_group", "validate_approval", "archive_key"}
)

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
_STEP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_LOOP_TYPES = frozenset({"loop", "while", "foreach", "for_each", "repeat", "until", "cycle"})
_LOOP_KEYS = frozenset({"loop", "while", "foreach", "for_each", "repeat", "until", "cycle"})
_PROJECT_KEYS = frozenset(
    {
        "project_uuid",
        "project_id",
        "project_ref",
        "project_uuid_from",
        "project_id_from",
        "project_ref_from",
    }
)
_REFERENCE_KEYS = frozenset(
    {
        "agent_from",
        "input_from",
        "content_from",
        "items_from",
        "period_from",
        "approval_status_from",
        "approval_param_hash_from",
        "from",
    }
)


def _issue(
    code: str,
    message: str,
    path: str,
    *,
    severity: str = "error",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "code": code,
        "message": message,
        "path": path,
        "severity": severity,
    }
    if details:
        item["details"] = details
    return item


class _WorkflowWalker:
    def __init__(
        self,
        definition: dict[str, Any],
        *,
        allowed_project_ids: set[str] | None,
        strict_project_scope: bool,
        max_depth: int,
        max_nodes: int,
    ) -> None:
        self.definition = definition
        self.workflow_id = str(definition.get("id") or "").strip().lower()
        self.allowed_project_ids = allowed_project_ids
        self.strict_project_scope = strict_project_scope
        self.max_depth_limit = max_depth
        self.max_nodes_limit = max_nodes
        self.errors: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []
        self.nodes: list[dict[str, Any]] = []
        self.edges: list[dict[str, str]] = []
        self.max_depth = 0

    def run(self) -> dict[str, Any]:
        self._validate_header()
        steps = self.definition.get("steps")
        if isinstance(steps, list) and steps:
            self._walk_sequence(steps, path="", depth=1, inherited_approval=False)
        preview = {
            "node_count": len(self.nodes),
            "max_depth": self.max_depth,
            "requires_approval": any(bool(n.get("requires_approval")) for n in self.nodes),
            "nodes": self.nodes,
            "edges": self.edges,
        }
        return {
            "valid": not self.errors,
            "errors": self.errors,
            "warnings": self.warnings,
            "preview": preview,
        }

    def _validate_header(self) -> None:
        if not self.workflow_id or not _ID_RE.fullmatch(self.workflow_id):
            self.errors.append(_issue("invalid_workflow_id", "流程 ID 必须为小写字母、数字和下划线。", "id"))
        steps = self.definition.get("steps")
        if not isinstance(steps, list) or not steps:
            self.errors.append(_issue("steps_required", "流程至少需要一个步骤。", "steps"))
        elif len(steps) > 30:
            self.errors.append(_issue("too_many_steps", "流程步骤不能超过 30 个。", "steps"))

    def _walk_sequence(
        self,
        steps: list[Any],
        *,
        path: str,
        depth: int,
        inherited_approval: bool,
    ) -> bool:
        self.max_depth = max(self.max_depth, depth)
        if depth > self.max_depth_limit:
            self.errors.append(
                _issue(
                    "workflow_depth_exceeded",
                    f"流程嵌套深度不能超过 {self.max_depth_limit}。",
                    path or "steps",
                )
            )
            return False

        local_ids: set[str] = set()
        known_ids: set[str] = set()
        all_paths_approved = inherited_approval
        previous_id = ""
        for index, step in enumerate(steps):
            step_path = f"{path}.steps[{index}]" if path else f"steps[{index}]"
            if not isinstance(step, dict):
                self.errors.append(_issue("invalid_step", "步骤必须是对象。", step_path))
                all_paths_approved = False
                continue
            sid = str(step.get("id") or "").strip()
            stype = str(step.get("type") or "").strip()
            node_path = f"{path}.{sid}" if path else sid
            if not sid or not _STEP_ID_RE.fullmatch(sid):
                self.errors.append(_issue("invalid_step_id", "步骤 ID 必须为小写字母、数字和下划线。", f"{step_path}.id"))
            elif sid in local_ids:
                self.errors.append(_issue("duplicate_step_id", "同一流程分支内的步骤 ID 不能重复。", f"{step_path}.id"))
            else:
                local_ids.add(sid)
            if stype not in ALLOWED_STEP_TYPES:
                self.errors.append(_issue("invalid_step_type", f"不支持的步骤类型：{stype or '(empty)'}。", f"{step_path}.type"))
            params = step.get("params")
            if not isinstance(params, dict):
                self.errors.append(_issue("invalid_step_params", "步骤 params 必须是对象。", f"{step_path}.params"))
                params = {}

            self._check_loop(stype, params, step_path)
            self._check_business_action(stype, params, step_path)
            self._check_references(params, known_ids, step_path)
            self._check_project_refs(params, step_path)

            requires_approval = self._step_requires_approval(stype, params)
            if requires_approval and not all_paths_approved:
                self.errors.append(
                    _issue(
                        "approval_required",
                        "该步骤可能产生外部副作用，必须先经过 approval 或 human_review。",
                        f"{step_path}.params",
                    )
                )
            node = {
                "id": node_path or f"step_{index + 1}",
                "type": stype,
                "path": step_path,
                "requires_approval": requires_approval,
            }
            self.nodes.append(node)
            if len(self.nodes) > self.max_nodes_limit:
                self.errors.append(
                    _issue(
                        "workflow_node_limit_exceeded",
                        f"流程节点总数不能超过 {self.max_nodes_limit}。",
                        "steps",
                    )
                )
                return False
            if previous_id:
                self.edges.append({"from": previous_id, "to": node["id"]})
            previous_id = node["id"]

            nested_approval = all_paths_approved or stype in {"approval", "human_review"}
            if stype == "business" and str(params.get("action") or "").strip().lower() == "validate_approval":
                nested_approval = True
            if stype == "parallel":
                branches = params.get("branches")
                if not isinstance(branches, list) or not branches:
                    self.errors.append(_issue("parallel_branches_required", "parallel 必须包含非空 branches。", f"{step_path}.params.branches"))
                else:
                    branch_results: list[bool] = []
                    branch_ids: set[str] = set()
                    for branch_index, branch in enumerate(branches):
                        branch_path = f"{node_path}.branch[{branch_index}]"
                        if not isinstance(branch, dict):
                            self.errors.append(_issue("invalid_parallel_branch", "并行分支必须是对象。", branch_path))
                            branch_results.append(False)
                            continue
                        branch_id = str(branch.get("id") or f"b{branch_index + 1}").strip()
                        if branch_id in branch_ids:
                            self.errors.append(_issue("duplicate_branch_id", "并行分支 ID 不能重复。", f"{branch_path}.id"))
                        branch_ids.add(branch_id)
                        branch_steps = branch.get("steps")
                        if not isinstance(branch_steps, list) or not branch_steps:
                            self.errors.append(_issue("parallel_branch_steps_required", "并行分支至少需要一个步骤。", f"{branch_path}.steps"))
                            branch_results.append(False)
                            continue
                        branch_results.append(
                            self._walk_sequence(
                                branch_steps,
                                path=f"{node_path}.{branch_id}",
                                depth=depth + 1,
                                inherited_approval=nested_approval,
                            )
                        )
                    all_paths_approved = bool(branch_results) and all(branch_results)
            elif stype == "condition":
                nested = False
                branch_results = []
                for branch_name in ("then", "else"):
                    branch_steps = params.get(branch_name)
                    if branch_steps is None:
                        continue
                    nested = True
                    if not isinstance(branch_steps, list):
                        self.errors.append(_issue("invalid_condition_branch", "condition 分支必须是步骤数组。", f"{step_path}.params.{branch_name}"))
                        branch_results.append(False)
                        continue
                    branch_results.append(
                        self._walk_sequence(
                            branch_steps,
                            path=f"{node_path}.{branch_name}",
                            depth=depth + 1,
                            inherited_approval=nested_approval,
                        )
                    )
                if nested:
                    all_paths_approved = bool(branch_results) and all(branch_results)
                else:
                    all_paths_approved = nested_approval
            else:
                all_paths_approved = nested_approval
            if sid:
                known_ids.add(sid)
        return all_paths_approved

    def _step_requires_approval(self, stype: str, params: dict[str, Any]) -> bool:
        if stype in {"approval", "human_review", "egress_check"}:
            return False
        explicit = params.get("requires_approval", params.get("approval_required"))
        if explicit is False:
            return False
        if explicit is True or params.get("external_side_effect") is True:
            return True
        # Notifications are durable external side effects.  A preceding
        # approval/validate_approval gate makes them safe without extra flags.
        return stype == "notification"

    def _check_loop(self, stype: str, params: dict[str, Any], path: str) -> None:
        if stype.lower() in _LOOP_TYPES:
            self.errors.append(_issue("unbounded_loop", "不支持无界循环节点；请改用有明确上限的批处理。", f"{path}.type"))
        if any(key in params for key in _LOOP_KEYS):
            bound = params.get("max_iterations")
            if not isinstance(bound, int) or isinstance(bound, bool) or bound <= 0:
                self.errors.append(_issue("unbounded_loop", "循环必须提供正整数 max_iterations。", f"{path}.params"))
            elif bound > 100:
                self.errors.append(_issue("loop_bound_too_large", "max_iterations 不能超过 100。", f"{path}.params.max_iterations"))
        if stype == "subflow":
            target = str(params.get("workflow_id") or "").strip().lower()
            if not target:
                self.errors.append(_issue("subflow_workflow_required", "subflow 必须指定 workflow_id。", f"{path}.params.workflow_id"))
            elif target == self.workflow_id:
                self.errors.append(_issue("subflow_cycle", "subflow 不能直接调用自身。", f"{path}.params.workflow_id"))

    def _check_business_action(self, stype: str, params: dict[str, Any], path: str) -> None:
        if stype != "business":
            return
        action = str(params.get("action") or "").strip().lower()
        if action not in ALLOWED_BUSINESS_ACTIONS:
            self.errors.append(
                _issue(
                    "invalid_business_action",
                    f"不支持的业务动作：{action or '(empty)'}。",
                    f"{path}.params.action",
                    details={"action": action},
                )
            )

    def _check_references(self, params: dict[str, Any], known_ids: set[str], path: str) -> None:
        for key, value in params.items():
            if key not in _REFERENCE_KEYS or not isinstance(value, str) or not value.strip():
                continue
            ref = value.strip()
            if ref.startswith(("context.", "workflow.", "input.")) or ref in {"input_text", "preferred_agent_id"}:
                continue
            source = ref.split(".", 1)[0]
            if source and source not in known_ids:
                self.errors.append(_issue("unknown_step_reference", f"引用的步骤不存在：{source}。", f"{path}.params.{key}"))

    def _check_project_refs(self, value: Any, path: str, key_hint: str = "") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                child_path = f"{path}.params.{key}" if path.endswith("steps[0]") else f"{path}.{key}"
                if key in _PROJECT_KEYS:
                    self._check_project_value(key, child, child_path)
                else:
                    self._check_project_refs(child, child_path, key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                self._check_project_refs(child, f"{path}[{index}]", key_hint)

    def _check_project_value(self, key: str, value: Any, path: str) -> None:
        if not isinstance(value, str) or not value.strip():
            self.errors.append(_issue("project_reference_required", "项目引用必须是非空字符串。", path))
            return
        ref = value.strip()
        if key.endswith("_from") or ref.startswith(("context.", "workflow.")):
            self.warnings.append(
                _issue(
                    "project_reference_runtime_scoped",
                    "动态项目引用将在运行时按项目成员权限再次校验。",
                    path,
                    severity="warning",
                )
            )
            return
        if self.allowed_project_ids is None:
            if self.strict_project_scope:
                self.errors.append(_issue("project_scope_unavailable", "无法验证项目归属，已拒绝字面量项目引用。", path))
            else:
                self.warnings.append(_issue("project_scope_unavailable", "字面量项目引用需要调用方提供项目权限范围。", path, severity="warning"))
            return
        if ref not in self.allowed_project_ids:
            self.errors.append(_issue("project_access_denied", "流程引用了当前用户无权访问的项目。", path))


def validate_workflow_definition(
    definition: dict[str, Any],
    *,
    allowed_project_ids: set[str] | None = None,
    strict_project_scope: bool = False,
    max_depth: int = 8,
    max_nodes: int = 100,
) -> dict[str, Any]:
    """Return deterministic diagnostics and a graph preview for a definition."""

    if not isinstance(definition, dict):
        return {
            "valid": False,
            "errors": [_issue("invalid_definition", "流程定义必须是对象。", "workflow")],
            "warnings": [],
            "preview": {"node_count": 0, "max_depth": 0, "requires_approval": False, "nodes": [], "edges": []},
        }
    return _WorkflowWalker(
        definition,
        allowed_project_ids=allowed_project_ids,
        strict_project_scope=strict_project_scope,
        max_depth=max_depth,
        max_nodes=max_nodes,
    ).run()
