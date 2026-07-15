from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select


REVIEW_READY_CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "paragraph",
            "text": "本月未发生重大安全事件。",
        },
        {
            "block_id": "monthly-actions",
            "type": "paragraph",
            "text": "已完成月度巡检。",
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


@pytest.fixture
def professional_quality_rules(generation_db, professional_catalog):
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
                "blocked_statuses": ["unsupported", "conflicted", "stale"],
                "critical_only": True,
            },
            "blocker",
            True,
        ),
        (
            "project_scope",
            "project_scope_gate",
            {},
            "blocker",
            True,
        ),
        (
            "consistency",
            "declared_count_gate",
            {},
            "error",
            True,
        ),
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
    rules = []
    versions = []
    for index, (category, evaluator, config, severity, blocking) in enumerate(
        definitions,
        start=1,
    ):
        rule = QualityRuleDefinition(
            rule_key=f"builtin.{category}",
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
        rules.append(rule)
        versions.append(version)

    professional_catalog.skill_version.quality_policy_ids_json = [
        version.id for version in versions
    ]
    generation_db.commit()
    return SimpleNamespace(rules=rules, versions=versions)


def _create_body(catalog, **overrides) -> dict:
    body = {
        "title": "2026 年 7 月安全运营月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": "personal",
        "formality": "working",
        "skill_version_uuid": catalog.skill_version.uuid,
        "template_version_uuid": catalog.template_version.uuid,
        "content": REVIEW_READY_CONTENT,
        "content_summary": "安全运营月度概览",
        "creation_reason": "manual",
    }
    body.update(overrides)
    return body


def _create(client, catalog, *, key: str, **overrides):
    return client.post(
        "/api/ai/deliverables",
        headers={"Idempotency-Key": key},
        json=_create_body(catalog, **overrides),
    )


def _review_body(created: dict, **overrides) -> dict:
    body = {
        "row_version": created["row_version"],
        "version_uuid": created["current_version"]["version_uuid"],
        "content_hash": created["current_version"]["content_hash"],
    }
    body.update(overrides)
    return body


def _review(client, created: dict, *, key: str, **overrides):
    return client.post(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews",
        headers={"Idempotency-Key": key},
        json=_review_body(created, **overrides),
    )


def test_review_passes_all_categories_pins_version_and_replays_idempotently(
    client_for_user,
    generation_db,
    professional_catalog,
    professional_quality_rules,
) -> None:
    from app.governance_models import AuditLog
    from app.professional_delivery.models import ReviewRun

    client = client_for_user("u-1")
    created = _create(
        client,
        professional_catalog,
        key="create-review-ready",
    ).json()

    response = _review(client, created, key="review-pass")

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["request_id"]
    assert payload["deliverable_uuid"] == created["deliverable_uuid"]
    assert payload["lifecycle_status"] == "pending_approval"
    assert payload["row_version"] == 2
    review = payload["review"]
    assert review["version_uuid"] == created["current_version"]["version_uuid"]
    assert review["version_no"] == 1
    assert review["content_hash"] == created["current_version"]["content_hash"]
    assert review["status"] == "passed"
    assert review["gates_passed"] is True
    assert review["issues"] == []
    assert review["rule_version_uuids"] == [
        version.uuid for version in professional_quality_rules.versions
    ]
    assert [item["category"] for item in review["category_results"]] == [
        "structure_contract",
        "facts_evidence",
        "project_scope",
        "consistency",
        "professional_rules",
        "format_expression",
        "sensitive_security",
    ]
    assert all(item["status"] == "passed" for item in review["category_results"])

    replay = _review(client, created, key="review-pass")
    assert replay.status_code == 201, replay.text
    assert replay.json()["review"]["review_uuid"] == review["review_uuid"]
    assert generation_db.scalar(select(func.count(ReviewRun.id))) == 1

    reused = _review(
        client,
        created,
        key="review-pass",
        content_hash="0" * 64,
    )
    assert reused.status_code == 409
    assert reused.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    history = client.get(
        f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews"
    )
    assert history.status_code == 200, history.text
    history_payload = history.json()
    assert history_payload["total"] == 1
    assert history_payload["items"][0]["review_uuid"] == review["review_uuid"]
    assert "content" not in history_payload["items"][0]

    audits = list(
        generation_db.scalars(
            select(AuditLog).where(
                AuditLog.action == "professional_deliverable.review.create"
            )
        )
    )
    assert len(audits) == 1
    assert audits[0].metadata_json == {
        "event": "deliverable_review_completed",
        "status": "passed",
        "record_count": 0,
    }


def test_review_blocks_unsupported_fact_and_sensitive_literal_without_leaking_it(
    client_for_user,
    professional_catalog,
    professional_quality_rules,
) -> None:
    client = client_for_user("u-1")
    blocked_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "monthly-overview",
                "type": "paragraph",
                "text": "管理口令 password=TopSecret-2026",
            },
            {
                "block_id": "monthly-actions",
                "type": "paragraph",
                "text": "已完成月度巡检。",
            },
            {
                "block_id": "critical-fact",
                "type": "claim",
                "claim_type": "fact",
                "critical": True,
                "fact_status": "unsupported",
                "text": "全部风险已经彻底解决。",
            },
        ],
    }
    created = _create(
        client,
        professional_catalog,
        key="create-blocked-review",
        content=blocked_content,
    ).json()

    response = _review(client, created, key="review-blocked")

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["lifecycle_status"] == "changes_requested"
    assert payload["review"]["status"] == "failed"
    assert payload["review"]["gates_passed"] is False
    issues = payload["review"]["issues"]
    assert {(item["category"], item["block_id"]) for item in issues} == {
        ("facts_evidence", "critical-fact"),
        ("sensitive_security", "monthly-overview"),
    }
    assert all(item["severity"] == "blocker" for item in issues)
    assert "TopSecret-2026" not in response.text

    fact_issue = next(item for item in issues if item["category"] == "facts_evidence")
    rejected_waiver = client.patch(
        f"/api/ai/review-issues/{fact_issue['issue_uuid']}",
        json={"status": "accepted_risk", "reason": "业务接受"},
    )
    assert rejected_waiver.status_code == 422
    assert rejected_waiver.json()["detail"]["code"] == (
        "REVIEW_ISSUE_WAIVER_FORBIDDEN"
    )

    resolved = client.patch(
        f"/api/ai/review-issues/{fact_issue['issue_uuid']}",
        json={"status": "resolved", "reason": "已补齐原始证据"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["issue"]["status"] == "resolved"
    assert resolved.json()["issue"]["handled_by"] == "u-1"
    assert resolved.json()["issue"]["handling_reason"] == "已补齐原始证据"


def test_non_blocking_warning_can_be_accepted_but_does_not_replace_human_approval(
    client_for_user,
    professional_catalog,
    professional_quality_rules,
) -> None:
    client = client_for_user("u-1")
    content_without_actions = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "monthly-overview",
                "type": "paragraph",
                "text": "本月完成例行运营。",
            }
        ],
    }
    created = _create(
        client,
        professional_catalog,
        key="create-warning-review",
        content=content_without_actions,
    ).json()

    response = _review(client, created, key="review-warning")

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["review"]["gates_passed"] is True
    assert payload["lifecycle_status"] == "pending_approval"
    assert payload["lifecycle_status"] != "approved"
    assert len(payload["review"]["issues"]) == 1
    issue = payload["review"]["issues"][0]
    assert issue["severity"] == "warning"
    assert issue["blocking"] is False

    accepted = client.patch(
        f"/api/ai/review-issues/{issue['issue_uuid']}",
        json={"status": "accepted_risk", "reason": "本期无整改动作"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["issue"]["status"] == "accepted_risk"


def test_review_rejects_stale_target_and_incomplete_mandatory_rule_set(
    client_for_user,
    generation_db,
    professional_catalog,
    professional_quality_rules,
) -> None:
    from app.professional_delivery.models import ReviewRun

    client = client_for_user("u-1")
    created = _create(
        client,
        professional_catalog,
        key="create-stale-review",
    ).json()

    stale = _review(
        client,
        created,
        key="review-stale",
        content_hash="f" * 64,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "DELIVERABLE_REVIEW_TARGET_STALE"

    professional_catalog.skill_version.quality_policy_ids_json = [
        version.id
        for version in professional_quality_rules.versions
        if generation_db.get(type(professional_quality_rules.rules[0]), version.rule_id).category
        != "sensitive_security"
    ]
    generation_db.commit()
    incomplete = _review(client, created, key="review-incomplete")
    assert incomplete.status_code == 422
    assert incomplete.json()["detail"]["code"] == "QUALITY_RULE_SET_INCOMPLETE"
    assert incomplete.json()["detail"]["missing_categories"] == [
        "sensitive_security"
    ]
    assert generation_db.scalar(select(func.count(ReviewRun.id))) == 0


def test_project_reviewer_can_run_review_read_only_can_view_and_outsider_is_hidden(
    client_for_user,
    professional_catalog,
    professional_quality_rules,
) -> None:
    owner = client_for_user("u-1")
    reviewer = client_for_user("u-2")
    read_only = client_for_user("u-3")
    outsider = client_for_user("u-4")
    project = owner.post(
        "/api/ai/projects",
        json={"name": "质量复核项目", "description": ""},
    ).json()
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-2", "role": "reviewer"},
    )
    owner.post(
        f"/api/ai/projects/{project['project_uuid']}/members",
        json={"user_id": "u-3", "role": "read_only"},
    )
    blocked_content = {
        "schema_version": "1",
        "blocks": [
            {
                "block_id": "monthly-overview",
                "type": "paragraph",
                "text": "项目月报",
            },
            {
                "block_id": "monthly-actions",
                "type": "paragraph",
                "text": "本月动作",
            },
            {
                "block_id": "critical-fact",
                "type": "claim",
                "critical": True,
                "fact_status": "unsupported",
                "text": "无证据结论",
            },
        ],
    }
    created_response = _create(
        owner,
        professional_catalog,
        key="create-project-review",
        scope_type="project",
        formality="formal",
        project_uuid=project["project_uuid"],
        content=blocked_content,
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()

    reviewed = _review(reviewer, created, key="project-review")
    assert reviewed.status_code == 201, reviewed.text
    issue_uuid = reviewed.json()["review"]["issues"][0]["issue_uuid"]
    history_path = f"/api/ai/deliverables/{created['deliverable_uuid']}/reviews"

    assert read_only.get(history_path).status_code == 200
    forbidden = _review(read_only, created, key="read-only-review")
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == (
        "PROJECT_DELIVERABLE_REVIEW_FORBIDDEN"
    )
    assert read_only.patch(
        f"/api/ai/review-issues/{issue_uuid}",
        json={"status": "resolved", "reason": "无权限处理"},
    ).status_code == 403
    assert outsider.get(history_path).status_code == 404
    assert outsider.patch(
        f"/api/ai/review-issues/{issue_uuid}",
        json={"status": "resolved", "reason": "越权处理"},
    ).status_code == 404


def test_review_audit_failure_rolls_back_run_issues_and_lifecycle(
    client_for_user,
    generation_db,
    professional_catalog,
    professional_quality_rules,
    monkeypatch,
) -> None:
    from app.models import WorkArtifact
    from app.professional_delivery import routes
    from app.professional_delivery.models import ReviewIssue, ReviewRun

    client = client_for_user("u-1")
    created = _create(
        client,
        professional_catalog,
        key="create-review-audit-failure",
    ).json()
    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == created["deliverable_uuid"]
        )
    )
    assert artifact is not None

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(routes, "write_request_audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        _review(client, created, key="review-audit-failure")

    generation_db.refresh(artifact)
    assert artifact.lifecycle_status == "draft"
    assert artifact.row_version == 1
    assert generation_db.scalar(select(func.count(ReviewRun.id))) == 0
    assert generation_db.scalar(select(func.count(ReviewIssue.id))) == 0
