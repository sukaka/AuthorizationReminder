import base64
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.agent_run_service import AgentRunService, LeaseLostError
from app.agent_runtime.runtime_shadow import (
    aggregate_shadow_records,
    compare_snapshots,
    normalize_snapshot,
    should_sample,
)
from app.agent_runtime.runtime_shadow_fixture import (
    CONTRACT_CASE_COUNT,
    CONTRACT_TRIAL_COUNT,
    build_contract_fixture,
    build_contract_trials,
)
from app.agent_runtime.langgraph_runtime import (
    LangGraphRuntime,
    langgraph_backend_status,
    select_runtime,
)
from app.agent_runtime.langgraph_graph import (
    LangGraphDependencyError,
    build_langgraph_contract_graph,
    langgraph_graph_status,
    langgraph_thread_config,
)
from app.agent_runtime.langgraph_service_binding import LangGraphRunBinding
from app.agent_runtime.agent_run_checkpoint_saver import AgentRunCheckpointSaver
from app.agent_runtime.runtime_state_contract import (
    append_completed_step,
    phase_contract_status,
    state_validation_error,
)
from app.agent_runtime.tool_base import BaseTool, ToolContext, ToolResult
from app.agent_runtime.tool_registry import ToolRegistry
from app.agent_runtime.native_runtime import NativeRuntime
from app.agent_runtime.protocol import RunRequest
from app.crypto import ContentCipher
from app.models import AgentRun, AgentRunLangGraphCheckpoint, Base


def _snapshot(*, answer="ok", runtime="native", citations=None):
    return {
        "status": "succeeded",
        "stage": "completed",
        "progress": 100,
        "model_calls": 1,
        "result": {
            "kind": "answer",
            "answer": answer,
            "runtime": runtime,
            "citations": citations or [],
            "snippet_count": 1,
            "workflow": "chat",
        },
    }


def test_runtime_marker_is_not_a_shadow_mismatch():
    assert compare_snapshots(_snapshot(), _snapshot(runtime="langgraph_shadow")) == []


def test_shadow_report_is_safe_and_categorizes_mismatch():
    report = aggregate_shadow_records([
        {"case_id": "same", "request": {"input_text": "secret"}, "baseline": _snapshot(), "candidate": _snapshot(runtime="langgraph_shadow")},
        {"case_id": "different", "request": {"input_text": "private"}, "baseline": _snapshot(), "candidate": _snapshot(answer="changed")},
    ])
    assert report["status"] == "fail"
    assert report["mismatch_cases"] == 1
    assert report["category_counts"] == {"answer": 1}
    rendered = str(report)
    assert "secret" not in rendered
    assert "private" not in rendered
    assert "changed" not in rendered
    assert len(normalize_snapshot(_snapshot())["result"]["answer_hash"]) == 64


def test_sampling_is_deterministic_and_bounded():
    assert should_sample("run-1", enabled=False, sample_percent=100) is False
    assert should_sample("run-1", enabled=True, sample_percent=0) is False
    assert should_sample("run-1", enabled=True, sample_percent=100) is True
    assert should_sample("run-1", enabled=True, sample_percent=25) == should_sample("run-1", enabled=True, sample_percent=25)


def test_langgraph_backend_status_separates_dependency_from_implementation():
    status = langgraph_backend_status()
    assert {
        "dependency_installed",
        "implemented",
        "production_ready",
        "reason",
    }.issubset(status)
    assert status["implemented"] is False
    assert status["business_adapter_implemented"] is True
    assert status["production_checkpointer_supported"] is False
    assert status["production_ready"] is False
    assert status["reason"] in {
        "dependency_missing",
        "checkpointer_dependency_missing",
        "production_integration_pending",
        "backend_not_implemented",
    }


def test_langgraph_graph_contract_is_explicitly_fail_closed_without_checkpointer():
    try:
        build_langgraph_contract_graph(checkpointer=None)
    except LangGraphDependencyError as exc:
        assert "checkpointer" in str(exc) or "dependency" in str(exc)
    else:
        raise AssertionError("graph builder must require a durable checkpointer")


