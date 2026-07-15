import base64
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select


FACT_CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "claim",
            "claim_type": "fact",
            "critical": True,
            "text": "关键系统可用率为 99.95%。",
        },
        {
            "block_id": "monthly-actions",
            "type": "paragraph",
            "text": "已完成月度巡检。",
        },
    ],
}


@pytest.fixture
def professional_fact_catalog(generation_db):
    from app.professional_delivery.models import (
        SkillDefinition,
        SkillVersion,
        TemplateDefinition,
        TemplateVersion,
    )

    skill = SkillDefinition(
        skill_key="facts_evidence_monthly_report",
        name="事实证据月报",
        category="security_operations",
        description="验证事实与证据链",
        scope_policy="both",
        status="published",
        created_by="system",
    )
    template = TemplateDefinition(
        template_key="facts_evidence_monthly_report",
        name="事实证据月报模板",
        purpose="验证事实与证据链",
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
        fact_policy_json={
            "critical_numbers_require_source": True,
            "human_confirmation_required": False,
        },
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
def professional_fact_quality_rules(generation_db, professional_fact_catalog):
    from app.professional_delivery.models import (
        QualityRuleDefinition,
        QualityRuleVersion,
    )

    definitions = [
        (
            "structure_contract",
            "required_blocks",
            {"required_block_ids": ["monthly-overview"]},
            "blocker",
            True,
        ),
        (
            "facts_evidence",
            "fact_status_gate",
            {
                "blocked_statuses": [
                    "pending_confirmation",
                    "unsupported",
                    "conflicted",
                    "stale",
                ],
                "critical_only": True,
            },
            "blocker",
            True,
        ),
        ("project_scope", "project_scope_gate", {}, "blocker", True),
        ("consistency", "declared_count_gate", {}, "error", True),
        (
            "professional_rules",
            "required_blocks",
            {"required_block_ids": ["monthly-actions"]},
            "warning",
            False,
        ),
        (
            "format_expression",
            "required_block_fields",
            {"required_fields": ["block_id", "type"]},
            "error",
            True,
        ),
        (
            "sensitive_security",
            "forbidden_literals",
            {"literals": ["password=", "密码："]},
            "blocker",
            True,
        ),
    ]
    versions = []
    for index, (category, evaluator, config, severity, blocking) in enumerate(
        definitions,
        start=1,
    ):
        rule = QualityRuleDefinition(
            rule_key=f"facts-evidence.{category}",
            name=category,
            category=category,
            description=f"{category} 确定性检查",
            status="published",
            created_by="system",
        )
        generation_db.add(rule)
        generation_db.flush()
        version = QualityRuleVersion(
            rule_id=rule.id,
            version=1,
            content_hash=f"{index:064x}",
            evaluator_type=evaluator,
            config_json=config,
            severity=severity,
            blocking=blocking,
            status="published",
            published_by="system",
            published_at=datetime(2026, 7, 14, 10, 0, 0),
            created_by="system",
        )
        generation_db.add(version)
        generation_db.flush()
        rule.current_published_version_id = version.id
        versions.append(version)

    professional_fact_catalog.skill_version.quality_policy_ids_json = [
        version.id for version in versions
    ]
    generation_db.commit()
    return versions


@pytest.fixture
def professional_fact_approval_flow(generation_db):
    from app.professional_delivery.models import (
        ApprovalFlowDefinition,
        ApprovalFlowVersion,
    )

    flow = ApprovalFlowDefinition(
        flow_key="facts_evidence_personal",
        name="事实证据个人审批流",
        scope_policy="personal",
        deliverable_types_json=["security_ops_monthly_report"],
        status="published",
        created_by="system",
    )
    generation_db.add(flow)
    generation_db.flush()
    version = ApprovalFlowVersion(
        flow_id=flow.id,
        version=1,
        content_hash="f" * 64,
        steps_json=[{"step_key": "final_approval", "roles": ["owner"]}],
        min_approvals=1,
        allow_author_approve=True,
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
    generation_db.commit()
    return version


def _create_deliverable(client, catalog, *, key: str, **overrides):
    body = {
        "title": "2026 年 7 月事实证据月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": "personal",
        "formality": "formal",
        "skill_version_uuid": catalog.skill_version.uuid,
        "template_version_uuid": catalog.template_version.uuid,
        "content": FACT_CONTENT,
        "content_summary": "关键系统可用率",
        "creation_reason": "manual",
    }
    body.update(overrides)
    return client.post(
        "/api/ai/deliverables",
        headers={"Idempotency-Key": key},
        json=body,
    )


def _extract_facts(client, created: dict, *, key: str):
    return client.post(
        "/api/ai/deliverables/"
        f"{created['deliverable_uuid']}/versions/"
        f"{created['current_version']['version_uuid']}/facts/extract",
        headers={"Idempotency-Key": key},
        json={"content_hash": created["current_version"]["content_hash"]},
    )


def _add_knowledge_chunk(
    generation_db,
    *,
    owner_user_id: str,
    file_uuid: str,
    chunk_id: str,
    content: str,
    content_hash: str,
    page_number: int,
    section_title: str,
):
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.models import KnowledgeChunk, KnowledgeFile

    knowledge_file = KnowledgeFile(
        uuid=file_uuid,
        sso_user_id=owner_user_id,
        owner_user_id=owner_user_id,
        file_name=f"{file_uuid}.pdf",
        original_file_name=f"{file_uuid}.pdf",
        file_type="application/pdf",
        file_size=1024,
        content_sha256=content_hash,
        version=1,
        is_current_version=True,
        reference_enabled=True,
        permission_scope="private",
        visibility="PRIVATE",
        status="READY",
        key_version="v1",
        uploaded_by=owner_user_id,
    )
    generation_db.add(knowledge_file)
    generation_db.flush()
    encrypted = ContentCipher(get_settings().content_encryption_key).encrypt_json(
        {"text": content},
        chunk_id.encode("utf-8"),
    )
    chunk = KnowledgeChunk(
        chunk_id=chunk_id,
        file_id=knowledge_file.id,
        file_name=knowledge_file.file_name,
        chunk_text_ciphertext=encrypted.ciphertext,
        chunk_text_nonce=encrypted.nonce,
        page_number=page_number,
        section_title=section_title,
        chunk_index=0,
        token_estimate=20,
        token_count=20,
        metadata_json={},
        status="READY",
    )
    generation_db.add(chunk)
    generation_db.flush()
    return knowledge_file, chunk


def _prepare_supported_personal_deliverable(
    client,
    generation_db,
    catalog,
    *,
    key_prefix: str,
):
    created_response = _create_deliverable(
        client,
        catalog,
        key=f"{key_prefix}-create",
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted_response = _extract_facts(
        client,
        created,
        key=f"{key_prefix}-extract",
    )
    assert extracted_response.status_code == 201, extracted_response.text
    fact = next(
        item for item in extracted_response.json()["items"] if item["critical"]
    )
    knowledge_file, chunk = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid=f"{key_prefix}-knowledge",
        chunk_id=f"{key_prefix}-chunk",
        content="监控平台统计关键系统可用率为 99.95%。",
        content_hash="e" * 64,
        page_number=5,
        section_title="可用率统计",
    )
    generation_db.commit()
    linked = client.post(
        f"/api/ai/facts/{fact['fact_uuid']}/evidence",
        headers={"Idempotency-Key": f"{key_prefix}-link"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": chunk.chunk_id,
        },
    )
    assert linked.status_code == 201, linked.text
    reviewed = client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": f"{key_prefix}-review"},
        json={
            "row_version": created["row_version"],
            "version_uuid": created["current_version"]["version_uuid"],
            "content_hash": created["current_version"]["content_hash"],
        },
    )
    assert reviewed.status_code == 201, reviewed.text
    assert reviewed.json()["review"]["gates_passed"] is True
    return SimpleNamespace(
        created=created,
        fact=fact,
        knowledge_file=knowledge_file,
        chunk=chunk,
        reviewed=reviewed.json(),
    )


def _assert_source_invalidation_persisted(
    generation_db,
    prepared,
    *,
    expected_row_version: int,
    approval_cleared: bool = False,
) -> None:
    from app.governance_models import AuditLog
    from app.models import WorkArtifact
    from app.professional_delivery.models import DeliverableEvidence, DeliverableFact

    generation_db.expire_all()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == prepared.created["deliverable_uuid"]
        )
    )
    fact = generation_db.scalar(
        select(DeliverableFact).where(
            DeliverableFact.uuid == prepared.fact["fact_uuid"]
        )
    )
    evidence = generation_db.scalar(
        select(DeliverableEvidence).where(
            DeliverableEvidence.source_uuid == prepared.chunk.chunk_id,
            DeliverableEvidence.deliverable_id == artifact.id,
        )
    )
    audit = generation_db.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "professional_deliverable.evidence.invalidate",
            AuditLog.entity_uuid == artifact.uuid,
        )
        .order_by(AuditLog.id.desc())
    )

    assert evidence.status == "stale"
    assert evidence.stale_reason == "source_content_changed"
    assert fact.status == "stale"
    assert artifact.lifecycle_status == "changes_requested"
    assert artifact.row_version == expected_row_version
    if approval_cleared:
        assert artifact.approved_version_id is None
        assert artifact.approved_content_hash == ""
    assert audit is not None
    assert audit.result == "SUCCESS"


