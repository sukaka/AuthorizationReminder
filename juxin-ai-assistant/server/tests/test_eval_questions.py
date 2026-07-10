import json
from pathlib import Path

from app.learning_eval import run_learning_eval


def test_eval_questions_cover_learning_loop_regressions() -> None:
    path = Path(__file__).resolve().parents[1] / "eval_questions.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["version"] == "1.0"
    questions = payload["questions"]
    assert 20 <= len(questions) <= 50
    ids = {item["id"] for item in questions}
    assert {
        "business-role",
        "wdsp-deployment",
        "risk-asset-value-correction",
        "word-export-history",
        "latest-cve",
        "web-capture-official",
        "codex-prompt-generation",
        "ui-design-suggestion",
    }.issubset(ids)
    for item in questions:
        assert item["question"].strip()
        assert item["expected_focus"]


def test_learning_eval_runner_checks_context_readiness() -> None:
    report = run_learning_eval()

    assert report["total"] >= 20
    assert report["failed"] == 0
    ids = {item["id"] for item in report["results"]}
    assert "latest-cve" in ids
    latest = next(item for item in report["results"] if item["id"] == "latest-cve")
    assert latest["requires_web_search"] is True
    codex = next(item for item in report["results"] if item["id"] == "codex-prompt-generation")
    assert codex["task_type"] == "codex_prompt"
    ui = next(item for item in report["results"] if item["id"] == "ui-design-suggestion")
    assert ui["task_type"] == "ui_design"
