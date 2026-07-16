#!/usr/bin/env python3
"""Simulate multi-worker checkpoint handoff in-process.

Worker A writes steps + checkpoint then "crashes" (marks failed).
Worker B (new AgentRunService instance, same DB) retries and continues.

Usage:
  python scripts/run_multi_instance_checkpoint_drill.py --cases 10
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from collections import Counter
from pathlib import Path


def recovery_failure_reasons(
    *,
    checkpoint_found: bool,
    checkpoint_progress: int,
    final_progress: int,
    snapshot_status: str,
    run_status: str,
    attempt: int,
    successful_step_counts: dict[str, int],
    event_keys: list[str],
) -> list[str]:
    """Return fail-closed recovery gate failures for one drill case."""
    reasons: list[str] = []
    terminal_success = {"succeeded", "completed"}
    if not checkpoint_found:
        reasons.append("safe_checkpoint_missing")
    if snapshot_status not in terminal_success:
        reasons.append(f"snapshot_not_succeeded:{snapshot_status}")
    if run_status not in terminal_success:
        reasons.append(f"run_not_succeeded:{run_status}")
    if final_progress < checkpoint_progress:
        reasons.append(f"progress_regressed:{final_progress}<{checkpoint_progress}")
    if attempt < 2:
        reasons.append(f"retry_attempt_not_recorded:{attempt}")

    repeated = sorted(
        step_type
        for step_type in ("coordinate", "research", "write")
        if successful_step_counts.get(step_type, 0) > 1
    )
    if repeated:
        reasons.append(f"completed_steps_repeated:{','.join(repeated)}")
    if not any(key.startswith("checkpoint-resume-") for key in event_keys):
        reasons.append("checkpoint_resume_event_missing")
    if not any(key.startswith("checkpoint-continue-") for key in event_keys):
        reasons.append("checkpoint_continue_event_missing")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=int, default=10)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault(
        "AI_LOCAL_BINDING_SECRET",
        "local-binding-secret-for-multi-instance-32",
    )
    if not os.environ.get("CONTENT_ENCRYPTION_KEY"):
        os.environ["CONTENT_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(b"0" * 32).decode(
            "ascii"
        )

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.agent_contracts import AgentRunStage, AgentRunStatus
    from app.agent_run_service import AgentRunService
    from app.agent_runtime.native_runtime import NativeRuntime
    from app.agent_runtime.protocol import RunRequest
    from app.checkpoint_recovery import extract_safe_checkpoint
    from app.crypto import ContentCipher
    from app.models import Base

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    key = os.environ["CONTENT_ENCRYPTION_KEY"]
    cipher = ContentCipher(key)

    ok = 0
    cases = max(1, min(int(args.cases), 50))
    failures: list[dict] = []

    for i in range(cases):
        db = Session()
        # --- Worker A ---
        worker_a = AgentRunService(db, cipher)
        row = worker_a.create_run(
            owner_user_id="drill-user",
            input_text=f"多实例演练任务 {i}：请生成分析报告并列出风险",
            run_type="complex",
            title=f"drill-{i}",
        )
        worker_a.add_step(
            row,
            step_type="coordinate",
            status="succeeded",
            role="coordinator",
            checkpoint={"stage": AgentRunStage.PLANNING.value, "progress": 12},
        )
        worker_a.add_step(
            row,
            step_type="research",
            status="succeeded",
            role="researcher",
            checkpoint={
                "stage": AgentRunStage.RETRIEVING.value,
                "progress": 50,
                "snippet_count": 2,
            },
            output_summary={"snippet_count": 2},
        )
        worker_a.add_step(
            row,
            step_type="write",
            status="succeeded",
            role="writer",
            checkpoint={"stage": AgentRunStage.EXECUTING.value, "progress": 75, "draft_chars": 200},
        )
        row.result_json = {
            "kind": "draft",
            "answer": f"## 演练草稿 {i}\n\n风险：示例。\n\n来源：\n- 《演练资料》",
        }
        row.checkpoint_json = {
            "stage": AgentRunStage.EXECUTING.value,
            "progress": 75,
            "last_safe_step": "write",
            "snippet_count": 2,
        }
        # crash
        row.status = AgentRunStatus.FAILED.value
        row.stage = AgentRunStage.FAILED.value
        row.error_code = "worker_a_crash"
        row.error_message_safe = "simulated multi-instance crash"
        row.progress = 75
        db.add(row)
        db.commit()
        run_id = row.uuid
        db.close()

        # --- Worker B takes over ---
        db2 = Session()
        worker_b = AgentRunService(db2, cipher)
        row_b = worker_b.get_owned_run(run_id, "drill-user")
        assert row_b is not None
        cp = extract_safe_checkpoint(db2, row_b)
        worker_b.retry(row_b)
        db2.flush()

        runtime = NativeRuntime(db2, cipher)
        snapshot = runtime.start_sync(
            RunRequest(
                run_id=row_b.uuid,
                owner_user_id=row_b.owner_user_id,
                input_text=f"多实例演练任务 {i}：请生成分析报告并列出风险",
                run_type="complex",
            )
        )
        db2.commit()
        db2.refresh(row_b)

        steps = worker_b.list_steps(run_id)
        successful_step_counts = Counter(
            step.step_type
            for step in steps
            if step.status in {"succeeded", "completed"}
        )
        event_keys = [event.event_key or "" for event in worker_b.list_events(run_id)]
        checkpoint_progress = int(cp.progress) if cp is not None else 0
        reasons = recovery_failure_reasons(
            checkpoint_found=cp is not None,
            checkpoint_progress=checkpoint_progress,
            final_progress=int(row_b.progress or 0),
            snapshot_status=snapshot.status,
            run_status=row_b.status,
            attempt=int(row_b.attempt or 0),
            successful_step_counts=dict(successful_step_counts),
            event_keys=event_keys,
        )
        if not reasons:
            ok += 1
        else:
            failures.append(
                {
                    "run_id": run_id,
                    "status": row_b.status,
                    "progress": row_b.progress,
                    "snapshot": snapshot.status,
                    "attempt": row_b.attempt,
                    "successful_step_counts": dict(successful_step_counts),
                    "event_keys": event_keys,
                    "reasons": reasons,
                }
            )
        db2.close()

    rate = ok / cases if cases else 0.0
    report = {
        "total": cases,
        "recovered": ok,
        "failed": cases - ok,
        "recovery_rate": round(rate, 4),
        "target": 0.99,
        "passed": rate >= 0.99,
        "failures": failures[:10],
        "mode": "in_process_multi_session_simulation",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
