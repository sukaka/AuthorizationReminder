from pathlib import Path

import pytest


def _runtime_root(tmp_path: Path) -> Path:
    root = tmp_path / "dashi-runtime" / "project"
    (root / "scripts").mkdir(parents=True)
    (root / "package.json").write_text(
        '{"scripts":{"render:goal":"tsx scripts/render-goal-deck.jsx",'
        '"export:pptx":"node scripts/export-pptx.mjs",'
        '"export:pdf":"node scripts/export-pptx.mjs --pdf"}}',
        encoding="utf-8",
    )
    (root / "scripts" / "render-goal-deck.jsx").write_text("", encoding="utf-8")
    (root / "scripts" / "export-pptx.mjs").write_text("", encoding="utf-8")
    return root


def test_dashi_ppt_fails_closed_when_runtime_is_not_configured(tmp_path):
    from app.config import get_settings
    from app.dashi_ppt_runtime import DashiPptRuntimeError, generate_dashi_ppt

    settings = get_settings().model_copy(update={
        "dashi_ppt_runtime_root": "",
        "export_storage_dir": str(tmp_path / "exports"),
    })

    with pytest.raises(DashiPptRuntimeError, match="DASHI_PPT_RUNTIME_UNAVAILABLE"):
        generate_dashi_ppt(
            settings=settings,
            user_id="employee-1",
            run_id="run-1",
            question="制作客户汇报",
            user_input={"question": "制作客户汇报"},
        )


def test_dashi_ppt_generates_requested_artifacts_in_isolated_run_dir(tmp_path, monkeypatch):
    from app.config import get_settings
    from app import dashi_ppt_runtime

    runtime_root = _runtime_root(tmp_path)
    settings = get_settings().model_copy(update={
        "dashi_ppt_runtime_root": str(runtime_root),
        "export_storage_dir": str(tmp_path / "exports"),
    })

    def fake_run_npm(root, args, settings, *, phase):
        target = Path(args[-1])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"generated-" + phase.encode("ascii"))

    monkeypatch.setattr(dashi_ppt_runtime, "_run_npm", fake_run_npm)
    title, artifacts = dashi_ppt_runtime.generate_dashi_ppt(
        settings=settings,
        user_id="employee/with-spaces",
        run_id="run-1",
        question="客户年度经营汇报",
        user_input={
            "question": "客户年度经营汇报",
            "formats": ["html", "pptx", "pdf"],
        },
    )

    assert title == "客户年度经营汇报"
    assert [item.format for item in artifacts] == ["html", "pptx", "pdf"]
    assert all(item.path.is_file() for item in artifacts)
    assert all("employee-with-spaces" in str(item.path) for item in artifacts)
    assert (tmp_path / "exports" / "dashi-ppt" / "employee-with-spaces" / "run-1" / "goal.json").is_file()


def test_dashi_ppt_accepts_goal_spec_without_title(tmp_path, monkeypatch):
    from app.config import get_settings
    from app import dashi_ppt_runtime

    runtime_root = _runtime_root(tmp_path)
    settings = get_settings().model_copy(update={
        "dashi_ppt_runtime_root": str(runtime_root),
        "export_storage_dir": str(tmp_path / "exports"),
    })
    monkeypatch.setattr(
        dashi_ppt_runtime,
        "_run_npm",
        lambda root, args, settings, *, phase: Path(args[-1]).write_bytes(b"ok"),
    )

    title, artifacts = dashi_ppt_runtime.generate_dashi_ppt(
        settings=settings,
        user_id="employee-1",
        run_id="run-2",
        question="",
        user_input={
            "goal_spec": {"slides": [{"layout": "theme01_page001", "props": {}}]},
            "format": "pptx",
        },
    )

    assert title == "聚信 AI 助手专题汇报"
    assert [item.format for item in artifacts] == ["pptx"]
