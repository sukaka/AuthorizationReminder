"""Validated, scope-bound management query plans.

The enterprise assistant never turns model text into SQL.  A plan is compiled
from a small registry of metrics and filters, then executed against the same
request-local project membership scope used by the overview endpoint.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..project_task_models import ProjectDeliverable, ProjectTask
from ..project_workspace_models import Project, ProjectMember
from .access import EnterpriseAccessScope
from .service import (
    _COMPLETED_DELIVERABLE_STATUSES,
    _COMPLETED_TASK_STATUSES,
    _project_health,
)


MAX_QUERY_LIMIT = 100
MAX_PROJECTS = 100
MAX_DEPARTMENTS = 100
MAX_FILTERS = 4
MAX_METRICS = 4
MAX_PERIOD_DAYS = 366

METRIC_REGISTRY: dict[str, dict[str, str]] = {
    "active_project_count": {
        "label": "活跃项目数",
        "unit": "count",
        "source": "ai_projects",
    },
    "overdue_task_rate": {
        "label": "逾期任务率",
        "unit": "ratio",
        "source": "ai_project_tasks",
    },
    "approved_deliverable_rate": {
        "label": "正式成果通过率",
        "unit": "ratio",
        "source": "ai_project_deliverables",
    },
    "project_health_score": {
        "label": "项目健康分",
        "unit": "score",
        "source": "ai_project_health_snapshots_or_live_rules",
    },
}

_ALLOWED_INTENTS = frozenset({"metric_summary", "compare_project_health"})
_ALLOWED_GROUP_BY = frozenset({"project", "status"})
_ALLOWED_FILTER_FIELDS = frozenset({"project_uuid", "status"})
_ALLOWED_FILTER_OPS = frozenset({"eq", "in"})


class QueryScopeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_uuids: list[str] = Field(default_factory=list, max_length=MAX_PROJECTS)
    department_ids: list[int] = Field(default_factory=list, max_length=MAX_DEPARTMENTS)

    @model_validator(mode="after")
    def normalize_scope(self) -> "QueryScopeIn":
        self.project_uuids = list(dict.fromkeys(item.strip() for item in self.project_uuids))
        self.department_ids = list(dict.fromkeys(self.department_ids))
        if any(not item for item in self.project_uuids):
            raise ValueError("scope.project_uuids 不能包含空值")
        if any(item <= 0 for item in self.department_ids):
            raise ValueError("scope.department_ids 必须为正整数")
        return self


class QueryPeriodIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date
    end: date

    @model_validator(mode="after")
    def validate_period(self) -> "QueryPeriodIn":
        if self.start > self.end:
            raise ValueError("period.start 不能晚于 period.end")
        if (self.end - self.start).days > MAX_PERIOD_DAYS:
            raise ValueError(f"查询周期不能超过 {MAX_PERIOD_DAYS} 天")
        return self


class QueryFilterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=48)
    op: Literal["eq", "in"]
    value: str | list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_filter(self) -> "QueryFilterIn":
        if self.field not in _ALLOWED_FILTER_FIELDS:
            raise ValueError(f"不允许的筛选字段: {self.field}")
        if self.op == "in":
            if not isinstance(self.value, list) or not self.value:
                raise ValueError("in 筛选必须提供非空列表")
            if len(self.value) > MAX_PROJECTS:
                raise ValueError(f"筛选值不能超过 {MAX_PROJECTS} 个")
        elif isinstance(self.value, list):
            raise ValueError("eq 筛选只能提供单个值")
        return self


class QueryPlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: Literal["metric_summary", "compare_project_health"]
    scope: QueryScopeIn = Field(default_factory=QueryScopeIn)
    period: QueryPeriodIn
    metrics: list[str] = Field(min_length=1, max_length=MAX_METRICS)
    filters: list[QueryFilterIn] = Field(default_factory=list, max_length=MAX_FILTERS)
    group_by: list[str] = Field(default_factory=list, max_length=2)
    limit: int = Field(default=20, ge=1, le=MAX_QUERY_LIMIT)

    @model_validator(mode="after")
    def validate_registry(self) -> "QueryPlanIn":
        self.metrics = list(dict.fromkeys(item.strip() for item in self.metrics))
        self.group_by = list(dict.fromkeys(item.strip() for item in self.group_by))
        if any(not item for item in self.metrics):
            raise ValueError("metrics 不能包含空值")
        unknown = sorted(set(self.metrics) - METRIC_REGISTRY.keys())
        if unknown:
            raise ValueError(f"未知指标: {', '.join(unknown)}")
        unknown_group = sorted(set(self.group_by) - _ALLOWED_GROUP_BY)
        if unknown_group:
            raise ValueError(f"不允许的分组字段: {', '.join(unknown_group)}")
        if self.intent == "compare_project_health" and "project_health_score" not in self.metrics:
            raise ValueError("compare_project_health 必须包含 project_health_score")
        if self.intent == "metric_summary" and "project_health_score" in self.metrics and "project" not in self.group_by:
            raise ValueError("project_health_score 只能按 project 分组查询")
        return self


@dataclass(frozen=True)
class CompiledQueryPlan:
    intent: str
    metric_codes: tuple[str, ...]
    project_uuids: tuple[str, ...]
    department_ids: tuple[int, ...]
    period_start: date
    period_end: date
    filters: tuple[tuple[str, str, tuple[str, ...]], ...]
    group_by: tuple[str, ...]
    limit: int
    policy_version: str
    scope_fingerprint: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "scope": {
                "project_uuids": list(self.project_uuids),
                "department_ids": list(self.department_ids),
            },
            "period": {
                "start": self.period_start.isoformat(),
                "end": self.period_end.isoformat(),
            },
            "metrics": list(self.metric_codes),
            "filters": [
                {"field": field, "op": op, "value": list(values)}
                for field, op, values in self.filters
            ],
            "group_by": list(self.group_by),
            "limit": self.limit,
            "policy_version": self.policy_version,
            "scope_fingerprint": self.scope_fingerprint,
        }


def _visible_projects(db: Session, scope: EnterpriseAccessScope) -> list[Project]:
    query = select(Project).where(Project.status == "active")
    if not scope.is_admin:
        query = query.join(ProjectMember, ProjectMember.project_id == Project.id).where(
            ProjectMember.user_id == scope.user_id,
            ProjectMember.status == "active",
        )
    return db.scalars(query.order_by(Project.id.asc())).unique().all()


def compile_query_plan(
    db: Session,
    scope: EnterpriseAccessScope,
    payload: QueryPlanIn | dict[str, Any],
) -> CompiledQueryPlan:
    """Validate and bind a user/model request to the current access scope."""

    request = payload if isinstance(payload, QueryPlanIn) else QueryPlanIn.model_validate(payload)
    visible = _visible_projects(db, scope)
    visible_by_uuid = {project.uuid: project for project in visible}

    requested = set(request.scope.project_uuids)
    selected = [
        project
        for project in visible
        if (not requested or project.uuid in requested)
        and (
            not request.scope.department_ids
            or project.owner_department_id in request.scope.department_ids
        )
    ]
    unauthorized = requested - visible_by_uuid.keys()
    if unauthorized:
        raise PermissionError("查询范围不包含当前用户的访问范围")
    if not selected:
        raise PermissionError("查询范围没有可访问的项目")

    normalized_filters: list[tuple[str, str, tuple[str, ...]]] = []
    for item in request.filters:
        values = (item.value,) if isinstance(item.value, str) else tuple(item.value)
        if item.field == "project_uuid":
            allowed = set(project.uuid for project in selected)
            if item.op == "eq" and values[0] not in allowed:
                raise PermissionError("筛选项目不在当前访问范围内")
            if item.op == "in" and not set(values).intersection(allowed):
                raise PermissionError("筛选项目不在当前访问范围内")
        normalized_filters.append((item.field, item.op, values))

    return CompiledQueryPlan(
        intent=request.intent,
        metric_codes=tuple(request.metrics),
        project_uuids=tuple(project.uuid for project in selected),
        department_ids=tuple(request.scope.department_ids),
        period_start=request.period.start,
        period_end=request.period.end,
        filters=tuple(normalized_filters),
        group_by=tuple(request.group_by),
        limit=request.limit,
        policy_version=scope.policy_version,
        scope_fingerprint=scope.scope_fingerprint,
    )


def _filter_projects(projects: list[Project], plan: CompiledQueryPlan) -> list[Project]:
    selected = projects
    for field, op, values in plan.filters:
        if field == "project_uuid":
            value_set = set(values)
            selected = [
                project
                for project in selected
                if (project.uuid in value_set if op == "in" else project.uuid == values[0])
            ]
        elif field == "status":
            value_set = set(values)
            selected = [
                project
                for project in selected
                if (project.status in value_set if op == "in" else project.status == values[0])
            ]
    return selected


def _metric_row(metric_code: str, projects: list[Project], db: Session, cutoff: datetime) -> dict[str, Any]:
    project_ids = [project.id for project in projects]
    project_uuids = [project.uuid for project in projects]
    if metric_code == "active_project_count":
        return {
            "metric_code": metric_code,
            "value": len(projects),
            "numerator": len(projects),
            "denominator": None,
            "project_uuids": project_uuids,
            "evidence_refs": project_uuids,
        }
    if metric_code == "overdue_task_rate":
        tasks = db.scalars(select(ProjectTask).where(ProjectTask.project_id.in_(project_ids))).all() if project_ids else []
        # This is a current-state operational metric: a task that became due
        # after a report period was selected is still overdue at execution
        # time. Historical snapshots remain available through the snapshot
        # service, which preserves its explicit cutoff semantics.
        current_cutoff = max(cutoff, datetime.now(UTC))
        due = [task for task in tasks if task.due_at and (task.due_at.replace(tzinfo=UTC) if task.due_at.tzinfo is None else task.due_at) <= current_cutoff]
        overdue = [task for task in due if task.status.lower() not in _COMPLETED_TASK_STATUSES]
        return {
            "metric_code": metric_code,
            "value": len(overdue) / len(due) if due else None,
            "numerator": len(overdue),
            "denominator": len(due),
            "project_uuids": project_uuids,
            "evidence_refs": [task.uuid for task in overdue],
        }
    if metric_code == "approved_deliverable_rate":
        deliverables = db.scalars(select(ProjectDeliverable).where(ProjectDeliverable.project_id.in_(project_ids))).all() if project_ids else []
        approved = [item for item in deliverables if item.status.lower() in _COMPLETED_DELIVERABLE_STATUSES]
        return {
            "metric_code": metric_code,
            "value": len(approved) / len(deliverables) if deliverables else None,
            "numerator": len(approved),
            "denominator": len(deliverables),
            "project_uuids": project_uuids,
            "evidence_refs": [item.uuid for item in approved],
        }
    raise ValueError(f"未注册的指标: {metric_code}")


def execute_query_plan(
    db: Session,
    scope: EnterpriseAccessScope,
    plan: CompiledQueryPlan,
) -> dict[str, Any]:
    """Execute only a previously compiled plan and return traceable rows."""

    if plan.scope_fingerprint != scope.scope_fingerprint or plan.policy_version != scope.policy_version:
        raise PermissionError("查询计划的访问策略已变化，请重新生成计划")
    visible = _visible_projects(db, scope)
    allowed = set(plan.project_uuids)
    projects = _filter_projects([project for project in visible if project.uuid in allowed], plan)
    if not projects:
        return {
            "plan": plan.as_dict(),
            "rows": [],
            "generated_at": datetime.now(UTC).isoformat(),
            "evidence_refs": [],
        }
    cutoff = datetime.combine(plan.period_end, time.max, tzinfo=UTC)
    rows: list[dict[str, Any]] = []
    if "project_health_score" in plan.metric_codes:
        health_by_uuid = {
            row["project_uuid"]: row
            for row in _project_health(db, projects, cutoff)
        }
        for project in projects[: plan.limit]:
            health = health_by_uuid[project.uuid]
            rows.append(
                {
                    "group": {"project_uuid": project.uuid, "project_name": project.name},
                    "metrics": {"project_health_score": health["score"]},
                    "status": health["status"],
                    "confidence": health["confidence"],
                    "evidence_refs": [project.uuid],
                }
            )
    else:
        for metric_code in plan.metric_codes:
            metric = _metric_row(metric_code, projects, db, cutoff)
            rows.append(
                {
                    "group": {"project_uuids": [project.uuid for project in projects]},
                    "metrics": {metric_code: metric["value"]},
                    "evidence_refs": metric["evidence_refs"],
                }
            )
    rows = rows[: plan.limit]
    evidence_refs = list(dict.fromkeys(ref for row in rows for ref in row.get("evidence_refs", [])))
    return {
        "plan": plan.as_dict(),
        "rows": rows,
        "generated_at": datetime.now(UTC).isoformat(),
        "evidence_refs": evidence_refs,
    }


def _csv_cell(value: Any) -> str:
    """Serialize a cell without allowing spreadsheet formula execution."""

    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = str(value)
    if text[:1] in {"=", "+", "-", "@"}:
        return f"'{text}"
    return text


def serialize_query_result_csv(result: dict[str, Any]) -> bytes:
    """Return a deterministic, traceable CSV export for a validated query result."""

    plan = result["plan"]
    metric_codes = list(plan.get("metrics", []))
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow([
        "period_start",
        "period_end",
        "policy_version",
        "scope_fingerprint",
        "group_project_uuid",
        "group_project_name",
        "group_project_uuids",
        "group_status",
        *metric_codes,
        "row_status",
        "confidence",
        "evidence_refs",
    ])
    for row in result.get("rows", []):
        group = row.get("group") or {}
        metrics = row.get("metrics") or {}
        writer.writerow([
            _csv_cell(plan.get("period", {}).get("start")),
            _csv_cell(plan.get("period", {}).get("end")),
            _csv_cell(plan.get("policy_version")),
            _csv_cell(plan.get("scope_fingerprint")),
            _csv_cell(group.get("project_uuid")),
            _csv_cell(group.get("project_name")),
            _csv_cell(group.get("project_uuids")),
            _csv_cell(group.get("status")),
            *(_csv_cell(metrics.get(code)) for code in metric_codes),
            _csv_cell(row.get("status")),
            _csv_cell(row.get("confidence")),
            _csv_cell(row.get("evidence_refs", [])),
        ])
    return ("\ufeff" + output.getvalue()).encode("utf-8")


__all__ = [
    "CompiledQueryPlan",
    "METRIC_REGISTRY",
    "QueryFilterIn",
    "QueryPlanIn",
    "QueryPeriodIn",
    "QueryScopeIn",
    "compile_query_plan",
    "execute_query_plan",
    "serialize_query_result_csv",
]
