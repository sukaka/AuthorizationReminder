"""Enterprise Intelligence 5.0 readiness checks.

The probe is intentionally conservative: a locally-created schema can prove
that the code is wired, but it cannot prove that production migrations,
workers, credentials, or external notification delivery are ready.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from ..config import Settings
from ..feature_flags import load_feature_flags


CURRENT_ENTERPRISE_MIGRATION_HEAD = "0063_enterprise_notification_read_state"

# These tables cover the enterprise intelligence read/write path and its
# durable notification boundary.  Keeping the list explicit makes a missing
# migration visible even when SQLAlchemy metadata was imported successfully.
REQUIRED_ENTERPRISE_TABLES = frozenset(
    {
        "ai_organizations",
        "ai_organization_units",
        "ai_enterprise_customers",
        "ai_customer_identity_bindings",
        "ai_enterprise_entity_refs",
        "ai_enterprise_entity_aliases",
        "ai_project_customer_links",
        "ai_project_service_occurrences",
        "ai_project_issue_asset_links",
        "ai_project_remediations",
        "ai_enterprise_metric_definitions",
        "ai_enterprise_metric_snapshots",
        "ai_enterprise_project_health_snapshots",
        "ai_enterprise_data_quality_issues",
        "ai_enterprise_graph_relations",
        "ai_enterprise_graph_relation_evidence",
        "ai_enterprise_org_memory_items",
        "ai_enterprise_org_memory_versions",
        "ai_enterprise_org_memory_reviews",
        "ai_enterprise_org_memory_candidates",
        "ai_enterprise_insight_rules",
        "ai_enterprise_insight_rule_versions",
        "ai_enterprise_insights",
        "ai_enterprise_insight_evidence",
        "ai_enterprise_recommendations",
        "ai_enterprise_recommendation_actions",
        "ai_enterprise_capability_evaluations",
        "ai_enterprise_optimization_proposals",
        "ai_enterprise_optimization_proposal_events",
        "ai_enterprise_capability_observations",
        "ai_workflow_notification_outbox",
    }
)


def _check_schema(db: Session) -> dict[str, Any]:
    try:
        tables = set(inspect(db.get_bind()).get_table_names())
    except Exception as exc:
        return {
            "id": "enterprise_schema",
            "name": "企业智能 5.0 表结构",
            "status": "fail",
            "detail": f"无法读取表结构: {str(exc)[:180]}",
        }

    missing = sorted(REQUIRED_ENTERPRISE_TABLES - tables)
    return {
        "id": "enterprise_schema",
        "name": "企业智能 5.0 表结构",
        "status": "fail" if missing else "pass",
        "detail": (
            f"缺少 {len(missing)} 张表"
            if missing
            else f"已发现 {len(REQUIRED_ENTERPRISE_TABLES)} 张核心表"
        ),
        "missing_tables": missing,
    }


def _check_migration(db: Session) -> dict[str, Any]:
    try:
        tables = set(inspect(db.get_bind()).get_table_names())
        if "alembic_version" not in tables:
            return {
                "id": "enterprise_migration",
                "name": "企业智能 5.0 迁移版本",
                "status": "warn",
                "detail": "当前数据库没有 alembic_version（通常是开发测试库）",
                "expected_head": CURRENT_ENTERPRISE_MIGRATION_HEAD,
                "versions": [],
            }
        versions = sorted(
            str(value)
            for value in db.execute(text("SELECT version_num FROM alembic_version"))
            .scalars()
            .all()
        )
    except Exception as exc:
        return {
            "id": "enterprise_migration",
            "name": "企业智能 5.0 迁移版本",
            "status": "fail",
            "detail": f"无法读取迁移版本: {str(exc)[:180]}",
            "expected_head": CURRENT_ENTERPRISE_MIGRATION_HEAD,
        }

    current_head = versions[0] if len(versions) == 1 else None
    ready = bool(current_head and _is_enterprise_head_applied(current_head))
    return {
        "id": "enterprise_migration",
        "name": "企业智能 5.0 迁移版本",
        "status": "pass" if ready else "fail",
        "detail": (
            f"当前 head={current_head}，已包含企业智能基线 {CURRENT_ENTERPRISE_MIGRATION_HEAD}"
            if ready
            else f"当前版本 {versions or ['<empty>']}，期望单一且包含企业智能基线的 head"
        ),
        "expected_head": CURRENT_ENTERPRISE_MIGRATION_HEAD,
        "versions": versions,
    }


def _is_enterprise_head_applied(current_head: str) -> bool:
    """Return whether ``current_head`` descends from the frozen 5.0 baseline.

    Later, unrelated migrations must not make an already-applied enterprise
    baseline look stale.  The fallback keeps the check deterministic when the
    Alembic script directory is unavailable in a packaged runtime.
    """

    server_root = Path(__file__).resolve().parents[2]
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(Config(str(server_root / "alembic.ini")))
        revision = script.get_revision(current_head)
        visited: set[str] = set()
        stack = [revision]
        while stack:
            node = stack.pop()
            if node is None or node.revision in visited:
                continue
            visited.add(node.revision)
            if node.revision == CURRENT_ENTERPRISE_MIGRATION_HEAD:
                return True
            down_revision = node.down_revision
            if isinstance(down_revision, tuple):
                stack.extend(script.get_revision(item) for item in down_revision)
            elif down_revision:
                stack.append(script.get_revision(down_revision))
        return False
    except Exception:
        return current_head == CURRENT_ENTERPRISE_MIGRATION_HEAD


def _check_worker(settings: Settings) -> dict[str, Any]:
    flags = load_feature_flags(settings)
    enabled = bool(flags.get("workflow_control_worker", False))
    return {
        "id": "enterprise_worker",
        "name": "企业洞察周期 Worker",
        "status": "pass" if enabled else "warn",
        "detail": (
            "WorkflowControlWorker 已开启"
            if enabled
            else "WorkflowControlWorker 未开启；周期洞察不会自动执行"
        ),
        "feature_flag": "workflow_control_worker",
    }


def _check_notification_provider() -> dict[str, Any]:
    try:
        from ..provider_reconciliation import FakeNotificationProvider, NotificationProvider

        _ = FakeNotificationProvider, NotificationProvider
    except Exception as exc:
        return {
            "id": "enterprise_notification_provider",
            "name": "企业通知 Provider 契约",
            "status": "fail",
            "detail": f"Provider 契约不可用: {str(exc)[:180]}",
        }

    return {
        "id": "enterprise_notification_provider",
        "name": "企业通知 Provider 契约",
        "status": "warn",
        "detail": "本地 Outbox/可替换 Provider 契约可用；真实外部 Provider 尚未绑定",
        "provider_contract": "NotificationProvider.send/reconcile",
        "default_sink": "local_notification_sink",
    }


def build_enterprise_readiness(db: Session, settings: Settings) -> dict[str, Any]:
    """Return a conservative, machine-readable enterprise 5.0 readiness report."""

    checks = [
        _check_schema(db),
        _check_migration(db),
        _check_worker(settings),
        _check_notification_provider(),
    ]
    fail_count = sum(1 for check in checks if check["status"] == "fail")
    warn_count = sum(1 for check in checks if check["status"] == "warn")
    if fail_count:
        overall = "not_ready"
    elif warn_count:
        overall = "ready_with_warnings"
    else:
        overall = "ready"
    return {
        "overall": overall,
        "checks": checks,
        "fail_count": fail_count,
        "warn_count": warn_count,
        "pass_count": len(checks) - fail_count - warn_count,
        "expected_migration_head": CURRENT_ENTERPRISE_MIGRATION_HEAD,
    }
