import hashlib
import json

import pytest
from sqlalchemy import func, select


INITIAL_CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "paragraph",
            "text": "安全运营月报待生成。",
        }
    ],
}

GENERATED_CONTENT = {
    "schema_version": "1",
    "blocks": [
        {
            "block_id": "monthly-overview",
            "type": "paragraph",
            "text": "2026 年 7 月未发生重大安全事件。",
        },
        {
            "block_id": "operations-metrics",
            "type": "paragraph",
            "text": "本月完成全部安全巡检。",
        },
        {
            "block_id": "major-incidents",
            "type": "paragraph",
            "text": "本月无重大安全事件。",
        },
        {
            "block_id": "risks-and-plans",
            "type": "paragraph",
            "text": "下月继续执行安全巡检。",
        },
    ],
}


def _canonical_hash(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _seed_catalog(db):
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.professional_delivery.catalog_service import ensure_builtin_catalog
    from app.professional_delivery.models import (
        SkillDefinition,
        SkillVersion,
        TemplateDefinition,
        TemplateVersion,
    )

    settings = get_settings()
    ensure_builtin_catalog(
        db,
        cipher=ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    )
    db.commit()
    skill = db.scalar(
        select(SkillDefinition).where(
            SkillDefinition.skill_key == "security_ops_monthly_report"
        )
    )
    template = db.scalar(
        select(TemplateDefinition).where(
            TemplateDefinition.template_key == "security_ops_monthly_report"
        )
    )
    assert skill is not None and template is not None
    skill_version = db.get(SkillVersion, skill.current_published_version_id)
    template_version = db.get(
        TemplateVersion,
        template.current_published_version_id,
    )
    assert skill_version is not None and template_version is not None
    return skill_version, template_version


def _create_deliverable(
    client,
    db,
    *,
    key: str = "runner-create-security-report",
    scope_type: str = "personal",
    project_uuid: str | None = None,
) -> dict:
    skill_version, template_version = _seed_catalog(db)
    body = {
        "title": "2026 年 7 月安全运营月报",
        "deliverable_type": "security_ops_monthly_report",
        "scope_type": scope_type,
        "formality": "formal",
        "skill_version_uuid": skill_version.uuid,
        "template_version_uuid": template_version.uuid,
        "content": INITIAL_CONTENT,
        "content_summary": "安全运营月报初始版本",
        "creation_reason": "manual",
    }
    if project_uuid is not None:
        body["project_uuid"] = project_uuid
    response = client.post(
        "/api/ai/deliverables",
        headers={"Idempotency-Key": key},
        json=body,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_project(client, *, name: str, members: list[tuple[str, str]] = ()) -> dict:
    response = client.post(
        "/api/ai/projects",
        json={"name": name, "description": "Runner 安全边界测试"},
    )
    assert response.status_code == 201, response.text
    project = response.json()
    for user_id, role in members:
        member = client.post(
            f"/api/ai/projects/{project['project_uuid']}/members",
            json={"user_id": user_id, "role": role},
        )
        assert member.status_code == 201, member.text
    return project


def _seed_project_file(
    db,
    *,
    project_uuid: str,
    owner_user_id: str,
    file_uuid: str,
    content_hash: str,
):
    from app.models import KnowledgeFile
    from app.project_context_models import ProjectFile
    from app.project_workspace_models import Project

    project = db.scalar(select(Project).where(Project.uuid == project_uuid))
    assert project is not None
    knowledge_file = KnowledgeFile(
        uuid=file_uuid,
        sso_user_id=owner_user_id,
        owner_user_id=owner_user_id,
        uploaded_by=owner_user_id,
        file_name=f"{file_uuid}.docx",
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size=128,
        content_sha256=content_hash,
        status="READY",
        key_version="v1",
        reference_enabled=True,
        is_current_version=True,
    )
    db.add(knowledge_file)
    db.flush()
    db.add(
        ProjectFile(
            project_id=project.id,
            knowledge_file_id=knowledge_file.id,
            status="active",
            linked_by=owner_user_id,
        )
    )
    db.commit()
    return knowledge_file


def _start_body(deliverable: dict, **overrides) -> dict:
    body = {
        "row_version": deliverable["row_version"],
        "source_version_uuid": deliverable["current_version"]["version_uuid"],
        "inputs": {"period": "2026-07"},
        "resource_refs": [],
        "model_profile_uuid": "local-openai-compatible-profile",
        "max_steps": 16,
        "max_model_calls": 2,
    }
    body.update(overrides)
    return body


def test_professional_runner_start_is_idempotent_pinned_and_secret_safe(
    generation_db,
    client_for_user,
) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher, EncryptedPayload
    from app.models import AgentRun
    from app.professional_delivery.models import (
        ProfessionalModelStepToken,
        ProfessionalRunBinding,
    )

    client = client_for_user("runner-owner")
    deliverable = _create_deliverable(client, generation_db)
    body = _start_body(
        deliverable,
        inputs={
            "period": "2026-07",
            "operator_notes": "仅限本次运行的敏感备注",
        },
    )
    headers = {"Idempotency-Key": "run-security-report-july"}

    first = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers=headers,
        json=body,
    )
    assert first.status_code == 202, first.text
    payload = first.json()
    assert payload["status"] == "waiting_for_model"
    assert payload["phase"] == "draft"
    assert payload["source_version_uuid"] == body["source_version_uuid"]
    assert payload["skill_version_uuid"] == deliverable["current_version"]["skill_version_uuid"]
    assert payload["template_version_uuid"] == deliverable["current_version"]["template_version_uuid"]
    assert len(payload["context_hash"]) == 64
    assert payload["missing_fields"] == []
    model_request = payload["pending_model_request"]
    assert model_request["one_time_token"]
    assert len(model_request["request_hash"]) == 64
    assert model_request["inputs"] == body["inputs"]

    replay = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers=headers,
        json=body,
    )
    assert replay.status_code == 202, replay.text
    assert replay.json()["run_uuid"] == payload["run_uuid"]
    assert replay.json()["replayed"] is True
    assert replay.json()["pending_model_request"]["one_time_token"] is None

    conflict = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers=headers,
        json={**body, "inputs": {"period": "2026-08"}},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    binding = generation_db.scalar(
        select(ProfessionalRunBinding).where(
            ProfessionalRunBinding.agent_run_uuid == payload["run_uuid"]
        )
    )
    run = generation_db.scalar(
        select(AgentRun).where(AgentRun.uuid == payload["run_uuid"])
    )
    token = generation_db.scalar(
        select(ProfessionalModelStepToken).where(
            ProfessionalModelStepToken.agent_run_uuid == payload["run_uuid"]
        )
    )
    assert binding is not None and run is not None and token is not None
    persisted_safe_state = json.dumps(
        {
            "execution_context": binding.execution_context_json,
            "checkpoint": run.checkpoint_json,
            "token_metadata": token.metadata_json,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    assert "仅限本次运行的敏感备注" not in persisted_safe_state
    assert model_request["one_time_token"] not in persisted_safe_state
    assert token.token_hash != model_request["one_time_token"]
    assert binding.context_hash == payload["context_hash"]

    settings = get_settings()
    decrypted = ContentCipher(settings.content_encryption_key).decrypt_json(
        EncryptedPayload(
            ciphertext=binding.input_ciphertext,
            nonce=binding.input_nonce,
        ),
        f"professional-run:{payload['run_uuid']}".encode("utf-8"),
    )
    assert decrypted == body["inputs"]


def test_professional_runner_collects_missing_input_and_rotates_model_token(
    generation_db,
    client_for_user,
) -> None:
    from app.governance_models import AuditLog

    client = client_for_user("runner-input-owner")
    deliverable = _create_deliverable(client, generation_db)
    started = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "run-missing-period"},
        json=_start_body(deliverable, inputs={}),
    )
    assert started.status_code == 202, started.text
    waiting = started.json()
    assert waiting["status"] == "waiting_for_input"
    assert waiting["phase"] == "completeness"
    assert waiting["missing_fields"] == ["period"]
    assert waiting["pending_model_request"] is None

    waiting_detail_response = client.get(
        f"/api/ai/runs/{waiting['run_uuid']}"
    )
    assert waiting_detail_response.status_code == 200, waiting_detail_response.text
    waiting_detail = waiting_detail_response.json()["professional"]
    assert waiting_detail["run_uuid"] == waiting["run_uuid"]
    assert waiting_detail["deliverable_uuid"] == deliverable["deliverable_uuid"]
    assert waiting_detail["missing_fields"] == ["period"]
    assert waiting_detail["allowed_actions"] == ["supply_input", "cancel"]
    assert len(waiting_detail["stages"]) == 9
    completeness = next(
        stage
        for stage in waiting_detail["stages"]
        if stage["key"] == "completeness"
    )
    assert completeness["status"] == "waiting"
    assert completeness["duration_ms"] >= 0
    assert completeness["summary"] == "等待补充必要输入"
    assert completeness["recover_action"] == "supply_input"

    supplied = client.post(
        f"/api/ai/runs/{waiting['run_uuid']}/input",
        headers={"Idempotency-Key": "supply-period"},
        json={"inputs": {"period": "2026-07"}},
    )
    assert supplied.status_code == 202, supplied.text
    ready = supplied.json()
    assert ready["status"] == "waiting_for_model"
    old_token = ready["pending_model_request"]["one_time_token"]

    ready_detail_response = client.get(f"/api/ai/runs/{waiting['run_uuid']}")
    assert ready_detail_response.status_code == 200, ready_detail_response.text
    ready_detail = ready_detail_response.json()["professional"]
    assert ready_detail["allowed_actions"] == ["resume", "cancel"]
    assert ready_detail["missing_fields"] == []
    assert ready_detail["pending_model_request"]["one_time_token"] is None
    assert old_token not in json.dumps(ready_detail, ensure_ascii=False, sort_keys=True)
    assert next(
        stage
        for stage in ready_detail["stages"]
        if stage["key"] == "completeness"
    )["status"] == "succeeded"
    draft = next(
        stage for stage in ready_detail["stages"] if stage["key"] == "draft"
    )
    assert draft["status"] == "waiting"
    assert draft["recover_action"] == "resume"

    resumed = client.post(
        f"/api/ai/runs/{waiting['run_uuid']}/resume",
        headers={"Idempotency-Key": "resume-model-bridge"},
    )
    assert resumed.status_code == 202, resumed.text
    new_token = resumed.json()["pending_model_request"]["one_time_token"]
    assert new_token
    assert new_token != old_token

    rejected = client.post(
        f"/api/ai/runs/{waiting['run_uuid']}/steps/"
        f"{ready['pending_model_request']['step_uuid']}/model-result",
        json={
            "one_time_token": old_token,
            "request_hash": ready["pending_model_request"]["request_hash"],
            "content": GENERATED_CONTENT,
            "content_hash": _canonical_hash(GENERATED_CONTENT),
            "summary": "旧令牌不应被接受",
            "model_metadata": {},
        },
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "MODEL_STEP_TOKEN_REVOKED"
    audits = {
        audit.action: audit.metadata_json
        for audit in generation_db.scalars(
            select(AuditLog).where(
                AuditLog.action.in_(
                    {
                        "professional_run.start",
                        "professional_run.input",
                        "professional_run.resume",
                    }
                )
            )
        )
    }
    assert audits == {
        "professional_run.start": {
            "event": "professional_run_started",
            "status": "waiting_for_input",
        },
        "professional_run.input": {
            "event": "professional_run_input_supplied",
            "status": "waiting_for_model",
        },
        "professional_run.resume": {
            "event": "professional_run_resumed",
            "status": "waiting_for_model",
        },
    }


def test_professional_runner_persists_exactly_one_version_for_model_result(
    generation_db,
    client_for_user,
) -> None:
    from app.governance_models import AuditLog
    from app.models import AgentRunEvent, WorkArtifact, WorkArtifactVersion
    from app.professional_delivery.models import ReviewRun

    client = client_for_user("runner-result-owner")
    deliverable = _create_deliverable(client, generation_db)
    started = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "run-result-july"},
        json=_start_body(deliverable),
    )
    assert started.status_code == 202, started.text
    run = started.json()
    pending = run["pending_model_request"]
    path = (
        f"/api/ai/runs/{run['run_uuid']}/steps/"
        f"{pending['step_uuid']}/model-result"
    )
    body = {
        "one_time_token": pending["one_time_token"],
        "request_hash": pending["request_hash"],
        "content": GENERATED_CONTENT,
        "content_hash": _canonical_hash(GENERATED_CONTENT),
        "summary": "生成 2026 年 7 月安全运营月报",
        "model_metadata": {
            "model_profile_uuid": "local-openai-compatible-profile",
            "model_id": "local-model",
            "latency_ms": 321,
            "ignored_secret": "must-not-persist",
        },
    }

    invalid = client.post(path, json={**body, "one_time_token": "wrong-token"})
    assert invalid.status_code == 409
    assert invalid.json()["detail"]["code"] == "MODEL_STEP_TOKEN_INVALID"

    completed = client.post(path, json=body)
    assert completed.status_code == 200, completed.text
    payload = completed.json()
    assert payload["status"] == "completed"
    assert payload["phase"] == "persist"
    assert payload["created_version"]["version_no"] == 2
    assert payload["created_version"]["content"] == GENERATED_CONTENT
    assert payload["pending_model_request"] is None
    assert payload["quality_review"]["status"] == "passed"
    assert payload["quality_review"]["gates_passed"] is True
    assert len(payload["quality_review"]["category_results"]) == 7
    assert payload["quality_review"]["issues"] == []

    repeated = client.post(path, json=body)
    assert repeated.status_code == 409
    assert repeated.json()["detail"]["code"] == "MODEL_STEP_TOKEN_USED"

    artifact = generation_db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.uuid == deliverable["deliverable_uuid"]
        )
    )
    assert artifact is not None
    version_count = generation_db.scalar(
        select(func.count()).select_from(WorkArtifactVersion).where(
            WorkArtifactVersion.artifact_id == artifact.id
        )
    )
    assert version_count == 2
    reviews = list(
        generation_db.scalars(
            select(ReviewRun).where(ReviewRun.deliverable_id == artifact.id)
        )
    )
    assert len(reviews) == 1
    assert reviews[0].deliverable_version_id == artifact.current_version_id
    assert reviews[0].content_hash == payload["created_version"]["content_hash"]
    assert reviews[0].gates_passed is True
    assert artifact.lifecycle_status == "pending_approval"

    detail = client.get(f"/api/ai/runs/{run['run_uuid']}")
    assert detail.status_code == 200, detail.text
    professional = detail.json()["professional"]
    assert professional["status"] == "completed"
    assert (
        professional["created_version_uuid"]
        == payload["created_version"]["version_uuid"]
    )
    assert professional["allowed_actions"] == ["open_deliverable"]
    assert len(professional["stages"]) == 9
    assert all(stage["status"] == "succeeded" for stage in professional["stages"])
    assert all(stage["duration_ms"] >= 0 for stage in professional["stages"])
    assert next(
        stage for stage in professional["stages"] if stage["key"] == "persist"
    )["recover_action"] == "open_deliverable"
    assert "must-not-persist" not in json.dumps(
        detail.json(),
        ensure_ascii=False,
        sort_keys=True,
    )
    terminal_event = generation_db.scalar(
        select(AgentRunEvent)
        .where(AgentRunEvent.run_id == run["run_uuid"])
        .order_by(AgentRunEvent.sequence.desc())
        .limit(1)
    )
    assert terminal_event is not None
    assert terminal_event.event_type == "completed"
    assert terminal_event.stage == "completed"
    audits = {
        audit.action: audit.metadata_json
        for audit in generation_db.scalars(
            select(AuditLog).where(
                AuditLog.action.in_(
                    {
                        "professional_run.model_result",
                        "professional_deliverable.version.create",
                        "professional_deliverable.review.create",
                    }
                )
            )
        )
    }
    assert audits == {
        "professional_run.model_result": {
            "event": "professional_model_result_accepted",
            "status": "completed",
        },
        "professional_deliverable.version.create": {
            "event": "deliverable_version_created",
            "status": "completed",
        },
        "professional_deliverable.review.create": {
            "event": "deliverable_review_completed",
            "status": "passed",
            "record_count": 0,
        },
    }


