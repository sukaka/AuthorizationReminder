"""Smart routing + workflow engine tests."""

from datetime import UTC, datetime, timedelta

from app.agent_router import route_agents
from app.workflow_engine import WorkflowEngine, list_workflow_definitions


def test_route_prefers_summary_for_summary_query(generation_db) -> None:
    result = route_agents(
        generation_db,
        input_text="请帮我总结一下这段话的摘要",
    )
    assert result.selected_agent_id is not None
    # summary capability should rank local.summary high
    ids = [c.agent_id for c in result.candidates]
    assert "local.summary" in ids
    assert result.candidates[0].agent_id in {"local.summary", "local.echo"}


def test_route_blocks_external_on_l3(generation_db) -> None:
    # register external agent in hub
    from app.agent_hub import get_agent_hub

    hub = get_agent_hub()
    hub.register_http(
        agent_id="ext.route",
        name="Ext",
        description="x",
        endpoint="https://example.test/a",
    )
    result = route_agents(
        generation_db,
        input_text="机密 绝密 商密 文件请处理",
        allow_external=True,
    )
    filtered = {f["agent_id"]: f["reason"] for f in result.filtered_out}
    assert "ext.route" in filtered
    assert "L3" in filtered["ext.route"] or "external" in filtered["ext.route"]
    # selected should be local
    assert result.selected_agent_id is None or result.selected_agent_id.startswith("local.")


def test_route_user_preference(generation_db) -> None:
    result = route_agents(
        generation_db,
        input_text="随便说点什么",
        preferred_agent_id="local.echo",
    )
    assert result.selected_agent_id == "local.echo"
    assert any("用户指定" in r for r in result.candidates[0].reasons)


def test_workflow_list_and_serial(generation_db) -> None:
    defs = list_workflow_definitions()
    assert any(d["id"] == "serial_summary_echo" for d in defs)
    builtin = {item["id"]: item for item in defs}
    for workflow_id, expected_steps in {
        "project_dossier": ["project_read", "transform", "artifact"],
        "review_and_notify": ["artifact", "approval", "notification"],
        "scheduled_weekly_brief": ["project_read", "transform", "artifact"],
    }.items():
        assert workflow_id in builtin
        assert builtin[workflow_id]["step_count"] == len(expected_steps)

    from app.workflow_engine import get_workflow_definition

    for workflow_id, expected_steps in {
        "project_dossier": ["project_read", "transform", "artifact"],
        "review_and_notify": ["artifact", "approval", "notification"],
        "scheduled_weekly_brief": ["project_read", "transform", "artifact"],
    }.items():
        definition = get_workflow_definition(workflow_id)
        assert [step["type"] for step in definition["steps"]] == expected_steps

    engine = WorkflowEngine(generation_db)
    result = engine.run(
        "serial_summary_echo",
        input_text="这是一段很长的用于摘要的文本内容，需要先压缩再回声。",
    )
    assert result.status == "succeeded"
    assert len(result.steps) >= 2
    assert result.steps[0]["type"] == "invoke"
    assert result.steps[-1]["status"] == "succeeded"


def test_workflow_parallel_and_human(generation_db) -> None:
    engine = WorkflowEngine(generation_db)
    par = engine.run("parallel_dual", input_text="并行测试内容")
    assert par.status == "succeeded"
    assert any(s["type"] == "parallel" for s in par.steps)

    hum = engine.run("human_review_gate", input_text="需要审核的草稿材料")
    assert hum.status == "waiting_human"


