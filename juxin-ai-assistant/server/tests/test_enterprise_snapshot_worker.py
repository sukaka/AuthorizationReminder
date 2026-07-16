from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.snapshot_worker import EnterpriseSnapshotWorker
from app.enterprise_metrics_models import (
    EnterpriseDataQualityIssue,
    EnterpriseMetricSnapshot,
    EnterpriseProjectHealthSnapshot,
)
from app.project_task_models import ProjectTask
from app.project_workspace_models import Project, ProjectMember
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str = "u-1", role: str = "employee") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=f"user-{user_id}", role=role),
            scope=AuthScope(department="交付部", managed_departments=["交付部"]),
            apps=["ai-assistant"],
        )
    )


def test_snapshot_worker_is_idempotent_and_does_not_commit(generation_db) -> None:
    project = Project(name="Worker 项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="u-1", role="member", invited_by="u-1"))
    generation_db.add(
        ProjectTask(
            project_id=project.id,
            title="已完成任务",
            created_by="u-1",
            status="done",
            due_at=datetime(2026, 7, 15, tzinfo=UTC),
        )
    )
    generation_db.commit()
    cutoff = datetime(2026, 7, 16, tzinfo=UTC)
    worker = EnterpriseSnapshotWorker(worker_id="worker-test")

    first = worker.run_once(generation_db, _scope(), cutoff=cutoff, source_version=3)
    generation_db.commit()
    second = worker.run_once(generation_db, _scope(), cutoff=cutoff, source_version=3)
    generation_db.commit()

    assert first.metric_snapshots_created == 3
    assert first.health_snapshots_created == 1
    assert first.cutoff == cutoff
    assert first.source_version == 3
    assert second.metric_snapshots_created == 0
    assert second.health_snapshots_created == 0
    assert second.quality_issues_created == 0
    assert generation_db.scalar(select(func.count(EnterpriseMetricSnapshot.id))) == 3
    assert generation_db.scalar(select(func.count(EnterpriseProjectHealthSnapshot.id))) == 1

    generation_db.add(
        ProjectTask(
            project_id=project.id,
            title="新任务",
            created_by="u-1",
            status="todo",
            due_at=cutoff - timedelta(days=1),
        )
    )
    generation_db.commit()
    third = worker.run_once(
        generation_db,
        _scope(),
        cutoff=cutoff + timedelta(days=1),
        source_version=3,
    )
    generation_db.commit()
    assert third.metric_snapshots_created == 3
    assert third.health_snapshots_created == 1
    assert generation_db.scalar(select(func.count(EnterpriseMetricSnapshot.id))) == 6
    assert generation_db.scalar(select(func.count(EnterpriseProjectHealthSnapshot.id))) == 2


def test_snapshot_worker_requires_view_capability_and_source_version(generation_db) -> None:
    worker = EnterpriseSnapshotWorker(worker_id="worker-test")
    with pytest.raises(PermissionError):
        worker.run_once(generation_db, _scope("customer-1", "external"))
    with pytest.raises(ValueError, match="source_version"):
        worker.run_once(generation_db, _scope(), source_version=0)


def test_snapshot_worker_keeps_quality_findings_append_only(generation_db) -> None:
    project = Project(name="质量项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(ProjectMember(project_id=project.id, user_id="u-1", role="member", invited_by="u-1"))
    generation_db.commit()

    worker = EnterpriseSnapshotWorker(worker_id="worker-test")
    first = worker.run_once(
        generation_db,
        _scope(),
        cutoff=datetime(2026, 7, 16, tzinfo=UTC),
        source_version=1,
    )
    generation_db.commit()
    assert first.quality_issues_created > 0
    issue = generation_db.scalar(select(EnterpriseDataQualityIssue).limit(1))
    assert issue is not None
    issue.status = "resolved"
    generation_db.commit()

    second = worker.run_once(
        generation_db,
        _scope(),
        cutoff=datetime(2026, 7, 17, tzinfo=UTC),
        source_version=1,
    )
    generation_db.commit()
    assert second.quality_issues_created == 0
    assert generation_db.scalar(select(EnterpriseDataQualityIssue.status).where(
        EnterpriseDataQualityIssue.id == issue.id
    )) == "resolved"
