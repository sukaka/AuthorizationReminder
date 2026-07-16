from datetime import UTC, datetime

from sqlalchemy import select

from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.service import persist_enterprise_data_quality_issues
from app.enterprise_metrics_models import EnterpriseDataQualityIssue
from app.project_initialization_models import ProjectContract
from app.project_workspace_models import Project, ProjectMember
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope() -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id="u-1", username="user-u-1", role="employee"),
            scope=AuthScope(department="交付部", managed_departments=["交付部"]),
            apps=["ai-assistant"],
        )
    )


def test_persist_enterprise_data_quality_issues_is_idempotent_and_preserves_resolutions(
    generation_db,
) -> None:
    project = Project(name="待治理项目", owner_user_id="u-1", created_by="u-1")
    generation_db.add(project)
    generation_db.flush()
    generation_db.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id="u-1",
                role="member",
                invited_by="u-1",
            ),
            ProjectContract(
                project_id=project.id,
                name="客户合同",
                customer_name="待确认客户",
            ),
        ]
    )
    generation_db.commit()
    detected_at = datetime(2026, 7, 16, 10, 0, tzinfo=UTC)

    first = persist_enterprise_data_quality_issues(
        generation_db,
        _scope(),
        detected_at=detected_at,
    )
    assert first == {"issues_scanned": 6, "issues_created": 6}

    resolved = generation_db.scalar(
        select(EnterpriseDataQualityIssue).order_by(EnterpriseDataQualityIssue.id)
    )
    assert resolved is not None
    resolved.status = "resolved"
    resolved.resolved_by = "operator-1"
    generation_db.commit()

    second = persist_enterprise_data_quality_issues(
        generation_db,
        _scope(),
        detected_at=datetime(2026, 7, 17, tzinfo=UTC),
    )
    assert second == {"issues_scanned": 6, "issues_created": 0}
    assert generation_db.scalar(
        select(EnterpriseDataQualityIssue.status).where(
            EnterpriseDataQualityIssue.id == resolved.id
        )
    ) == "resolved"

    new_rule = persist_enterprise_data_quality_issues(
        generation_db,
        _scope(),
        source_version=2,
    )
    assert new_rule == {"issues_scanned": 6, "issues_created": 6}
    assert generation_db.scalar(
        select(EnterpriseDataQualityIssue.id).where(
            EnterpriseDataQualityIssue.source_version == 2
        )
    ) is not None
