"""Deterministic insight detection and approval-only recommendation gates."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..enterprise_insight_models import (
    EnterpriseInsight,
    EnterpriseInsightEvidence,
    EnterpriseInsightRule,
    EnterpriseInsightRuleVersion,
    EnterpriseRecommendation,
    EnterpriseRecommendationAction,
)
from ..enterprise_intelligence_models import EnterpriseOrganization
from ..models import WorkflowTriggerInbox
from ..project_task_models import ProjectTask
from ..project_workspace_models import Project, ProjectMember
from ..workflow_control import enqueue_trigger_event
from .access import EnterpriseAccessScope


OVERDUE_TASK_RULE_KEY = "project.overdue_task"
OVERDUE_TASK_RULE_VERSION = "1.0.0"
ALLOWED_INSIGHT_STATUSES = frozenset(
    {"open", "acknowledged", "action_proposed", "action_started", "resolved", "dismissed", "false_positive", "expired"}
)
ALLOWED_RISK_LEVELS = frozenset({"low", "medium", "high"})
ALLOWED_ACTION_STATUSES = frozenset({"approved", "queued", "succeeded", "failed", "reconciliation_required"})


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo is not None else value


def _hash(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _require_view(scope: EnterpriseAccessScope) -> None:
    if not scope.can("intelligence:view"):
        raise PermissionError("当前身份无企业智能中枢访问权限")


def _require_manage(scope: EnterpriseAccessScope) -> None:
    _require_view(scope)
    if not scope.can("intelligence:manage"):
        raise PermissionError("当前身份无企业智能管理权限")


def _require_execute(scope: EnterpriseAccessScope) -> None:
    _require_manage(scope)
    if not scope.can("intelligence:recommendation:execute"):
        raise PermissionError("当前身份无建议动作执行权限")


def _visible_projects(db: Session, scope: EnterpriseAccessScope, organization_id: int) -> list[Project]:
    statement = select(Project).where(
        Project.organization_id == organization_id,
        Project.status == "active",
    )
    if not scope.is_admin:
        statement = statement.join(
            ProjectMember,
            (ProjectMember.project_id == Project.id)
            & (ProjectMember.user_id == scope.user_id)
            & (ProjectMember.status == "active"),
        )
    return list(db.scalars(statement.order_by(Project.id)).unique().all())


def _get_organization(db: Session, organization_id: int) -> EnterpriseOrganization:
    organization = db.get(EnterpriseOrganization, organization_id)
    if organization is None:
        raise LookupError("组织不存在或不可访问")
    return organization


def _ensure_overdue_rule(db: Session, scope: EnterpriseAccessScope, organization_id: int) -> EnterpriseInsightRuleVersion:
    rule = db.scalar(
        select(EnterpriseInsightRule).where(
            EnterpriseInsightRule.organization_id == organization_id,
            EnterpriseInsightRule.rule_key == OVERDUE_TASK_RULE_KEY,
        )
    )
    if rule is None:
        rule = EnterpriseInsightRule(
            organization_id=organization_id,
            rule_key=OVERDUE_TASK_RULE_KEY,
            name="项目任务逾期风险",
            description="检测截止时间已过且仍未完成的项目任务。",
            latest_version=OVERDUE_TASK_RULE_VERSION,
            created_by=scope.user_id,
        )
        db.add(rule)
        db.flush()
    version = db.scalar(
        select(EnterpriseInsightRuleVersion).where(
            EnterpriseInsightRuleVersion.rule_id == rule.id,
            EnterpriseInsightRuleVersion.version == OVERDUE_TASK_RULE_VERSION,
        )
    )
    if version is None:
        version = EnterpriseInsightRuleVersion(
            rule_id=rule.id,
            version=OVERDUE_TASK_RULE_VERSION,
            rule_type="overdue_task",
            config_json={"completed_statuses": ["done", "completed", "approved", "delivered", "cancelled", "canceled"]},
            created_by=scope.user_id,
        )
        db.add(version)
        db.flush()
    return version


def detect_overdue_task_insights(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    cutoff: datetime,
    source_version: str = "project-task-v1",
) -> list[EnterpriseInsight]:
    """Persist one bounded, idempotent insight per overdue task in scope."""

    _require_manage(scope)
    _get_organization(db, organization_id)
    cutoff = _utc(cutoff)
    version = _ensure_overdue_rule(db, scope, organization_id)
    projects = _visible_projects(db, scope, organization_id)
    if not projects:
        return []
    project_ids = [project.id for project in projects]
    tasks = db.scalars(
        select(ProjectTask).where(
            ProjectTask.project_id.in_(project_ids),
            ProjectTask.due_at.is_not(None),
            ProjectTask.due_at <= cutoff,
            ProjectTask.status.not_in(["done", "completed", "approved", "delivered", "cancelled", "canceled"]),
        ).order_by(ProjectTask.id)
    ).all()
    project_by_id = {project.id: project for project in projects}
    result: list[EnterpriseInsight] = []
    for task in tasks:
        project = project_by_id[task.project_id]
        evidence_fingerprint = _hash(
            {
                "task_uuid": task.uuid,
                "task_updated_at": str(task.updated_at),
                "cutoff": cutoff.isoformat(),
                "source_version": source_version,
            }
        )
        insight = db.scalar(
            select(EnterpriseInsight).where(
                EnterpriseInsight.rule_version_id == version.id,
                EnterpriseInsight.scope_fingerprint == scope.scope_fingerprint,
                EnterpriseInsight.evidence_fingerprint == evidence_fingerprint,
            )
        )
        if insight is None:
            priority = str(task.priority or "normal").lower()
            severity = "high" if priority in {"critical", "high"} else "medium"
            insight = EnterpriseInsight(
                organization_id=organization_id,
                project_id=project.id,
                rule_version_id=version.id,
                insight_type=OVERDUE_TASK_RULE_KEY,
                title=f"项目“{project.name}”存在逾期任务",
                summary=f"任务“{task.title}”截止时间为 {task.due_at.isoformat()}，当前状态为 {task.status}。",
                scope_fingerprint=scope.scope_fingerprint,
                policy_version=scope.policy_version,
                data_cutoff_at=cutoff,
                data_version=source_version,
                confidence=0.95,
                severity=severity,
                impact_scope_json={"project_uuid": project.uuid, "task_uuid": task.uuid},
                evidence_fingerprint=evidence_fingerprint,
            )
            db.add(insight)
            db.flush()
            db.add(
                EnterpriseInsightEvidence(
                    insight_id=insight.id,
                    evidence_type="project_task",
                    evidence_uuid=task.uuid,
                    source_table=ProjectTask.__tablename__,
                    source_version=1,
                    detail_json={
                        "project_uuid": project.uuid,
                        "task_title": task.title,
                        "due_at": task.due_at.isoformat() if task.due_at else "",
                        "status": task.status,
                        "priority": task.priority,
                    },
                )
            )
        result.append(insight)
    return result


def _get_visible_insight(db: Session, scope: EnterpriseAccessScope, insight_uuid: str) -> EnterpriseInsight:
    _require_view(scope)
    statement = select(EnterpriseInsight).where(EnterpriseInsight.uuid == insight_uuid)
    if not scope.is_admin:
        statement = statement.join(
            ProjectMember,
            (ProjectMember.project_id == EnterpriseInsight.project_id)
            & (ProjectMember.user_id == scope.user_id)
            & (ProjectMember.status == "active"),
        )
    insight = db.scalar(statement)
    if insight is None:
        raise LookupError("洞察不存在或不可访问")
    return insight


def list_insights(
    db: Session,
    scope: EnterpriseAccessScope,
    *,
    status: str | None = None,
    limit: int = 100,
) -> list[EnterpriseInsight]:
    _require_view(scope)
    limit = max(1, min(int(limit), 200))
    statement = select(EnterpriseInsight)
    if not scope.is_admin:
        statement = statement.join(
            ProjectMember,
            (ProjectMember.project_id == EnterpriseInsight.project_id)
            & (ProjectMember.user_id == scope.user_id)
            & (ProjectMember.status == "active"),
        )
    if status:
        if status not in ALLOWED_INSIGHT_STATUSES:
            raise ValueError("不支持的洞察状态")
        statement = statement.where(EnterpriseInsight.status == status)
    return list(
        db.scalars(statement.order_by(EnterpriseInsight.data_cutoff_at.desc(), EnterpriseInsight.id.desc()).limit(limit)).unique().all()
    )


def _transition_insight(
    db: Session,
    scope: EnterpriseAccessScope,
    insight_uuid: str,
    *,
    target_status: str,
    feedback: str = "",
) -> EnterpriseInsight:
    _require_manage(scope)
    if target_status not in ALLOWED_INSIGHT_STATUSES:
        raise ValueError("不支持的洞察状态")
    insight = _get_visible_insight(db, scope, insight_uuid)
    allowed = {
        "acknowledged": {"open"},
        "dismissed": {"open", "acknowledged", "action_proposed"},
        "false_positive": {"open", "acknowledged"},
    }
    if insight.status not in allowed.get(target_status, set()):
        raise ValueError("洞察当前状态不允许此操作")
    now = datetime.now(UTC).replace(tzinfo=None)
    insight.status = target_status
    insight.feedback = str(feedback or "")[:2000]
    insight.acknowledged_by = scope.user_id
    insight.acknowledged_at = now
    if target_status in {"dismissed", "false_positive"}:
        insight.resolved_at = now
    insight.row_version = int(insight.row_version or 1) + 1
    return insight


def acknowledge_insight(db: Session, scope: EnterpriseAccessScope, insight_uuid: str, *, feedback: str = "") -> EnterpriseInsight:
    return _transition_insight(db, scope, insight_uuid, target_status="acknowledged", feedback=feedback)


def dismiss_insight(db: Session, scope: EnterpriseAccessScope, insight_uuid: str, *, feedback: str = "") -> EnterpriseInsight:
    return _transition_insight(db, scope, insight_uuid, target_status="dismissed", feedback=feedback)


def propose_recommendation(
    db: Session,
    scope: EnterpriseAccessScope,
    insight_uuid: str,
    *,
    recommendation_type: str,
    title: str,
    payload: dict[str, Any],
    risk_level: str,
    idempotency_key: str,
) -> tuple[EnterpriseRecommendation, EnterpriseRecommendationAction]:
    _require_manage(scope)
    if risk_level not in ALLOWED_RISK_LEVELS:
        raise ValueError("不支持的动作风险等级")
    if not idempotency_key.strip() or len(idempotency_key) > 128:
        raise ValueError("idempotency_key 无效")
    insight = _get_visible_insight(db, scope, insight_uuid)
    if insight.status not in {"open", "acknowledged", "action_proposed"}:
        raise ValueError("当前洞察不允许提出建议")
    organization_id = insight.organization_id
    request_hash = _hash({"insight": insight.uuid, "type": recommendation_type, "title": title, "payload": payload, "risk": risk_level})
    existing = db.scalar(
        select(EnterpriseRecommendation).where(
            EnterpriseRecommendation.organization_id == organization_id,
            EnterpriseRecommendation.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ValueError("idempotency_key 已用于不同建议")
        action = db.scalar(
            select(EnterpriseRecommendationAction).where(EnterpriseRecommendationAction.recommendation_id == existing.id)
        )
        if action is None:
            raise RuntimeError("建议动作记录缺失")
        return existing, action
    recommendation = EnterpriseRecommendation(
        organization_id=organization_id,
        insight_id=insight.id,
        recommendation_type=recommendation_type,
        title=title[:255],
        payload_json=payload,
        risk_level=risk_level,
        status="proposed",
        scope_fingerprint=insight.scope_fingerprint,
        policy_version=scope.policy_version,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        proposed_by=scope.user_id,
    )
    db.add(recommendation)
    db.flush()
    action = EnterpriseRecommendationAction(
        recommendation_id=recommendation.id,
        action_type=recommendation_type,
        risk_level=risk_level,
        status="pending_execution" if risk_level == "low" else "pending_approval",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        requires_approval=risk_level != "low",
    )
    db.add(action)
    insight.status = "action_proposed"
    insight.row_version = int(insight.row_version or 1) + 1
    db.flush()
    return recommendation, action


def approve_recommendation_action(
    db: Session,
    scope: EnterpriseAccessScope,
    recommendation_uuid: str,
) -> EnterpriseRecommendationAction:
    _require_execute(scope)
    recommendation = db.scalar(select(EnterpriseRecommendation).where(EnterpriseRecommendation.uuid == recommendation_uuid))
    if recommendation is None:
        raise LookupError("建议不存在或不可访问")
    insight = db.get(EnterpriseInsight, recommendation.insight_id)
    if insight is None:
        raise LookupError("建议关联的洞察不存在或不可访问")
    if not scope.is_admin and _get_visible_insight(db, scope, insight.uuid).id != insight.id:
        raise LookupError("建议不存在或不可访问")
    action = db.scalar(
        select(EnterpriseRecommendationAction).where(EnterpriseRecommendationAction.recommendation_id == recommendation.id)
    )
    if action is None:
        raise RuntimeError("建议动作记录缺失")
    if not action.requires_approval:
        return action
    if action.status == "approved":
        # Approval is a durable state transition. A retried request must not
        # mint a new token or advance the row version again.
        return action
    if action.status != "pending_approval":
        raise ValueError("建议动作当前不在待审批状态")
    now = datetime.now(UTC).replace(tzinfo=None)
    action.status = "approved"
    action.approval_token_hash = _hash({"recommendation": recommendation.uuid, "reviewer": scope.user_id, "version": action.row_version})
    action.row_version = int(action.row_version or 1) + 1
    recommendation.status = "approved"
    recommendation.approved_by = scope.user_id
    recommendation.approved_at = now
    recommendation.row_version = int(recommendation.row_version or 1) + 1
    return action


def queue_recommendation_workflow_event(
    db: Session,
    scope: EnterpriseAccessScope,
    recommendation_uuid: str,
    *,
    idempotency_key: str,
) -> tuple[WorkflowTriggerInbox, bool]:
    """Put an approved recommendation on the durable 4.0 trigger inbox.

    This is deliberately an enqueue-only boundary. The workflow control worker
    owns leases, fencing, retries and actual execution; this function never
    calls a provider or mutates a business fact directly.
    """

    _require_execute(scope)
    if not idempotency_key or len(idempotency_key) > 128:
        raise ValueError("建议派发幂等键无效")
    recommendation = db.scalar(
        select(EnterpriseRecommendation).where(EnterpriseRecommendation.uuid == recommendation_uuid)
    )
    if recommendation is None:
        raise LookupError("建议不存在或不可访问")
    insight = db.get(EnterpriseInsight, recommendation.insight_id)
    if insight is None:
        raise LookupError("建议关联的洞察不存在或不可访问")
    if not scope.is_admin and _get_visible_insight(db, scope, insight.uuid).id != insight.id:
        raise LookupError("建议不存在或不可访问")
    action = db.scalar(
        select(EnterpriseRecommendationAction).where(
            EnterpriseRecommendationAction.recommendation_id == recommendation.id
        )
    )
    if action is None:
        raise RuntimeError("建议动作记录缺失")
    if action.status not in {"approved", "pending_execution", "queued"}:
        raise ValueError("建议动作当前不允许派发")

    recommendation_payload = recommendation.payload_json if isinstance(recommendation.payload_json, dict) else {}
    workflow_id = str(recommendation_payload.get("workflow_id") or "").strip()
    if len(workflow_id) < 2 or len(workflow_id) > 48:
        raise ValueError("建议必须指定有效的 workflow_id")
    owner_user_id = str(recommendation.approved_by or recommendation.proposed_by or scope.user_id)
    event_type = "enterprise.recommendation.action"
    event_key = f"recommendation:{recommendation.uuid}"
    payload = {
        "input_text": recommendation.title,
        "recommendation_uuid": recommendation.uuid,
        "recommendation_action_uuid": action.uuid,
        "dispatch_idempotency_key": idempotency_key,
        "context": {
            "source": "enterprise_recommendation",
            "recommendation_uuid": recommendation.uuid,
            "recommendation_action_uuid": action.uuid,
            "insight_uuid": insight.uuid,
            "recommendation_type": recommendation.recommendation_type,
            "risk_level": recommendation.risk_level,
            "payload": recommendation_payload,
        },
    }
    event, replayed = enqueue_trigger_event(
        db,
        owner_user_id=owner_user_id,
        workflow_id=workflow_id,
        event_type=event_type,
        event_key=event_key,
        payload=payload,
    )
    existing_payload = event.payload_json if isinstance(event.payload_json, dict) else {}
    if (
        existing_payload.get("recommendation_uuid") != recommendation.uuid
        or existing_payload.get("dispatch_idempotency_key") != idempotency_key
    ):
        raise ValueError("建议派发幂等键冲突")
    if event.run_id and recommendation.workflow_run_id != event.run_id:
        recommendation.workflow_run_id = event.run_id
        recommendation.row_version = int(recommendation.row_version or 1) + 1
    if action.status != "queued":
        action.status = "queued"
        action.row_version = int(action.row_version or 1) + 1
    if recommendation.status != "queued":
        recommendation.status = "queued"
        recommendation.row_version = int(recommendation.row_version or 1) + 1
    db.flush()
    return event, replayed


def bind_recommendation_workflow_run(
    db: Session,
    payload: dict[str, Any] | None,
    run_id: str,
) -> bool:
    """Bind a trigger-created run to its recommendation without side effects.

    The workflow control worker owns execution.  This small callback only
    records the durable relationship after a run is created (or recovered),
    and refuses to overwrite a different run so reconciliation can investigate
    an impossible duplicate instead of silently changing history.
    """

    if not isinstance(payload, dict):
        return False
    context = payload.get("context") if isinstance(payload.get("context"), dict) else payload
    if context.get("source") != "enterprise_recommendation":
        return False
    recommendation_uuid = str(
        payload.get("recommendation_uuid") or context.get("recommendation_uuid") or ""
    ).strip()
    normalized_run_id = str(run_id or "").strip()
    if not recommendation_uuid or not normalized_run_id:
        return False
    recommendation = db.scalar(
        select(EnterpriseRecommendation).where(
            EnterpriseRecommendation.uuid == recommendation_uuid
        )
    )
    if recommendation is None:
        return False
    if recommendation.workflow_run_id and recommendation.workflow_run_id != normalized_run_id:
        raise ValueError("建议已绑定其他 workflow run")
    if recommendation.workflow_run_id == normalized_run_id:
        return False
    recommendation.workflow_run_id = normalized_run_id
    recommendation.row_version = int(recommendation.row_version or 1) + 1
    db.flush()
    return True


def record_recommendation_result(
    db: Session,
    scope: EnterpriseAccessScope,
    recommendation_uuid: str,
    *,
    status: str,
    result: dict[str, Any] | None = None,
) -> EnterpriseRecommendationAction:
    """Record an external worker result; never infer success from a timeout."""

    _require_manage(scope)
    if status not in ALLOWED_ACTION_STATUSES - {"approved", "queued"}:
        raise ValueError("不支持的动作结果状态")
    recommendation = db.scalar(select(EnterpriseRecommendation).where(EnterpriseRecommendation.uuid == recommendation_uuid))
    if recommendation is None:
        raise LookupError("建议不存在或不可访问")
    insight_record = db.get(EnterpriseInsight, recommendation.insight_id)
    if insight_record is None:
        raise LookupError("建议关联的洞察不存在或不可访问")
    insight = _get_visible_insight(db, scope, insight_record.uuid)
    action = db.scalar(select(EnterpriseRecommendationAction).where(EnterpriseRecommendationAction.recommendation_id == recommendation.id))
    if action is None:
        raise RuntimeError("建议动作记录缺失")
    normalized_result = result or {}
    if action.status == status and action.status in {"succeeded", "failed", "reconciliation_required"}:
        if (action.result_json or {}) == normalized_result:
            # Worker retries are expected; return the terminal record without
            # changing its execution timestamp or version.
            return action
        raise ValueError("建议动作已记录不同的结果")
    if action.status not in {"approved", "queued", "pending_execution"}:
        raise ValueError("建议动作当前不允许记录结果")
    action.status = status
    action.result_json = normalized_result
    action.executed_at = datetime.now(UTC).replace(tzinfo=None)
    action.reconciliation_status = "required" if status == "reconciliation_required" else "not_required"
    action.row_version = int(action.row_version or 1) + 1
    recommendation.status = "reconciliation_required" if status == "reconciliation_required" else status
    if status == "succeeded":
        insight.status = "resolved"
        insight.resolved_at = action.executed_at
    insight.row_version = int(insight.row_version or 1) + 1
    return action
