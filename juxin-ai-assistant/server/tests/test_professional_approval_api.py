from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select


CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "paragraph",
            "text": "本月未发生重大安全事件。",
        }
    ],
}


@pytest.fixture
def professional_catalog(generation_db):
    from app.professional_delivery.models import (
        SkillDefinition,
        SkillVersion,
        TemplateDefinition,
        TemplateVersion,
    )

    skill = SkillDefinition(
        skill_key="security_ops_monthly_report",
        name="安全运营月报",
        category="security_operations",
        description="形成安全运营月度专业成果",
        scope_policy="both",
        status="published",
        created_by="system",
    )
    template = TemplateDefinition(
        template_key="security_ops_monthly_report",
        name="安全运营月报模板",
        purpose="安全运营月度汇报",
        deliverable_types_json=["security_ops_monthly_report"],
        scope_type="system",
        status="published",
        created_by="system",
    )
    generation_db.add_all([skill, template])
    generation_db.flush()
    template_version = TemplateVersion(
        template_id=template.id,
        version=1,
        content_hash="t" * 64,
        input_schema_json={"type": "object"},
        structure_dsl_json={"type": "document", "children": []},
        status="published",
        published_by="system",
        published_at=datetime(2026, 7, 14, 9, 0, 0),
        created_by="system",
    )
    generation_db.add(template_version)
    generation_db.flush()
    skill_version = SkillVersion(
        skill_id=skill.id,
        version=1,
        content_hash="s" * 64,
        input_schema_json={"type": "object"},
        output_schema_json={"type": "object"},
        plan_definition_json={"steps": []},
        default_template_version_id=template_version.id,
        status="published",
        published_by="system",
        published_at=datetime(2026, 7, 14, 9, 0, 0),
        created_by="system",
    )
    generation_db.add(skill_version)
    generation_db.flush()
    skill.current_published_version_id = skill_version.id
    template.current_published_version_id = template_version.id
    generation_db.commit()
    return SimpleNamespace(
        skill=skill,
        skill_version=skill_version,
        template=template,
        template_version=template_version,
    )


@pytest.fixture
def approval_flows(generation_db):
    from app.professional_delivery.models import (
        ApprovalFlowDefinition,
        ApprovalFlowVersion,
    )

    def create_flow(
        flow_key: str,
        scope_policy: str,
        *,
        roles: list[str],
        allow_author_approve: bool,
    ) -> tuple[ApprovalFlowDefinition, ApprovalFlowVersion]:
        flow = ApprovalFlowDefinition(
            flow_key=flow_key,
            name=f"{flow_key} 审批流",
            scope_policy=scope_policy,
            deliverable_types_json=["security_ops_monthly_report"],
            status="published",
            created_by="system",
        )
        generation_db.add(flow)
        generation_db.flush()
        version = ApprovalFlowVersion(
            flow_id=flow.id,
            version=1,
            content_hash=("a" if scope_policy == "personal" else "b") * 64,
            steps_json=[{"step_key": "final_approval", "roles": roles}],
            min_approvals=1,
            allow_author_approve=allow_author_approve,
            reminder_config_json={"enabled": False},
            return_target="author",
            status="published",
            published_by="system",
            published_at=datetime(2026, 7, 14, 11, 0, 0),
            created_by="system",
        )
        generation_db.add(version)
        generation_db.flush()
        flow.current_published_version_id = version.id
        return flow, version

    personal_flow, personal_version = create_flow(
        "personal_standard",
        "personal",
        roles=["owner"],
        allow_author_approve=True,
    )
    project_flow, project_version = create_flow(
        "project_standard",
        "project",
        roles=["reviewer", "project_lead", "project_admin"],
        allow_author_approve=False,
    )
    generation_db.commit()
    return SimpleNamespace(
        personal=personal_flow,
        personal_version=personal_version,
        project=project_flow,
        project_version=project_version,
    )