def test_professional_runner_enforces_project_write_and_run_ownership(
    generation_db,
    client_for_user,
) -> None:
    owner = client_for_user("runner-project-owner")
    read_only = client_for_user("runner-project-reader")
    member = client_for_user("runner-project-member")
    outsider = client_for_user("runner-project-outsider")
    project = _create_project(
        owner,
        name="Runner 项目权限",
        members=[
            ("runner-project-reader", "read_only"),
            ("runner-project-member", "member"),
        ],
    )
    deliverable = _create_deliverable(
        owner,
        generation_db,
        key="runner-project-deliverable",
        scope_type="project",
        project_uuid=project["project_uuid"],
    )
    path = f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs"

    forbidden = read_only.post(
        path,
        headers={"Idempotency-Key": "runner-read-only-start"},
        json=_start_body(deliverable),
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"]["code"] == "PROJECT_DELIVERABLE_WRITE_FORBIDDEN"

    started = member.post(
        path,
        headers={"Idempotency-Key": "runner-member-start"},
        json=_start_body(deliverable),
    )
    assert started.status_code == 202, started.text
    run = started.json()
    assert outsider.get(f"/api/ai/runs/{run['run_uuid']}").status_code == 404
    hidden_input = outsider.post(
        f"/api/ai/runs/{run['run_uuid']}/input",
        headers={"Idempotency-Key": "runner-outsider-input"},
        json={"inputs": {"period": "2026-08"}},
    )
    assert hidden_input.status_code == 404
    assert hidden_input.json()["detail"]["code"] == "PROFESSIONAL_RUN_NOT_FOUND"


def test_professional_runner_server_pins_only_project_authorized_resources(
    generation_db,
    client_for_user,
) -> None:
    from app.models import AgentRun
    from app.professional_delivery.models import ProfessionalRunBinding

    owner = client_for_user("runner-resource-owner")
    project_a = _create_project(owner, name="Runner 资源项目 A")
    project_b = _create_project(owner, name="Runner 资源项目 B")
    deliverable = _create_deliverable(
        owner,
        generation_db,
        key="runner-resource-deliverable",
        scope_type="project",
        project_uuid=project_a["project_uuid"],
    )
    file_a = _seed_project_file(
        generation_db,
        project_uuid=project_a["project_uuid"],
        owner_user_id="runner-resource-owner",
        file_uuid="00000000-0000-4000-8000-0000000000a1",
        content_hash="a" * 64,
    )
    file_b = _seed_project_file(
        generation_db,
        project_uuid=project_b["project_uuid"],
        owner_user_id="runner-resource-owner",
        file_uuid="00000000-0000-4000-8000-0000000000b2",
        content_hash="b" * 64,
    )
    path = f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs"

    injected = owner.post(
        path,
        headers={"Idempotency-Key": "runner-cross-project-resource"},
        json=_start_body(
            deliverable,
            resource_refs=[
                {
                    "resource_type": "knowledge_file",
                    "resource_uuid": file_b.uuid,
                }
            ],
        ),
    )
    assert injected.status_code == 404
    assert injected.json()["detail"]["code"] == "PROFESSIONAL_RESOURCE_NOT_FOUND"
    assert generation_db.scalar(select(func.count()).select_from(AgentRun)) == 0
    assert (
        generation_db.scalar(select(func.count()).select_from(ProfessionalRunBinding))
        == 0
    )

    started = owner.post(
        path,
        headers={"Idempotency-Key": "runner-authorized-project-resource"},
        json=_start_body(
            deliverable,
            resource_refs=[
                {
                    "resource_type": "knowledge_file",
                    "resource_uuid": file_a.uuid,
                    "version_uuid": "attacker-controlled-version",
                    "content_hash": "f" * 64,
                }
            ],
        ),
    )
    assert started.status_code == 202, started.text
    payload = started.json()
    expected = [
        {
            "resource_type": "knowledge_file",
            "resource_uuid": file_a.uuid,
            "version_uuid": file_a.uuid,
            "content_hash": file_a.content_sha256,
        }
    ]
    assert payload["pending_model_request"]["context"]["authorized_resources"] == expected
    assert file_b.uuid not in json.dumps(
        payload["pending_model_request"],
        ensure_ascii=False,
        sort_keys=True,
    )
    binding = generation_db.scalar(
        select(ProfessionalRunBinding).where(
            ProfessionalRunBinding.agent_run_uuid == payload["run_uuid"]
        )
    )
    assert binding is not None
    assert binding.resource_refs_json == expected


def test_professional_runner_cancel_revokes_active_model_token(
    generation_db,
    client_for_user,
) -> None:
    from app.governance_models import AuditLog
    from app.models import AgentRunEvent
    from app.professional_delivery.models import ProfessionalModelStepToken

    client = client_for_user("runner-cancel-owner")
    deliverable = _create_deliverable(client, generation_db)
    started = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "runner-cancel-start"},
        json=_start_body(deliverable),
    )
    assert started.status_code == 202, started.text
    run = started.json()
    pending = run["pending_model_request"]

    cancelled = client.post(f"/api/ai/runs/{run['run_uuid']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    detail = client.get(f"/api/ai/runs/{run['run_uuid']}")
    assert detail.status_code == 200, detail.text
    professional = detail.json()["professional"]
    assert professional["status"] == "cancelled"
    assert professional["allowed_actions"] == []
    assert next(
        stage for stage in professional["stages"] if stage["key"] == "draft"
    )["status"] == "cancelled"

    rejected = client.post(
        f"/api/ai/runs/{run['run_uuid']}/steps/{pending['step_uuid']}/model-result",
        json={
            "one_time_token": pending["one_time_token"],
            "request_hash": pending["request_hash"],
            "content": GENERATED_CONTENT,
            "content_hash": _canonical_hash(GENERATED_CONTENT),
            "summary": "取消后不得写入",
            "model_metadata": {},
        },
    )
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "MODEL_STEP_TOKEN_REVOKED"
    token = generation_db.scalar(
        select(ProfessionalModelStepToken).where(
            ProfessionalModelStepToken.agent_run_uuid == run["run_uuid"]
        )
    )
    assert token is not None and token.revoked_at is not None
    terminal_event = generation_db.scalar(
        select(AgentRunEvent)
        .where(AgentRunEvent.run_id == run["run_uuid"])
        .order_by(AgentRunEvent.sequence.desc())
        .limit(1)
    )
    assert terminal_event is not None
    assert terminal_event.event_type == "cancelled"
    assert terminal_event.stage == "cancelled"
    audits = list(
        generation_db.scalars(
            select(AuditLog).where(AuditLog.action == "professional_run.cancel")
        )
    )
    assert len(audits) == 1
    assert audits[0].entity_uuid == run["run_uuid"]
    assert audits[0].metadata_json == {
        "event": "professional_run_cancelled",
        "status": "cancelled",
    }


def test_professional_runner_cancel_audit_failure_rolls_back_revocation(
    generation_db,
    client_for_user,
    monkeypatch,
) -> None:
    from app.professional_delivery import runner_routes
    from app.professional_delivery.models import (
        ProfessionalModelStepToken,
        ProfessionalRunBinding,
    )

    client = client_for_user("runner-cancel-audit-failure-owner")
    deliverable = _create_deliverable(client, generation_db)
    started = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "runner-cancel-audit-failure-start"},
        json=_start_body(deliverable),
    )
    assert started.status_code == 202, started.text
    run_uuid = started.json()["run_uuid"]

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(
        runner_routes,
        "write_request_audit",
        fail_audit,
        raising=False,
    )
    with pytest.raises(RuntimeError, match="audit unavailable"):
        client.post(f"/api/ai/runs/{run_uuid}/cancel")

    generation_db.expire_all()
    binding = generation_db.scalar(
        select(ProfessionalRunBinding).where(
            ProfessionalRunBinding.agent_run_uuid == run_uuid
        )
    )
    token = generation_db.scalar(
        select(ProfessionalModelStepToken).where(
            ProfessionalModelStepToken.agent_run_uuid == run_uuid
        )
    )
    assert binding is not None and binding.status == "waiting_for_model"
    assert token is not None and token.revoked_at is None