def test_extract_facts_is_exact_version_encrypted_and_idempotent(
    client_for_user,
    generation_db,
    professional_fact_catalog,
) -> None:
    from app.professional_delivery.models import DeliverableFact

    owner = client_for_user("u-1")
    outsider = client_for_user("u-2")
    created_response = _create_deliverable(
        owner,
        professional_fact_catalog,
        key="create-fact-extraction",
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()

    extracted = _extract_facts(owner, created, key="extract-facts-v1")

    assert extracted.status_code == 201, extracted.text
    payload = extracted.json()
    assert payload["deliverable_uuid"] == created["deliverable_uuid"]
    assert payload["version_uuid"] == created["current_version"]["version_uuid"]
    assert payload["content_hash"] == created["current_version"]["content_hash"]
    assert payload["total"] == 2
    critical = next(item for item in payload["items"] if item["critical"])
    assert critical["block_id"] == "monthly-overview"
    assert critical["claim_type"] == "fact"
    assert critical["claim_text"] == "关键系统可用率为 99.95%。"
    assert critical["status"] == "pending_confirmation"
    assert critical["source_required"] is True
    assert critical["row_version"] == 1

    replay = _extract_facts(owner, created, key="extract-facts-v1")
    assert replay.status_code == 201, replay.text
    assert [item["fact_uuid"] for item in replay.json()["items"]] == [
        item["fact_uuid"] for item in payload["items"]
    ]

    fact_rows = list(
        generation_db.scalars(
            select(DeliverableFact).order_by(DeliverableFact.block_id.asc())
        )
    )
    assert len(fact_rows) == 2
    assert all(row.claim_ciphertext for row in fact_rows)
    assert all(
        row.claim_hash and row.deliverable_content_hash == payload["content_hash"]
        for row in fact_rows
    )
    assert all(
        row.claim_ciphertext.find(b"99.95") == -1
        for row in fact_rows
    )

    list_path = (
        "/api/ai/deliverables/"
        f"{created['deliverable_uuid']}/versions/"
        f"{created['current_version']['version_uuid']}/facts"
    )
    assert owner.get(list_path).status_code == 200
    assert outsider.get(list_path).status_code == 404


def test_new_version_inherits_only_unchanged_facts_and_their_evidence(
    client_for_user,
    generation_db,
    professional_fact_catalog,
) -> None:
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import (
        DeliverableEvidence,
        DeliverableFact,
        FactEvidenceLink,
    )

    owner = client_for_user("u-1")
    created_response = _create_deliverable(
        owner,
        professional_fact_catalog,
        key="create-version-inheritance",
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted_response = _extract_facts(
        owner,
        created,
        key="extract-version-inheritance",
    )
    assert extracted_response.status_code == 201, extracted_response.text
    original_fact = next(
        item for item in extracted_response.json()["items"] if item["critical"]
    )
    _, chunk = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="version-inheritance-knowledge",
        chunk_id="version-inheritance-chunk",
        content="监控平台统计关键系统可用率为 99.95%。",
        content_hash="9" * 64,
        page_number=8,
        section_title="月度可用率",
    )
    generation_db.commit()
    linked_response = owner.post(
        f"/api/ai/facts/{original_fact['fact_uuid']}/evidence",
        headers={"Idempotency-Key": "link-version-inheritance"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": chunk.chunk_id,
        },
    )
    assert linked_response.status_code == 201, linked_response.text
    original_evidence = linked_response.json()["evidence"]

    changed_actions_content = {
        **FACT_CONTENT,
        "blocks": [
            dict(FACT_CONTENT["blocks"][0]),
            {
                **FACT_CONTENT["blocks"][1],
                "text": "已完成月度巡检并更新处置清单。",
            },
        ],
    }
    version_response = owner.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions",
        headers={"Idempotency-Key": "create-inherited-version"},
        json={
            "row_version": created["row_version"],
            "parent_version_uuid": created["current_version"]["version_uuid"],
            "content": changed_actions_content,
            "content_summary": "保留不变事实并更新处置清单",
            "change_summary": "更新月度处置清单",
            "creation_reason": "manual_edit",
        },
    )
    assert version_response.status_code == 201, version_response.text
    inherited_version = version_response.json()["version"]
    facts_path = (
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions/"
        f"{inherited_version['version_uuid']}/facts"
    )
    inherited_facts_response = owner.get(facts_path)
    assert inherited_facts_response.status_code == 200, inherited_facts_response.text
    inherited_facts = inherited_facts_response.json()["items"]
    assert len(inherited_facts) == 1
    inherited_fact = inherited_facts[0]
    assert inherited_fact["fact_uuid"] != original_fact["fact_uuid"]
    assert inherited_fact["block_id"] == "monthly-overview"
    assert inherited_fact["claim_hash"] == original_fact["claim_hash"]
    assert inherited_fact["claim_text"] == original_fact["claim_text"]
    assert inherited_fact["status"] == "supported"
    assert inherited_fact["content_hash"] == inherited_version["content_hash"]

    generation_db.expire_all()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    version_row = generation_db.scalar(
        select(WorkArtifactVersion).where(
            WorkArtifactVersion.uuid == inherited_version["version_uuid"]
        )
    )
    inherited_fact_row = generation_db.scalar(
        select(DeliverableFact).where(
            DeliverableFact.uuid == inherited_fact["fact_uuid"]
        )
    )
    inherited_link = generation_db.scalar(
        select(FactEvidenceLink).where(
            FactEvidenceLink.fact_id == inherited_fact_row.id
        )
    )
    inherited_evidence = generation_db.get(
        DeliverableEvidence,
        inherited_link.evidence_id,
    )
    assert artifact is not None
    assert version_row is not None
    assert inherited_evidence is not None
    assert inherited_evidence.uuid != original_evidence["evidence_uuid"]
    assert inherited_evidence.deliverable_version_id == version_row.id
    assert inherited_evidence.source_uuid == original_evidence["source_uuid"]
    assert (
        inherited_evidence.source_content_hash
        == original_evidence["source_content_hash"]
    )
    assert inherited_evidence.quote_hash == original_evidence["quote_hash"]
    assert inherited_evidence.status == "active"
    preview = owner.get(
        f"/api/ai/evidence/{inherited_evidence.uuid}/preview"
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["evidence"]["quote"] == original_evidence["quote"]
    assert (
        preview.json()["evidence"]["version_uuid"]
        == inherited_version["version_uuid"]
    )

    changed_fact_content = {
        **changed_actions_content,
        "blocks": [
            {
                **changed_actions_content["blocks"][0],
                "text": "关键系统可用率为 99.90%。",
            },
            dict(changed_actions_content["blocks"][1]),
        ],
    }
    changed_fact_response = owner.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions",
        headers={"Idempotency-Key": "create-changed-fact-version"},
        json={
            "row_version": artifact.row_version,
            "parent_version_uuid": inherited_version["version_uuid"],
            "content": changed_fact_content,
            "content_summary": "修改关键事实",
            "change_summary": "修正关键系统可用率",
            "creation_reason": "manual_edit",
        },
    )
    assert changed_fact_response.status_code == 201, changed_fact_response.text
    changed_fact_version = changed_fact_response.json()["version"]
    changed_fact_list = owner.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/versions/"
        f"{changed_fact_version['version_uuid']}/facts"
    )
    assert changed_fact_list.status_code == 200, changed_fact_list.text
    assert changed_fact_list.json()["items"] == []