def test_langgraph_checkpoint_identity_is_run_scoped():
    assert langgraph_thread_config(" run-42 ") == {
        "configurable": {"thread_id": "run-42"}
    }
    try:
        langgraph_thread_config("")
    except ValueError as exc:
        assert "run_id" in str(exc)
    else:
        raise AssertionError("empty run_id must not create a checkpoint identity")


def test_runtime_state_contract_is_ordered_idempotent_and_fail_closed():
    assert phase_contract_status()["phase_steps"] == ["prepare", "execute", "verify", "finish"]
    assert append_completed_step(["prepare", "execute"], "execute") == ["prepare", "execute"]
    assert state_validation_error(
        {
            "run_id": "run-1",
            "owner_user_id": "user-1",
            "input_text": "hello",
            "phase": "executed",
            "completed_steps": ["prepare", "execute"],
        }
    ) is None
    assert state_validation_error(
        {
            "run_id": "run-1",
            "owner_user_id": "user-1",
            "input_text": "hello",
            "phase": "verified",
            "completed_steps": ["prepare", "prepare"],
        }
    ) == ("INVALID_RUN_STEPS", "任务状态步骤重复")
    assert state_validation_error(
        {
            "run_id": "run-1",
            "owner_user_id": "user-1",
            "input_text": "hello",
            "phase": "verified",
            "completed_steps": ["prepare", "verify"],
        }
    ) == ("INVALID_RUN_STEPS", "任务状态步骤顺序无效")
    assert state_validation_error(
        {
            "run_id": "run-1",
            "owner_user_id": "user-1",
            "input_text": "hello",
            "phase": "executed",
            "completed_steps": [["prepare"]],
        }
    ) == ("INVALID_RUN_STEPS", "任务状态步骤无效")
    assert state_validation_error(
        {"run_id": "run-1", "owner_user_id": "user-1", "input_text": "hello", "phase": "unknown"}
    ) == ("INVALID_RUN_PHASE", "任务状态阶段无效")
    assert state_validation_error(
        {
            "run_id": "run-1",
            "owner_user_id": "user-1",
            "input_text": "hello",
            "schema_version": "9.0",
        }
    ) == ("INVALID_RUN_STATE_SCHEMA", "任务状态版本不受支持")


def test_runtime_state_contract_rejects_phase_and_prefix_mismatch():
    base = {
        "run_id": "run-1",
        "owner_user_id": "user-1",
        "input_text": "hello",
    }
    assert state_validation_error({**base, "phase": "prepared", "completed_steps": []}) == (
        "INVALID_RUN_STEPS",
        "任务状态步骤与阶段不一致",
    )
    assert state_validation_error({**base, "phase": "executed", "completed_steps": ["prepare"]}) == (
        "INVALID_RUN_STEPS",
        "任务状态步骤与阶段不一致",
    )
    assert state_validation_error({**base, "phase": "failed", "completed_steps": ["prepare", "finish"]}) == (
        "INVALID_RUN_STEPS",
        "任务状态步骤顺序无效",
    )
    assert state_validation_error({**base, "phase": "failed", "completed_steps": ["prepare", "execute"]}) is None


def test_append_completed_step_rejects_skipped_or_corrupt_prefix():
    try:
        append_completed_step(["prepare"], "verify")
    except ValueError as exc:
        assert "completed steps" in str(exc)
    else:
        raise AssertionError("a skipped phase must not be appended")

    try:
        append_completed_step(["prepare", "finish"], "execute")
    except ValueError as exc:
        assert "completed steps" in str(exc)
    else:
        raise AssertionError("a corrupt prefix must not be reused")


def test_langgraph_graph_pilot_persists_state_when_optional_dependencies_exist():
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    saver = SqliteSaver(sqlite3.connect(":memory:", check_same_thread=False))
    graph = build_langgraph_contract_graph(
        checkpointer=saver,
        execute=lambda state: {"result": {"answer": state["input_text"]}},
    )
    config = {"configurable": {"thread_id": "runtime-contract-test"}}
    result = graph.invoke(
        {"run_id": "run-1", "owner_user_id": "user-1", "input_text": "hello"},
        config,
    )
    assert result["phase"] == "completed"
    assert result["completed_steps"] == ["prepare", "execute", "verify", "finish"]
    assert graph.get_state(config).values["result"]["answer"] == "hello"


