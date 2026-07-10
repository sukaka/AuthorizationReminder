from app.governance_models import AuditLog
from app.models import Assistant, AssistantModeVersion, GenerationRecord, WorkArtifact


def _mode_payload(**overrides):
    payload = {
        "code": "security-operations",
        "name": "安全运维助手",
        "description": "用于安全运维报告和排障材料。",
        "icon": "shield",
        "allowed_tools": ["company_knowledge_search", "word_export"],
        "default_source_scope": "company",
        "default_output_structure": "背景、处置过程、风险、下一步",
        "word_template": "juxin_standard",
        "test_cases": [{"name": "运维报告", "input": "生成月度运维报告"}],
        "review_status": "approved",
    }
    payload.update(overrides)
    return payload


def test_admin_creates_and_enables_mode_without_changing_existing_mode(
    client_for_user,
    generation_db,
    seeded_task,
) -> None:
    admin = client_for_user("mode-admin", role="admin")
    employee = client_for_user("mode-employee")
    existing = generation_db.query(Assistant).filter_by(code="general").one()

    created = admin.post("/api/ai/admin/assistant-modes", json=_mode_payload())
    enabled = admin.post(
        f"/api/ai/admin/assistant-modes/{created.json()['uuid']}/enable"
    )
    catalog = employee.get("/api/ai/catalog")

    assert created.status_code == 201
    assert created.json()["status"] == "DRAFT"
    assert created.json()["version"] == 1
    assert enabled.status_code == 200
    assert enabled.json()["status"] == "ACTIVE"
    assert enabled.json()["allowed_tools"] == ["company_knowledge_search", "word_export"]
    assert generation_db.get(Assistant, existing.id).status == "ACTIVE"
    assert {item["code"] for item in catalog.json()["assistants"]} >= {
        "general",
        "security-operations",
    }
    created_row = generation_db.query(Assistant).filter_by(code="security-operations").one()
    assert generation_db.query(AssistantModeVersion).filter_by(
        assistant_id=created_row.id
    ).count() == 2
    assert generation_db.query(AuditLog).filter(
        AuditLog.action.in_(("assistant_mode.create", "assistant_mode.enable"))
    ).count() == 2


def test_disabled_mode_is_hidden_but_historical_generation_remains_readable(
    client_for_user,
    generation_db,
    records,
) -> None:
    admin = client_for_user("mode-admin", role="admin")
    employee = client_for_user("u-1")
    general = generation_db.query(Assistant).filter_by(code="general").one()

    disabled = admin.post(f"/api/ai/admin/assistant-modes/{general.uuid}/disable")
    catalog = employee.get("/api/ai/catalog")
    history = employee.get("/api/ai/generations")

    assert disabled.status_code == 200
    assert disabled.json()["status"] == "DISABLED"
    assert "general" not in {item["code"] for item in catalog.json()["assistants"]}
    assert records.u1.uuid in {item["uuid"] for item in history.json()["items"]}


def test_mode_test_run_writes_no_generation_or_work_artifact(
    client_for_user,
    generation_db,
    seeded_task,
) -> None:
    admin = client_for_user("mode-admin", role="admin")
    general = generation_db.query(Assistant).filter_by(code="general").one()
    general.default_output_structure = "摘要、正文、下一步"
    generation_db.commit()
    before_generations = generation_db.query(GenerationRecord).count()
    before_artifacts = generation_db.query(WorkArtifact).count()

    result = admin.post(
        f"/api/ai/admin/assistant-modes/{general.uuid}/test",
        json={"input": "生成一份内部周报"},
    )

    assert result.status_code == 200
    assert result.json()["status"] == "passed"
    assert result.json()["persisted"] is False
    assert generation_db.query(GenerationRecord).count() == before_generations
    assert generation_db.query(WorkArtifact).count() == before_artifacts


def test_failed_mode_configuration_can_roll_back(
    client_for_user,
    generation_db,
    seeded_task,
) -> None:
    admin = client_for_user("mode-admin", role="admin")
    general = generation_db.query(Assistant).filter_by(code="general").one()
    baseline = admin.get(f"/api/ai/admin/assistant-modes/{general.uuid}").json()

    broken = admin.put(
        f"/api/ai/admin/assistant-modes/{general.uuid}",
        json={
            **_mode_payload(
                code="general",
                name="通用助手",
                allowed_tools=["missing_tool"],
            ),
        },
    )
    failed_test = admin.post(
        f"/api/ai/admin/assistant-modes/{general.uuid}/test",
        json={"input": "测试"},
    )
    rolled_back = admin.post(
        f"/api/ai/admin/assistant-modes/{general.uuid}/rollback",
        json={"version": baseline["version"]},
    )

    assert broken.status_code == 200
    assert broken.json()["version"] == baseline["version"] + 1
    assert failed_test.json()["status"] == "failed"
    assert failed_test.json()["issues"] == ["工具不可用：missing_tool"]
    assert rolled_back.status_code == 200
    assert rolled_back.json()["allowed_tools"] == baseline["allowed_tools"]
    assert rolled_back.json()["version"] == baseline["version"] + 2
    assert generation_db.query(AuditLog).filter_by(action="assistant_mode.rollback").count() == 1
