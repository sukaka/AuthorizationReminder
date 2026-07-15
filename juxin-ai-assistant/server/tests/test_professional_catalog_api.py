from sqlalchemy import func, select


def _seed_catalog(db):
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.professional_delivery.catalog_service import ensure_builtin_catalog

    settings = get_settings()
    result = ensure_builtin_catalog(
        db,
        cipher=ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    )
    db.commit()
    return result


def _skill_version(db, skill_key: str):
    from app.professional_delivery.models import SkillDefinition, SkillVersion

    skill = db.scalar(
        select(SkillDefinition).where(SkillDefinition.skill_key == skill_key)
    )
    assert skill is not None
    version = db.scalar(
        select(SkillVersion).where(
            SkillVersion.id == skill.current_published_version_id
        )
    )
    assert version is not None
    return skill, version


def _template_version(db, template_key: str):
    from app.professional_delivery.models import TemplateDefinition, TemplateVersion

    template = db.scalar(
        select(TemplateDefinition).where(
            TemplateDefinition.template_key == template_key
        )
    )
    assert template is not None
    version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.id == template.current_published_version_id
        )
    )
    assert version is not None
    return template, version


def _skill_version_body(default_template_version_uuid: str) -> dict:
    return {
        "input_schema": {
            "type": "object",
            "properties": {"period": {"type": "string"}},
            "required": ["period"],
        },
        "output_schema": {
            "type": "object",
            "properties": {"blocks": {"type": "array"}},
            "required": ["blocks"],
        },
        "plan_definition": {
            "steps": [
                {"step_key": "collect", "name": "受权取证"},
                {"step_key": "draft", "name": "生成初稿"},
                {"step_key": "verify", "name": "确定性验证"},
            ],
            "selection_rules": {
                "deliverable_types": ["security_ops_monthly_report"],
                "keywords": ["安全运营", "月报"],
                "required_input_fields": ["period"],
            },
            "examples": [{"objective": "生成 7 月安全运营月报"}],
            "counterexamples": [{"objective": "撰写合同"}],
            "tests": [{"name": "period_required", "expected": "valid"}],
        },
        "prompt_bundle": {
            "system": "只基于授权事实生成安全运营月报。",
            "instructions": ["不得虚构关键数字", "缺少证据时标记待确认"],
        },
        "allowed_resource_types": ["knowledge_file", "project_context"],
        "allowed_tool_ids": ["knowledge.search", "calculator.deterministic"],
        "required_fact_policy": {
            "critical_numbers_require_source": True,
            "human_confirmation_required": True,
        },
        "quality_rule_set_version_ids": [],
        "default_template_version_uuid": default_template_version_uuid,
        "review_checklist": ["关键数字均有来源", "结论与证据一致"],
    }


def _template_version_body(*, unsafe: bool = False) -> dict:
    structure = {
        "type": "document",
        "children": [
            {
                "type": "section",
                "id": "overview",
                "title": "本月概览",
                "children": [
                    {"type": "field", "path": "period"},
                    {"type": "references"},
                ],
            },
            {
                "type": "if",
                "condition": {"op": "exists", "path": "major_incidents"},
                "children": [
                    {
                        "type": "table",
                        "columns": [
                            {"key": "time", "title": "时间"},
                            {"key": "event", "title": "事件"},
                        ],
                        "rows_from": "major_incidents",
                    }
                ],
            },
        ],
    }
    if unsafe:
        structure["children"].append(
            {"type": "paragraph", "eval": "__import__('os').system('id')"}
        )
    return {
        "input_schema": {
            "type": "object",
            "properties": {
                "period": {"type": "string"},
                "major_incidents": {"type": "array"},
            },
        },
        "structure_dsl": structure,
        "dynamic_tables": [
            {
                "id": "major-incidents",
                "rows_from": "major_incidents",
                "columns": ["time", "event"],
            }
        ],
        "conditional_sections": [
            {
                "section_id": "major-incidents",
                "condition": {"op": "exists", "path": "major_incidents"},
            }
        ],
        "style_theme": {"name": "juxin-professional"},
        "word_render_config": {"toc": True, "references": "endnotes"},
        "compatible_skill_version_uuids": [],
    }