def test_project_evidence_search_and_link_are_scoped_and_precisely_located(
    client_for_user,
    generation_db,
    professional_fact_catalog,
) -> None:
    from app.project_context_models import ProjectFile
    from app.project_workspace_models import Project
    from app.professional_delivery.models import DeliverableEvidence

    owner = client_for_user("u-1")
    project_a = owner.post(
        "/api/ai/projects",
        json={"name": "项目 A", "description": "证据范围 A"},
    ).json()
    project_b = owner.post(
        "/api/ai/projects",
        json={"name": "项目 B", "description": "证据范围 B"},
    ).json()
    created_response = _create_deliverable(
        owner,
        professional_fact_catalog,
        key="create-project-facts",
        scope_type="project",
        project_uuid=project_a["project_uuid"],
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted = _extract_facts(owner, created, key="extract-project-facts").json()
    fact = next(item for item in extracted["items"] if item["critical"])

    file_a, chunk_a = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="knowledge-project-a",
        chunk_id="chunk-project-a",
        content="监控平台统计关键系统可用率为 99.95%。",
        content_hash="a" * 64,
        page_number=12,
        section_title="资产统计",
    )
    file_b, chunk_b = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="knowledge-project-b",
        chunk_id="chunk-project-b",
        content="项目 B 的关键系统可用率为 88%。",
        content_hash="b" * 64,
        page_number=3,
        section_title="项目 B 统计",
    )
    project_a_row = generation_db.scalar(
        select(Project).where(Project.uuid == project_a["project_uuid"])
    )
    project_b_row = generation_db.scalar(
        select(Project).where(Project.uuid == project_b["project_uuid"])
    )
    generation_db.add_all(
        [
            ProjectFile(
                project_id=project_a_row.id,
                knowledge_file_id=file_a.id,
                category="项目资料",
                status="active",
                linked_by="u-1",
            ),
            ProjectFile(
                project_id=project_b_row.id,
                knowledge_file_id=file_b.id,
                category="项目资料",
                status="active",
                linked_by="u-1",
            ),
        ]
    )
    generation_db.commit()

    search_response = owner.get(
        "/api/ai/evidence/search",
        params={
            "deliverable_uuid": created["deliverable_uuid"],
            "version_uuid": created["current_version"]["version_uuid"],
            "q": "可用率",
        },
    )
    assert search_response.status_code == 200, search_response.text
    candidates = search_response.json()["items"]
    assert [item["source_uuid"] for item in candidates] == [chunk_a.chunk_id]
    assert candidates[0]["location"] == {
        "file_name": file_a.file_name,
        "page_number": 12,
        "sheet_name": "",
        "cell_range": "",
        "section_title": "资产统计",
        "paragraph_index": None,
        "chunk_id": chunk_a.chunk_id,
    }

    attach_path = f"/api/ai/facts/{fact['fact_uuid']}/evidence"
    cross_project = owner.post(
        attach_path,
        headers={"Idempotency-Key": "link-cross-project-evidence"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": chunk_b.chunk_id,
        },
    )
    assert cross_project.status_code == 422
    assert cross_project.json()["detail"]["code"] == (
        "EVIDENCE_SOURCE_SCOPE_MISMATCH"
    )

    linked = owner.post(
        attach_path,
        headers={"Idempotency-Key": "link-project-a-evidence"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": chunk_a.chunk_id,
        },
    )
    assert linked.status_code == 201, linked.text
    linked_payload = linked.json()
    assert linked_payload["fact"]["status"] == "supported"
    assert linked_payload["link"]["relation"] == "supports"
    evidence = linked_payload["evidence"]
    assert evidence["source_content_hash"] == "a" * 64
    assert evidence["quote"] == "监控平台统计关键系统可用率为 99.95%。"
    assert evidence["status"] == "active"
    assert evidence["location"]["page_number"] == 12
    assert evidence["location"]["section_title"] == "资产统计"
    assert evidence["location"]["chunk_id"] == chunk_a.chunk_id

    evidence_row = generation_db.scalar(
        select(DeliverableEvidence).where(
            DeliverableEvidence.uuid == evidence["evidence_uuid"]
        )
    )
    assert evidence_row is not None
    assert b"99.95" not in evidence_row.quote_ciphertext

    preview = owner.get(
        f"/api/ai/evidence/{evidence['evidence_uuid']}/preview"
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["evidence"] == evidence


def test_database_evidence_gate_blocks_review_until_critical_fact_is_supported(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
) -> None:
    from app.project_context_models import ProjectFile

    client = client_for_user("u-1")
    created_response = _create_deliverable(
        client,
        professional_fact_catalog,
        key="create-evidence-gate",
        scope_type="personal",
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted = _extract_facts(client, created, key="extract-evidence-gate").json()
    fact = next(item for item in extracted["items"] if item["critical"])

    first_review = client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": "review-without-evidence"},
        json={
            "row_version": created["row_version"],
            "version_uuid": created["current_version"]["version_uuid"],
            "content_hash": created["current_version"]["content_hash"],
        },
    )
    assert first_review.status_code == 201, first_review.text
    first_payload = first_review.json()
    assert first_payload["lifecycle_status"] == "changes_requested"
    assert first_payload["review"]["gates_passed"] is False
    fact_issues = [
        issue
        for issue in first_payload["review"]["issues"]
        if issue["category"] == "facts_evidence"
    ]
    assert len(fact_issues) == 1
    assert fact_issues[0]["block_id"] == "monthly-overview"
    assert fact_issues[0]["evidence_ids"] == []

    knowledge_file, chunk = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="knowledge-personal-evidence",
        chunk_id="chunk-personal-evidence",
        content="监控平台统计关键系统可用率为 99.95%。",
        content_hash="c" * 64,
        page_number=5,
        section_title="可用率统计",
    )
    # Personal deliverables authorize the owner directly; a ProjectFile row must
    # not be required or synthesized for this source.
    assert generation_db.scalar(
        select(ProjectFile).where(ProjectFile.knowledge_file_id == knowledge_file.id)
    ) is None
    generation_db.commit()

    linked = client.post(
        f"/api/ai/facts/{fact['fact_uuid']}/evidence",
        headers={"Idempotency-Key": "link-personal-evidence"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": chunk.chunk_id,
        },
    )
    assert linked.status_code == 201, linked.text
    evidence_uuid = linked.json()["evidence"]["evidence_uuid"]

    second_review = client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": "review-with-evidence"},
        json={
            "row_version": first_payload["row_version"],
            "version_uuid": created["current_version"]["version_uuid"],
            "content_hash": created["current_version"]["content_hash"],
        },
    )
    assert second_review.status_code == 201, second_review.text
    second_payload = second_review.json()
    assert second_payload["lifecycle_status"] == "pending_approval"
    assert second_payload["review"]["gates_passed"] is True
    assert all(
        issue["category"] != "facts_evidence"
        for issue in second_payload["review"]["issues"]
    )

    revoked = client.post(
        f"/api/ai/evidence/{evidence_uuid}/revoke",
        headers={"Idempotency-Key": "revoke-personal-evidence"},
        json={"reason": "来源已撤回"},
    )
    assert revoked.status_code == 200, revoked.text
    revoked_payload = revoked.json()
    assert revoked_payload["evidence"]["status"] == "revoked"
    assert revoked_payload["lifecycle_status"] == "changes_requested"
    assert revoked_payload["row_version"] == second_payload["row_version"] + 1

    _, replacement_chunk = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="knowledge-personal-evidence-replacement",
        chunk_id="chunk-personal-evidence-replacement",
        content="复核底稿再次确认关键系统可用率为 99.95%。",
        content_hash="d" * 64,
        page_number=6,
        section_title="复核统计",
    )
    generation_db.commit()
    replacement = client.post(
        f"/api/ai/facts/{fact['fact_uuid']}/evidence",
        headers={"Idempotency-Key": "link-personal-evidence-replacement"},
        json={
            "relation": "supports",
            "source_type": "knowledge_chunk",
            "source_uuid": replacement_chunk.chunk_id,
        },
    )
    assert replacement.status_code == 201, replacement.text
    assert replacement.json()["fact"]["status"] == "supported"

    repaired_review = client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": "review-with-replacement-evidence"},
        json={
            "row_version": revoked_payload["row_version"],
            "version_uuid": created["current_version"]["version_uuid"],
            "content_hash": created["current_version"]["content_hash"],
        },
    )
    assert repaired_review.status_code == 201, repaired_review.text
    assert repaired_review.json()["review"]["gates_passed"] is True
    assert repaired_review.json()["lifecycle_status"] == "pending_approval"


