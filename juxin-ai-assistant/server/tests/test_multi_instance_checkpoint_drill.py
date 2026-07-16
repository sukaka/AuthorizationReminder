"""Fail-closed gates for the multi-session checkpoint drill."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_drill_module():
    path = Path(__file__).parents[1] / "scripts" / "run_multi_instance_checkpoint_drill.py"
    spec = importlib.util.spec_from_file_location("multi_instance_checkpoint_drill", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_failed_terminal_status_never_passes_recovery_gate() -> None:
    drill = _load_drill_module()

    reasons = drill.recovery_failure_reasons(
        checkpoint_found=True,
        checkpoint_progress=75,
        final_progress=100,
        snapshot_status="failed",
        run_status="failed",
        attempt=2,
        successful_step_counts={"coordinate": 1, "research": 1, "write": 1},
        event_keys=["checkpoint-resume-2", "checkpoint-continue-2"],
    )

    assert "snapshot_not_succeeded:failed" in reasons
    assert "run_not_succeeded:failed" in reasons


def test_repeated_completed_step_or_missing_events_fails_recovery_gate() -> None:
    drill = _load_drill_module()

    reasons = drill.recovery_failure_reasons(
        checkpoint_found=True,
        checkpoint_progress=75,
        final_progress=100,
        snapshot_status="succeeded",
        run_status="succeeded",
        attempt=2,
        successful_step_counts={"coordinate": 1, "research": 1, "write": 2},
        event_keys=[],
    )

    assert "completed_steps_repeated:write" in reasons
    assert "checkpoint_resume_event_missing" in reasons
    assert "checkpoint_continue_event_missing" in reasons
