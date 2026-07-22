import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import select


def _runtime_root(tmp_path: Path) -> Path:
    root = tmp_path / "dashi-runtime" / "project"
    (root / "scripts").mkdir(parents=True)
    (root / "node_modules").mkdir()
    (root / "package.json").write_text(
        '{"scripts":{"render:goal":"tsx scripts/render-goal-deck.jsx",'
        '"export:pptx":"node scripts/export-pptx.mjs"}}',
        encoding="utf-8",
    )
    (root / "scripts" / "render-goal-deck.jsx").write_text("", encoding="utf-8")
    (root / "scripts" / "export-pptx.mjs").write_text("", encoding="utf-8")
    return root


def test_chat_ppt_intent_distinguishes_create_revision_and_information() -> None:
    from app.chat_ppt_workflow import detect_dashi_ppt_intent

    assert detect_dashi_ppt_intent("帮我制作一份年度经营汇报PPT") == "create"
    assert detect_dashi_ppt_intent("把上一版第二页改成风险分析", has_previous=True) == "revise"
    assert detect_dashi_ppt_intent("把第二页改成风险分析", has_previous=True) == "revise"
    assert detect_dashi_ppt_intent("把第二页改成风险分析") is None
    assert detect_dashi_ppt_intent("把上一版第二页改成风险分析") is None
    assert detect_dashi_ppt_intent("PPT 是什么意思") is None
    assert detect_dashi_ppt_intent("如何制作一份好看的 PPT") is None


def test_chat_ppt_confirmation_requires_style_and_media_choice() -> None:
    from app.chat_ppt_workflow import (
        ChatPptContext,
        _parse_ppt_selection,
        build_chat_ppt_confirmation_message,
    )

    message = build_chat_ppt_confirmation_message(ChatPptContext(
        intent="create",
        previous_goal=None,
        source_question="制作年度经营汇报 PPT",
        theme_pack="theme05",
        requires_confirmation=True,
    ))
    assert message.startswith("# 大师 PPT 制作前确认")
    assert "theme01" in message
    assert "theme12" in message
    assert "![大师 PPT 主题风格预览](/api/skills/dashi-ppt/theme-preview)" in message
    assert "需要图片" in message

    selected = _parse_ppt_selection(
        "风格：theme08；需要图片",
        fallback_question="制作年度经营汇报 PPT",
    )
    assert selected.theme_pack == "theme08"
    assert selected.needs_media is True
    assert selected.is_complete

    auto_selected = _parse_ppt_selection(
        "你来定；不需要图片",
        fallback_question="制作年度经营汇报 PPT",
    )
    assert auto_selected.theme_pack == "theme05"
    assert auto_selected.needs_media is False


def test_dashi_ppt_theme_preview_uses_the_fixed_runtime_asset(client_for_user, tmp_path) -> None:
    from app.config import get_settings
    from app.dashi_ppt_runtime import dashi_ppt_theme_preview_path
    from app.main import app

    runtime_root = _runtime_root(tmp_path)
    preview_path = runtime_root.parent / "assets" / "skill" / "theme-style-grid.png"
    preview_path.parent.mkdir(parents=True)
    preview_path.write_bytes(b"theme-preview")
    settings = get_settings().model_copy(update={"dashi_ppt_runtime_root": str(runtime_root)})
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        assert dashi_ppt_theme_preview_path(settings) == preview_path
        response = client_for_user("chat-ppt-owner").get("/api/skills/dashi-ppt/theme-preview")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/png")
        assert response.content == b"theme-preview"
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_chat_answer_becomes_complete_dashi_goal_spec() -> None:
    from app.chat_ppt_workflow import build_dashi_goal_spec

    spec = build_dashi_goal_spec(
        """# 2026 年度经营汇报

        用数据解释增长，用行动解决风险。

        ## 经营总览
        - 营收同比增长 18%
        - 核心客户续约率达到 92%

        ## 风险与行动
        - 华东交付产能仍有缺口
        - 8 月前完成外部资源补充
        """,
        question="制作年度经营汇报 PPT",
    )

    assert spec["title"] == "2026 年度经营汇报"
    assert len(spec["slides"]) == 4
    encoded = json.dumps(spec, ensure_ascii=False)
    assert "营收同比增长 18%" in encoded
    assert "8 月前完成外部资源补充" in encoded
    assert "围绕用户问题组织内容" not in encoded
    layouts = [slide["layout"] for slide in spec["slides"]]
    assert len(layouts) == len(set(layouts))
    assert isinstance(spec["slides"][0]["props"]["meta"], list)
    assert spec["slides"][0]["props"]["chipCount"] == 3
    assert spec["slides"][0]["props"]["metaCount"] == 3
    assert isinstance(spec["slides"][-1]["props"]["meta"], list)