def test_human_confirmation_is_evidence_and_claim_edit_invalidates_it(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
) -> None:
    from app.professional_delivery.models import (
        DeliverableEvidence,
        DeliverableFact,
        FactEvidenceLink,
    )

    client = client_for_user("u-1")
    created_response = _create_deliverable(
        client,
        professional_fact_catalog,
        key="create-human-confirmation",
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted = _extract_facts(
        client,
        created,
        key="extract-human-confirmation",
    ).json()
    fact = next(item for item in extracted["items"] if item["critical"])

    confirmed_response = client.patch(
        f"/api/ai/facts/{fact['fact_uuid']}",
        headers={"Idempotency-Key": "confirm-critical-fact"},
        json={"row_version": fact["row_version"], "status": "confirmed"},
    )
    assert confirmed_response.status_code == 200, confirmed_response.text
    confirmed = confirmed_response.json()["fact"]
    assert confirmed["status"] == "confirmed"
    assert confirmed["confirmed_by"] == "u-1"
    assert confirmed["confirmed_at"] is not None

    fact_row = generation_db.scalar(
        select(DeliverableFact).where(DeliverableFact.uuid == fact["fact_uuid"])
    )
    confirmation = generation_db.scalar(
        select(DeliverableEvidence).where(
            DeliverableEvidence.deliverable_version_id
            == fact_row.deliverable_version_id,
            DeliverableEvidence.source_type == "human_confirmation",
        )
    )
    assert confirmation is not None
    assert confirmation.source_content_hash == confirmed["claim_hash"]
    assert confirmation.captured_by == "u-1"
    assert confirmation.status == "active"
    confirmation_link = generation_db.scalar(
        select(FactEvidenceLink).where(
            FactEvidenceLink.fact_id == fact_row.id,
            FactEvidenceLink.evidence_id == confirmation.id,
        )
    )
    assert confirmation_link is not None
    assert confirmation_link.relation == "supports"
    assert confirmation_link.status == "active"

    review_response = client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": "review-human-confirmation-only"},
        json={
            "row_version": created["row_version"],
            "version_uuid": created["current_version"]["version_uuid"],
            "content_hash": created["current_version"]["content_hash"],
        },
    )
    assert review_response.status_code == 201, review_response.text
    review_payload = review_response.json()
    assert review_payload["review"]["gates_passed"] is False
    assert any(
        issue["category"] == "facts_evidence"
        and "缺少有效支持证据" in issue["message"]
        for issue in review_payload["review"]["issues"]
    )

    edited_response = client.patch(
        f"/api/ai/facts/{fact['fact_uuid']}",
        headers={"Idempotency-Key": "edit-confirmed-critical-fact"},
        json={
            "row_version": confirmed["row_version"],
            "claim_text": "关键系统可用率为 99.90%。",
        },
    )
    assert edited_response.status_code == 200, edited_response.text
    edited = edited_response.json()["fact"]
    assert edited["claim_hash"] != confirmed["claim_hash"]
    assert edited["status"] == "pending_confirmation"
    assert edited["confirmed_by"] == ""
    assert edited["confirmed_at"] is None

    generation_db.refresh(confirmation)
    generation_db.refresh(confirmation_link)
    assert confirmation.status == "stale"
    assert confirmation.stale_reason == "claim_changed"
    assert confirmation_link.status == "stale"


