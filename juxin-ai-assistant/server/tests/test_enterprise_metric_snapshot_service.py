from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.service import persist_enterprise_overview_snapshots
from app.enterprise_metrics_models import (
    EnterpriseMetricSnapshot,
    EnterpriseProjectHealthSnapshot,
)
from app.project_task_models import ProjectTask
from app.project_workspace_models import Project, ProjectMember
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str = "u-1") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=f"user-{user_id}", role="employee"),
            scope=AuthScope(department="交付部", managed_departments=["交付部"]),
            apps=["ai-assistant"],
        )
    )


def test_persist_enterprise_overview_snapshots_is_idempotent_and_immutable(generation_db) -> None:
    project = Project(name="快照项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(
        ProjectMember(
            project_id=project.id,
            user_id="u-1",
            role="member",
            invited_by="u-1",
        )
    )
    task = ProjectTask(
        project_id=project.id,
        title="按期任务",
        created_by="u-1",
        status="done",
        due_at=datetime(2026, 7, 15, tzinfo=UTC),
    )
    generation_db.add(task)
    generation_db.commit()
    cutoff = datetime(2026, 7, 16, tzinfo=UTC)

    first = persist_enterprise_overview_snapshots(generation_db, _scope(), cutoff=cutoff)
    second = persist_enterprise_overview_snapshots(generation_db, _scope(), cutoff=cutoff)

    assert first == {"metric_snapshots_created": 3, "health_snapshots_created": 1}
    assert second == {"metric_snapshots_created": 0, "health_snapshots_created": 0}
    assert generation_db.scalar(select(EnterpriseMetricSnapshot.value).where(
        EnterpriseMetricSnapshot.metric_code == "overdue_task_rate"
    )) == 0.0
    assert generation_db.scalar(select(EnterpriseMetricSnapshot.source_hash).where(
        EnterpriseMetricSnapshot.metric_code == "overdue_task_rate"
    ))
    assert generation_db.scalar(select(EnterpriseProjectHealthSnapshot.score)) is not None

    task.status = "todo"
    task.due_at = cutoff - timedelta(days=1)
    generation_db.commit()
    third = persist_enterprise_overview_snapshots(generation_db, _scope(), cutoff=cutoff)

    assert third == {"metric_snapshots_created": 0, "health_snapshots_created": 0}
    assert generation_db.scalar(select(EnterpriseMetricSnapshot.value).where(
        EnterpriseMetricSnapshot.metric_code == "overdue_task_rate"
    )) == 0.0
