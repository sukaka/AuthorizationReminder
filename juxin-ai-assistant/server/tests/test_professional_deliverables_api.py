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

UPDATED_CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "paragraph",
            "text": "本月完成全部安全巡检，未发生重大安全事件。",
        },
        {
            "block_id": "monthly-actions",
            "type": "paragraph",
            "text": "已关闭两项低风险整改。",
        },
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


def _create_body(catalog, **overrides) -> dict:
    body = {
        "title": "2026 年 7 月安全运营月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": "personal",
        "formality": "working",
        "skill_version_uuid": catalog.skill_version.uuid,
        "template_version_uuid": catalog.template_version.uuid,
        "content": CONTENT,
        "content_summary": "安全运营月度概览",
        "creation_reason": "manual",
    }
    body.update(overrides)
    return body


def _create(client, catalog, *, key="create-monthly-report", **overrides):
    return client.post(
        "/api/ai/deliverables",
        headers={"Idempotency-Key": key},
        json=_create_body(catalog, **overrides),
    )


def _create_version(
    client,
    deliverable_uuid: str,
    *,
    key: str = "create-monthly-report-v2",
    **overrides,
):
    body = {
        "row_version": 1,
        "content": UPDATED_CONTENT,
        "content_summary": "补充巡检与整改结论",
        "change_summary": "补充巡检和整改情况",
        "creation_reason": "manual_edit",
    }
    body.update(overrides)
    return client.post(
        f"/api/ai/deliverables/{deliverable_uuid}/versions",
        headers={"Idempotency-Key": key},
        json=body,
    )