def test_langgraph_graph_validation_fails_closed_when_optional_dependencies_exist():
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    calls: list[str] = []
    saver = SqliteSaver(sqlite3.connect(":memory:", check_same_thread=False))
    graph = build_langgraph_contract_graph(
        checkpointer=saver,
        execute=lambda state: calls.append("execute") or {},
        verify=lambda state: calls.append("verify") or {},
    )
    result = graph.invoke(
        {"run_id": "run-1", "owner_user_id": "user-1", "input_text": ""},
        {"configurable": {"thread_id": "runtime-invalid-test"}},
    )
    assert result["phase"] == "failed"
    assert result["error_code"] == "INVALID_RUN_STATE"
    assert result["completed_steps"] == ["prepare"]
    assert calls == []


def test_langgraph_service_binding_reuses_tool_outcome_and_run_checkpoint_contracts(generation_db):
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    calls: list[dict] = []

    class ReadTool(BaseTool):
        name = "langgraph_pilot_read"
        effect = "read"

        def run(self, tool_input, context):
            calls.append(dict(tool_input))
            return ToolResult(
                tool_name=self.name,
                payload={"answer": f"tool:{tool_input['text']}"},
                source_count=1,
            )

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="pilot-user", input_text="hello")
    token = service.acquire_lease(row.uuid, "pilot-worker")
    assert token is not None
    service.bind_lease("pilot-worker", token)
    registry = ToolRegistry()
    registry.register(ReadTool())
    context = ToolContext(
        user_id="pilot-user",
        db=generation_db,
        run_id=row.uuid,
        idempotency_key="",
    )
    binding = LangGraphRunBinding(
        service=service,
        row=row,
        worker_id="pilot-worker",
        fencing_token=token,
        tool_registry=registry,
        tool_context=context,
        tool_name="langgraph_pilot_read",
        tool_input={"text": "hello"},
    )
    saver = SqliteSaver(sqlite3.connect(":memory:", check_same_thread=False))
    result = binding.invoke(
        checkpointer=saver,
        input_text="hello",
    )

    assert result["phase"] == "completed"
    assert result["result"] == {"answer": "tool:hello"}
    assert row.status == "succeeded"
    assert [step.step_type for step in service.list_steps(row.uuid)] == [
        "langgraph_prepare",
        "langgraph_execute",
        "langgraph_verify",
        "langgraph_finish",
    ]
    assert row.checkpoint_json["langgraph_thread_id"] == row.uuid

    # Replaying the same graph thread must reuse the durable AgentRun result
    # instead of invoking the read tool or appending duplicate steps.
    replay = binding.invoke(
        checkpointer=saver,
        input_text="hello",
    )
    assert replay["phase"] == "completed"
    assert replay["result"] == {"answer": "tool:hello"}
    assert calls == [{"text": "hello"}]
    assert len(service.list_steps(row.uuid)) == 4


def test_langgraph_service_binding_fails_closed_after_fencing_takeover(generation_db):
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    import sqlite3

    from datetime import UTC, datetime
    from langgraph.checkpoint.sqlite import SqliteSaver

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="pilot-user", input_text="hello")
    first_now = datetime(2026, 7, 13, 10, 0, tzinfo=UTC).replace(tzinfo=None)
    first_token = service.acquire_lease(row.uuid, "pilot-worker-a", ttl_seconds=10, now=first_now)
    assert first_token is not None
    second_token = service.acquire_lease(
        row.uuid,
        "pilot-worker-b",
        ttl_seconds=10,
        now=datetime(2026, 7, 13, 10, 0, 11, tzinfo=UTC).replace(tzinfo=None),
    )
    assert second_token == first_token + 1
    binding = LangGraphRunBinding(
        service=service,
        row=row,
        worker_id="pilot-worker-a",
        fencing_token=first_token,
    )
    result = binding.invoke(
        checkpointer=SqliteSaver(sqlite3.connect(":memory:", check_same_thread=False)),
        input_text="hello",
    )

    assert result["phase"] == "failed"
    assert result["error_code"] == "RUN_LEASE_LOST"
    generation_db.refresh(row)
    assert row.status == "created"
    assert service.list_steps(row.uuid) == []