def test_derived_fact_uses_whitelisted_deterministic_calculator(
    client_for_user,
    generation_db,
    professional_fact_catalog,
) -> None:
    derived_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "metric-a",
                "type": "claim",
                "claim_type": "fact",
                "text": "指标 A 为 10。",
            },
            {
                "block_id": "metric-b",
                "type": "claim",
                "claim_type": "fact",
                "text": "指标 B 为 20。",
            },
            {
                "block_id": "metric-total",
                "type": "claim",
                "claim_type": "analysis",
                "text": "指标合计为 30.00。",
            },
        ],
    }
    client = client_for_user("u-1")
    created_response = _create_deliverable(
        client,
        professional_fact_catalog,
        key="create-derived-calculation",
        content=derived_content,
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    extracted = _extract_facts(
        client,
        created,
        key="extract-derived-calculation",
    ).json()
    facts_by_block = {item["block_id"]: item for item in extracted["items"]}
    target = facts_by_block["metric-total"]
    inputs = [
        facts_by_block["metric-a"]["fact_uuid"],
        facts_by_block["metric-b"]["fact_uuid"],
    ]
    _, chunk = _add_knowledge_chunk(
        generation_db,
        owner_user_id="u-1",
        file_uuid="knowledge-derived-calculation",
        chunk_id="chunk-derived-calculation",
        content="统计底稿记录指标 A 为 10，指标 B 为 20。",
        content_hash="d" * 64,
        page_number=8,
        section_title="指标底稿",
    )
    generation_db.commit()
    attach_path = f"/api/ai/facts/{target['fact_uuid']}/evidence"
    base_body = {
        "relation": "derived_from",
        "source_type": "knowledge_chunk",
        "source_uuid": chunk.chunk_id,
        "input_fact_uuids": inputs,
        "rounding_rule": "2dp",
    }

    disallowed = client.post(
        attach_path,
        headers={"Idempotency-Key": "derived-expression-disallowed"},
        json={**base_body, "derived_expression": "inputs[0] + inputs[1]"},
    )
    assert disallowed.status_code == 422
    assert disallowed.json()["detail"]["code"] == "DERIVED_EXPRESSION_NOT_ALLOWED"

    mismatch = client.post(
        attach_path,
        headers={"Idempotency-Key": "derived-calculation-mismatch"},
        json={**base_body, "derived_expression": "average(input_facts)"},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"]["code"] == "DERIVED_CALCULATION_MISMATCH"

    linked = client.post(
        attach_path,
        headers={"Idempotency-Key": "derived-calculation-valid"},
        json={**base_body, "derived_expression": "sum(input_facts)"},
    )
    assert linked.status_code == 201, linked.text
    payload = linked.json()
    assert payload["fact"]["status"] == "supported"
    assert payload["link"]["derived_expression"] == "sum(input_facts)"
    assert payload["link"]["input_fact_uuids"] == inputs
    assert payload["link"]["rounding_rule"] == "2dp"


def test_submit_revalidates_fact_evidence_source(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
    professional_fact_approval_flow,
) -> None:
    client = client_for_user("u-1")
    prepared = _prepare_supported_personal_deliverable(
        client,
        generation_db,
        professional_fact_catalog,
        key_prefix="submit-evidence-revalidation",
    )
    prepared.knowledge_file.content_sha256 = "0" * 64
    generation_db.commit()

    response = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/submit",
        headers={"Idempotency-Key": "submit-stale-evidence"},
        json={
            "row_version": prepared.reviewed["row_version"],
            "version_uuid": prepared.created["current_version"]["version_uuid"],
            "content_hash": prepared.created["current_version"]["content_hash"],
            "approval_flow_version_uuid": professional_fact_approval_flow.uuid,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "DELIVERABLE_EVIDENCE_GATE_FAILED"
    assert response.json()["detail"]["checkpoint"] == "submit"
    _assert_source_invalidation_persisted(
        generation_db,
        prepared,
        expected_row_version=prepared.reviewed["row_version"] + 1,
    )


def test_approve_revalidates_fact_evidence_source(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
    professional_fact_approval_flow,
) -> None:
    client = client_for_user("u-1")
    prepared = _prepare_supported_personal_deliverable(
        client,
        generation_db,
        professional_fact_catalog,
        key_prefix="approve-evidence-revalidation",
    )
    submitted = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/submit",
        headers={"Idempotency-Key": "approve-evidence-submit"},
        json={
            "row_version": prepared.reviewed["row_version"],
            "version_uuid": prepared.created["current_version"]["version_uuid"],
            "content_hash": prepared.created["current_version"]["content_hash"],
            "approval_flow_version_uuid": professional_fact_approval_flow.uuid,
        },
    )
    assert submitted.status_code == 201, submitted.text
    prepared.knowledge_file.content_sha256 = "1" * 64
    generation_db.commit()

    response = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/approve",
        headers={"Idempotency-Key": "approve-stale-evidence"},
        json={
            "row_version": submitted.json()["row_version"],
            "version_uuid": prepared.created["current_version"]["version_uuid"],
            "content_hash": prepared.created["current_version"]["content_hash"],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "DELIVERABLE_EVIDENCE_GATE_FAILED"
    assert response.json()["detail"]["checkpoint"] == "approve"
    _assert_source_invalidation_persisted(
        generation_db,
        prepared,
        expected_row_version=submitted.json()["row_version"] + 1,
    )


def test_delivery_revalidates_fact_evidence_source(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
    professional_fact_approval_flow,
) -> None:
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import DeliverableExport

    client = client_for_user("u-1")
    prepared = _prepare_supported_personal_deliverable(
        client,
        generation_db,
        professional_fact_catalog,
        key_prefix="delivery-evidence-revalidation",
    )
    submitted = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/submit",
        headers={"Idempotency-Key": "delivery-evidence-submit"},
        json={
            "row_version": prepared.reviewed["row_version"],
            "version_uuid": prepared.created["current_version"]["version_uuid"],
            "content_hash": prepared.created["current_version"]["content_hash"],
            "approval_flow_version_uuid": professional_fact_approval_flow.uuid,
        },
    )
    assert submitted.status_code == 201, submitted.text
    approved = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/approve",
        headers={"Idempotency-Key": "delivery-evidence-approve"},
        json={
            "row_version": submitted.json()["row_version"],
            "version_uuid": prepared.created["current_version"]["version_uuid"],
            "content_hash": prepared.created["current_version"]["content_hash"],
        },
    )
    assert approved.status_code == 200, approved.text
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == prepared.created["deliverable_uuid"]
        )
    )
    version = generation_db.scalar(
        select(WorkArtifactVersion).where(
            WorkArtifactVersion.uuid
            == prepared.created["current_version"]["version_uuid"]
        )
    )
    export = DeliverableExport(
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        content_hash=version.content_hash,
        export_format="docx",
        status="ready",
        watermarked=False,
        file_name="事实证据月报.docx",
        file_path="/tmp/facts-evidence-monthly.docx",
        file_hash="2" * 64,
        file_size=1,
        renderer_version="professional-docx-v1",
        created_by="u-1",
    )
    generation_db.add(export)
    prepared.knowledge_file.content_sha256 = "3" * 64
    generation_db.commit()

    response = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/deliver",
        headers={"Idempotency-Key": "deliver-stale-evidence"},
        json={
            "row_version": approved.json()["row_version"],
            "version_uuid": version.uuid,
            "content_hash": version.content_hash,
            "export_uuid": export.uuid,
            "recipient_description": "客户安全负责人",
            "note": "证据复验",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "DELIVERABLE_EVIDENCE_GATE_FAILED"
    assert response.json()["detail"]["checkpoint"] == "deliver"
    _assert_source_invalidation_persisted(
        generation_db,
        prepared,
        expected_row_version=approved.json()["row_version"] + 1,
        approval_cleared=True,
    )


def test_refresh_marks_delivered_evidence_stale_and_preserves_snapshot(
    client_for_user,
    generation_db,
    professional_fact_catalog,
    professional_fact_quality_rules,
    professional_fact_approval_flow,
) -> None:
    from app.governance_models import AuditLog
    from app.models import WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import (
        DeliverableEvidence,
        DeliverableExport,
        DeliverableFact,
    )

    client = client_for_user("u-1")
    prepared = _prepare_supported_personal_deliverable(
        client,
        generation_db,
        professional_fact_catalog,
        key_prefix="delivered-source-change",
    )
    version_uuid = prepared.created["current_version"]["version_uuid"]
    content_hash = prepared.created["current_version"]["content_hash"]
    submitted = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/submit",
        headers={"Idempotency-Key": "delivered-source-change-submit"},
        json={
            "row_version": prepared.reviewed["row_version"],
            "version_uuid": version_uuid,
            "content_hash": content_hash,
            "approval_flow_version_uuid": professional_fact_approval_flow.uuid,
        },
    )
    assert submitted.status_code == 201, submitted.text
    approved = client.post(
        f"/api/ai/deliverables/{prepared.created['deliverable_uuid']}/approve",
        headers={"Idempotency-Key": "delivered-source-change-approve"},
        json={
            "row_version": submitted.json()["row_version"],
            "version_uuid": version_uuid,
            "content_hash": content_hash,
        },
    )
    assert approved.status_code == 200, approved.text

    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == prepared.created["deliverable_uuid"]
        )
    )
    version = generation_db.scalar(
        select(WorkArtifactVersion).where(WorkArtifactVersion.uuid == version_uuid)
    )
    export = DeliverableExport(
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        content_hash=version.content_hash,
        export_format="docx",
        status="ready",
        watermarked=False,
        file_name="已交付事实证据月报.docx",
        file_path="/tmp/delivered-facts-evidence-monthly.docx",
        file_hash="4" * 64,
        file_size=1,
        renderer_version="professional-docx-v1",
        created_by="u-1",
    )
    generation_db.add(export)
    generation_db.commit()

    delivered = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/deliver",
        headers={"Idempotency-Key": "delivered-source-change-deliver"},
        json={
            "row_version": approved.json()["row_version"],
            "version_uuid": version.uuid,
            "content_hash": version.content_hash,
            "export_uuid": export.uuid,
            "recipient_description": "客户安全负责人",
            "note": "正式交付",
        },
    )
    assert delivered.status_code == 201, delivered.text
    delivered_row_version = delivered.json()["row_version"]
    snapshot_before = client.get(
        f"/api/ai/deliverables/{artifact.uuid}"
    ).json()["current_version"]

    prepared.knowledge_file.content_sha256 = "5" * 64
    generation_db.commit()
    refreshed = client.post(
        f"/api/ai/deliverables/{artifact.uuid}/evidence/refresh",
        headers={"Idempotency-Key": "delivered-source-change-refresh"},
    )

    assert refreshed.status_code == 200, refreshed.text
    refresh_payload = refreshed.json()
    assert refresh_payload["lifecycle_status"] == "delivered"
    assert refresh_payload["row_version"] == delivered_row_version
    assert refresh_payload["invalidated_evidence_uuids"]
    assert refresh_payload["source_change_notice"] == {
        "message": "来源后续已变化",
        "affected_evidence_count": 1,
        "historical_snapshot_preserved": True,
    }

    detail = client.get(f"/api/ai/deliverables/{artifact.uuid}")
    assert detail.status_code == 200, detail.text
    detail_payload = detail.json()
    assert detail_payload["lifecycle_status"] == "delivered"
    assert detail_payload["row_version"] == delivered_row_version
    assert detail_payload["current_version"] == snapshot_before
    assert detail_payload["source_change_notice"] == refresh_payload[
        "source_change_notice"
    ]

    generation_db.expire_all()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(WorkArtifact.uuid == artifact.uuid)
    )
    fact = generation_db.scalar(
        select(DeliverableFact).where(
            DeliverableFact.uuid == prepared.fact["fact_uuid"]
        )
    )
    evidence = generation_db.scalar(
        select(DeliverableEvidence).where(
            DeliverableEvidence.source_uuid == prepared.chunk.chunk_id,
            DeliverableEvidence.deliverable_id == artifact.id,
        )
    )
    audit = generation_db.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "professional_deliverable.evidence.invalidate",
            AuditLog.entity_uuid == artifact.uuid,
        )
        .order_by(AuditLog.id.desc())
    )
    assert artifact.lifecycle_status == "delivered"
    assert artifact.row_version == delivered_row_version
    assert artifact.delivered_version_id == version.id
    assert evidence.status == "stale"
    assert evidence.stale_reason == "source_content_changed"
    assert fact.status == "stale"
    assert audit is not None
    assert audit.result == "SUCCESS"