def test_parallel_branches_overlap_and_keep_isolated_deterministic_results(monkeypatch) -> None:
    """Parallel branches must overlap without leaking state across branches."""

    import threading

    engine = WorkflowEngine()
    barrier = threading.Barrier(2)
    lock = threading.Lock()
    active = 0
    max_active = 0
    original_exec = engine._exec_step

    def probe_exec(step_type, params, ctx):
        nonlocal active, max_active
        if step_type == "noop" and params.get("probe"):
            with lock:
                active += 1
                max_active = max(max_active, active)
            try:
                barrier.wait(timeout=2)
                return {"status": "ok", "marker": ctx.get("marker")}
            finally:
                with lock:
                    active -= 1
        return original_exec(step_type, params, ctx)

    monkeypatch.setattr(engine, "_exec_step", probe_exec)
    output = engine._exec_step(
        "parallel",
        {
            "branches": [
                {
                    "id": "second",
                    "steps": [
                        {"id": "mark", "type": "set", "params": {"key": "marker", "value": "B"}},
                        {"id": "probe", "type": "noop", "params": {"probe": True}},
                    ],
                },
                {
                    "id": "first",
                    "steps": [
                        {"id": "mark", "type": "set", "params": {"key": "marker", "value": "A"}},
                        {"id": "probe", "type": "noop", "params": {"probe": True}},
                    ],
                },
            ]
        },
        {"input_text": "", "steps": {}, "marker": "root"},
    )

    assert max_active == 2
    assert list(output["branches"]) == ["second", "first"]
    assert output["branches"]["second"]["final"]["marker"] == "B"
    assert output["branches"]["first"]["final"]["marker"] == "A"


def test_workflow_route_invoke(generation_db) -> None:
    engine = WorkflowEngine(generation_db)
    result = engine.run(
        "simple_route_invoke",
        input_text="请做个简短摘要",
    )
    assert result.status == "succeeded"
    assert any(s["type"] == "route" for s in result.steps)


def test_api_route_and_workflow(generation_client, generation_db) -> None:
    route = generation_client.post(
        "/api/ai/workflows/route",
        json={
            "input_text": "生成摘要 summary",
            "preferred_agent_id": "local.summary",
            "create_run_audit": True,
        },
    )
    assert route.status_code == 200, route.text
    body = route.json()
    assert body["selected_agent_id"] == "local.summary"
    assert body.get("agent_run_id")

    # routing visible in task center
    listed_runs = generation_client.get("/api/ai/runs")
    assert listed_runs.status_code == 200
    assert any(r["run_id"] == body["agent_run_id"] for r in listed_runs.json()["items"])

    listed = generation_client.get("/api/ai/workflows")
    assert listed.status_code == 200
    assert listed.json()["total"] >= 3

    run = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        json={"input_text": "API 工作流串行测试文本", "create_run_audit": True},
    )
    assert run.status_code == 200, run.text
    assert run.json()["status"] == "succeeded"
    assert run.json().get("agent_run_id")


def test_audited_manual_workflow_run_idempotency_key_replays_same_run(
    generation_client, generation_db
) -> None:
    """Retrying a manual run request must not create a second AgentRun."""

    from sqlalchemy import func, select

    from app.models import AgentRun

    headers = {"Idempotency-Key": "manual-workflow-replay-1"}
    payload = {
        "input_text": "手动幂等工作流测试",
        "context": {"request_id": "req-1"},
        "create_run_audit": True,
    }
    first = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        headers=headers,
        json=payload,
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    replay = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        headers=headers,
        json=payload,
    )
    assert replay.status_code == 200, replay.text
    replay_body = replay.json()
    assert replay_body["agent_run_id"] == first_body["agent_run_id"]
    assert replay_body["replayed"] is True

    count = generation_db.scalar(
        select(func.count()).select_from(AgentRun).where(
            AgentRun.run_type == "workflow",
            AgentRun.uuid == first_body["agent_run_id"],
        )
    )
    assert count == 1


def test_manual_workflow_idempotency_key_rejects_changed_request(generation_client) -> None:
    headers = {"Idempotency-Key": "manual-workflow-replay-mismatch"}
    first = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        headers=headers,
        json={"input_text": "第一次请求", "create_run_audit": True},
    )
    assert first.status_code == 200, first.text
    changed = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        headers=headers,
        json={"input_text": "请求内容已改变", "create_run_audit": True},
    )
    assert changed.status_code == 409, changed.text
    assert changed.json()["detail"] == "idempotency_key_reused_with_different_request"