def test_builtin_catalog_is_idempotent_and_exposes_exact_published_versions(
    generation_db,
    client_for_user,
) -> None:
    from app.professional_delivery.catalog_service import ensure_builtin_catalog
    from app.professional_delivery.models import (
        ApprovalFlowDefinition,
        QualityRuleDefinition,
        QualityRuleVersion,
        SkillDefinition,
        TemplateDefinition,
    )
    from app.project_workspace_models import Project, ProjectMember

    first = _seed_catalog(generation_db)
    second = ensure_builtin_catalog(
        generation_db,
        cipher=first.cipher,
        key_version=first.key_version,
    )
    generation_db.commit()

    assert first.created_count == 65
    assert second.created_count == 0
    assert generation_db.scalar(select(func.count()).select_from(SkillDefinition)) == 7
    assert generation_db.scalar(select(func.count()).select_from(TemplateDefinition)) == 7
    assert (
        generation_db.scalar(select(func.count()).select_from(ApprovalFlowDefinition))
        == 2
    )
    assert (
        generation_db.scalar(select(func.count()).select_from(QualityRuleDefinition))
        == 49
    )
    assert (
        generation_db.scalar(select(func.count()).select_from(QualityRuleVersion))
        == 49
    )

    expected_categories = {
        "structure_contract",
        "facts_evidence",
        "project_scope",
        "consistency",
        "professional_rules",
        "format_expression",
        "sensitive_security",
    }
    core_rule_sets: list[set[int]] = []
    for skill_key in (
        "security_ops_monthly_report",
        "risk_assessment_process_review",
        "incident_response_report",
        "security_baseline_check_report",
    ):
        _, core_version = _skill_version(generation_db, skill_key)
        rule_ids = {int(value) for value in core_version.quality_policy_ids_json}
        assert len(rule_ids) == 7
        categories = set(
            generation_db.scalars(
                select(QualityRuleDefinition.category)
                .join(
                    QualityRuleVersion,
                    QualityRuleVersion.rule_id == QualityRuleDefinition.id,
                )
                .where(QualityRuleVersion.id.in_(rule_ids))
            )
        )
        assert categories == expected_categories
        core_rule_sets.append(rule_ids)
    assert all(
        left.isdisjoint(right)
        for index, left in enumerate(core_rule_sets)
        for right in core_rule_sets[index + 1 :]
    )

    client = client_for_user("catalog-reader")
    skill_response = client.get(
        "/api/ai/skills",
        params={
            "scope_type": "personal",
            "deliverable_type": "security_ops_monthly_report",
        },
    )
    assert skill_response.status_code == 200
    skills = skill_response.json()
    security_skill = next(
        item
        for item in skills["items"]
        if item["skill_key"] == "security_ops_monthly_report"
    )
    assert security_skill["status"] == "published"
    assert security_skill["current_version"]["version"] == 1
    assert security_skill["current_version"]["default_template_version_uuid"]
    assert "ciphertext" not in str(skills).lower()
    assert "nonce" not in str(skills).lower()

    detail_response = client.get(
        f"/api/ai/skills/{security_skill['skill_uuid']}"
        f"/versions/{security_skill['current_version']['version_uuid']}"
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["plan_definition"]["examples"]
    assert detail["plan_definition"]["counterexamples"]
    assert detail["plan_definition"]["tests"]
    assert detail["plan_definition"]["golden_samples"]
    assert len(detail["quality_rule_set_version_ids"]) == 7
    assert detail["prompt_bundle_present"] is True
    assert "prompt_bundle" not in detail

    template_response = client.get(
        "/api/ai/templates",
        params={
            "scope_type": "personal",
            "deliverable_type": "security_ops_monthly_report",
        },
    )
    assert template_response.status_code == 200
    templates = template_response.json()
    security_template = next(
        item
        for item in templates["items"]
        if item["template_key"] == "security_ops_monthly_report"
    )
    template_detail = client.get(
        f"/api/ai/templates/{security_template['template_uuid']}"
        f"/versions/{security_template['current_version']['version_uuid']}"
    )
    assert template_detail.status_code == 200
    assert template_detail.json()["structure_dsl"]["type"] == "document"

    personal_flow_response = client.get(
        "/api/ai/approval-flows",
        params={
            "scope_type": "personal",
            "deliverable_type": "security_ops_monthly_report",
        },
    )
    assert personal_flow_response.status_code == 200
    personal_flows = personal_flow_response.json()
    assert personal_flows["total"] == 1
    personal_flow = personal_flows["items"][0]
    assert personal_flow["flow_key"] == "personal_standard_review"
    assert personal_flow["scope_policy"] == "personal"
    assert personal_flow["current_version"]["version"] == 1
    assert personal_flow["current_version"]["version_uuid"]
    assert len(personal_flow["current_version"]["content_hash"]) == 64
    assert personal_flow["current_version"]["min_approvals"] == 1
    assert personal_flow["current_version"]["allow_author_approve"] is True
    assert personal_flow["current_version"]["steps"][0]["step_key"] == "confirm"

    project = Project(
        name="审批流目录项目",
        owner_user_id="catalog-reader",
        created_by="catalog-reader",
    )
    generation_db.add(project)
    generation_db.flush()
    generation_db.add(
        ProjectMember(
            project_id=project.id,
            user_id="catalog-reader",
            role="reviewer",
            invited_by="catalog-reader",
        )
    )
    generation_db.commit()

    project_flow_response = client.get(
        "/api/ai/approval-flows",
        params={
            "scope_type": "project",
            "project_uuid": project.uuid,
            "deliverable_type": "custom_professional_report",
        },
    )
    assert project_flow_response.status_code == 200
    project_flows = project_flow_response.json()
    assert project_flows["total"] == 1
    project_flow = project_flows["items"][0]
    assert project_flow["flow_key"] == "project_standard_review"
    assert project_flow["scope_policy"] == "project"
    assert project_flow["current_version"]["allow_author_approve"] is False
    assert project_flow["current_version"]["steps"][0]["roles"] == [
        "reviewer",
        "project_lead",
        "project_admin",
    ]

    outsider = client_for_user("catalog-outsider")
    hidden = outsider.get(
        "/api/ai/approval-flows",
        params={
            "scope_type": "project",
            "project_uuid": project.uuid,
            "deliverable_type": "security_ops_monthly_report",
        },
    )
    assert hidden.status_code == 404


def test_skill_selection_prioritizes_explicit_choice_and_persists_replay(
    generation_db,
    client_for_user,
) -> None:
    from app.professional_delivery.models import SkillSelectionRecord

    _seed_catalog(generation_db)
    _, explicit_version = _skill_version(
        generation_db,
        "security_ops_monthly_report",
    )
    _, task_version = _skill_version(generation_db, "manual_document")
    client = client_for_user("selector")
    body = {
        "objective": "请生成 7 月安全运营月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": "personal",
        "input_fields": {"period": "2026-07"},
        "explicit_skill_version_uuid": explicit_version.uuid,
        "task_bound_skill_version_uuid": task_version.uuid,
        "model_suggested_skill_version_uuids": [task_version.uuid],
        "user_confirmed": True,
    }
    headers = {"Idempotency-Key": "select-security-july"}

    first = client.post("/api/ai/skills/select", json=body, headers=headers)
    replay = client.post("/api/ai/skills/select", json=body, headers=headers)

    assert first.status_code == 200
    assert replay.status_code == 200
    payload = first.json()
    assert payload["selection_source"] == "explicit"
    assert payload["selected"]["version_uuid"] == explicit_version.uuid
    assert payload["candidates"][0]["version_uuid"] == explicit_version.uuid
    assert payload["candidates"][0]["score"] == 1.0
    assert "用户显式选择" in payload["candidates"][0]["reasons"]
    assert payload["confirmation_required"] is False
    assert replay.json()["selection_uuid"] == payload["selection_uuid"]
    assert replay.json()["replayed"] is True

    records = list(generation_db.scalars(select(SkillSelectionRecord)))
    assert len(records) == 1
    assert records[0].selected_skill_version_id == explicit_version.id
    assert records[0].candidate_versions_json[0]["version_uuid"] == explicit_version.uuid
    assert records[0].user_confirmed is True

    conflict = client.post(
        "/api/ai/skills/select",
        json={**body, "objective": "不同请求"},
        headers=headers,
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_skill_version_management_is_admin_idempotent_immutable_and_audited(
    generation_db,
    client_for_user,
) -> None:
    from app.governance_models import AuditLog
    from app.professional_delivery.models import SkillVersion

    _seed_catalog(generation_db)
    skill, original = _skill_version(generation_db, "security_ops_monthly_report")
    _, default_template = _template_version(
        generation_db,
        "security_ops_monthly_report",
    )
    body = _skill_version_body(default_template.uuid)
    employee = client_for_user("employee")
    admin = client_for_user("admin", role="admin")
    path = f"/api/ai/skills/{skill.uuid}/versions"
    headers = {"Idempotency-Key": "security-skill-v2"}

    forbidden = employee.post(path, json=body, headers=headers)
    assert forbidden.status_code == 403

    created = admin.post(path, json=body, headers=headers)
    replay = admin.post(path, json=body, headers=headers)
    assert created.status_code == 201
    assert replay.status_code == 201
    created_payload = created.json()
    assert created_payload["version"] == 2
    assert created_payload["status"] == "draft"
    assert replay.json()["version_uuid"] == created_payload["version_uuid"]
    assert replay.json()["replayed"] is True

    conflict_body = _skill_version_body(default_template.uuid)
    conflict_body["review_checklist"] = ["different"]
    conflict = admin.post(path, json=conflict_body, headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    publish = admin.post(
        f"{path}/{created_payload['version_uuid']}/publish",
        headers={"Idempotency-Key": "publish-security-skill-v2"},
    )
    assert publish.status_code == 200
    assert publish.json()["status"] == "published"
    generation_db.refresh(skill)
    generation_db.refresh(original)
    assert skill.current_published_version_id != original.id
    assert original.version == 1
    assert original.status == "published"
    assert original.content_hash == created_payload["previous_content_hash"]

    persisted = generation_db.scalar(
        select(SkillVersion).where(
            SkillVersion.uuid == created_payload["version_uuid"]
        )
    )
    assert persisted is not None
    assert persisted.prompt_bundle_ciphertext
    assert persisted.prompt_bundle_nonce
    assert persisted.status == "published"

    actions = set(
        generation_db.scalars(
            select(AuditLog.action).where(
                AuditLog.entity_uuid == created_payload["version_uuid"]
            )
        )
    )
    assert actions == {
        "professional_skill.version.create",
        "professional_skill.version.publish",
    }


def test_template_publish_rejects_unsafe_dsl_then_publishes_valid_version(
    generation_db,
    client_for_user,
) -> None:
    from app.professional_delivery.models import TemplateVersion

    _seed_catalog(generation_db)
    template, original = _template_version(
        generation_db,
        "security_ops_monthly_report",
    )
    admin = client_for_user("admin", role="admin")
    employee = client_for_user("employee")
    path = f"/api/ai/templates/{template.uuid}/versions"

    forbidden = employee.post(
        path,
        json=_template_version_body(),
        headers={"Idempotency-Key": "employee-template-write"},
    )
    assert forbidden.status_code == 403

    unsafe = admin.post(
        path,
        json=_template_version_body(unsafe=True),
        headers={"Idempotency-Key": "unsafe-template-v2"},
    )
    assert unsafe.status_code == 201
    unsafe_publish = admin.post(
        f"{path}/{unsafe.json()['version_uuid']}/publish",
        headers={"Idempotency-Key": "publish-unsafe-template-v2"},
    )
    assert unsafe_publish.status_code == 422
    assert unsafe_publish.json()["detail"]["code"] == "TEMPLATE_DSL_UNSAFE"
    unsafe_row = generation_db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.uuid == unsafe.json()["version_uuid"]
        )
    )
    assert unsafe_row is not None
    assert unsafe_row.status == "draft"

    valid = admin.post(
        path,
        json=_template_version_body(),
        headers={"Idempotency-Key": "valid-template-v3"},
    )
    assert valid.status_code == 201
    published = admin.post(
        f"{path}/{valid.json()['version_uuid']}/publish",
        headers={"Idempotency-Key": "publish-valid-template-v3"},
    )
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    generation_db.refresh(template)
    generation_db.refresh(original)
    assert template.current_published_version_id != original.id
    assert original.status == "published"

    detail = employee.get(
        f"/api/ai/templates/{template.uuid}"
        f"/versions/{valid.json()['version_uuid']}"
    )
    assert detail.status_code == 200
    assert detail.json()["dynamic_tables"][0]["rows_from"] == "major_incidents"
    assert detail.json()["conditional_sections"][0]["condition"]["op"] == "exists"