def test_langgraph_finish_replay_repairs_run_projection(generation_db):
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="pilot-user", input_text="hello")
    token = service.acquire_lease(row.uuid, "pilot-worker")
    assert token is not None
    service.bind_lease("pilot-worker", token)
    binding = LangGraphRunBinding(
        service=service,
        row=row,
        worker_id="pilot-worker",
        fencing_token=token,
    )

    prepared = binding.prepare(binding.initial_state("hello"))
    executed = binding.execute({**binding.initial_state("hello"), **prepared})
    verified = binding.verify({**binding.initial_state("hello"), **prepared, **executed})
    generation_db.refresh(row)
    assert row.status == "running"

    # Simulate a crash after finish Step commit but before mark_succeeded.
    service.add_step(
        row,
        step_type="langgraph_finish",
        status="succeeded",
        role="harness",
    )
    replay = binding.finish({
        **binding.initial_state("hello"),
        **prepared,
        **executed,
        **verified,
    })

    assert replay["phase"] == "completed"
    assert row.status == "succeeded"
    assert row.result_json == {"answer": "hello"}


def test_agent_run_checkpoint_saver_is_durable_and_run_scoped(generation_db):
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="checkpoint-user", input_text="hello")
    token = service.acquire_lease(row.uuid, "checkpoint-worker")
    assert token is not None
    service.bind_lease("checkpoint-worker", token)
    binding = LangGraphRunBinding(
        service=service,
        row=row,
        worker_id="checkpoint-worker",
        fencing_token=token,
    )

    saver = AgentRunCheckpointSaver(
        service,
        row,
        worker_id="checkpoint-worker",
        fencing_token=token,
    )
    result = binding.invoke(input_text="hello")
    assert result["phase"] == "completed"
    stored_record = generation_db.scalar(
        select(AgentRunLangGraphCheckpoint)
        .where(AgentRunLangGraphCheckpoint.run_id == row.uuid)
        .order_by(AgentRunLangGraphCheckpoint.id.desc())
    )
    assert stored_record is not None
    stored = {
        "thread_id": stored_record.thread_id,
        "checkpoint_id": stored_record.checkpoint_id,
    }
    assert stored["thread_id"] == row.uuid
    assert stored["checkpoint_id"]
    restored = saver.get_tuple({"configurable": {"thread_id": row.uuid}})
    assert restored is not None
    assert restored.checkpoint["channel_values"]["phase"] == "completed"

    # The saver cannot be pointed at another run's thread, even by a caller
    # holding a valid lease for this row.
    try:
        saver.get_tuple({"configurable": {"thread_id": "other-run"}})
    except ValueError as exc:
        assert "AgentRun uuid" in str(exc)
    else:
        raise AssertionError("cross-run LangGraph checkpoint reads must fail closed")


def test_checkpoint_saver_list_returns_history_with_before_filter_and_limit():
    """Listing a thread must expose its full durable history, not only the tip."""

    from types import SimpleNamespace

    saver = object.__new__(AgentRunCheckpointSaver)
    saver.row = SimpleNamespace(uuid="run-1")
    payloads = [
        {"thread_id": "run-1", "checkpoint_ns": "", "checkpoint_id": "cp-3", "metadata": {"phase": "finish"}},
        {"thread_id": "run-1", "checkpoint_ns": "", "checkpoint_id": "cp-2", "metadata": {"phase": "execute"}},
        {"thread_id": "run-1", "checkpoint_ns": "", "checkpoint_id": "cp-1", "metadata": {"phase": "prepare"}},
    ]
    saver._assert_thread = lambda config: ("run-1", "")
    saver._langgraph_payloads = lambda **_: payloads
    saver._tuple = lambda payload, _: payload["checkpoint_id"]
    config = {"configurable": {"thread_id": "run-1", "checkpoint_ns": ""}}

    assert list(saver.list(config)) == ["cp-3", "cp-2", "cp-1"]
    assert list(saver.list(config, limit=2)) == ["cp-3", "cp-2"]
    assert list(
        saver.list(
            config,
            before={"configurable": {"thread_id": "run-1", "checkpoint_id": "cp-2"}},
        )
    ) == ["cp-1"]
    assert list(
        saver.list(
            config,
            before={"configurable": {"thread_id": "run-1", "checkpoint_id": "cp-unknown"}},
        )
    ) == []
    assert list(saver.list(config, filter={"phase": "execute"})) == ["cp-2"]
    assert list(saver.list(config, filter={"phase": "missing"})) == []


