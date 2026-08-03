"""NativeRuntime checkpoint-aware resume skips completed steps."""

from __future__ import annotations

import base64

from app.agent_contracts import AgentRunStage
from app.agent_run_service import AgentRunService
from app.agent_runtime.native_runtime import NativeRuntime
from app.agent_runtime.protocol import ResumeCommand, RunRequest
from app.crypto import ContentCipher


def _cipher() -> ContentCipher:
    return ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))


def test_resume_skips_write_when_draft_checkpoint_exists(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(
        owner_user_id="dev",
        input_text="请生成一份详细分析报告，列出风险与整改建议",
        run_type="complex",
        title="resume-test",
    )
    service.add_step(
        row,
        step_type="coordinate",
        status="succeeded",
        role="coordinator",
        checkpoint={"stage": "planning", "progress": 12},
    )
    service.add_step(
        row,
        step_type="research",
        status="succeeded",
        role="researcher",
        checkpoint={"stage": "retrieving", "progress": 50, "snippet_count": 1},
    )
    service.add_step(
        row,
        step_type="write",
        status="succeeded",
        role="writer",
        checkpoint={"stage": "executing", "progress": 75},
    )
    row.result_json = {
        "kind": "draft",
        "answer": "## 草稿\n\n内容完整。\n\n来源：\n- 《制度》第1页",
    }
    row.checkpoint_json = {
        "stage": "executing",
        "progress": 75,
        "last_safe_step": "write",
        "snippet_count": 1,
        "resume_source": "run",
    }
    row.status = "failed"
    row.stage = "failed"
    row.progress = 75
    generation_db.add(row)
    generation_db.commit()

    runtime = NativeRuntime(generation_db, cipher)
    snapshot = runtime.start_sync(
        RunRequest(
            run_id=row.uuid,
            owner_user_id="dev",
            input_text="请生成一份详细分析报告，列出风险与整改建议",
            run_type="complex",
        )
    )
    generation_db.commit()
    generation_db.refresh(row)

    events = service.list_events(row.uuid)
    labels = [e.label for e in events]
    assert any("checkpoint" in (e.event_key or "") or "复用" in (e.label or "") for e in events) or any(
        "checkpoint" in (lbl or "").lower() or "复用" in (lbl or "") for lbl in labels
    )
    # A resumed draft is successful only when it reaches a terminal-success state.
    write_steps = [s for s in service.list_steps(row.uuid) if s.step_type == "write"]
    assert len(write_steps) == 1
    assert snapshot.run_id == row.uuid
    assert snapshot.status in {"succeeded", "completed"}
    assert row.status in {"succeeded", "completed"}


def test_retry_then_runtime_resume_api_path(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(
        owner_user_id="dev",
        input_text="简短问题",
        run_type="chat",
    )
    service.add_step(
        row,
        step_type="write",
        status="succeeded",
        role="writer",
        checkpoint={"stage": "executing", "progress": 70},
    )
    row.result_json = {"answer": "已有答案，含来源《手册》。", "kind": "draft"}
    row.checkpoint_json = {
        "stage": "executing",
        "progress": 70,
        "last_safe_step": "write",
        "snippet_count": 1,
    }
    service.mark_failed(row, code="boom", message="crash")
    generation_db.commit()

    import asyncio

    runtime = NativeRuntime(generation_db, cipher)
    snap = asyncio.run(runtime.resume(row.uuid, ResumeCommand(action="retry")))
    generation_db.commit()
    generation_db.refresh(row)
    assert row.attempt >= 2
    assert snap.run_id == row.uuid


def test_runtime_converts_unhandled_checkpoint_failure_to_failed_run(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(
        owner_user_id="dev",
        input_text="执行到草稿检查点后失败",
        run_type="complex",
        title="checkpoint-failure",
    )
    runtime = NativeRuntime(generation_db, cipher)

    def failing_executor(run, _request, _worker_id, _fencing_token):
        runtime.service.mark_running(run, stage=AgentRunStage.EXECUTING)
        runtime.service.persist_safe_checkpoint(
            run,
            checkpoint={"last_safe_step": "write"},
            stage=AgentRunStage.EXECUTING,
            progress=75,
        )
        raise RuntimeError("simulated executor failure")

    snapshot = runtime.start_sync_with_executor(
        RunRequest(
            run_id=row.uuid,
            owner_user_id="dev",
            input_text="执行到草稿检查点后失败",
            run_type="complex",
        ),
        failing_executor,
    )
    generation_db.commit()
    generation_db.refresh(row)

    assert snapshot.status == "failed"
    assert row.status == "failed"
    assert row.stage == "failed"
    assert row.progress == 75
    assert snapshot.run_id == row.uuid


def test_runtime_does_not_execute_when_another_worker_holds_run_lease(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="dev", input_text="并发恢复")
    assert service.acquire_lease(row.uuid, "other-worker") == 1

    runtime = NativeRuntime(generation_db, cipher, worker_id="this-worker")
    snapshot = runtime.start_sync(
        RunRequest(run_id=row.uuid, owner_user_id="dev", input_text="并发恢复")
    )

    assert snapshot.error_code == "RUN_LEASE_HELD"
    assert row.status == "created"


def test_runtime_never_marks_a_failed_outcome_evaluation_as_success(generation_db) -> None:
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="dev", input_text="恢复一份没有来源的草稿")
    service.add_step(row, step_type="write", status="succeeded", role="writer")
    row.result_json = {"kind": "draft", "answer": "这是一份没有明确依据的普通草稿内容"}
    row.checkpoint_json = {"stage": "executing", "progress": 75, "last_safe_step": "write", "snippet_count": 0}
    row.status = "failed"
    row.stage = "failed"
    generation_db.add(row)
    generation_db.commit()

    snapshot = NativeRuntime(generation_db, cipher).start_sync(
        RunRequest(run_id=row.uuid, owner_user_id="dev", input_text="恢复一份没有来源的草稿")
    )

    assert snapshot.status == "failed"
    assert snapshot.result["kind"] == "needs_human_review"
    assert snapshot.result["quality"]["outcome"] == "revise"