def test_professional_runner_rejects_budget_below_fixed_workflow(
    generation_db,
    client_for_user,
) -> None:
    from app.models import AgentRun
    from app.professional_delivery.models import ProfessionalRunBinding

    client = client_for_user("runner-budget-owner")
    deliverable = _create_deliverable(client, generation_db)
    response = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "runner-too-small-budget"},
        json=_start_body(deliverable, max_steps=9),
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PROFESSIONAL_RUN_BUDGET_TOO_SMALL"
    assert generation_db.scalar(select(func.count()).select_from(AgentRun)) == 0
    assert (
        generation_db.scalar(select(func.count()).select_from(ProfessionalRunBinding))
        == 0
    )


def test_professional_runner_start_writes_body_free_audit(
    generation_db,
    client_for_user,
) -> None:
    from app.governance_models import AuditLog

    client = client_for_user("runner-audit-owner")
    deliverable = _create_deliverable(client, generation_db)
    response = client.post(
        f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
        headers={"Idempotency-Key": "runner-audited-start"},
        json=_start_body(
            deliverable,
            inputs={
                "period": "2026-07",
                "operator_notes": "不得进入审计日志的敏感说明",
            },
        ),
    )
    assert response.status_code == 202, response.text
    audits = list(
        generation_db.scalars(
            select(AuditLog).where(AuditLog.action == "professional_run.start")
        )
    )
    assert len(audits) == 1
    assert audits[0].entity_uuid == response.json()["run_uuid"]
    assert audits[0].metadata_json == {
        "event": "professional_run_started",
        "status": "waiting_for_model",
    }
    assert "敏感说明" not in json.dumps(
        audits[0].metadata_json,
        ensure_ascii=False,
        sort_keys=True,
    )


def test_professional_runner_audit_failure_rolls_back_start(
    generation_db,
    client_for_user,
    monkeypatch,
) -> None:
    from app.models import AgentRun
    from app.professional_delivery import runner_routes
    from app.professional_delivery.models import (
        ProfessionalModelStepToken,
        ProfessionalRunBinding,
    )

    client = client_for_user("runner-audit-failure-owner")
    deliverable = _create_deliverable(client, generation_db)

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(
        runner_routes,
        "write_request_audit",
        fail_audit,
        raising=False,
    )
    with pytest.raises(RuntimeError, match="audit unavailable"):
        client.post(
            f"/api/ai/deliverables/{deliverable['deliverable_uuid']}/runs",
            headers={"Idempotency-Key": "runner-audit-failure"},
            json=_start_body(deliverable),
        )

    assert generation_db.scalar(select(func.count()).select_from(AgentRun)) == 0
    assert (
        generation_db.scalar(select(func.count()).select_from(ProfessionalRunBinding))
        == 0
    )
    assert (
        generation_db.scalar(select(func.count()).select_from(ProfessionalModelStepToken))
        == 0
    )