def test_checkpoint_saver_payload_history_reads_all_committed_records(generation_db):
    """The database adapter must retain history ordering across fresh reads."""

    from types import SimpleNamespace

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="checkpoint-history", input_text="hello")
    generation_db.add_all(
        [
            AgentRunLangGraphCheckpoint(
                run_id=row.uuid,
                thread_id=row.uuid,
                checkpoint_ns="",
                checkpoint_id=checkpoint_id,
                checkpoint_json={"id": checkpoint_id},
                metadata_json={"phase": phase},
                pending_writes_json=[],
                new_versions_json={},
            )
            for checkpoint_id, phase in (("cp-1", "prepare"), ("cp-2", "execute"), ("cp-3", "finish"))
        ]
    )
    generation_db.commit()

    saver = object.__new__(AgentRunCheckpointSaver)
    saver.service = service
    saver.row = SimpleNamespace(uuid=row.uuid)
    saver._shared_session = True
    payloads = saver._langgraph_payloads(thread_id=row.uuid, checkpoint_ns="")

    assert [payload["checkpoint_id"] for payload in payloads] == ["cp-3", "cp-2", "cp-1"]


def test_durable_checkpoint_survives_outer_transaction_rollback(tmp_path):
    """A safe point must remain visible after the request transaction rolls back."""

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'checkpoint.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    db = sessions()
    try:
        cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
        service = AgentRunService(db, cipher)
        row = service.create_run(owner_user_id="durable-user", input_text="checkpoint")
        db.commit()
        token = service.acquire_lease(row.uuid, "durable-worker")
        assert token is not None
        db.commit()
        service.bind_lease("durable-worker", token)

        service.persist_safe_checkpoint(
            row,
            checkpoint={"last_safe_step": "execute", "answer": "persisted"},
            durable=True,
        )
        db.rollback()

        with sessions() as reader:
            stored = reader.get(AgentRun, row.id)
            assert stored is not None
            assert stored.checkpoint_json["answer"] == "persisted"
            assert stored.checkpoint_json["last_safe_step"] == "execute"
    finally:
        db.close()


def test_checkpoint_saver_uses_independent_commit_and_fencing(tmp_path):
    """A takeover rejects the old saver while its committed checkpoint remains readable."""

    import pytest

    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'saver-fencing.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    first_db = sessions()
    second_db = sessions()
    try:
        first_service = AgentRunService(first_db, cipher)
        row = first_service.create_run(owner_user_id="fencing-user", input_text="checkpoint")
        first_db.commit()
        first_token = first_service.acquire_lease(row.uuid, "worker-a")
        assert first_token is not None
        first_db.commit()
        old_saver = AgentRunCheckpointSaver(
            first_service,
            row,
            worker_id="worker-a",
            fencing_token=first_token,
        )
        config = {"configurable": {"thread_id": row.uuid, "checkpoint_ns": ""}}
        old_saver.put(config, {"id": "cp-1", "channel_values": {"phase": "one"}}, {}, {})

        second_service = AgentRunService(second_db, cipher)
        takeover_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=31)
        second_token = second_service.acquire_lease(row.uuid, "worker-b", now=takeover_at)
        assert second_token is not None and second_token > first_token
        second_db.commit()

        with pytest.raises(LeaseLostError):
            old_saver.put(config, {"id": "cp-stale", "channel_values": {"phase": "stale"}}, {}, {})

        reader = sessions()
        try:
            records = reader.scalars(
                select(AgentRunLangGraphCheckpoint)
                .where(AgentRunLangGraphCheckpoint.run_id == row.uuid)
                .order_by(AgentRunLangGraphCheckpoint.id)
            ).all()
            assert [record.checkpoint_id for record in records] == ["cp-1"]
            assert records[0].fencing_token == first_token
        finally:
            reader.close()
    finally:
        first_db.close()
        second_db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_local_contract_fixture_has_fifty_equivalent_cases():
    records = build_contract_fixture()
    report = aggregate_shadow_records(records)
    assert len(records) == CONTRACT_CASE_COUNT == 50
    assert report["status"] == "pass"
    assert report["total_cases"] == 50
    assert report["mismatch_cases"] == 0


