"""Workflow aborts on egress blocked / invoke error."""

from __future__ import annotations

from app.workflow_engine import WorkflowEngine


def test_egress_check_blocks_pipeline(generation_db, monkeypatch) -> None:
    from app import data_egress

    class FakeDecision:
        allowed = False
        level = 3
        reasons = ["confidential"]
        redaction_applied = False
        redacted_text = ""
        requires_confirmation = False
        level_label = "L3"
        policy = "block"

    monkeypatch.setattr(data_egress, "evaluate_egress", lambda *a, **k: FakeDecision())
    engine = WorkflowEngine(generation_db)
    result = engine.run(
        "vendor_kimi_jimeng",
        input_text="机密内容请勿外传",
        egress_confirmed=False,
    )
    assert result.status == "failed"
    assert result.steps
    assert result.steps[0]["type"] == "egress_check"
    assert result.steps[0]["status"] == "failed"
    # later steps not executed
    assert all(s["id"] != "analyze" for s in result.steps if s.get("status") == "succeeded")
