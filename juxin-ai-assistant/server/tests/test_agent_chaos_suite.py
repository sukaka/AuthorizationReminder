from __future__ import annotations

import pytest

from scripts import run_agent_chaos_suite as chaos


def test_local_chaos_suite_passes_and_is_machine_readable():
    report = chaos.run_suite()

    assert report["schema_version"] == "1.0"
    assert report["scope"] == "local_in_memory_only"
    assert report["overall"] == "pass"
    assert report["passed"] is True
    assert report["failed_count"] == 0
    assert {case["id"] for case in report["cases"]} == {
        "loop_convergence",
        "cancel_and_budget",
        "tool_unknown_outcome",
        "tool_timeout_taxonomy",
        "model_failure_taxonomy",
        "lease_fencing",
        "db_unavailable_fail_closed",
    }


def test_local_chaos_suite_fails_closed_when_case_raises(monkeypatch):
    def broken_case():
        raise RuntimeError("injected chaos failure")

    monkeypatch.setattr(chaos, "_case_loop_convergence", broken_case)
    report = chaos.run_suite()

    assert report["overall"] == "fail"
    assert report["passed"] is False
    failed = next(case for case in report["cases"] if case["id"] == "loop_convergence")
    assert failed["status"] == "fail"
    assert "injected chaos failure" in failed["detail"]["error"]


@pytest.mark.parametrize("repeat", [0, 21])
def test_local_chaos_suite_rejects_unsafe_repeat(repeat):
    with pytest.raises(ValueError, match="between 1 and 20"):
        chaos.run_suite(repeat=repeat)