def test_create_personal_deliverable_pins_versions_encrypts_content_and_replays(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.crypto import ContentCipher, EncryptedPayload
    from app.governance_models import AuditLog
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import DeliverableIdempotencyRecord
    from app.config import get_settings

    client = client_for_user("u-1")
    first = _create(client, professional_catalog)

    assert first.status_code == 201, first.text
    payload = first.json()
    assert payload["request_id"]
    assert payload["scope_type"] == "personal"
    assert payload["project_uuid"] is None
    assert payload["owner_user_id"] == "u-1"
    assert payload["lifecycle_status"] == "draft"
    assert payload["row_version"] == 1
    assert payload["allowed_actions"] == [
        "edit",
        "update_metadata",
        "create_version",
        "manage_facts",
        "review",
        "resolve_review_issue",
        "comment",
        "reply_comment",
        "export",
    ]
    assert payload["current_version"]["version_no"] == 1
    assert payload["current_version"]["skill_version_uuid"] == professional_catalog.skill_version.uuid
    assert payload["current_version"]["template_version_uuid"] == professional_catalog.template_version.uuid
    assert payload["current_version"]["content"] == CONTENT
    assert len(payload["current_version"]["content_hash"]) == 64

    replay = _create(client, professional_catalog)
    assert replay.status_code == 201, replay.text
    assert replay.json()["deliverable_uuid"] == payload["deliverable_uuid"]

    artifact = generation_db.scalar(
        select(WorkArtifact).where(WorkArtifact.uuid == payload["deliverable_uuid"])
    )
    assert artifact is not None
    version = generation_db.scalar(
        select(WorkArtifactVersion).where(WorkArtifactVersion.artifact_id == artifact.id)
    )
    assert version is not None
    assert version.content_ciphertext
    assert CONTENT["blocks"][0]["text"].encode() not in version.content_ciphertext
    decrypted = ContentCipher(get_settings().content_encryption_key).decrypt_json(
        EncryptedPayload(version.content_ciphertext, version.content_nonce),
        version.uuid.encode("utf-8"),
    )
    assert decrypted == CONTENT
    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == 1
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 1
    assert generation_db.scalar(select(func.count(DeliverableIdempotencyRecord.id))) == 1
    audits = list(
        generation_db.scalars(
            select(AuditLog).where(AuditLog.action == "professional_deliverable.create")
        )
    )
    assert len(audits) == 1
    assert audits[0].metadata_json == {
        "event": "deliverable_created",
        "status": "draft",
    }


def test_update_metadata_uses_optimistic_lock_and_preserves_version_snapshot(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.governance_models import AuditLog
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import DeliverableIdempotencyRecord

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="metadata-create").json()
    deliverable_uuid = created["deliverable_uuid"]
    original_snapshot = created["current_version"]["title_snapshot"]
    body = {"row_version": created["row_version"], "title": "安全运营月报（终稿）"}

    updated = client.patch(
        f"/api/ai/deliverables/{deliverable_uuid}",
        headers={"Idempotency-Key": "metadata-update"},
        json=body,
    )

    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert payload["title"] == "安全运营月报（终稿）"
    assert payload["row_version"] == 2
    assert payload["current_version"]["title_snapshot"] == original_snapshot

    replay = client.patch(
        f"/api/ai/deliverables/{deliverable_uuid}",
        headers={"Idempotency-Key": "metadata-update"},
        json=body,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["row_version"] == 2

    stale = client.patch(
        f"/api/ai/deliverables/{deliverable_uuid}",
        headers={"Idempotency-Key": "metadata-update-stale"},
        json={"row_version": 1, "title": "过期写入"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "DELIVERABLE_VERSION_CONFLICT"

    artifact = generation_db.scalar(
        select(WorkArtifact).where(WorkArtifact.uuid == deliverable_uuid)
    )
    assert artifact is not None
    version = generation_db.get(WorkArtifactVersion, artifact.current_version_id)
    assert version is not None
    assert artifact.title == "安全运营月报（终稿）"
    assert version.title_snapshot == original_snapshot
    assert generation_db.scalar(
        select(func.count(DeliverableIdempotencyRecord.id))
    ) == 2
    assert generation_db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "professional_deliverable.metadata.update"
        )
    ) == 1


def test_delivered_result_submits_only_deidentified_exact_version_experience_candidate(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher, EncryptedPayload
    from app.governance_models import AuditLog
    from app.models import ExperienceLibrary, WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import DeliverableExperienceCandidate

    client = client_for_user("u-1")
    created = _create(client, professional_catalog, key="experience-create").json()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None
    version = generation_db.get(WorkArtifactVersion, artifact.current_version_id)
    assert version is not None
    artifact.lifecycle_status = "delivered"
    artifact.delivered_version_id = version.id
    generation_db.commit()

    body = {
        "row_version": artifact.row_version,
        "version_uuid": version.uuid,
        "content_hash": version.content_hash,
        "candidate_type": "rule",
        "deidentified_summary": "正式成果提交前，应先完成事实证据和敏感信息复核。",
    }
    submitted = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/experience-candidates",
        headers={"Idempotency-Key": "experience-submit"},
        json=body,
    )

    assert submitted.status_code == 201, submitted.text
    payload = submitted.json()["candidate"]
    assert payload["candidate_type"] == "rule"
    assert payload["status"] == "pending_review"
    assert payload["source_scope_type"] == "personal"
    assert payload["source_project_uuid"] is None
    assert payload["version_uuid"] == version.uuid
    assert payload["content_hash"] == version.content_hash
    assert payload["deidentified_summary"] == body["deidentified_summary"]

    replay = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/experience-candidates",
        headers={"Idempotency-Key": "experience-submit"},
        json=body,
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["candidate"]["candidate_uuid"] == payload["candidate_uuid"]

    stale = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/experience-candidates",
        headers={"Idempotency-Key": "experience-stale"},
        json={**body, "content_hash": "0" * 64},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "EXPERIENCE_CANDIDATE_TARGET_STALE"

    sensitive = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/experience-candidates",
        headers={"Idempotency-Key": "experience-sensitive"},
        json={**body, "deidentified_summary": "联系 user@example.com 复核规则。"},
    )
    assert sensitive.status_code == 422
    assert (
        sensitive.json()["detail"]["code"]
        == "EXPERIENCE_CANDIDATE_NOT_DEIDENTIFIED"
    )

    candidate = generation_db.scalar(select(DeliverableExperienceCandidate))
    assert candidate is not None
    assert body["deidentified_summary"].encode() not in candidate.payload_ciphertext
    decrypted = ContentCipher(get_settings().content_encryption_key).decrypt_json(
        EncryptedPayload(candidate.payload_ciphertext, candidate.payload_nonce),
        candidate.uuid.encode("utf-8"),
    )
    assert decrypted == {"deidentified_summary": body["deidentified_summary"]}
    assert generation_db.scalar(select(func.count(DeliverableExperienceCandidate.id))) == 1
    assert generation_db.scalar(select(func.count(ExperienceLibrary.id))) == 0
    assert generation_db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action
            == "professional_deliverable.experience_candidate.create"
        )
    ) == 1


