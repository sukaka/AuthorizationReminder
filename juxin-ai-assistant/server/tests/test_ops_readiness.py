"""Ops readiness probe."""

from app.ops_readiness import run_readiness_probe
from app.config import get_settings


def test_readiness_probe(generation_db) -> None:
    report = run_readiness_probe(generation_db, get_settings())
    assert report["overall"] in {"ready", "ready_with_warnings", "not_ready"}
    assert report["pass_count"] + report["warn_count"] + report["fail_count"] == len(report["checks"])
    ids = {c["id"] for c in report["checks"]}
    assert "database" in ids
    assert "learning_safety" in ids
    assert "offline_eval" in ids
    assert "enterprise_5_0" in ids


def test_readiness_api(generation_client) -> None:
    resp = generation_client.get(
        "/api/ai/ops/readiness",
        headers={"X-Test-Role": "admin"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "checks" in body
    assert body["overall"]


def test_ops_snapshot_exposes_reconciliation_backlogs(
    generation_client, generation_db
) -> None:
    from app.models import AgentToolInvocation, DirectActionInvocation

    generation_db.add_all(
        [
            AgentToolInvocation(
                run_id="ops-running-run",
                user_id="ops-user",
                tool_name="word_export",
                tool_version="1",
                idempotency_key="ops-running-key",
                request_hash="a" * 64,
                effect="write",
                status="in_progress",
            ),
            AgentToolInvocation(
                run_id="ops-reconcile-run",
                user_id="ops-user",
                tool_name="word_export",
                tool_version="1",
                idempotency_key="ops-reconcile-key",
                request_hash="b" * 64,
                effect="write",
                status="reconciliation_required",
            ),
        ]
    )
    generation_db.add(
        DirectActionInvocation(
            user_id="ops-user",
            action_name="knowledge_file_upload",
            idempotency_key="ops-direct-reconcile-key",
            request_hash="e" * 64,
            status="reconciliation_required",
        )
    )
    generation_db.commit()

    response = generation_client.get(
        "/api/ai/ops/snapshot", headers={"X-Test-Role": "admin"}
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["tool_invocations_in_progress"] >= 1
    assert payload["tool_invocations_reconciliation_required"] >= 1
    assert payload["direct_actions_reconciliation_required"] >= 1
    assert payload["run_reconciliation_overall"] == "pass"
    assert payload["run_reconciliation_issue_count"] == 0


def test_ops_snapshot_exposes_run_step_event_reconciliation_failure(
    generation_client, generation_db
) -> None:
    from app.agent_run_service import AgentRunService
    from app.crypto import ContentCipher
    from app.models import AgentRunStep

    service = AgentRunService(
        generation_db,
        ContentCipher("""AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="""),
    )
    run = service.create_run(owner_user_id="ops-user", input_text="snapshot 对账异常")
    run.status = "succeeded"
    run.stage = "completed"
    generation_db.add(
        AgentRunStep(
            run_id=run.uuid,
            sequence=2,
            step_type="execute",
            status="succeeded",
        )
    )
    generation_db.commit()

    response = generation_client.get(
        "/api/ai/ops/snapshot", headers={"X-Test-Role": "admin"}
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_reconciliation_overall"] == "fail"
    assert payload["run_reconciliation_scanned_runs"] == 1
    assert payload["run_reconciliation_issue_count"] >= 2
    assert payload["run_reconciliation_issue_counts"]["step_sequence_gap"] == 1


def test_admin_can_reconcile_unknown_tool_invocation(generation_client, generation_db) -> None:
    from app.models import AgentToolInvocation

    invocation = AgentToolInvocation(
        run_id="ops-reconcile-run",
        user_id="ops-user",
        tool_name="word_export",
        tool_version="1",
        idempotency_key="ops-reconcile-key",
        request_hash="c" * 64,
        effect="write",
        status="reconciliation_required",
    )
    generation_db.add(invocation)
    generation_db.commit()

    listed = generation_client.get(
        "/api/ai/ops/tool-invocations/reconciliation",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    assert any(item["uuid"] == invocation.uuid for item in listed.json()["items"])

    resolved = generation_client.post(
        f"/api/ai/ops/tool-invocations/{invocation.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={
            "action": "confirm_succeeded",
            "result_payload": {"artifact_id": "artifact-1"},
            "output_summary": {"artifact": "created"},
            "source_count": 1,
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "succeeded"
    assert resolved.json()["reconciliation_resolution"] == "operator_confirmed_succeeded"

    generation_db.refresh(invocation)
    assert invocation.result_payload_json == {"artifact_id": "artifact-1"}
    assert invocation.reconciled_by_user_id


def test_reconciliation_rejects_non_pending_invocation(generation_client, generation_db) -> None:
    from app.models import AgentToolInvocation

    invocation = AgentToolInvocation(
        run_id="ops-complete-run",
        user_id="ops-user",
        tool_name="word_export",
        tool_version="1",
        idempotency_key="ops-complete-key",
        request_hash="d" * 64,
        effect="write",
        status="succeeded",
        result_payload_json={"artifact_id": "artifact-1"},
    )
    generation_db.add(invocation)
    generation_db.commit()

    response = generation_client.post(
        f"/api/ai/ops/tool-invocations/{invocation.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={"action": "confirm_not_applied"},
    )
    assert response.status_code == 409


def test_admin_can_reconcile_unknown_channel_outbound(generation_client, generation_db) -> None:
    from app.models import ChannelIdentityBinding, ChannelMessageBinding

    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ops-channel-user",
        owner_user_id="ops-user",
        last_thread_id="ops-channel-thread",
    )
    generation_db.add(identity)
    generation_db.flush()
    binding = ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel="feishu",
        external_message_id="ops-outbound-1",
        direction="outbound",
        thread_id="ops-channel-thread",
        run_id="ops-channel-run",
        related_message_id="ops-inbound-1",
        metadata_json={
            "state": "reconciliation_required",
            "idempotency_key": "ops-outbound-key",
            "error": "provider timeout",
        },
    )
    generation_db.add(binding)
    generation_db.commit()

    listed = generation_client.get(
        "/api/ai/ops/channel-outbound/reconciliation",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    payload = listed.json()
    assert payload["total"] == 1
    assert payload["items"][0]["uuid"] == binding.uuid
    assert payload["items"][0]["idempotency_key"] == "ops-outbound-key"

    resolved = generation_client.post(
        f"/api/ai/ops/channel-outbound/{binding.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={
            "action": "confirm_succeeded",
            "external_receipt": {"provider_message_id": "provider-1", "status": "accepted"},
            "evidence_ref": "ticket://ops-1",
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["state"] == "sent"
    assert resolved.json()["reconciliation_resolution"] == "operator_confirmed_succeeded"
    assert resolved.json()["idempotency_key"] == "ops-outbound-key"

    generation_db.refresh(binding)
    assert binding.metadata_json["state"] == "sent"
    assert binding.metadata_json["outbound_ok"] is True
    assert binding.metadata_json["external_receipt"]["provider_message_id"] == "provider-1"
    assert binding.metadata_json["reconciled_by_user_id"]

    duplicate = generation_client.post(
        f"/api/ai/ops/channel-outbound/{binding.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={
            "action": "confirm_succeeded",
            "external_receipt": {"provider_message_id": "provider-1"},
        },
    )
    assert duplicate.status_code == 409


def test_channel_outbound_reconciliation_can_confirm_not_applied(
    generation_client, generation_db
) -> None:
    from app.models import ChannelIdentityBinding, ChannelMessageBinding

    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ops-channel-user-not-applied",
        owner_user_id="ops-user",
    )
    generation_db.add(identity)
    generation_db.flush()
    binding = ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel="feishu",
        external_message_id="ops-outbound-not-applied",
        direction="outbound",
        thread_id="ops-channel-thread",
        run_id="ops-channel-run",
        metadata_json={
            "state": "reconciliation_required",
            "idempotency_key": "ops-outbound-not-applied-key",
        },
    )
    generation_db.add(binding)
    generation_db.commit()

    resolved = generation_client.post(
        f"/api/ai/ops/channel-outbound/{binding.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={"action": "confirm_not_applied"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["state"] == "not_applied"
    assert resolved.json()["reconciliation_resolution"] == "operator_confirmed_not_applied"

    generation_db.refresh(binding)
    assert binding.metadata_json["state"] == "not_applied"
    assert binding.metadata_json["outbound_ok"] is False
    assert "新的幂等键" in binding.metadata_json["error"]


def test_channel_outbound_reconciliation_requires_admin_and_bounds_receipt(
    client_for_user, generation_db
) -> None:
    from app.models import ChannelIdentityBinding, ChannelMessageBinding

    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ops-channel-user-bounds",
        owner_user_id="ops-user",
    )
    generation_db.add(identity)
    generation_db.flush()
    binding = ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel="feishu",
        external_message_id="ops-outbound-bounds",
        direction="outbound",
        thread_id="ops-channel-thread",
        run_id="ops-channel-run",
        metadata_json={
            "state": "reconciliation_required",
            "idempotency_key": "ops-outbound-bounds-key",
        },
    )
    generation_db.add(binding)
    generation_db.commit()

    admin_client = client_for_user("ops-admin", role="admin")
    user_client = client_for_user("ops-employee", role="employee")
    forbidden = user_client.get(
        "/api/ai/ops/channel-outbound/reconciliation",
    )
    assert forbidden.status_code == 403

    oversized = admin_client.post(
        f"/api/ai/ops/channel-outbound/{binding.uuid}/reconcile",
        json={
            "action": "confirm_succeeded",
            "external_receipt": {"raw": "x" * 100_001},
        },
    )
    assert oversized.status_code == 422
    generation_db.refresh(binding)
    assert binding.metadata_json["state"] == "reconciliation_required"


def test_admin_can_reconcile_unknown_direct_action(generation_client, generation_db) -> None:
    from app.direct_action_service import DirectActionService
    from app.models import DirectActionInvocation

    service = DirectActionService(generation_db)
    invocation, replay = service.begin(
        user_id="ops-user",
        action_name="export_word",
        idempotency_key="ops-direct-key",
        request_payload={"artifact_id": "artifact-1"},
        timeout_seconds=30,
    )
    assert replay is None
    assert invocation is not None
    invocation.status = "reconciliation_required"
    generation_db.commit()

    listed = generation_client.get(
        "/api/ai/ops/direct-actions/reconciliation",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    assert any(item["uuid"] == invocation.uuid for item in listed.json()["items"])

    resolved = generation_client.post(
        f"/api/ai/ops/direct-actions/{invocation.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={
            "action": "confirm_succeeded",
            "response_status": 200,
            "response_payload": {
                "file_name": "artifact-1.docx",
                "download_url": "/api/exports/word/artifact-1/download",
            },
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "succeeded"
    assert resolved.json()["reconciliation_resolution"] == "operator_confirmed_succeeded"

    generation_db.refresh(invocation)
    assert invocation.response_payload_json == {
        "file_name": "artifact-1.docx",
        "download_url": "/api/exports/word/artifact-1/download",
    }
    assert invocation.reconciled_by_user_id

    duplicate, replay = service.begin(
        user_id="ops-user",
        action_name="export_word",
        idempotency_key="ops-direct-key",
        request_payload={"artifact_id": "artifact-1"},
        timeout_seconds=30,
    )
    assert duplicate is None
    assert replay is not None
    assert replay.status_code == 200
    assert replay.payload == {
        "file_name": "artifact-1.docx",
        "download_url": "/api/exports/word/artifact-1/download",
    }


def test_direct_action_reconciliation_requires_replayable_result(generation_client, generation_db) -> None:
    from app.models import DirectActionInvocation

    invocation = DirectActionInvocation(
        user_id="ops-user",
        action_name="export_word",
        idempotency_key="ops-direct-missing-result-key",
        request_hash="g" * 64,
        status="reconciliation_required",
    )
    generation_db.add(invocation)
    generation_db.commit()

    response = generation_client.post(
        f"/api/ai/ops/direct-actions/{invocation.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={"action": "confirm_succeeded"},
    )
    assert response.status_code == 422


def test_direct_action_reconciliation_rejects_invalid_original_response(
    generation_client, generation_db
) -> None:
    from app.models import DirectActionInvocation

    invocation = DirectActionInvocation(
        user_id="ops-user",
        action_name="export_word",
        idempotency_key="ops-direct-invalid-response-key",
        request_hash="h" * 64,
        status="reconciliation_required",
    )
    generation_db.add(invocation)
    generation_db.commit()

    response = generation_client.post(
        f"/api/ai/ops/direct-actions/{invocation.uuid}/reconcile",
        headers={"X-Test-Role": "admin"},
        json={
            "action": "confirm_succeeded",
            "response_status": 200,
            "response_payload": {"download_url": "/api/exports/word/invalid/download"},
        },
    )
    assert response.status_code == 422
    generation_db.refresh(invocation)
    assert invocation.status == "reconciliation_required"
