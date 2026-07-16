from datetime import UTC, datetime

import pytest

from app.enterprise_graph_memory_models import (
    EnterpriseGraphRelation,
    EnterpriseGraphRelationEvidence,
    EnterpriseOrgMemoryCandidate,
    EnterpriseOrgMemoryItem,
    EnterpriseOrgMemoryReview,
    EnterpriseOrgMemoryVersion,
)
from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.graph_memory_service import (
    create_graph_relation,
    create_memory_candidate,
    create_org_memory_item,
    review_org_memory_version,
)
from app.enterprise_intelligence_models import EnterpriseOrganization
from app.project_workspace_models import Project, ProjectMember
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str, role: str = "admin", department: str = "交付部") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=user_id, role=role),
            scope=AuthScope(department=department),
            apps=["ai-assistant"],
        )
    )


def _manager_scope(user_id: str, department: str = "交付部") -> EnterpriseAccessScope:
    """A non-admin scope with explicit manage capability for scope-bound tests."""

    return EnterpriseAccessScope(
        user_id=user_id,
        username=user_id,
        role="manager",
        department=department,
        managed_departments=(department,),
        is_admin=False,
        is_external=False,
        capabilities=frozenset({"assistant:use", "intelligence:view", "intelligence:manage"}),
    )


def _project(db, organization_id: int, name: str, owner: str = "employee-1") -> Project:
    row = Project(
        name=name,
        owner_user_id=owner,
        created_by=owner,
        organization_id=organization_id,
    )
    db.add(row)
    db.flush()
    return row


def test_graph_relation_requires_scope_and_evidence_is_idempotent(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="graph-org", name="图谱组织")
    generation_db.add(organization)
    generation_db.flush()
    visible = _project(generation_db, organization.id, "可见项目")
    hidden = _project(generation_db, organization.id, "不可见项目", owner="employee-2")
    generation_db.add(ProjectMember(project_id=visible.id, user_id="employee-1", role="member"))
    generation_db.flush()

    with pytest.raises(PermissionError, match="管理权限"):
        create_graph_relation(
            generation_db,
            _scope("employee-1", "employee"),
            organization.id,
            "project",
            visible.uuid,
            "project",
            hidden.uuid,
            "project_depends_on",
            evidence_refs=[{"type": "project", "uuid": visible.uuid, "source_version": 1}],
        )

    with pytest.raises(LookupError, match="不可访问"):
        create_graph_relation(
            generation_db,
            _manager_scope("employee-1"),
            organization.id,
            "project",
            visible.uuid,
            "project",
            hidden.uuid,
            "project_depends_on",
        )

    first = create_graph_relation(
        generation_db,
        _scope("admin-1"),
        organization.id,
        "project",
        visible.uuid,
        "project",
        hidden.uuid,
        "project_depends_on",
        evidence_refs=[{"type": "project", "uuid": visible.uuid, "source_version": 1}],
    )
    generation_db.commit()
    second = create_graph_relation(
        generation_db,
        _scope("admin-2"),
        organization.id,
        "project",
        visible.uuid,
        "project",
        hidden.uuid,
        "project_depends_on",
        evidence_refs=[{"type": "project", "uuid": visible.uuid, "source_version": 1}],
        confidence=0.1,
    )
    assert second.id == first.id
    assert generation_db.query(EnterpriseGraphRelation).count() == 1
    assert generation_db.query(EnterpriseGraphRelationEvidence).count() == 1


def test_memory_candidate_dedup_and_reviewed_versions_are_auditable(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="memory-org", name="记忆组织")
    generation_db.add(organization)
    generation_db.flush()

    with pytest.raises(PermissionError, match="管理权限"):
        create_memory_candidate(
            generation_db,
            _scope("employee-1", "employee"),
            organization.id,
            memory_key="delivery.standard",
            title="交付标准",
            content={"rule": "先审后发"},
            source_refs=[{"type": "quality_issue", "uuid": "q-1"}],
        )

    first = create_memory_candidate(
        generation_db,
        _scope("admin-1"),
        organization.id,
        memory_key="delivery.standard",
        title="交付标准",
        content={"rule": "先审后发"},
        source_refs=[{"type": "quality_issue", "uuid": "q-1"}],
    )
    generation_db.commit()
    second = create_memory_candidate(
        generation_db,
        _scope("admin-2"),
        organization.id,
        memory_key="delivery.standard",
        title="应被忽略",
        content={"rule": "不应覆盖"},
        source_refs=[],
    )
    assert second.id == first.id
    assert second.title == "交付标准"
    assert generation_db.query(EnterpriseOrgMemoryCandidate).count() == 1

    item, version = create_org_memory_item(
        generation_db,
        _scope("admin-1"),
        organization.id,
        memory_key="delivery.standard",
        title="交付标准",
        content={"rule": "先审后发"},
        source_refs=[{"type": "quality_issue", "uuid": "q-1"}],
    )
    assert item.status == "draft"
    assert version.status == "pending_review"
    with pytest.raises(PermissionError, match="管理权限"):
        review_org_memory_version(
            generation_db,
            _scope("employee-1", "employee"),
            version.id,
            action="approve",
            comment="发布",
        )

    approved = review_org_memory_version(
        generation_db,
        _scope("admin-2"),
        version.id,
        action="approve",
        comment="确认可用",
    )
    generation_db.commit()
    assert approved.status == "approved"
    assert item.status == "published"
    assert item.current_version == 1
    assert generation_db.query(EnterpriseOrgMemoryReview).count() == 1

    with pytest.raises(ValueError, match="已审核"):
        review_org_memory_version(
            generation_db,
            _scope("admin-3"),
            version.id,
            action="reject",
        )
