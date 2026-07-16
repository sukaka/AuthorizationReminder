from app.ops_slo import build_slo_audit


def _check_map(report):
    return {check["id"]: check for check in report["checks"]}


def test_slo_audit_reports_local_observation_gap_without_false_success(generation_db):
    report = build_slo_audit(
        generation_db,
        run_reconciliation={"overall": "pass", "issue_count": 0},
    )

    assert report["overall"] == "pass_with_gaps"
    assert report["fail_count"] == 0
    assert report["gap_count"] == 2
    checks = _check_map(report)
    assert checks["terminal_run_lease"]["status"] == "pass"
    assert checks["duplicate_tool_identity"]["status"] == "pass"
    assert checks["checkpoint_recovery_rate"]["status"] == "not_observed"
    assert checks["approval_recovery_rate"]["status"] == "not_observed"
    assert report["metrics"]["channel_outbound_reconciliation_required"] == 0


def test_slo_audit_fails_closed_on_ledger_and_budget_violations(generation_db):
    from app.agent_run_service import AgentRunService
    from app.crypto import ContentCipher
    from app.models import (
        AgentRunStep,
        AgentToolInvocation,
        ChannelIdentityBinding,
        ChannelMessageBinding,
        DirectActionInvocation,
    )

    service = AgentRunService(
        generation_db,
        ContentCipher("""AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="""),
    )
    run = service.create_run(
        owner_user_id="slo-user",
        input_text="slo violation",
        max_steps=1,
        max_model_calls=1,
        max_cost_micros=1,
    )
    run.status = "succeeded"
    run.finished_at = run.updated_at
    run.lease_owner = "dead-worker"
    run.lease_expires_at = run.updated_at
    run.model_calls = 2
    run.cost_micros = 2
    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ou_slo",
        owner_user_id="slo-user",
    )
    generation_db.add(identity)
    generation_db.flush()
    generation_db.add_all(
        [
            AgentRunStep(run_id=run.uuid, sequence=1, step_type="execute", status="succeeded"),
            AgentRunStep(run_id=run.uuid, sequence=2, step_type="execute", status="succeeded"),
            AgentToolInvocation(
                run_id=run.uuid,
                user_id="slo-user",
                tool_name="write_tool",
                tool_version="1",
                idempotency_key="",
                request_hash="",
                effect="write",
                status="reconciliation_required",
            ),
            DirectActionInvocation(
                user_id="slo-user",
                action_name="write_action",
                idempotency_key="",
                request_hash="",
                status="reconciliation_required",
            ),
            ChannelMessageBinding(
                identity_binding_id=identity.id,
                channel="feishu",
                external_message_id="om_slo:outbound",
                direction="outbound",
                run_id=run.uuid,
                metadata_json={"state": "reconciliation_required"},
            ),
        ]
    )
    generation_db.commit()

    report = build_slo_audit(
        generation_db,
        run_reconciliation={"overall": "fail", "issue_count": 1},
    )

    assert report["overall"] == "fail"
    assert report["fail_count"] >= 5
    checks = _check_map(report)
    for check_id in (
        "run_step_event_consistency",
        "terminal_run_lease",
        "budget_overrun",
        "reconciliation_backlog",
        "side_effect_audit_coverage",
    ):
        assert checks[check_id]["status"] == "fail"
    assert report["metrics"]["channel_outbound_reconciliation_required"] == 1


def test_ops_snapshot_includes_slo_audit(generation_client):
    response = generation_client.get(
        "/api/ai/ops/snapshot",
        headers={"X-Test-Role": "admin"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["slo_audit"]["overall"] in {"pass", "pass_with_gaps", "fail", "unavailable"}
    assert "checks" in payload["slo_audit"]
