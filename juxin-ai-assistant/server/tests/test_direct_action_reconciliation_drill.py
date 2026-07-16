from __future__ import annotations

from scripts.run_direct_action_reconciliation_drill import run_drill


def test_direct_action_reconciliation_drill_covers_fail_closed_ledger_semantics() -> None:
    report = run_drill()

    assert report["schema_version"] == "1.0"
    assert report["scope"] == "local_in_memory_only"
    assert report["passed"] is True
    assert report["failed"] == 0
    assert report["total"] == 5
    assert {case["id"] for case in report["cases"]} == {
        "success_replay_is_single_effect",
        "idempotency_key_conflict_is_rejected",
        "unknown_result_blocks_retry",
        "expired_in_progress_moves_to_reconciliation",
        "failed_result_requires_new_key",
    }


def test_direct_action_reconciliation_drill_reports_case_failures(monkeypatch) -> None:
    from app.direct_action_service import DirectActionService

    original = DirectActionService.succeed

    def fail_succeed(*args, **kwargs):
        raise RuntimeError("injected_succeed_failure")

    monkeypatch.setattr(DirectActionService, "succeed", fail_succeed)
    report = run_drill()

    assert report["passed"] is False
    assert report["failed"] >= 1
    failed_cases = {case["id"] for case in report["cases"] if case["status"] == "fail"}
    assert "success_replay_is_single_effect" in failed_cases
    monkeypatch.setattr(DirectActionService, "succeed", original)