def test_custom_workflow_save_and_run(generation_client, tmp_path, monkeypatch) -> None:
    from app import workflow_engine as we

    monkeypatch.setattr(we, "_custom_store_path", lambda settings=None: tmp_path / "wf.json")
    saved = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "my_serial",
            "name": "我的串行",
            "description": "测试",
            "steps": [
                {"id": "a", "type": "invoke", "params": {"agent_id": "local.summary"}},
                {"id": "b", "type": "invoke", "params": {"agent_id": "local.echo", "input_from": "a.output"}},
            ],
        },
    )
    assert saved.status_code == 201, saved.text
    published = generation_client.post("/api/ai/workflows/custom/my_serial/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    listed = generation_client.get("/api/ai/workflows")
    assert any(i["id"] == "my_serial" for i in listed.json()["items"])
    run = generation_client.post(
        "/api/ai/workflows/my_serial/run",
        json={"input_text": "自定义流程测试文本", "create_run_audit": True},
    )
    assert run.status_code == 200, run.text
    assert run.json()["status"] == "succeeded"
    assert run.json().get("agent_run_id")


def test_lightweight_workflow_run_is_owner_scoped(client_for_user) -> None:
    owner = client_for_user("workflow-owner")
    other = client_for_user("workflow-other")
    definition = {
        "id": "private_lightweight_flow",
        "name": "私有轻量流程",
        "steps": [{"id": "value", "type": "set", "params": {"key": "value", "value": "owner-only"}}],
    }
    saved = owner.post("/api/ai/workflows/custom", json=definition)
    assert saved.status_code == 201, saved.text
    assert owner.post("/api/ai/workflows/custom/private_lightweight_flow/publish").status_code == 200

    own_run = owner.post(
        "/api/ai/workflows/private_lightweight_flow/run",
        json={"input_text": "owner", "create_run_audit": False},
    )
    assert own_run.status_code == 200, own_run.text
    assert own_run.json()["status"] == "succeeded"
    assert own_run.json()["outputs"]["final"]["value"] == "owner-only"

    other_run = other.post(
        "/api/ai/workflows/private_lightweight_flow/run",
        json={"input_text": "other", "create_run_audit": False},
    )
    assert other_run.status_code == 200, other_run.text
    assert other_run.json()["status"] == "failed"
    assert other_run.json()["error"] == "workflow_not_found"


def test_database_runner_does_not_fallback_to_global_custom_file(generation_db, tmp_path, monkeypatch) -> None:
    """Legacy file workflows must not bypass database owner scoping."""
    from app import workflow_engine

    custom_path = tmp_path / "custom_workflows.json"
    monkeypatch.setattr(
        workflow_engine,
        "_custom_store_path",
        lambda settings=None: custom_path,
    )
    workflow_engine.save_custom_workflow(
        {
            "id": "legacy_global_flow",
            "name": "遗留全局流程",
            "steps": [{"id": "value", "type": "set", "params": {"key": "value", "value": "leak"}}],
        }
    )

    result = workflow_engine.WorkflowEngine(generation_db).run(
        "legacy_global_flow",
        input_text="should not execute",
        owner_user_id="user-without-file-ownership",
    )
    assert result.status == "failed"
    assert result.error == "workflow_not_found"


def test_custom_workflow_versions_publish_and_rollback(generation_client) -> None:
    first = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "versioned_flow",
            "name": "版本流程",
            "steps": [{"id": "first", "type": "set", "params": {"key": "value", "value": "v1"}}],
        },
    )
    assert first.status_code == 201, first.text
    assert first.json()["version"] == 1
    assert first.json()["status"] == "draft"

    published_v1 = generation_client.post("/api/ai/workflows/custom/versioned_flow/publish")
    assert published_v1.status_code == 200, published_v1.text
    assert published_v1.json()["current_version"] == 1

    second = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "versioned_flow",
            "name": "版本流程",
            "steps": [{"id": "second", "type": "set", "params": {"key": "value", "value": "v2"}}],
        },
    )
    assert second.status_code == 201, second.text
    assert second.json()["version"] == 2
    assert generation_client.post("/api/ai/workflows/custom/versioned_flow/publish").status_code == 200

    rolled_back = generation_client.post(
        "/api/ai/workflows/custom/versioned_flow/rollback",
        json={"version": 1},
    )
    assert rolled_back.status_code == 200, rolled_back.text
    assert rolled_back.json()["current_version"] == 1

    run = generation_client.post(
        "/api/ai/workflows/versioned_flow/run",
        json={"input_text": "版本回滚", "create_run_audit": False},
    )
    assert run.status_code == 200, run.text
    assert run.json()["outputs"]["final"]["value"] == "v1"


