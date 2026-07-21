import json
from pathlib import Path

from sqlalchemy import select


def _runtime_root(tmp_path: Path) -> Path:
    root = tmp_path / "dashi-runtime" / "project"
    (root / "scripts").mkdir(parents=True)
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
    assert isinstance(spec["slides"][-1]["props"]["meta"], list)


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
        assert first["execution_mode"] == "background"
        assert "PPT" in first["execution_reason"]
        ppt_instruction = "\n".join(
            item["content"] for item in first["messages"] if item["role"] == "system"
        )
        assert "Dashi PPT" in ppt_instruction
        assert "真实 PPTX" in ppt_instruction

        completed = client.post(
            f"/api/ai/chat/messages/{first['assistant_message_uuid']}/complete",
            json={
                "completion_token": first["completion_token"],
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
        second = revision.json()
        assert second["execution_mode"] == "background"
        assert "PPT" in second["execution_reason"]
        revision_instruction = "\n".join(
            item["content"] for item in second["messages"] if item["role"] == "system"
        )
        assert "2026 年度经营汇报" in revision_instruction
        assert "上一版" in revision_instruction

        revised = client.post(
            f"/api/ai/chat/messages/{second['assistant_message_uuid']}/complete",
            json={
                "completion_token": second["completion_token"],
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