def test_chat_goal_uses_selected_theme_scaffold(monkeypatch) -> None:
    from app import chat_ppt_workflow

    captured: dict = {}

    def fake_scaffold(**kwargs):
        captured.update(kwargs)
        return {"title": kwargs["title"], "themePack": kwargs["theme_pack"], "slides": []}

    monkeypatch.setattr(chat_ppt_workflow, "build_scaffolded_dashi_goal_spec", fake_scaffold)
    spec = chat_ppt_workflow.build_dashi_goal_spec(
        "# 科技产品发布\n\n## 核心能力\n- 实现智能编排",
        question="制作科技产品发布 PPT",
        theme_pack="theme08",
        needs_media=True,
        settings=object(),
    )

    assert spec["themePack"] == "theme08"
    assert captured["theme_pack"] == "theme08"
    assert captured["needs_media"] is True


def test_chat_goal_uses_unique_layouts_for_maximum_supported_deck() -> None:
    from app.chat_ppt_workflow import build_dashi_goal_spec

    sections = "\n\n".join(
        f"## 第 {index} 部分\n- 第 {index} 部分判断\n- 第 {index} 部分行动"
        for index in range(1, 11)
    )
    spec = build_dashi_goal_spec(
        f"# 完整业务汇报\n\n围绕目标形成完整方案。\n\n{sections}",
        question="制作完整业务汇报 PPT",
    )

    layouts = [slide["layout"] for slide in spec["slides"]]
    assert len(spec["slides"]) == 10
    assert len(layouts) == len(set(layouts))
    assert layouts[0] == "theme01_page001"
    assert layouts[-1] == "theme01_page084"


