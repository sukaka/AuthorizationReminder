"""Operational insight scans with durable, idempotent in-app notifications.

The scan is intentionally enqueue-only: it evaluates the existing deterministic
insight rule and writes notification intent to the 4.0 outbox. A separate
workflow-control worker owns delivery, retry, lease fencing, and recovery.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..enterprise_intelligence_models import EnterpriseOrganization
from ..models import WorkflowNotificationOutbox, WorkflowSchedule
from ..workflow_control import create_schedule, enqueue_notification
from .access import EnterpriseAccessScope
from .insight_service import detect_overdue_task_insights


INSIGHT_NOTIFICATION_NODE = "enterprise.insight.notify"
INSIGHT_NOTIFICATION_POLICY_VERSION = "1.0.0"
INSIGHT_SCAN_WORKFLOW_ID = "__enterprise_insight_scan__"


@dataclass(frozen=True)
class InsightScanResult:
    """Bounded result returned by a scan route or scheduler adapter."""

    organization_id: int
    cutoff: datetime
    source_version: str
    insights: tuple
    notifications: tuple[WorkflowNotificationOutbox, ...]
    notifications_replayed: int

    @property
    def notifications_enqueued(self) -> int:
        return len(self.notifications) - self.notifications_replayed


def create_insight_scan_schedule(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    name: str,
    cron_expression: str,
    timezone: str = "UTC",
    next_fire_at: datetime | None = None,
    misfire_policy: str = "fire_once",
    catch_up: bool = False,
    source_version: str = "project-task-v1",
    idempotency_prefix: str = "",
    idempotency_key: str | None = None,
):
    """Create a durable scan schedule with a frozen, verifiable scope contract."""

    if not scope.can("intelligence:manage"):
        raise PermissionError("当前身份无企业智能管理权限")
    organization = db.scalar(
        select(EnterpriseOrganization).where(
            EnterpriseOrganization.id == organization_id,
            EnterpriseOrganization.status == "active",
        )
    )
    if organization is None:
        raise LookupError("组织不存在或已停用")
    name = name.strip()
    source_version = source_version.strip()
    if not name or not source_version:
        raise ValueError("洞察扫描调度名称和 source_version 不能为空")
    if idempotency_key is not None:
        idempotency_key = idempotency_key.strip()
        if not idempotency_key:
            raise ValueError("idempotency_key_required")
        if len(idempotency_key) > 128:
            raise ValueError("idempotency_key_too_long")
    request_hash = _schedule_request_hash(
        organization_id=organization_id,
        scope=scope,
        name=name,
        cron_expression=cron_expression,
        timezone=timezone,
        next_fire_at=next_fire_at,
        misfire_policy=misfire_policy,
        catch_up=catch_up,
        source_version=source_version,
        idempotency_prefix=idempotency_prefix,
    )
    if idempotency_key:
        existing_rows = db.scalars(
            select(WorkflowSchedule).where(
                WorkflowSchedule.owner_user_id == scope.user_id,
                WorkflowSchedule.workflow_id == INSIGHT_SCAN_WORKFLOW_ID,
            )
        ).all()
        for existing in existing_rows:
            metadata = existing.metadata_json if isinstance(existing.metadata_json, dict) else {}
            scan_metadata = metadata.get("enterprise_insight_scan")
            if not isinstance(scan_metadata, dict) or scan_metadata.get("idempotency_key") != idempotency_key:
                continue
            if scan_metadata.get("request_hash") != request_hash:
                raise ValueError("idempotency_key_conflict")
            return existing
    metadata = {
        "enterprise_insight_scan": {
            "organization_id": organization_id,
            "source_version": source_version,
            "scope": scope.as_dict(),
        }
    }
    if idempotency_key:
        metadata["enterprise_insight_scan"].update(
            {
                "idempotency_key": idempotency_key,
                "request_hash": request_hash,
            }
        )
    return create_schedule(
        db,
        owner_user_id=scope.user_id,
        workflow_id=INSIGHT_SCAN_WORKFLOW_ID,
        name=name,
        cron_expression=cron_expression,
        timezone=timezone,
        next_fire_at=next_fire_at,
        misfire_policy=misfire_policy,
        catch_up=catch_up,
        concurrency_policy="forbid",
        idempotency_prefix=idempotency_prefix or f"enterprise-insight-scan:{organization_id}",
        metadata=metadata,
    )


def _schedule_request_hash(
    *,
    organization_id: int,
    scope: EnterpriseAccessScope,
    name: str,
    cron_expression: str,
    timezone: str,
    next_fire_at: datetime | None,
    misfire_policy: str,
    catch_up: bool,
    source_version: str,
    idempotency_prefix: str,
) -> str:
    payload = {
        "organization_id": organization_id,
        "scope_fingerprint": scope.scope_fingerprint,
        "policy_version": scope.policy_version,
        "name": name,
        "cron_expression": cron_expression.strip(),
        "timezone": timezone.strip(),
        "next_fire_at": next_fire_at.isoformat() if next_fire_at else None,
        "misfire_policy": misfire_policy,
        "catch_up": bool(catch_up),
        "source_version": source_version,
        "idempotency_prefix": idempotency_prefix,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _notification_run_id(*, organization_id: int, user_id: str, task_uuid: str) -> str:
    """Use a stable run identity so a daily scan cannot duplicate an alert."""

    seed = f"enterprise-insight:{INSIGHT_NOTIFICATION_POLICY_VERSION}:{organization_id}:{user_id}:{task_uuid}"
    return str(uuid5(NAMESPACE_URL, seed))


def scan_overdue_insights(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    cutoff: datetime,
    source_version: str = "project-task-v1",
    notify: bool = True,
) -> InsightScanResult:
    """Detect overdue-task insights and enqueue one notification per task.

    The notification identity is based on the visible task and recipient, not
    the scan timestamp. Re-running a scan with a new cutoff therefore creates
    a new evidence snapshot when appropriate while replaying the same durable
    notification intent instead of sending another alert.
    """

    insights = tuple(
        detect_overdue_task_insights(
            db,
            scope,
            organization_id,
            cutoff=cutoff,
            source_version=source_version,
        )
    )
    notifications: list[WorkflowNotificationOutbox] = []
    replayed_count = 0
    if notify:
        for insight in insights:
            # Only actionable/open findings enter the attention stream. An
            # acknowledged, resolved, or dismissed finding remains queryable
            # without re-notifying the operator on every scan.
            if insight.status != "open":
                continue
            impact_scope = insight.impact_scope_json if isinstance(insight.impact_scope_json, dict) else {}
            task_uuid = str(impact_scope.get("task_uuid") or "").strip()
            if not task_uuid:
                # A notification without a stable source identity cannot be
                # deduplicated safely, so fail closed rather than spam.
                continue
            run_id = _notification_run_id(
                organization_id=organization_id,
                user_id=scope.user_id,
                task_uuid=task_uuid,
            )
            payload = {
                "source": "enterprise_insight",
                "insight_uuid": insight.uuid,
                "insight_type": insight.insight_type,
                "title": insight.title,
                "summary": insight.summary,
                "severity": insight.severity,
                "confidence": float(insight.confidence),
                "project_uuid": impact_scope.get("project_uuid", ""),
                "task_uuid": task_uuid,
                "data_cutoff_at": insight.data_cutoff_at.isoformat(),
                "data_version": insight.data_version,
                "scope_fingerprint": insight.scope_fingerprint,
                "policy_version": INSIGHT_NOTIFICATION_POLICY_VERSION,
            }
            notification, replayed = enqueue_notification(
                db,
                owner_user_id=scope.user_id,
                run_id=run_id,
                node_id=INSIGHT_NOTIFICATION_NODE,
                idempotency_key=f"overdue-task:{task_uuid}:{INSIGHT_NOTIFICATION_POLICY_VERSION}",
                channel="in_app",
                recipient=scope.user_id,
                payload=payload,
            )
            if replayed:
                replayed_count += 1
            notifications.append(notification)
    return InsightScanResult(
        organization_id=organization_id,
        cutoff=cutoff,
        source_version=source_version,
        insights=insights,
        notifications=tuple(notifications),
        notifications_replayed=replayed_count,
    )