def _create(client, catalog, *, key: str, **overrides) -> dict:
    body = {
        "title": "2026 年 7 月安全运营月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": "personal",
        "formality": "formal",
        "skill_version_uuid": catalog.skill_version.uuid,
        "template_version_uuid": catalog.template_version.uuid,
        "content": CONTENT,
        "content_summary": "安全运营月度概览",
        "creation_reason": "manual",
    }
    body.update(overrides)
    response = client.post(
        "/api/ai/deliverables",
        headers={"Idempotency-Key": key},
        json=body,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _mark_review_passed(generation_db, created: dict):
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import ReviewRun

    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None
    version = generation_db.get(WorkArtifactVersion, artifact.current_version_id)
    assert version is not None
    artifact.lifecycle_status = "pending_approval"
    artifact.row_version += 1
    run = ReviewRun(
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        content_hash=version.content_hash,
        skill_version_id=version.skill_version_id,
        template_version_id=version.template_version_id,
        rule_version_ids_json=[],
        status="passed",
        gates_passed=True,
        total_score=100,
        steps_json=[],
        result_summary_json={"blocking_issue_count": 0},
        initiated_by="reviewer-system",
        completed_at=datetime(2026, 7, 14, 12, 0, 0),
        audit_request_id="review-ready",
        idempotency_key=f"review-{artifact.uuid}",
        request_hash=version.content_hash,
    )
    generation_db.add(run)
    generation_db.commit()
    return artifact, version


def _target(artifact, version, **extra) -> dict:
    body = {
        "row_version": artifact.row_version,
        "version_uuid": version.uuid,
        "content_hash": version.content_hash,
    }
    body.update(extra)
    return body


def _submit(
    client,
    artifact,
    version,
    flow_version,
    *,
    key: str,
    body: dict | None = None,
):
    return client.post(
        f"/api/ai/deliverables/{artifact.uuid}/submit",
        headers={"Idempotency-Key": key},
        json=body
        or _target(
            artifact,
            version,
            approval_flow_version_uuid=flow_version.uuid,
        ),
    )


def _allowed_actions(client, deliverable_uuid: str) -> list[str]:
    response = client.get(f"/api/ai/deliverables/{deliverable_uuid}")
    assert response.status_code == 200, response.text
    return response.json()["allowed_actions"]


def test_personal_submit_and_approve_pin_exact_versions_and_replay(
    client_for_user,
    generation_db,
    professional_catalog,
    approval_flows,
) -> None:
    from app.governance_models import AuditLog
    from app.models import WorkArtifact
    from app.professional_delivery.models import ApprovalEvent

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="approval-personal")
    artifact, version = _mark_review_passed(generation_db, created)
    assert _allowed_actions(client, artifact.uuid) == [
        "update_metadata",
        "export",
        "submit",
    ]

    submit_body = _target(
        artifact,
        version,
        approval_flow_version_uuid=approval_flows.personal_version.uuid,
    )
    submitted = _submit(
        client,
        artifact,
        version,
        approval_flows.personal_version,
        key="submit-personal",
        body=submit_body,
    )
    assert submitted.status_code == 201, submitted.text
    submitted_payload = submitted.json()
    assert submitted_payload["lifecycle_status"] == "pending_approval"
    assert submitted_payload["row_version"] == 3
    assert submitted_payload["event"]["event_type"] == "submitted"
    assert submitted_payload["event"]["version_uuid"] == version.uuid
    assert (
        submitted_payload["event"]["approval_flow_version_uuid"]
        == approval_flows.personal_version.uuid
    )
    assert _allowed_actions(client, artifact.uuid) == [
        "update_metadata",
        "comment",
        "reply_comment",
        "export",
        "approve",
        "request_changes",
    ]

    replay = _submit(
        client,
        artifact,
        version,
        approval_flows.personal_version,
        key="submit-personal",
        body=submit_body,
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["event"]["event_uuid"] == submitted_payload["event"]["event_uuid"]
    assert generation_db.scalar(select(func.count(ApprovalEvent.id))) == 1

    reused = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/submit",
        headers={"Idempotency-Key": "submit-personal"},
        json=_target(
            artifact,
            version,
            approval_flow_version_uuid=approval_flows.project_version.uuid,
        ),
    )
    assert reused.status_code == 409
    assert reused.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    artifact = generation_db.get(WorkArtifact, artifact.id)
    approved = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/approve",
        headers={"Idempotency-Key": "approve-personal"},
        json=_target(artifact, version),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["lifecycle_status"] == "approved"
    assert approved.json()["row_version"] == 4
    assert approved.json()["event"]["event_type"] == "approved"
    assert _allowed_actions(client, artifact.uuid) == [
        "update_metadata",
        "create_revision",
        "export",
        "deliver",
    ]

    generation_db.refresh(artifact)
    assert artifact.approved_version_id == version.id
    assert artifact.approved_content_hash == version.content_hash
    assert artifact.approval_flow_version_id == approval_flows.personal_version.id
    assert [
        row.action
        for row in generation_db.scalars(
            select(AuditLog)
            .where(AuditLog.action.like("professional_deliverable.approval.%"))
            .order_by(AuditLog.id)
        )
    ] == [
        "professional_deliverable.approval.submit",
        "professional_deliverable.approval.approve",
    ]


