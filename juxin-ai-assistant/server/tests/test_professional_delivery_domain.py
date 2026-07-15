from dataclasses import FrozenInstanceError

import pytest


def test_deliverable_scope_enforces_personal_and_project_boundaries() -> None:
    from app.professional_delivery.domain import (
        DeliverableDomainError,
        DeliverableScope,
        ScopeType,
    )

    personal = DeliverableScope(
        scope_type=ScopeType.PERSONAL,
        owner_user_id="user-1",
        project_id=None,
    )
    project = DeliverableScope(
        scope_type=ScopeType.PROJECT,
        owner_user_id="creator-1",
        project_id=42,
    )

    assert personal.owner_user_id == "user-1"
    assert project.project_id == 42

    with pytest.raises(DeliverableDomainError) as missing_owner:
        DeliverableScope(
            scope_type=ScopeType.PERSONAL,
            owner_user_id="",
            project_id=None,
        )
    assert missing_owner.value.code == "DELIVERABLE_SCOPE_INVALID"

    with pytest.raises(DeliverableDomainError) as personal_project:
        DeliverableScope(
            scope_type=ScopeType.PERSONAL,
            owner_user_id="user-1",
            project_id=42,
        )
    assert personal_project.value.code == "DELIVERABLE_SCOPE_INVALID"

    with pytest.raises(DeliverableDomainError) as missing_project:
        DeliverableScope(
            scope_type=ScopeType.PROJECT,
            owner_user_id="creator-1",
            project_id=None,
        )
    assert missing_project.value.code == "DELIVERABLE_SCOPE_INVALID"


def test_deliverable_version_snapshot_is_canonical_and_immutable() -> None:
    from app.professional_delivery.domain import DeliverableVersionSnapshot

    content = {
        "title": "安全运维月报",
        "blocks": [
            {"block_id": "summary", "type": "paragraph", "text": "本月运行稳定"},
        ],
    }
    snapshot = DeliverableVersionSnapshot.create(
        deliverable_id=7,
        version_no=1,
        parent_version_id=None,
        skill_version_id=11,
        template_version_id=13,
        content=content,
        content_format="structured_json",
        content_schema_version="1.0",
        title_snapshot="安全运维月报",
        summary_snapshot="本月运行稳定",
        created_by="user-1",
        creation_reason="ai_generation",
    )
    same_snapshot = DeliverableVersionSnapshot.create(
        deliverable_id=7,
        version_no=1,
        parent_version_id=None,
        skill_version_id=11,
        template_version_id=13,
        content={"blocks": content["blocks"], "title": content["title"]},
        content_format="structured_json",
        content_schema_version="1.0",
        title_snapshot="安全运维月报",
        summary_snapshot="本月运行稳定",
        created_by="user-1",
        creation_reason="ai_generation",
    )

    original_hash = snapshot.content_hash
    content["blocks"][0]["text"] = "外部对象已被修改"

    assert snapshot.content["blocks"][0]["text"] == "本月运行稳定"
    assert snapshot.content_hash == original_hash
    assert same_snapshot.content_hash == original_hash
    with pytest.raises(FrozenInstanceError):
        snapshot.version_no = 2  # type: ignore[misc]


@pytest.mark.parametrize(
    ("skill_version_id", "template_version_id"),
    [(None, 13), (11, None), (0, 13), (11, 0)],
)
def test_deliverable_version_requires_pinned_skill_and_template_versions(
    skill_version_id: int | None,
    template_version_id: int | None,
) -> None:
    from app.professional_delivery.domain import (
        DeliverableDomainError,
        DeliverableVersionSnapshot,
    )

    with pytest.raises(DeliverableDomainError) as error:
        DeliverableVersionSnapshot.create(
            deliverable_id=7,
            version_no=1,
            parent_version_id=None,
            skill_version_id=skill_version_id,
            template_version_id=template_version_id,
            content={"blocks": []},
            content_format="structured_json",
            content_schema_version="1.0",
            title_snapshot="安全运维月报",
            summary_snapshot="",
            created_by="user-1",
            creation_reason="manual_edit",
        )
    assert error.value.code == "DELIVERABLE_VERSION_INVALID"


@pytest.mark.parametrize(
    ("current", "action", "context", "expected"),
    [
        ("draft", "submit_quality_review", {"has_current_version": True, "content_hash_unchanged": True}, "quality_review"),
        ("changes_requested", "submit_quality_review", {"has_current_version": True, "content_hash_unchanged": True}, "quality_review"),
        ("quality_review", "quality_review_failed", {"has_blocking_issues": True}, "changes_requested"),
        ("quality_review", "quality_review_passed", {"quality_gates_passed": True}, "pending_approval"),
        ("pending_approval", "request_changes", {"reason": "补充风险说明"}, "changes_requested"),
        ("pending_approval", "approve", {"can_approve": True, "version_unchanged": True}, "approved"),
        ("approved", "deliver", {"approved_version_selected": True}, "delivered"),
        ("delivered", "archive", {"delivery_record_complete": True}, "archived"),
        ("approved", "create_revision", {"creates_new_version": True}, "draft"),
        ("delivered", "create_revision", {"creates_new_version": True}, "draft"),
        ("archived", "create_revision", {"creates_new_version": True}, "draft"),
    ],
)
def test_lifecycle_state_machine_allows_only_declared_transitions(
    current: str,
    action: str,
    context: dict[str, object],
    expected: str,
) -> None:
    from app.professional_delivery.domain import (
        LifecycleAction,
        LifecycleStatus,
        TransitionContext,
        transition_lifecycle,
    )

    result = transition_lifecycle(
        LifecycleStatus(current),
        LifecycleAction(action),
        TransitionContext(**context),
    )

    assert result == LifecycleStatus(expected)


def test_lifecycle_state_machine_rejects_invalid_transition_and_missing_condition() -> None:
    from app.professional_delivery.domain import (
        DeliverableDomainError,
        LifecycleAction,
        LifecycleStatus,
        TransitionContext,
        transition_lifecycle,
    )

    with pytest.raises(DeliverableDomainError) as invalid_transition:
        transition_lifecycle(
            LifecycleStatus.DRAFT,
            LifecycleAction.APPROVE,
            TransitionContext(can_approve=True, version_unchanged=True),
        )
    assert invalid_transition.value.code == "DELIVERABLE_TRANSITION_INVALID"

    with pytest.raises(DeliverableDomainError) as missing_reason:
        transition_lifecycle(
            LifecycleStatus.PENDING_APPROVAL,
            LifecycleAction.REQUEST_CHANGES,
            TransitionContext(),
        )
    assert missing_reason.value.code == "DELIVERABLE_TRANSITION_PRECONDITION_FAILED"