def test_chat_generates_and_revises_real_dashi_ppt(
    client_for_user,
    generation_db,
    tmp_path,
    monkeypatch,
) -> None:
    from app import dashi_ppt_runtime
    from app.config import get_settings
    from app.main import app
    from app.models import SkillRunLog

    settings = get_settings().model_copy(update={
        "dashi_ppt_runtime_root": str(_runtime_root(tmp_path)),
        "export_storage_dir": str(tmp_path / "exports"),
    })

    def fake_run_npm(root, args, settings, *, phase):
        target = Path(args[-1])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"generated-" + phase.encode("ascii"))
        if phase == "render":
            assets = target.parent / "assets"
            (assets / "fonts").mkdir(parents=True, exist_ok=True)
            (assets / "imported-theme-runtime.js").write_text("runtime", encoding="utf-8")
            (assets / "fonts" / "mock.woff2").write_bytes(b"font")

    monkeypatch.setattr(dashi_ppt_runtime, "_run_npm", fake_run_npm)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = client_for_user("chat-ppt-owner")
        prepared = client.post(
            "/api/ai/chat/prepare",
            json={"question": "帮我制作一份年度经营汇报 PPT", "mode": "normal"},
        )
        assert prepared.status_code == 201, prepared.text
        first = prepared.json()
        assert first["completed"] is True
        assert first["completion_token"] == ""
        assert first["answer"].startswith("# 大师 PPT 制作前确认")
        assert "theme01" in first["answer"]
        assert "theme12" in first["answer"]
        assert "/api/skills/dashi-ppt/theme-preview" in first["answer"]

        selected = client.post(
            "/api/ai/chat/prepare",
            json={
                "session_uuid": first["session_uuid"],
                "question": "主题：年度经营汇报；风格：theme01；不需要图片",
                "mode": "normal",
            },
        )
        assert selected.status_code == 201, selected.text
        generation = selected.json()
        assert generation["completed"] is False
        assert generation["execution_mode"] == "background"
        assert "PPT" in generation["execution_reason"]
        ppt_instruction = "\n".join(
            item["content"] for item in generation["messages"] if item["role"] == "system"
        )
        assert "Dashi PPT" in ppt_instruction
        assert "真实 PPTX" in ppt_instruction
        assert "theme01" in ppt_instruction

        completed = client.post(
            f"/api/ai/chat/messages/{generation['assistant_message_uuid']}/complete",
            json={
                "completion_token": generation["completion_token"],
                "answer": (
                    "# 2026 年度经营汇报\n\n"
                    "用数据解释增长。\n\n"
                    "## 经营总览\n- 营收同比增长 18%\n- 续约率达到 92%\n\n"
                    "## 下一步\n- 补齐交付资源\n- 建立周度复盘"
                ),
                "model_display_name": "DeepSeek",
                "model_id": "deepseek-chat",
            },
        )
        assert completed.status_code == 200, completed.text
        files = completed.json()["generated_files"]
        assert [item["format"] for item in files] == ["html", "pptx"]
        assert files[0]["file_name"] == "presentation-html.zip"
        html_download = client.get(files[0]["download_url"])
        assert html_download.headers["content-type"].startswith("application/zip")
        with ZipFile(BytesIO(html_download.content)) as package:
            assert {
                "index.html",
                "assets/imported-theme-runtime.js",
                "assets/fonts/mock.woff2",
            }.issubset(package.namelist())
        assert client.get(files[1]["download_url"]).content == b"generated-pptx"

        first_run = generation_db.scalar(
            select(SkillRunLog)
            .where(SkillRunLog.skill_id == "dashi-ppt")
            .order_by(SkillRunLog.id.desc())
        )
        assert first_run is not None
        assert first_run.task_id == f"chat:{first['session_uuid']}"
        assert first_run.status == "completed"

        revision = client.post(
            "/api/ai/chat/prepare",
            json={
                "session_uuid": first["session_uuid"],
                "question": "把上一版第二页改成风险分析",
                "mode": "normal",
            },
        )
        assert revision.status_code == 201, revision.text
        revision_request = revision.json()
        assert revision_request["execution_mode"] == "background"
        assert "PPT" in revision_request["execution_reason"]
        revision_instruction = "\n".join(
            item["content"] for item in revision_request["messages"] if item["role"] == "system"
        )
        assert "2026 年度经营汇报" in revision_instruction
        assert "上一版" in revision_instruction

        revised = client.post(
            f"/api/ai/chat/messages/{revision_request['assistant_message_uuid']}/complete",
            json={
                "completion_token": revision_request["completion_token"],
                "answer": (
                    "# 2026 年度经营汇报（修订版）\n\n"
                    "用行动控制风险。\n\n"
                    "## 风险分析\n- 华东交付产能不足\n- 建立红黄灯机制\n\n"
                    "## 下一步\n- 8 月前补齐资源"
                ),
                "model_display_name": "DeepSeek",
                "model_id": "deepseek-chat",
            },
        )
        assert revised.status_code == 200, revised.text
        revised_files = revised.json()["generated_files"]
        assert [item["format"] for item in revised_files] == ["html", "pptx"]
        assert revised_files[1]["artifact_id"] != files[1]["artifact_id"]

        runs = list(generation_db.scalars(
            select(SkillRunLog)
            .where(SkillRunLog.skill_id == "dashi-ppt")
            .order_by(SkillRunLog.id.asc())
        ))
        assert len(runs) == 2
        revised_goal = (
            tmp_path
            / "exports"
            / "dashi-ppt"
            / "chat-ppt-owner"
            / runs[-1].uuid
            / "goal.json"
        )
        assert "华东交付产能不足" in revised_goal.read_text(encoding="utf-8")
    finally:
        app.dependency_overrides.pop(get_settings, None)