def test_personal_deliverable_is_hidden_from_other_users(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    outsider = client_for_user("u-2")
    created = _create(owner, professional_catalog).json()

    owner_list = owner.get("/api/ai/deliverables")
    assert owner_list.status_code == 200
    assert [item["deliverable_uuid"] for item in owner_list.json()["items"]] == [
        created["deliverable_uuid"]
    ]
    outsider_list = outsider.get("/api/ai/deliverables")
    assert outsider_list.status_code == 200
    assert outsider_list.json()["items"] == []
    assert outsider.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}"
    ).status_code == 404


def test_project_deliverable_uses_membership_instead_of_creator_ownership(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "安全运营项目", "description": "月度服务"},
    ).json()
    assert owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "member"},
    ).status_code == 201

    response = _create(
        owner,
        professional_catalog,
        key="create-project-monthly-report",
        scope_type="project",
        formality="formal",
        project_uuid=project["project_uuid"],
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["project_uuid"] == project["project_uuid"]
    member_detail = member.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}"
    )
    assert member_detail.status_code == 200
    assert member_detail.json()["allowed_actions"] == [
        "edit",
        "update_metadata",
        "create_version",
        "manage_facts",
        "reply_comment",
        "export",
    ]
    assert [
        item["deliverable_uuid"]
        for item in member.get("/api/ai/deliverables").json()["items"]
    ] == [created["deliverable_uuid"]]
    assert outsider.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}"
    ).status_code == 404
    assert outsider.get("/api/ai/deliverables").json()["items"] == []


