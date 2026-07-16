from app.agent_contracts import AgentRunStage, AgentRunStatus
from app.agent_run_service import AgentRunService
from app.config import get_settings
from app.crypto import ContentCipher
from app.governance_models import AuditLog


def _service(generation_db) -> AgentRunService:
    return AgentRunService(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
    )


def _running_run(generation_db, *, input_text: str = "运维控制样本"):
    service = _service(generation_db)
    row = service.create_run(owner_user_id="ops-user", input_text=input_text)
    service.transition_status(row, AgentRunStatus.RUNNING)
    row.stage = AgentRunStage.EXECUTING.value
    generation_db.commit()
    return service, row


def test_ops_run_detail_contains_run_lineage_and_scoped_reconciliation(
    generation_client, generation_db
) -> None:
    _, row = _running_run(generation_db)
    other_service = _service(generation_db)
    other = other_service.create_run(owner_user_id="other", input_text="另一个任务")
    other.status = "unknown"
    generation_db.commit()

    response = generation_client.get(
        f"/api/ai/ops/runs/{row.uuid}",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run"]["run_id"] == row.uuid
    assert payload["steps"] == []
    assert payload["events"]
    assert payload["reconciliation"]["scanned_runs"] == 1
    assert payload["reconciliation"]["issues"] == []


def test_ops_pause_is_idempotent_and_resume_continues_run(
    generation_client, generation_db
) -> None:
    _, row = _running_run(generation_db, input_text="没有匹配 FAQ 的恢复样本")
    headers = {"X-Test-Role": "admin"}

    paused = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/pause",
        headers=headers,
    )
    assert paused.status_code == 200, paused.text
    assert paused.json()["run"]["status"] == "paused"

    repeated = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/pause",
        headers=headers,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["run"]["status"] == "paused"

    resumed = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/resume",
        headers=headers,
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["run"]["status"] != "paused"
    assert resumed.json()["snapshot"]["status"] != "paused"

    audit_actions = [
        item.action
        for item in generation_db.query(AuditLog)
        .filter(AuditLog.entity_uuid == row.uuid)
        .all()
    ]
    assert "agent_run.ops_pause" in audit_actions
    assert "agent_run.ops_resume" in audit_actions


def test_ops_rollback_restores_latest_safe_checkpoint_without_side_effect_claim(
    generation_client, generation_db
) -> None:
    service, row = _running_run(generation_db, input_text="checkpoint 回滚样本")
    service.add_step(
        row,
        step_type="retrieve",
        status="succeeded",
        checkpoint={"stage": AgentRunStage.RETRIEVING.value, "progress": 45},
    )
    row.progress = 80
    generation_db.commit()

    response = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/rollback",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run"]["status"] == "paused"
    assert payload["run"]["progress"] == 45
    assert payload["checkpoint"]["resume_source"] == "ops_rollback"
    assert payload["side_effects_reversed"] is False


def test_ops_resume_running_is_idempotent_without_reexecution(
    generation_client, generation_db, monkeypatch
) -> None:
    _, row = _running_run(generation_db, input_text="恢复幂等样本")

    def fail_runtime(*args, **kwargs):
        raise AssertionError("running resume must not invoke the runtime again")

    monkeypatch.setattr("app.ops_routes.select_runtime", fail_runtime)
    response = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/resume",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["run"]["status"] == "running"
    assert response.json()["snapshot"]["status"] == "running"


def test_ops_rollback_without_safe_checkpoint_is_conflict(
    generation_client, generation_db
) -> None:
    _, row = _running_run(generation_db, input_text="无 checkpoint 回滚样本")

    response = generation_client.post(
        f"/api/ai/ops/runs/{row.uuid}/rollback",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 409, response.text
    assert "safe_checkpoint_not_found" in response.json()["detail"]


def test_ops_run_controls_require_admin(client_for_user, generation_db) -> None:
    _, row = _running_run(generation_db)

    response = client_for_user("employee").get(f"/api/ai/ops/runs/{row.uuid}")

    assert response.status_code == 403, response.text
