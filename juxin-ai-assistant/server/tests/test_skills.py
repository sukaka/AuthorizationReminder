from __future__ import annotations


def test_skill_registry_loads_builtin_published_skills() -> None:
    from app.skill_registry import SkillRegistry

    registry = SkillRegistry.default()
    items = registry.list_skills()

    assert {item.id for item in items} >= {
        "risk-assessment-review",
        "incident-report",
        "tool-update-record",
    }
    risk = registry.get("risk-assessment-review")
    assert risk.name == "风险评估过程文档审查"
    assert risk.requires_attachment is True
    assert "file_parser" in risk.allowed_tools
    assert risk.permissions.allow_web is False


def test_dashi_ppt_is_registered_as_safe_company_skill() -> None:
    from app.skill_registry import SkillRegistry

    registry = SkillRegistry.default()
    dashi = registry.get("dashi-ppt")

    assert dashi.status == "published"
    assert dashi.manifest.scope == "company"
    assert dashi.manifest.owner == "platform-admin"
    assert dashi.permissions.allow_web is False
    assert dashi.manifest.output_types == ["markdown", "html", "pptx", "pdf"]
    assert "pptx" in dashi.manifest.output_types
    assert "DASHI_PPT_RUNTIME_ROOT" in dashi.readme
    assert dashi.input_schema["required"] == ["question"]
    assert dashi.output_schema["properties"]["export"]["required"] == [
        "html",
        "pptx",
        "pdf",
    ]

    candidates = registry.match("请帮我制作一份客户汇报 PPT")
    assert any(item.id == "dashi-ppt" for item in candidates)


def test_default_skill_root_supports_container_layout(tmp_path, monkeypatch) -> None:
    from app import skill_registry

    app_root = tmp_path / "app"
    module_dir = app_root / "app"
    skill_root = app_root / "agent-harness" / "skills"
    module_dir.mkdir(parents=True)
    skill_root.mkdir(parents=True)
    monkeypatch.setattr(skill_registry, "__file__", str(module_dir / "skill_registry.py"))

    assert skill_registry.default_skill_root() == skill_root


def test_employee_lists_only_published_skills_and_runs_with_restricted_tools(
    client_for_user,
    generation_db,
) -> None:
    from app.models import AgentToolCallLog, SkillRunLog

    client = client_for_user("employee-skill")

    list_response = client.get("/api/skills")
    assert list_response.status_code == 200
    skill_ids = {item["id"] for item in list_response.json()["items"]}
    assert {
        "risk-assessment-review",
        "incident-report",
        "tool-update-record",
        "dashi-ppt",
    } <= skill_ids

    run_response = client.post(
        "/api/skills/risk-assessment-review/run",
        json={
            "task_id": "task-risk-1",
            "input": {
                "question": "请审查这份风险评估过程文档",
                "attachments": [{"name": "风险评估.docx", "file_type": "docx"}],
            },
        },
    )

    assert run_response.status_code == 200
    payload = run_response.json()
    assert payload["skill_id"] == "risk-assessment-review"
    assert payload["status"] == "completed"
    assert payload["artifacts"][0]["kind"] == "markdown"
    assert "不符合项" in payload["result"]["summary"]

    run_log = generation_db.query(SkillRunLog).one()
    assert run_log.skill_id == "risk-assessment-review"
    assert run_log.user_id == "employee-skill"
    assert run_log.status == "completed"
    assert set(run_log.tools_used_json) <= {
        "file_parse",
        "company_knowledge_search",
        "word_export",
        "personal_memory",
    }

    tool_logs = generation_db.query(AgentToolCallLog).all()
    assert [item.tool_name for item in tool_logs] == ["personal_memory"]
    assert tool_logs[0].run_id == run_log.uuid