def test_audited_human_review_waits_and_confirm_resumes(generation_client) -> None:
    run = generation_client.post(
        "/api/ai/workflows/human_review_gate/run",
        json={"input_text": "需要人工确认的草稿", "create_run_audit": True},
    )
    assert run.status_code == 200, run.text
    payload = run.json()
    assert payload["status"] == "waiting_human"
    run_id = payload["agent_run_id"]
    assert run_id

    detail = generation_client.get(f"/api/ai/runs/{run_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["run"]["status"] == "waiting_confirmation"
    assert any(event["event_type"] == "review" for event in detail.json()["events"])
    assert any(step["status"] == "waiting_confirmation" for step in detail.json()["steps"])

    confirmed = generation_client.post(f"/api/ai/runs/{run_id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "succeeded"

    final_detail = generation_client.get(f"/api/ai/runs/{run_id}")
    assert final_detail.status_code == 200, final_detail.text
    assert final_detail.json()["run"]["status"] == "succeeded"
    assert all(step["status"] == "succeeded" for step in final_detail.json()["steps"])
    assert all(step["status"] == "succeeded" for step in final_detail.json()["result"]["workflow"]["steps"])


def test_ops_resume_does_not_bypass_human_review(generation_client) -> None:
    run = generation_client.post(
        "/api/ai/workflows/human_review_gate/run",
        json={"input_text": "暂停后仍需人工确认", "create_run_audit": True},
    )
    assert run.status_code == 200, run.text
    run_id = run.json()["agent_run_id"]

    paused = generation_client.post(
        f"/api/ai/ops/runs/{run_id}/pause",
        headers={"X-Test-Role": "admin"},
    )
    assert paused.status_code == 200, paused.text
    assert paused.json()["run"]["status"] == "paused"

    resumed = generation_client.post(
        f"/api/ai/ops/runs/{run_id}/resume",
        headers={"X-Test-Role": "admin"},
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["run"]["status"] == "waiting_confirmation"

    confirmed = generation_client.post(f"/api/ai/runs/{run_id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "succeeded"


def test_audited_workflow_retry_replays_failed_step(generation_client, monkeypatch) -> None:
    saved = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "retry_flow",
            "name": "可重试流程",
            "steps": [{"id": "value", "type": "set", "params": {"key": "value", "value": "ok"}}],
        },
    )
    assert saved.status_code == 201, saved.text
    assert generation_client.post("/api/ai/workflows/custom/retry_flow/publish").status_code == 200

    from app.workflow_engine import WorkflowEngine

    original = WorkflowEngine._exec_step
    calls = {"count": 0}

    def fail_once(self, step_type, params, ctx):
        if calls["count"] == 0:
            calls["count"] += 1
            raise RuntimeError("transient workflow failure")
        return original(self, step_type, params, ctx)

    monkeypatch.setattr(WorkflowEngine, "_exec_step", fail_once)
    failed = generation_client.post(
        "/api/ai/workflows/retry_flow/run",
        json={"input_text": "先失败再重试", "create_run_audit": True},
    )
    assert failed.status_code == 200, failed.text
    run_id = failed.json()["agent_run_id"]
    assert failed.json()["status"] == "failed"

    monkeypatch.setattr(WorkflowEngine, "_exec_step", original)
    retried = generation_client.post(f"/api/ai/runs/{run_id}/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["run"]["status"] == "succeeded"
    assert retried.json()["snapshot"]["status"] == "succeeded"


def test_audited_run_pins_published_workflow_version(generation_client) -> None:
    first = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "pinned_flow",
            "name": "固定版本流程",
            "steps": [{"id": "value", "type": "set", "params": {"key": "value", "value": "v1"}}],
        },
    )
    assert first.status_code == 201, first.text
    assert generation_client.post("/api/ai/workflows/custom/pinned_flow/publish").status_code == 200

    first_run = generation_client.post(
        "/api/ai/workflows/pinned_flow/run",
        json={"input_text": "固定 v1", "create_run_audit": True},
    )
    assert first_run.status_code == 200, first_run.text
    first_run_id = first_run.json()["agent_run_id"]

    second = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "pinned_flow",
            "name": "固定版本流程",
            "steps": [{"id": "value", "type": "set", "params": {"key": "value", "value": "v2"}}],
        },
    )
    assert second.status_code == 201, second.text
    assert generation_client.post("/api/ai/workflows/custom/pinned_flow/publish").status_code == 200

    detail = generation_client.get(f"/api/ai/runs/{first_run_id}")
    assert detail.status_code == 200, detail.text
    workflow = detail.json()["result"]["workflow"]
    assert workflow["workflow_version"] == 1
    assert workflow["outputs"]["final"]["value"] == "v1"
    assert len(workflow["definition_hash"]) == 64


