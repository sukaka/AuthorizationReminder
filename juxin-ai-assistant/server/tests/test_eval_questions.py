import json
from pathlib import Path


def test_eval_questions_cover_learning_loop_regressions() -> None:
    path = Path(__file__).resolve().parents[1] / "eval_questions.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["version"] == "1.0"
    questions = payload["questions"]
    assert len(questions) >= 8
    ids = {item["id"] for item in questions}
    assert {
        "business-role",
        "wdsp-deployment",
        "risk-asset-value-correction",
        "word-export-history",
        "latest-cve",
        "web-capture-official",
    }.issubset(ids)
    for item in questions:
        assert item["question"].strip()
        assert item["expected_focus"]