def test_skill_run_rejects_disallowed_file_types(client_for_user) -> None:
    client = client_for_user("employee-skill")

    response = client.post(
        "/api/skills/risk-assessment-review/run",
        json={
            "input": {
                "question": "请审查这份压缩包",
                "attachments": [{"name": "材料.zip", "file_type": "zip"}],
            },
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "SKILL_INPUT_TYPE_NOT_ALLOWED"


def test_unpublished_skills_are_hidden_from_employee_and_visible_to_admin(
    client_for_user,
    tmp_path,
    monkeypatch,
) -> None:
    from app.skill_registry import SkillRegistry

    root = tmp_path / "skills"
    draft = root / "draft-skill"
    (draft / "prompts").mkdir(parents=True)
    (draft / "schemas").mkdir()
    (draft / "examples").mkdir()
    (draft / "eval").mkdir()
    (draft / "skill.json").write_text(
        """{
          "id": "draft-skill",
          "name": "草稿能力",
          "description": "普通用户不可见",
          "category": "draft",
          "version": "0.1.0",
          "status": "draft",
          "scope": "company",
          "owner": "admin",
          "requires_attachment": false,
          "allowed_tools": ["personal_memory"],
          "input_types": ["text"],
          "output_types": ["markdown"],
          "permissions": {
            "allow_web": false,
            "allow_company_knowledge": false,
            "allow_personal_memory": true,
            "allow_write_company_kb": false
          },
          "review": {
            "required_for_publish": true,
            "reviewer_role": "admin"
          },
          "tags": ["草稿"]
        }""",
        encoding="utf-8",
    )
    (draft / "SKILL.md").write_text("# 草稿能力\n", encoding="utf-8")
    (draft / "prompts" / "system.md").write_text("系统", encoding="utf-8")
    (draft / "prompts" / "task.md").write_text("任务", encoding="utf-8")
    (draft / "prompts" / "output.md").write_text("输出", encoding="utf-8")
    (draft / "schemas" / "input.schema.json").write_text("{}", encoding="utf-8")
    (draft / "schemas" / "output.schema.json").write_text("{}", encoding="utf-8")
    (draft / "examples" / "good.md").write_text("好", encoding="utf-8")
    (draft / "examples" / "bad.md").write_text("坏", encoding="utf-8")
    (draft / "eval" / "checklist.md").write_text("检查", encoding="utf-8")

    from app.main import app
    from app.skill_routes import get_skill_registry

    registry = SkillRegistry(root)
    app.dependency_overrides[get_skill_registry] = lambda: registry
    try:
        employee = client_for_user("employee-skill")
        assert employee.get("/api/skills").json()["items"] == []

        admin = client_for_user("admin-skill", role="admin")
        admin_response = admin.get("/api/admin/skills")
        assert admin_response.status_code == 200
        assert admin_response.json()["items"][0]["id"] == "draft-skill"
    finally:
        app.dependency_overrides.pop(get_skill_registry, None)


def test_admin_can_review_publish_and_disable_skill(client_for_user, generation_db) -> None:
    from app.models import SkillReview

    admin = client_for_user("admin-skill", role="admin")

    review = admin.post(
        "/api/admin/skills/risk-assessment-review/review",
        json={"status": "approved", "comment": "通过"},
    )
    assert review.status_code == 200
    assert review.json()["status"] == "approved"

    publish = admin.post("/api/admin/skills/risk-assessment-review/publish")
    assert publish.status_code == 200
    assert publish.json()["status"] == "published"

    disable = admin.post("/api/admin/skills/risk-assessment-review/disable")
    assert disable.status_code == 200
    assert disable.json()["status"] == "disabled"

    saved_review = generation_db.query(SkillReview).one()
    assert saved_review.skill_id == "risk-assessment-review"
    assert saved_review.reviewer_id == "admin-skill"
    assert saved_review.status == "approved"


def test_intent_route_returns_matching_skill_candidates(client_for_user) -> None:
    client = client_for_user("employee-skill")

    response = client.post(
        "/api/ai/intent/route",
        json={"query": "帮我生成安全事件分析报告"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["skill_candidates"][0]["skill_id"] == "incident-report"
    assert data["skill_candidates"][0]["skill_name"] == "安全事件分析报告生成"