def test_audited_workflow_claims_and_releases_execution_lease(
    generation_client, generation_db, monkeypatch
) -> None:
    """The durable workflow boundary must fence a worker for its whole execution."""

    from sqlalchemy import select

    from app.agent_run_service import AgentRunService
    from app.models import AgentRun

    claims: list[tuple[str, str, int | None]] = []
    releases: list[tuple[str, str, int]] = []
    original_acquire = AgentRunService.acquire_lease
    original_release = AgentRunService.release_lease

    def spy_acquire(self, run_id, worker_id, **kwargs):
        token = original_acquire(self, run_id, worker_id, **kwargs)
        claims.append((run_id, worker_id, token))
        return token

    def spy_release(self, run_id, worker_id, fencing_token):
        released = original_release(self, run_id, worker_id, fencing_token)
        releases.append((run_id, worker_id, fencing_token))
        return released

    monkeypatch.setattr(AgentRunService, "acquire_lease", spy_acquire)
    monkeypatch.setattr(AgentRunService, "release_lease", spy_release)

    response = generation_client.post(
        "/api/ai/workflows/serial_summary_echo/run",
        json={"input_text": "租约边界测试", "create_run_audit": True},
    )
    assert response.status_code == 200, response.text
    run_id = response.json()["agent_run_id"]
    assert run_id

    row = generation_db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
    assert row is not None
    assert any(item[0] == run_id and item[2] for item in claims)
    assert any(item[0] == run_id for item in releases)
    assert row.lease_owner == ""
    assert row.lease_expires_at is None


