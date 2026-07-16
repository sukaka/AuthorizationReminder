from __future__ import annotations

import pytest

from app.run_state_contracts import (
    RunStateContractError,
    migrate_checkpoint_to_run_state_v1,
)
from app.agent_run_service import AgentRunService
from app.checkpoint_recovery import extract_safe_checkpoint
from app.crypto import ContentCipher
import base64


def test_legacy_checkpoint_migrates_to_v1_and_preserves_progress() -> None:
    legacy_checkpoint = {
        "stage": "executing",
        "progress": 62,
        "last_safe_step": 4,
        "completed_steps": ["plan", "retrieve"],
        "tool_context": {"query": "test"},
    }

    state = migrate_checkpoint_to_run_state_v1(
        run_id=42,
        checkpoint=legacy_checkpoint,
        status="failed",
        attempt=2,
    )

    assert state.schema_version == "1.0"
    assert state.run_id == 42
    assert state.status == "failed"
    assert state.attempt == 2
    assert state.cursor.last_safe_step == 4
    assert state.cursor.completed_steps == ["plan", "retrieve"]
    assert state.legacy_checkpoint == legacy_checkpoint


def test_unknown_checkpoint_schema_is_rejected() -> None:
    with pytest.raises(RunStateContractError, match="unsupported checkpoint schema"):
        migrate_checkpoint_to_run_state_v1(
            run_id=42,
            checkpoint={"schema_version": "9.0", "stage": "executing"},
            status="running",
            attempt=1,
        )


def test_safe_checkpoint_exposes_normalized_run_state(generation_db) -> None:
    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="dev", input_text="恢复测试")
    row.status = "failed"
    row.checkpoint_json = {
        "stage": "executing",
        "progress": 60,
        "last_safe_step": "draft",
    }
    generation_db.flush()

    checkpoint = extract_safe_checkpoint(generation_db, row)

    assert checkpoint is not None
    assert checkpoint.payload["schema_version"] == "1.0"
    assert checkpoint.payload["run_state"]["status"] == "failed"
    assert checkpoint.payload["run_state"]["cursor"]["last_safe_step"] == 0