def test_project_author_cannot_self_approve_but_reviewer_can(
    client_for_user,
    generation_db,
    professional_catalog,
    approval_flows,
) -> None:
    author = client_for_user("u-1")
    reviewer = client_for_user("u-2")
    read_only = client_for_user("u-3")
    project = author.post(
        "/api/ai/projects",
        json={"name": "安全运营项目", "description": "月度服务"},
    ).json()
    assert author.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "reviewer"},
    ).status_code == 201
    assert author.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-3", "role": "read_only"},
    ).status_code == 201
    created = _create(
        author,
        professional_catalog,
        key="approval-project",
        scope_type="project",
        project_uuid=project["project_uuid"],
    )
    artifact, version = _mark_review_passed(generation_db, created)

    assert _allowed_actions(read_only, artifact.uuid) == ["export"]

    submitted = _submit(
        author,
        artifact,
        version,
        approval_flows.project_version,
        key="submit-project",
    )
    assert submitted.status_code == 201, submitted.text

    assert _allowed_actions(author, artifact.uuid) == [
        "update_metadata",
        "comment",
        "reply_comment",
        "export",
        "request_changes",
    ]
    assert _allowed_actions(reviewer, artifact.uuid) == [
        "comment",
        "reply_comment",
        "export",
        "approve",
        "request_changes",
    ]

    reviewer_comment = reviewer.post(
        f"/api/ai/deliverables/{artifact.uuid}/comments",
        headers={"Idempotency-Key": "project-reviewer-comment"},
        json={
            "version_uuid": version.uuid,
            "block_id": "monthly-overview",
            "content": "复核意见",
        },
    )
    assert reviewer_comment.status_code == 201, reviewer_comment.text

    read_only_comments = read_only.get(f"/api/ai/deliverables/{artifact.uuid}/comments")
    assert read_only_comments.status_code == 200, read_only_comments.text
    assert read_only_comments.json()["items"][0]["allowed_actions"] == []
    reviewer_comments = reviewer.get(f"/api/ai/deliverables/{artifact.uuid}/comments")
    assert reviewer_comments.status_code == 200, reviewer_comments.text
    assert reviewer_comments.json()["items"][0]["allowed_actions"] == ["resolve_comment"]

    self_approval = author.post(
        f"/api/ai/deliverables/{artifact.uuid}/approve",
        headers={"Idempotency-Key": "self-approve-project"},
        json=_target(artifact, version),
    )
    assert self_approval.status_code == 403
    assert self_approval.json()["detail"]["code"] == "DELIVERABLE_SELF_APPROVAL_FORBIDDEN"

    forbidden = read_only.post(
        f"/api/ai/deliverables/{artifact.uuid}/approve",
        headers={"Idempotency-Key": "readonly-approve-project"},
        json=_target(artifact, version),
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "PROJECT_DELIVERABLE_APPROVAL_FORBIDDEN"

    approved = reviewer.post(
        f"/api/ai/deliverables/{artifact.uuid}/approve",
        headers={"Idempotency-Key": "reviewer-approve-project"},
        json=_target(artifact, version),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["lifecycle_status"] == "approved"
    assert approved.json()["event"]["actor_user_id"] == "u-2"


def test_comments_are_version_bound_encrypted_and_linked_when_changes_requested(
    client_for_user,
    generation_db,
    professional_catalog,
    approval_flows,
) -> None:
    from app.crypto import ContentCipher, EncryptedPayload
    from app.config import get_settings
    from app.professional_delivery.models import ApprovalEvent, DeliverableComment

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="comment-personal")
    artifact, version = _mark_review_passed(generation_db, created)
    assert _submit(
        client,
        artifact,
        version,
        approval_flows.personal_version,
        key="submit-comment-personal",
    ).status_code == 201

    comment = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/comments",
        headers={"Idempotency-Key": "create-comment"},
        json={
            "version_uuid": version.uuid,
            "block_id": "monthly-overview",
            "char_start": 0,
            "char_end": 2,
            "content": "请补充事件处置证据。",
        },
    )
    assert comment.status_code == 201, comment.text
    comment_payload = comment.json()["comment"]
    assert comment_payload["content"] == "请补充事件处置证据。"
    assert comment_payload["status"] == "open"
    assert comment_payload["version_uuid"] == version.uuid
    assert comment_payload["allowed_actions"] == ["resolve_comment"]

    stored = generation_db.scalar(
        select(DeliverableComment).where(
            DeliverableComment.uuid == comment_payload["comment_uuid"]
        )
    )
    assert stored is not None
    assert b"\xe8\xaf\xb7\xe8\xa1\xa5\xe5\x85\x85" not in stored.content_ciphertext
    decrypted = ContentCipher(get_settings().content_encryption_key).decrypt_json(
        EncryptedPayload(stored.content_ciphertext, stored.content_nonce),
        stored.uuid.encode("utf-8"),
    )
    assert decrypted == {"content": "请补充事件处置证据。"}

    reply = client.post(
        f"/api/ai/comments/{stored.uuid}/replies",
        headers={"Idempotency-Key": "reply-comment"},
        json={"content": "收到，将在下一版本补齐。"},
    )
    assert reply.status_code == 201, reply.text
    assert reply.json()["comment"]["replies"][0]["content"] == "收到，将在下一版本补齐。"

    history = client.get(f"/api/ai/deliverables/{artifact.uuid}/comments")
    assert history.status_code == 200
    assert history.json()["items"][0]["comment_uuid"] == stored.uuid
    assert history.json()["items"][0]["allowed_actions"] == ["resolve_comment"]

    changes = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/request-changes",
        headers={"Idempotency-Key": "request-changes-personal"},
        json=_target(
            artifact,
            version,
            reason="补齐关键证据后重新提交。",
            comment_uuids=[stored.uuid],
        ),
    )
    assert changes.status_code == 200, changes.text
    assert changes.json()["lifecycle_status"] == "changes_requested"
    assert changes.json()["event"]["comment_uuids"] == [stored.uuid]

    event = generation_db.scalar(
        select(ApprovalEvent).where(ApprovalEvent.event_type == "changes_requested")
    )
    assert event is not None
    assert event.reason_ciphertext
    assert "补齐关键证据".encode() not in event.reason_ciphertext

    resolved = client.post(
        f"/api/ai/comments/{stored.uuid}/resolve",
        headers={"Idempotency-Key": "resolve-comment"},
        json={"reason": "新版本已补齐"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["comment"]["status"] == "resolved"


def test_delivery_requires_matching_approved_word_export_then_can_archive(
    client_for_user,
    generation_db,
    professional_catalog,
    approval_flows,
) -> None:
    from app.models import WorkArtifact
    from app.professional_delivery.models import (
        DeliverableExport,
        DeliveryRecord,
    )

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="delivery-personal")
    artifact, version = _mark_review_passed(generation_db, created)
    assert _submit(
        client,
        artifact,
        version,
        approval_flows.personal_version,
        key="submit-delivery-personal",
    ).status_code == 201
    artifact = generation_db.get(WorkArtifact, artifact.id)
    assert client.post(
        f"/api/ai/deliverables/{artifact.uuid}/approve",
        headers={"Idempotency-Key": "approve-delivery-personal"},
        json=_target(artifact, version),
    ).status_code == 200
    generation_db.refresh(artifact)

    export = DeliverableExport(
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        content_hash=version.content_hash,
        export_format="docx",
        status="ready",
        watermarked=True,
        file_name="安全运营月报.docx",
        file_path="/tmp/security-monthly.docx",
        created_by="u-1",
    )
    generation_db.add(export)
    generation_db.commit()

    delivery_body = _target(
        artifact,
        version,
        export_uuid=export.uuid,
        recipient_description="客户安全负责人",
        note="线下确认后人工交付",
    )
    delivered = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/deliver",
        headers={"Idempotency-Key": "deliver-personal"},
        json=delivery_body,
    )
    assert delivered.status_code == 422
    assert delivered.json()["detail"]["code"] == "DELIVERABLE_EXPORT_NOT_READY"

    export.watermarked = False
    export.file_hash = "a" * 64
    export.file_size = 1
    export.renderer_version = "professional-docx-v1"
    generation_db.commit()
    delivered = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/deliver",
        headers={"Idempotency-Key": "deliver-personal"},
        json=delivery_body,
    )
    assert delivered.status_code == 201, delivered.text
    delivered_payload = delivered.json()
    assert delivered_payload["lifecycle_status"] == "delivered"
    assert delivered_payload["delivery"]["version_uuid"] == version.uuid
    assert delivered_payload["delivery"]["export_uuid"] == export.uuid
    assert delivered_payload["delivery"]["delivered_by"] == "u-1"
    assert _allowed_actions(client, artifact.uuid) == [
        "update_metadata",
        "create_revision",
        "export",
        "archive",
        "submit_experience",
    ]

    replay = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/deliver",
        headers={"Idempotency-Key": "deliver-personal"},
        json=delivery_body,
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["delivery"]["delivery_uuid"] == delivered_payload["delivery"]["delivery_uuid"]
    assert generation_db.scalar(select(func.count(DeliveryRecord.id))) == 1

    generation_db.refresh(artifact)
    archived = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/archive",
        headers={"Idempotency-Key": "archive-personal"},
        json=_target(
            artifact,
            version,
            delivery_uuid=delivered_payload["delivery"]["delivery_uuid"],
        ),
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["lifecycle_status"] == "archived"
    assert _allowed_actions(client, artifact.uuid) == [
        "create_revision",
        "export",
        "submit_experience",
    ]
    generation_db.refresh(artifact)
    assert artifact.approved_version_id == version.id
    assert artifact.delivered_version_id == version.id
    assert artifact.record_status == "active"
    assert artifact.archived_by == "u-1"
    assert artifact.archived_at is not None