def test_read_only_project_member_cannot_create_deliverable(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    read_only = client_for_user("u-2")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "只读项目", "description": ""},
    ).json()
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "read_only"},
    )

    response = _create(
        read_only,
        professional_catalog,
        key="read-only-create",
        scope_type="project",
        project_uuid=project["project_uuid"],
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "PROJECT_DELIVERABLE_WRITE_FORBIDDEN"


def test_create_rejects_missing_idempotency_key_and_invalid_catalog_or_content(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.models import WorkArtifact

    client = client_for_user("u-1")
    missing_key = client.post(
        "/api/ai/deliverables",
        json=_create_body(professional_catalog),
    )
    assert missing_key.status_code == 400
    assert missing_key.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    professional_catalog.skill_version.status = "retired"
    generation_db.commit()
    unavailable = _create(client, professional_catalog, key="unavailable-skill")
    assert unavailable.status_code == 422
    assert unavailable.json()["detail"]["code"] == "SKILL_VERSION_NOT_AVAILABLE"
    professional_catalog.skill_version.status = "published"
    generation_db.commit()

    invalid_content = {
        "schema_version": "1",
        "blocks": [
            {"block_id": "duplicate", "type": "paragraph", "text": "一"},
            {"block_id": "duplicate", "type": "paragraph", "text": "二"},
        ],
    }
    invalid = _create(
        client,
        professional_catalog,
        key="invalid-content",
        content=invalid_content,
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "INVALID_DELIVERABLE_CONTENT"
    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == 0


def test_skill_scope_policy_is_enforced(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "项目", "description": ""},
    ).json()
    professional_catalog.skill.scope_policy = "personal"
    generation_db.commit()

    response = _create(
        owner,
        professional_catalog,
        key="wrong-scope",
        scope_type="project",
        project_uuid=project["project_uuid"],
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "SKILL_SCOPE_MISMATCH"


def test_audit_failure_rolls_back_deliverable_version_and_idempotency(
    client_for_user,
    generation_db,
    professional_catalog,
    monkeypatch,
) -> None:
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery import routes
    from app.professional_delivery.models import DeliverableIdempotencyRecord

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(routes, "write_request_audit", fail_audit)
    client = client_for_user("u-1")
    with pytest.raises(RuntimeError, match="audit unavailable"):
        _create(client, professional_catalog, key="audit-failure")

    assert generation_db.scalar(select(func.count(WorkArtifact.id))) == 0
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 0
    assert generation_db.scalar(select(func.count(DeliverableIdempotencyRecord.id))) == 0


def test_create_deliverable_version_is_immutable_encrypted_audited_and_idempotent(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher, EncryptedPayload
    from app.governance_models import AuditLog
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import DeliverableIdempotencyRecord

    client = client_for_user("u-1")
    created = _create(client, professional_catalog).json()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None
    original = generation_db.get(WorkArtifactVersion, artifact.current_version_id)
    assert original is not None
    original_state = (
        original.content_ciphertext,
        original.content_nonce,
        original.content_hash,
        original.title_snapshot,
        original.summary_snapshot,
    )

    response = _create_version(client, created["deliverable_uuid"])

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["deliverable_uuid"] == created["deliverable_uuid"]
    assert payload["version"]["version_no"] == 2
    assert payload["version"]["parent_version_uuid"] == original.uuid
    assert payload["version"]["skill_version_uuid"] == professional_catalog.skill_version.uuid
    assert payload["version"]["template_version_uuid"] == professional_catalog.template_version.uuid
    assert payload["version"]["content"] == UPDATED_CONTENT
    assert payload["version"]["change_summary"] == "补充巡检和整改情况"
    assert payload["version"]["creation_reason"] == "manual_edit"
    assert payload["version"]["content_hash"] != original.content_hash

    replay = _create_version(client, created["deliverable_uuid"])
    assert replay.status_code == 201, replay.text
    assert replay.json()["version"] == payload["version"]

    generation_db.refresh(artifact)
    versions = list(
        generation_db.scalars(
            select(WorkArtifactVersion)
            .where(WorkArtifactVersion.artifact_id == artifact.id)
            .order_by(WorkArtifactVersion.version)
        )
    )
    assert len(versions) == 2
    assert (
        versions[0].content_ciphertext,
        versions[0].content_nonce,
        versions[0].content_hash,
        versions[0].title_snapshot,
        versions[0].summary_snapshot,
    ) == original_state
    assert versions[1].parent_version_id == versions[0].id
    assert versions[1].content_ciphertext
    assert UPDATED_CONTENT["blocks"][0]["text"].encode() not in versions[1].content_ciphertext
    decrypted = ContentCipher(get_settings().content_encryption_key).decrypt_json(
        EncryptedPayload(versions[1].content_ciphertext, versions[1].content_nonce),
        versions[1].uuid.encode("utf-8"),
    )
    assert decrypted == UPDATED_CONTENT
    assert artifact.version == 2
    assert artifact.current_version_id == versions[1].id
    assert artifact.row_version == 2
    assert artifact.lifecycle_status == "draft"
    assert generation_db.scalar(select(func.count(DeliverableIdempotencyRecord.id))) == 2
    audits = list(
        generation_db.scalars(
            select(AuditLog).where(
                AuditLog.action == "professional_deliverable.version.create"
            )
        )
    )
    assert len(audits) == 1
    assert audits[0].metadata_json == {
        "event": "deliverable_version_created",
        "from_version": 1,
        "to_version": 2,
        "status": "draft",
    }


def test_version_idempotency_replay_returns_original_version_after_later_write(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.models import WorkArtifactVersion

    client = client_for_user("u-1")
    created = _create(client, professional_catalog).json()
    first = _create_version(
        client,
        created["deliverable_uuid"],
        key="original-v2-write",
    )
    assert first.status_code == 201, first.text
    first_version = first.json()["version"]

    later_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "overview",
                "type": "paragraph",
                "text": "第三版月报正文",
            }
        ],
    }
    later = _create_version(
        client,
        created["deliverable_uuid"],
        key="later-v3-write",
        row_version=2,
        content=later_content,
        change_summary="形成第三版",
    )
    assert later.status_code == 201, later.text
    assert later.json()["version"]["version_no"] == 3

    replay = _create_version(
        client,
        created["deliverable_uuid"],
        key="original-v2-write",
    )

    assert replay.status_code == 201, replay.text
    assert replay.json()["version"] == first_version
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 3


def test_create_deliverable_version_rejects_stale_row_and_idempotency_reuse(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.models import WorkArtifactVersion

    client = client_for_user("u-1")
    created = _create(client, professional_catalog).json()
    first = _create_version(client, created["deliverable_uuid"])
    assert first.status_code == 201, first.text

    stale = _create_version(
        client,
        created["deliverable_uuid"],
        key="stale-version-write",
        row_version=1,
        change_summary="过期客户端写入",
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == {
        "code": "DELIVERABLE_VERSION_CONFLICT",
        "message": "成果已被其他操作更新，请刷新后重试",
        "current_row_version": 2,
        "current_version_no": 2,
    }

    reused = _create_version(
        client,
        created["deliverable_uuid"],
        key="create-monthly-report-v2",
        row_version=2,
        change_summary="用相同幂等键提交不同请求",
    )
    assert reused.status_code == 409
    assert reused.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 2


def test_project_deliverable_version_requires_active_writer_membership(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    read_only = client_for_user("u-3")
    outsider = client_for_user("u-4")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "版本权限项目", "description": ""},
    ).json()
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-3", "role": "read_only"},
    )
    created = _create(
        owner,
        professional_catalog,
        key="create-project-version-report",
        scope_type="project",
        formality="formal",
        project_uuid=project["project_uuid"],
    ).json()

    forbidden = _create_version(
        read_only,
        created["deliverable_uuid"],
        key="read-only-version-write",
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "PROJECT_DELIVERABLE_WRITE_FORBIDDEN"
    assert _create_version(
        outsider,
        created["deliverable_uuid"],
        key="outsider-version-write",
    ).status_code == 404

    allowed = _create_version(
        member,
        created["deliverable_uuid"],
        key="member-version-write",
    )
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["version"]["version_no"] == 2


def test_create_revision_preserves_delivery_milestones_and_audit_failure_rolls_back(
    client_for_user,
    generation_db,
    professional_catalog,
    monkeypatch,
) -> None:
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery import routes
    from app.professional_delivery.models import DeliverableIdempotencyRecord

    client = client_for_user("u-1")
    created = _create(client, professional_catalog).json()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None
    delivered_version_id = artifact.current_version_id
    artifact.lifecycle_status = "delivered"
    artifact.approved_version_id = delivered_version_id
    artifact.delivered_version_id = delivered_version_id
    generation_db.commit()

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(routes, "write_request_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        _create_version(
            client,
            created["deliverable_uuid"],
            key="revision-audit-failure",
        )

    generation_db.refresh(artifact)
    assert artifact.lifecycle_status == "delivered"
    assert artifact.row_version == 1
    assert artifact.current_version_id == delivered_version_id
    assert artifact.approved_version_id == delivered_version_id
    assert artifact.delivered_version_id == delivered_version_id
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 1
    assert generation_db.scalar(select(func.count(DeliverableIdempotencyRecord.id))) == 1


def test_delivered_deliverable_can_create_revision_without_overwriting_milestones(
    client_for_user,
    generation_db,
    professional_catalog,
) -> None:
    from app.models import WorkArtifact, WorkArtifactVersion

    client = client_for_user("u-1")
    created = _create(client, professional_catalog).json()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None
    delivered_version_id = artifact.current_version_id
    artifact.lifecycle_status = "delivered"
    artifact.approved_version_id = delivered_version_id
    artifact.delivered_version_id = delivered_version_id
    generation_db.commit()

    response = _create_version(
        client,
        created["deliverable_uuid"],
        key="delivered-revision-success",
    )

    assert response.status_code == 201, response.text
    assert response.json()["version"]["version_no"] == 2
    generation_db.refresh(artifact)
    assert artifact.lifecycle_status == "draft"
    assert artifact.current_version_id != delivered_version_id
    assert artifact.approved_version_id == delivered_version_id
    assert artifact.delivered_version_id == delivered_version_id
    assert generation_db.scalar(select(func.count(WorkArtifactVersion.id))) == 2


def test_version_history_is_paginated_and_exact_version_restores_immutable_content(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    outsider = client_for_user("u-2")
    created = _create(owner, professional_catalog).json()
    version_1 = created["current_version"]
    version_2_response = _create_version(owner, created["deliverable_uuid"])
    assert version_2_response.status_code == 201, version_2_response.text
    version_2 = version_2_response.json()["version"]
    version_3_response = _create_version(
        owner,
        created["deliverable_uuid"],
        key="history-v3",
        row_version=2,
        content={
            "schema_version": "1",
            "blocks": [
                {
                    "block_id": "monthly-overview",
                    "type": "paragraph",
                    "text": "第三版月报正文",
                }
            ],
        },
        change_summary="形成第三版",
    )
    assert version_3_response.status_code == 201, version_3_response.text
    version_3 = version_3_response.json()["version"]

    first_page = owner.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions",
        params={"page": 1, "page_size": 2},
    )
    assert first_page.status_code == 200, first_page.text
    history = first_page.json()
    assert history["request_id"]
    assert history["deliverable_uuid"] == created["deliverable_uuid"]
    assert history["total"] == 3
    assert history["page"] == 1
    assert history["page_size"] == 2
    assert [item["version_no"] for item in history["items"]] == [3, 2]
    assert history["items"][0]["is_current"] is True
    assert history["items"][1]["is_current"] is False
    assert "content" not in history["items"][0]

    second_page = owner.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions",
        params={"page": 2, "page_size": 2},
    )
    assert second_page.status_code == 200, second_page.text
    assert [item["version_no"] for item in second_page.json()["items"]] == [1]

    exact = owner.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}"
        f"/versions/{version_1['version_uuid']}"
    )
    assert exact.status_code == 200, exact.text
    exact_payload = exact.json()
    assert exact_payload["request_id"]
    assert exact_payload["deliverable_uuid"] == created["deliverable_uuid"]
    assert exact_payload["version"] == version_1
    assert exact_payload["version"]["content"] == CONTENT
    assert exact_payload["version"]["content_hash"] != version_2["content_hash"]
    assert exact_payload["version"]["content_hash"] != version_3["content_hash"]

    other = _create(
        owner,
        professional_catalog,
        key="other-deliverable-for-version-injection",
        title="另一个成果",
    ).json()
    injected = owner.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}"
        f"/versions/{other['current_version']['version_uuid']}"
    )
    assert injected.status_code == 404
    assert injected.json()["detail"]["code"] == "DELIVERABLE_VERSION_NOT_FOUND"
    assert outsider.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions"
    ).status_code == 404


