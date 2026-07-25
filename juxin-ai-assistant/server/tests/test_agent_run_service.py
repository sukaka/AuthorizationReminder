import base64
from datetime import UTC, datetime

import pytest

from app.agent_contracts import AgentRunStage, AgentRunStatus
from app.agent_run_service import AgentRunService, BudgetExceededError, LeaseLostError
from app.chat_service import _latest_task_state_payload
from app.crypto import ContentCipher
from app.faq_matcher import normalize_question
from app.models import AgentRun, SharedFaq


def _cipher() -> ContentCipher:
    key = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    return ContentCipher(key)


def test_run_isolation_by_owner(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    a = service.create_run(owner_user_id="user-a", input_text="问题A")
    b = service.create_run(owner_user_id="user-b", input_text="问题B")
    generation_db.commit()

    assert service.get_owned_run(a.uuid, "user-a") is not None
    assert service.get_owned_run(a.uuid, "user-b") is None
    assert service.get_owned_run(b.uuid, "user-b") is not None


def test_list_owned_can_filter_by_conversation(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    current = service.create_run(
        owner_user_id="user-a",
        input_text="当前会话",
        conversation_id="conversation-current",
    )
    service.create_run(
        owner_user_id="user-a",
        input_text="其他会话",
        conversation_id="conversation-other",
    )
    generation_db.commit()

    rows = service.list_owned(
        "user-a",
        conversation_id="conversation-current",
    )

    assert [row.uuid for row in rows] == [current.uuid]


def test_public_run_includes_origin_conversation(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(
        owner_user_id="user-a",
        input_text="需要返回原会话",
        conversation_id="conversation-origin",
    )
    generation_db.commit()

    payload = service.to_public_run(row)

    assert payload.conversation_id == "conversation-origin"


def test_public_run_exposes_waiting_and_failure_recovery_semantics(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="user-a", input_text="需要补充信息")
    row.status = "waiting_user"
    row.checkpoint_json = {"next_action": "请补充客户名称后继续"}
    generation_db.commit()

    waiting = service.to_public_run(row)

    assert waiting.requires_user_action is True
    assert waiting.next_action == "请补充客户名称后继续"
    assert waiting.cancel_allowed is True
    assert waiting.retry_allowed is False

    row.status = "failed"
    row.stage = "failed"
    row.error_code = "MODEL_TIMEOUT"
    row.error_message_safe = "生成超时，请稍后重试"
    generation_db.commit()

    failed = service.to_public_run(row)

    assert failed.requires_user_action is False
    assert failed.retry_allowed is True
    assert failed.cancel_allowed is False
    assert failed.error_code == "MODEL_TIMEOUT"
    assert failed.error_message == "生成超时，请稍后重试"


def test_public_run_normalizes_artifact_delivery_metadata(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="user-a", input_text="生成 PPT")
    row.status = "succeeded"
    row.stage = "completed"
    row.progress = 100
    row.result_json = {
        "artifact_id": "artifact-pptx",
        "artifact_type": "pptx",
        "artifact_title": "客户汇报",
        "format": "pptx",
        "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "download_url": "/api/artifacts/artifact-pptx/download",
        "downloadable": True,
        "editable": True,
    }
    generation_db.commit()

    payload = service.to_public_run(row)

    assert payload.artifact is not None
    assert payload.artifact.artifact_id == "artifact-pptx"
    assert payload.artifact.format == "pptx"
    assert payload.artifact.downloadable is True
    assert payload.artifact.editable is True
    assert payload.next_action == "可查看或下载任务成果"


def test_latest_chat_task_payload_restores_run_without_task_state(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(
        owner_user_id="user-a",
        input_text="无任务状态的历史会话",
        conversation_id="conversation-without-task-state",
    )
    generation_db.commit()

    payload = _latest_task_state_payload(
        generation_db,
        user_id="user-a",
        conversation_id="conversation-without-task-state",
    )

    assert payload == {
        "conversation_id": "conversation-without-task-state",
        "run_id": row.uuid,
    }


def test_faq_fast_path_zero_model_calls(generation_db) -> None:
    generation_db.add(
        SharedFaq(
            question="公司年假几天",
            question_normalized=normalize_question("公司年假几天"),
            aliases_json=["年假多少天"],
            answer="满一年享有5天年假。",
            status="published",
        )
    )
    generation_db.commit()

    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="公司年假几天")
    handled = service.execute_faq_fast_path(row, "公司年假几天")
    generation_db.commit()

    assert handled is True
    assert row.status == "succeeded"
    assert row.model_calls == 0
    assert row.result_json["kind"] == "faq"
    assert row.result_json["display_label"] == "统一回复"
    events = service.list_events(row.uuid)
    assert any(e.event_type == "completed" for e in events)
    assert any(e.event_type == "delta" and "年假" in e.content for e in events)


def test_budget_guard_blocks_extra_model_calls(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(
        owner_user_id="dev",
        input_text="测试预算",
        max_model_calls=1,
        max_steps=5,
    )
    service.record_model_call(row)
    with pytest.raises(BudgetExceededError):
        service.record_model_call(row)


def test_step_budget_blocks_excess_tool_calls(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(
        owner_user_id="dev",
        input_text="测试步骤预算",
        max_step_tool_calls=1,
    )

    with pytest.raises(BudgetExceededError) as exc_info:
        service.add_step(
            row,
            step_type="retrieve",
            status="succeeded",
            usage={"tool_calls": 2},
        )

    assert exc_info.value.code == "STEP_TOOL_CALL_BUDGET_EXCEEDED"


def test_cancel_and_retry(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="可取消任务")
    service.request_cancel(row)
    generation_db.commit()
    assert row.status == "cancelled"

    service.retry(row)
    generation_db.commit()
    assert row.status == "retrying"
    assert row.attempt == 2


def test_run_lease_fences_stale_worker_after_expiry_takeover(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="租约任务")
    now = datetime(2026, 7, 13, 10, 0, tzinfo=UTC).replace(tzinfo=None)

    first_token = service.acquire_lease(row.uuid, "worker-a", ttl_seconds=30, now=now)
    assert first_token == 1
    assert service.acquire_lease(row.uuid, "worker-b", ttl_seconds=30, now=now) is None
    assert service.acquire_lease(row.uuid, "worker-a", ttl_seconds=30, now=now) == first_token

    second_token = service.acquire_lease(
        row.uuid,
        "worker-b",
        ttl_seconds=30,
        now=datetime(2026, 7, 13, 10, 0, 31, tzinfo=UTC).replace(tzinfo=None),
    )
    assert second_token == 2
    with pytest.raises(LeaseLostError):
        service.transition_status(
            row,
            AgentRunStatus.RUNNING,
            worker_id="worker-a",
            fencing_token=first_token,
        )

    service.transition_status(
        row,
        AgentRunStatus.RUNNING,
        worker_id="worker-b",
        fencing_token=second_token,
        now=datetime(2026, 7, 13, 10, 0, 31, tzinfo=UTC).replace(tzinfo=None),
    )
    assert row.status == "running"


def test_run_lease_release_requires_current_fencing_token(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="释放租约")
    token = service.acquire_lease(row.uuid, "worker-a")
    assert token == 1

    assert service.release_lease(row.uuid, "worker-a", token + 1) is False
    assert service.release_lease(row.uuid, "worker-a", token) is True
    assert service.acquire_lease(row.uuid, "worker-b") == 2


def test_run_lease_renewal_requires_current_owner_and_token(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="续租任务")
    start = datetime(2026, 7, 13, 10, 0, tzinfo=UTC).replace(tzinfo=None)
    token = service.acquire_lease(row.uuid, "worker-a", ttl_seconds=30, now=start)
    assert token == 1

    assert service.renew_lease(
        row.uuid,
        "worker-a",
        token,
        ttl_seconds=30,
        now=datetime(2026, 7, 13, 10, 0, 20, tzinfo=UTC).replace(tzinfo=None),
    )
    assert service.acquire_lease(
        row.uuid,
        "worker-b",
        now=datetime(2026, 7, 13, 10, 0, 35, tzinfo=UTC).replace(tzinfo=None),
    ) is None
    assert service.renew_lease(
        row.uuid,
        "worker-b",
        token,
        now=datetime(2026, 7, 13, 10, 0, 35, tzinfo=UTC).replace(tzinfo=None),
    ) is False


def test_safe_checkpoint_is_versioned_and_lease_guarded(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="保存恢复点")
    token = service.acquire_lease(row.uuid, "worker-a")
    assert token is not None
    service.bind_lease("worker-a", token)

    service.persist_safe_checkpoint(
        row,
        checkpoint={"last_safe_step": "research", "snippet_count": 2},
        stage=AgentRunStage.RETRIEVING,
        progress=50,
    )

    checkpoint = row.checkpoint_json or {}
    run_state = checkpoint["run_state"]
    assert row.stage == AgentRunStage.RETRIEVING.value
    assert row.progress == 50
    assert checkpoint["schema_version"] == "1.0"
    assert run_state["revision"] == row.state_revision
    assert run_state["cursor"]["last_safe_step"] == 0
