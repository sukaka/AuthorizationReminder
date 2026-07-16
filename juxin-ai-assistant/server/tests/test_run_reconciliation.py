import base64
from datetime import UTC, datetime

from app.agent_contracts import AgentEventType, AgentRunStage, AgentRunStatus
from app.agent_run_service import AgentRunService
from app.crypto import ContentCipher
from app.models import AgentRunStep


def _service(generation_db) -> AgentRunService:
    key = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    return AgentRunService(generation_db, ContentCipher(key))


def test_run_reconciliation_reports_machine_detectable_inconsistencies(
    generation_client, generation_db
) -> None:
    service = _service(generation_db)
    row = service.create_run(owner_user_id="ops-user", input_text="不一致样本")
    row.status = AgentRunStatus.SUCCEEDED.value
    row.stage = AgentRunStage.COMPLETED.value
    row.finished_at = datetime.now(UTC).replace(tzinfo=None)
    generation_db.add(
        AgentRunStep(
            run_id=row.uuid,
            sequence=2,
            step_type="execute",
            status="succeeded",
            started_at=row.finished_at,
            finished_at=row.finished_at,
        )
    )
    generation_db.commit()

    response = generation_client.get(
        "/api/ai/ops/run-reconciliation",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["overall"] == "fail"
    assert payload["scanned_runs"] == 1
    assert payload["issue_count"] >= 2
    assert {item["code"] for item in payload["issues"]} >= {
        "step_sequence_gap",
        "terminal_event_missing",
    }


def test_run_reconciliation_accepts_consistent_run(generation_client, generation_db) -> None:
    service = _service(generation_db)
    row = service.create_run(owner_user_id="ops-user", input_text="一致样本")
    service.add_step(row, step_type="execute", status="succeeded")
    service.mark_succeeded(row, result={"ok": True})
    service.append_event(
        row,
        event_type=AgentEventType.COMPLETED,
        stage=AgentRunStage.COMPLETED,
        label="已完成",
        progress=100,
        event_key="completed-1",
    )
    generation_db.commit()

    response = generation_client.get(
        "/api/ai/ops/run-reconciliation?limit=10",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["overall"] == "pass"
    assert payload["scanned_runs"] == 1
    assert payload["issue_count"] == 0
    assert payload["issues"] == []