def test_submit_rejects_stale_or_failed_review_and_audit_failure_rolls_back(
    client_for_user,
    generation_db,
    professional_catalog,
    approval_flows,
    monkeypatch,
) -> None:
    from app.models import WorkArtifact
    from app.professional_delivery import routes
    from app.professional_delivery.models import ApprovalEvent, ReviewRun

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="approval-rollback")
    artifact, version = _mark_review_passed(generation_db, created)

    stale = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/submit",
        headers={"Idempotency-Key": "submit-stale"},
        json=_target(
            artifact,
            version,
            row_version=artifact.row_version - 1,
            approval_flow_version_uuid=approval_flows.personal_version.uuid,
        ),
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "DELIVERABLE_VERSION_CONFLICT"

    latest_review = generation_db.scalar(
        select(ReviewRun).where(ReviewRun.deliverable_id == artifact.id)
    )
    latest_review.status = "failed"
    latest_review.gates_passed = False
    generation_db.commit()
    failed = _submit(
        client,
        artifact,
        version,
        approval_flows.personal_version,
        key="submit-failed-review",
    )
    assert failed.status_code == 422
    assert failed.json()["detail"]["code"] == "DELIVERABLE_REVIEW_NOT_PASSED"
    latest_review.status = "passed"
    latest_review.gates_passed = True
    generation_db.commit()

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(routes, "write_request_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        _submit(
            client,
            artifact,
            version,
            approval_flows.personal_version,
            key="submit-audit-failure",
        )

    generation_db.expire_all()
    artifact = generation_db.get(WorkArtifact, artifact.id)
    assert artifact.lifecycle_status == "pending_approval"
    assert artifact.row_version == 2
    assert artifact.approval_flow_version_id is None
    assert generation_db.scalar(select(func.count(ApprovalEvent.id))) == 0