def test_local_contract_fixture_repeats_three_independent_trials():
    records = build_contract_trials(trials=CONTRACT_TRIAL_COUNT)
    report = aggregate_shadow_records(records)

    assert len(records) == CONTRACT_CASE_COUNT * CONTRACT_TRIAL_COUNT
    assert len({record["case_id"] for record in records}) == len(records)
    assert {record["trial"] for record in records} == {1, 2, 3}
    assert report["status"] == "pass"
    assert report["total_cases"] == CONTRACT_CASE_COUNT * CONTRACT_TRIAL_COUNT
    assert report["mismatch_cases"] == 0


def test_native_and_langgraph_fast_path_are_equivalent_in_isolated_databases():
    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    snapshots = []
    for runtime_class in (NativeRuntime, LangGraphRuntime):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        row = AgentRunService(db, cipher).create_run(
            owner_user_id="shadow-fixture",
            input_text="一个没有知识库证据的问题",
            run_type="chat",
        )
        request = RunRequest(
            run_id=row.uuid,
            owner_user_id="shadow-fixture",
            input_text="一个没有知识库证据的问题",
            run_type="chat",
        )
        snapshots.append(runtime_class(db, cipher).start_sync(request))
        db.close()

    assert compare_snapshots(snapshots[0], snapshots[1]) == []


def test_real_langgraph_native_adapter_preserves_business_result(generation_db):
    status = langgraph_graph_status()
    if not status["checkpointer_supported"]:
        import pytest

        pytest.skip("optional LangGraph SQLite dependencies are not installed")

    from app.agent_runtime.answer_engine import DefaultAnswerEngine
    from app.agent_runtime.deep_retrieve import RetrievedSnippet

    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode())
    engine = DefaultAnswerEngine(
        retrieve_fn=lambda _db, _user, _query: [
            RetrievedSnippet(
                name="pilot-source",
                location="section-1",
                file_uuid="pilot-file",
                text="这是用于真实 LangGraph 适配器 parity 的稳定证据。",
            )
        ]
    )
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(owner_user_id="pilot-user", input_text="验证适配器")
    request = RunRequest(
        run_id=row.uuid,
        owner_user_id=row.owner_user_id,
        input_text="验证适配器",
    )
    runtime = LangGraphRuntime(
        generation_db,
        cipher,
        answer_engine=engine,
        mode="real",
        lease_heartbeat_interval_seconds=60,
    )
    snapshot = runtime.start_sync(request)

    assert snapshot.status == "succeeded"
    assert snapshot.result["runtime"] == "langgraph_real"
    assert snapshot.result["snippet_count"] == 1
    assert snapshot.result["answer"]
    assert [step.step_type for step in service.list_steps(row.uuid)] == [
        "coordinate",
        "research",
        "write",
        "review",
    ]

    replay = runtime.start_sync(request)
    assert replay.status == "succeeded"
    assert replay.result["answer"] == snapshot.result["answer"]
    assert [step.step_type for step in service.list_steps(row.uuid)] == [
        "coordinate",
        "research",
        "write",
        "review",
    ]


def test_admin_langgraph_flag_controls_runtime_selection(tmp_path, monkeypatch):
    from app import feature_flags as ff

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    settings = type("Settings", (), {"knowledge_storage_dir": str(tmp_path)})()
    ff.save_feature_flags({"langgraph_runtime": True}, settings)
    runtime = select_runtime(
        None,
        ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode()),
        settings=settings,
    )
    assert isinstance(runtime, LangGraphRuntime)
    assert runtime.capabilities == {
        "backend": "langgraph",
        "mode": "shadow",
        "delegates_to": "native",
        **langgraph_backend_status(),
    }


def test_real_langgraph_mode_fails_closed_until_backend_exists(tmp_path, monkeypatch):
    from app import feature_flags as ff

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    settings = type("Settings", (), {"knowledge_storage_dir": str(tmp_path)})()
    ff.save_feature_flags(
        {"langgraph_runtime": True, "langgraph_runtime_mode": "real"}, settings
    )

    try:
        select_runtime(
            None,
            ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode()),
            settings=settings,
        )
    except RuntimeError as exc:
        assert "production readiness gate" in str(exc)
    else:
        raise AssertionError("real LangGraph mode must fail closed")