def test_audited_workflow_typed_nodes_persist_artifact_and_wait_for_approval(
    generation_client, generation_db
) -> None:
    """Skill/Tool/Artifact/Approval nodes share the durable workflow contract."""

    from sqlalchemy import select

    from app.models import AgentArtifact

    saved = generation_client.post(
        "/api/ai/workflows/custom",
        json={
            "id": "typed_delivery_flow",
            "name": "类型化交付流程",
            "steps": [
                {
                    "id": "skill",
                    "type": "skill",
                    "params": {"skill_id": "incident-report"},
                },
                {
                    "id": "validate",
                    "type": "tool",
                    "params": {
                        "name": "document_structure_validate",
                        "input": {"document_type": "报告"},
                        "content_from": "input_text",
                    },
                },
                {
                    "id": "artifact",
                    "type": "artifact",
                    "params": {
                        "title": "事件报告成果",
                        "content_from": "skill.result.summary",
                    },
                },
                {
                    "id": "approval",
                    "type": "approval",
                    "params": {"message": "请确认事件报告后归档"},
                },
            ],
        },
    )
    assert saved.status_code == 201, saved.text
    assert generation_client.post(
        "/api/ai/workflows/custom/typed_delivery_flow/publish"
    ).status_code == 200

    response = generation_client.post(
        "/api/ai/workflows/typed_delivery_flow/run",
        json={
            "input_text": (
                "背景：生产环境发生事件。范围：核心服务。发现：接口异常。"
                "分析：根因为配置变更。结论：需要整改并跟踪。"
            ),
            "create_run_audit": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "waiting_human"
    run_id = payload["agent_run_id"]

    detail = generation_client.get(f"/api/ai/runs/{run_id}")
    assert detail.status_code == 200, detail.text
    steps = detail.json()["steps"]
    assert [step["status"] for step in steps] == [
        "succeeded", "succeeded", "succeeded", "waiting_confirmation"
    ]
    # The public step contract intentionally exposes a compact summary only;
    # the durable typed-node output is available in the workflow result.
    workflow_steps = detail.json()["result"]["workflow"]["steps"]
    artifact_output = workflow_steps[2].get("output") or {}
    artifact_id = artifact_output.get("artifact_id")
    assert artifact_id
    artifact = generation_db.scalar(
        select(AgentArtifact).where(AgentArtifact.uuid == artifact_id)
    )
    assert artifact is not None
    assert artifact.title == "事件报告成果"

    confirmed = generation_client.post(f"/api/ai/runs/{run_id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "succeeded"


def test_schedule_dispatch_is_idempotent_and_records_fire_metadata(
    generation_client, generation_db
) -> None:
    """A retried fire reuses its run and a later fire respects forbid concurrency."""

    from sqlalchemy import select

    from app.models import AgentRun, WorkflowSchedule

    scheduled_fire = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    created = generation_client.post(
        "/api/ai/workflows/schedules",
        json={
            "workflow_id": "human_review_gate",
            "name": "调度幂等围栏",
            "cron_expression": "* * * * *",
            "next_fire_at": scheduled_fire.isoformat(),
            "concurrency_policy": "forbid",
        },
    )
    assert created.status_code == 201, created.text
    schedule_uuid = created.json()["schedule_uuid"]

    claimed = generation_client.post(
        "/api/ai/workflows/schedules/claim",
        json={"worker_id": "scheduler-a"},
    )
    assert claimed.status_code == 200, claimed.text
    claim = next(item for item in claimed.json()["items"] if item["schedule_uuid"] == schedule_uuid)
    first = generation_client.post(
        f"/api/ai/workflows/schedules/{schedule_uuid}/dispatch",
        json={"worker_id": "scheduler-a", "lease_token": claim["lease_token"]},
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["status"] == "waiting_human"
    assert first_payload["replayed"] is False
    assert first_payload["scheduled_fire_at"]

    run = generation_db.scalar(select(AgentRun).where(AgentRun.uuid == first_payload["agent_run_id"]))
    assert run is not None
    runtime = run.metadata_json["workflow_runtime"]
    assert runtime["routing"]["schedule_uuid"] == schedule_uuid
    assert runtime["routing"]["scheduled_fire_at"] == first_payload["scheduled_fire_at"]
    assert runtime["routing"]["idempotency_key"] == first_payload["idempotency_key"]

    # Rewind the schedule to the same occurrence to simulate a dispatch retry.
    schedule = generation_db.scalar(select(WorkflowSchedule).where(WorkflowSchedule.uuid == schedule_uuid))
    schedule.next_fire_at = scheduled_fire
    generation_db.commit()
    retry_claim = generation_client.post(
        "/api/ai/workflows/schedules/claim",
        json={"worker_id": "scheduler-a"},
    )
    retry_item = next(item for item in retry_claim.json()["items"] if item["schedule_uuid"] == schedule_uuid)
    replay = generation_client.post(
        f"/api/ai/workflows/schedules/{schedule_uuid}/dispatch",
        json={"worker_id": "scheduler-a", "lease_token": retry_item["lease_token"]},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    assert replay.json()["agent_run_id"] == first_payload["agent_run_id"]

    # A different occurrence still sees the waiting run and is skipped by
    # forbid, rather than starting a second active execution.
    schedule = generation_db.scalar(select(WorkflowSchedule).where(WorkflowSchedule.uuid == schedule_uuid))
    schedule.next_fire_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    generation_db.commit()
    later_claim = generation_client.post(
        "/api/ai/workflows/schedules/claim",
        json={"worker_id": "scheduler-a"},
    )
    later_item = next(item for item in later_claim.json()["items"] if item["schedule_uuid"] == schedule_uuid)
    skipped = generation_client.post(
        f"/api/ai/workflows/schedules/{schedule_uuid}/dispatch",
        json={"worker_id": "scheduler-a", "lease_token": later_item["lease_token"]},
    )
    assert skipped.status_code == 200, skipped.text
    assert skipped.json()["status"] == "skipped_concurrency"
    assert skipped.json()["agent_run_id"] == first_payload["agent_run_id"]


def test_schedule_routes_patch_and_toggle_are_owner_scoped(client_for_user) -> None:
    owner = client_for_user("u-schedule")
    other = client_for_user("u-other")
    created = owner.post(
        "/api/ai/workflows/schedules",
        json={
            "workflow_id": "serial_summary_echo",
            "name": "调度控制面",
            "cron_expression": "0 9 * * 1",
            "next_fire_at": "2026-07-20T01:00:00",
        },
    )
    assert created.status_code == 201, created.text
    schedule_uuid = created.json()["schedule_uuid"]

    forbidden = other.patch(
        f"/api/ai/workflows/schedules/{schedule_uuid}",
        json={"name": "越权修改"},
    )
    assert forbidden.status_code == 404

    patched = owner.patch(
        f"/api/ai/workflows/schedules/{schedule_uuid}",
        json={
            "cron_expression": "*/15 8-10 * * 1-5",
            "misfire_policy": "fire_once",
            "catch_up": True,
            "concurrency_policy": "allow",
            "metadata": {"source": "route-test"},
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["cron_expression"] == "*/15 8-10 * * 1-5"
    assert patched.json()["misfire_policy"] == "fire_once"
    assert patched.json()["catch_up"] is True
    assert patched.json()["metadata"] == {"source": "route-test"}

    invalid = owner.patch(
        f"/api/ai/workflows/schedules/{schedule_uuid}",
        json={"cron_expression": "not a cron"},
    )
    assert invalid.status_code == 400

    disabled = owner.post(
        f"/api/ai/workflows/schedules/{schedule_uuid}/disable"
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False

    cleared = owner.patch(
        f"/api/ai/workflows/schedules/{schedule_uuid}",
        json={"next_fire_at": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["next_fire_at"] is None

    enabled = owner.post(
        f"/api/ai/workflows/schedules/{schedule_uuid}/enable"
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True
    assert enabled.json()["next_fire_at"]


def test_notification_reconciliation_routes_list_resolve_and_isolate(
    client_for_user, generation_db
) -> None:
    from app.workflow_control import (
        claim_notifications,
        enqueue_notification,
        mark_notification_reconciliation_required,
    )

    notification, _ = enqueue_notification(
        generation_db,
        owner_user_id="u-a",
        run_id="run-reconcile-route",
        node_id="notify",
        idempotency_key="run-reconcile-route:notify",
        channel="in_app",
        recipient="u-a",
        payload={"title": "待核对"},
    )
    claim = claim_notifications(
        generation_db,
        owner_user_id="u-a",
        worker_id="provider-worker",
    )
    assert [item.uuid for item in claim] == [notification.uuid]
    assert mark_notification_reconciliation_required(
        generation_db,
        notification.uuid,
        worker_id="provider-worker",
        lease_token=claim[0].lease_token,
        error="provider_timeout",
        provider_metadata={"provider": "local", "request_id": "req-1"},
    )
    generation_db.commit()

    owner = client_for_user("u-a")
    other = client_for_user("u-b")
    assert other.get("/api/ai/workflows/outbox/reconciliation").json()["total"] == 0
    listed = owner.get("/api/ai/workflows/outbox/reconciliation")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["notification_uuid"] == notification.uuid

    forbidden = other.post(
        f"/api/ai/workflows/outbox/{notification.uuid}/reconcile",
        json={"outcome": "succeeded"},
    )
    assert forbidden.status_code == 404

    unknown = owner.post(
        f"/api/ai/workflows/outbox/{notification.uuid}/reconcile",
        json={"outcome": "unknown", "error": "仍无法确认"},
    )
    assert unknown.status_code == 200, unknown.text
    assert unknown.json()["status"] == "reconciliation_required"

    resolved = owner.post(
        f"/api/ai/workflows/outbox/{notification.uuid}/reconcile",
        json={"outcome": "success", "provider_metadata": {"receipt": "ok-1"}},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "sent"
    assert owner.get("/api/ai/workflows/outbox/reconciliation").json()["total"] == 0


def test_event_dispatch_claims_processing_envelope_once(generation_client, generation_db) -> None:
    event = generation_client.post(
        "/api/ai/workflows/events",
        json={
            "workflow_id": "serial_summary_echo",
            "event_type": "project.updated",
            "event_key": "event-dispatch-once",
            "payload": {"input_text": "事件处理一次"},
        },
    )
    assert event.status_code == 202, event.text
    event_uuid = event.json()["event_uuid"]
    dispatched = generation_client.post(f"/api/ai/workflows/events/{event_uuid}/dispatch")
    assert dispatched.status_code == 202, dispatched.text
    first = dispatched.json()
    assert first["status"] == "succeeded"
    replay = generation_client.post(f"/api/ai/workflows/events/{event_uuid}/dispatch")
    assert replay.status_code == 202, replay.text
    assert replay.json()["status"] == "processed"
    assert replay.json()["agent_run_id"] == first["agent_run_id"]