def test_structured_version_diff_tracks_paragraph_table_added_and_removed_blocks(
    client_for_user,
    professional_catalog,
) -> None:
    client = client_for_user("u-1")
    base_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "overview",
                "type": "paragraph",
                "text": "本月发现两项风险。",
            },
            {
                "block_id": "risk-table",
                "type": "table",
                "rows": [
                    {"row_id": "risk-1", "cells": ["主机风险", "处理中"]},
                ],
            },
            {
                "block_id": "legacy-note",
                "type": "paragraph",
                "text": "旧版临时说明。",
            },
        ],
    }
    updated_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "overview",
                "type": "paragraph",
                "text": "本月发现两项风险，均已闭环。",
            },
            {
                "block_id": "risk-table",
                "type": "table",
                "rows": [
                    {"row_id": "risk-1", "cells": ["主机风险", "已关闭"]},
                    {"row_id": "risk-2", "cells": ["账号风险", "已关闭"]},
                ],
            },
            {
                "block_id": "monthly-actions",
                "type": "paragraph",
                "text": "完成两项整改。",
            },
        ],
    }
    created = _create(
        client,
        professional_catalog,
        key="create-diff-report",
        content=base_content,
    ).json()
    version_1_uuid = created["current_version"]["version_uuid"]
    version_2_response = _create_version(
        client,
        created["deliverable_uuid"],
        key="create-diff-report-v2",
        content=updated_content,
        change_summary="闭环风险并删除临时说明",
    )
    assert version_2_response.status_code == 201, version_2_response.text
    version_2_uuid = version_2_response.json()["version"]["version_uuid"]

    response = client.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/diff",
        params={"from": version_1_uuid, "to": version_2_uuid},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["request_id"]
    assert payload["deliverable_uuid"] == created["deliverable_uuid"]
    assert payload["from_version_uuid"] == version_1_uuid
    assert payload["from_version_no"] == 1
    assert payload["to_version_uuid"] == version_2_uuid
    assert payload["to_version_no"] == 2
    assert payload["summary"] == {
        "added_blocks": 1,
        "removed_blocks": 1,
        "modified_blocks": 2,
        "unchanged_blocks": 0,
    }
    assert [change["block_id"] for change in payload["changes"]] == [
        "overview",
        "risk-table",
        "monthly-actions",
        "legacy-note",
    ]
    changes = {change["block_id"]: change for change in payload["changes"]}
    assert changes["overview"]["change_type"] == "modified"
    assert changes["overview"]["field_changes"] == [
        {
            "path": "/text",
            "change_type": "modified",
            "before": "本月发现两项风险。",
            "after": "本月发现两项风险，均已闭环。",
        }
    ]
    assert changes["risk-table"]["change_type"] == "modified"
    assert {
        change["path"] for change in changes["risk-table"]["field_changes"]
    } == {"/rows/0/cells/1", "/rows/1"}
    assert changes["monthly-actions"]["change_type"] == "added"
    assert changes["monthly-actions"]["before"] is None
    assert changes["legacy-note"]["change_type"] == "removed"
    assert changes["legacy-note"]["after"] is None


def test_project_version_reads_allow_read_only_member_and_hide_from_outsider(
    client_for_user,
    professional_catalog,
) -> None:
    owner = client_for_user("u-1")
    read_only = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "版本读取隔离项目", "description": ""},
    ).json()
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "read_only"},
    )
    created = _create(
        owner,
        professional_catalog,
        key="create-project-version-read-report",
        scope_type="project",
        formality="formal",
        project_uuid=project["project_uuid"],
    ).json()
    version_uuid = created["current_version"]["version_uuid"]
    history_path = f"/api/ai/deliverables/{created['deliverable_uuid']}/versions"
    version_path = f"{history_path}/{version_uuid}"
    diff_path = f"/api/ai/deliverables/{created['deliverable_uuid']}/diff"

    assert read_only.get(history_path).status_code == 200
    assert read_only.get(version_path).status_code == 200
    assert read_only.get(
        diff_path,
        params={"from": version_uuid, "to": version_uuid},
    ).status_code == 200

    assert outsider.get(history_path).status_code == 404
    assert outsider.get(version_path).status_code == 404
    assert outsider.get(
        diff_path,
        params={"from": version_uuid, "to": version_uuid},
    ).status_code == 404
