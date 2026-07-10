import asyncio
from unittest.mock import Mock

from sqlalchemy import select

from app.config import get_settings
from app.crypto import ContentCipher
from app.long_tasks import LongTaskExecutor, LongTaskService
from app.models import LongTask
from app.server_model_client import ServerModelStreamEvent


def _prepare_chat(client):
    response = client.post(
        "/api/ai/chat/prepare",
        json={"question": "生成一份长报告", "mode": "normal"},
    )
    assert response.status_code == 201
    return response.json()


def _queue_chat(client, prepared):
    return client.post(
        "/api/ai/long-tasks/chat-generation",
        json={
            "conversation_id": prepared["session_uuid"],
            "message_uuid": prepared["assistant_message_uuid"],
            "completion_token": prepared["completion_token"],
            "messages": prepared["messages"],
            "temperature": 0.3,
            "title": "季度调研报告",
        },
    )


def test_queue_encrypts_private_payload_and_lists_only_owner(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", enqueue)
    owner = client_for_user("long-owner")
    other = client_for_user("long-other")
    prepared = _prepare_chat(owner)

    queued = _queue_chat(owner, prepared)
    duplicate = _queue_chat(owner, prepared)

    assert queued.status_code == 202
    assert duplicate.status_code == 409
    task = queued.json()
    assert task["status"] == "queued"
    assert task["draft"] == ""
    enqueue.assert_called_once_with(task["task_id"])
    row = generation_db.scalar(select(LongTask).where(LongTask.uuid == task["task_id"]))
    assert row is not None
    assert "生成一份长报告".encode() not in row.request_ciphertext

    own_list = owner.get("/api/ai/long-tasks")
    other_list = other.get("/api/ai/long-tasks")
    hidden_detail = other.get(f"/api/ai/long-tasks/{task['task_id']}")
    stolen_queue = _queue_chat(other, prepared)
    assert own_list.json()["total"] == 1
    assert other_list.json()["total"] == 0
    assert hidden_detail.status_code == 404
    assert stolen_queue.status_code == 404


def test_failed_task_keeps_draft_and_retry_resumes_same_task(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    enqueue = Mock()
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", enqueue)
    owner = client_for_user("long-retry")
    prepared = _prepare_chat(owner)
    task = _queue_chat(owner, prepared).json()
    enqueue.reset_mock()
    service = LongTaskService(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
    )
    service.mark_running(task["task_id"], owner_user_id="long-retry")
    service.save_draft(
        task["task_id"],
        owner_user_id="long-retry",
        draft="已经生成的正文草稿",
        checkpoint="generating",
    )
    service.mark_failed(
        task["task_id"],
        owner_user_id="long-retry",
        error_code="NETWORK_FAILED",
        error_message="联网失败，请重试",
    )
    generation_db.commit()

    failed = owner.get(f"/api/ai/long-tasks/{task['task_id']}")
    retried = owner.post(f"/api/ai/long-tasks/{task['task_id']}/retry")

    assert failed.json()["status"] == "failed"
    assert failed.json()["draft"] == "已经生成的正文草稿"
    assert failed.json()["retry_allowed"] is True
    assert retried.status_code == 200
    assert retried.json()["status"] == "retrying"
    assert retried.json()["draft"] == "已经生成的正文草稿"
    assert retried.json()["attempt"] == 2
    enqueue.assert_called_once_with(task["task_id"])


def test_cancelled_task_never_calls_external_model(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    enqueue = Mock()
    cancel = Mock()
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", enqueue)
    monkeypatch.setattr("app.long_task_routes.dispatcher.cancel", cancel)
    owner = client_for_user("long-cancel")
    prepared = _prepare_chat(owner)
    task = _queue_chat(owner, prepared).json()
    service = LongTaskService(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
    )
    service.mark_running(task["task_id"], owner_user_id="long-cancel")
    generation_db.commit()

    cancelled = owner.post(f"/api/ai/long-tasks/{task['task_id']}/cancel")
    generation_db.commit()
    stream_model = Mock()
    executor = LongTaskExecutor(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
        stream_model=stream_model,
    )
    asyncio.run(executor.run(task["task_id"]))

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    cancel.assert_called_once_with(task["task_id"])
    stream_model.assert_not_called()


def test_executor_persists_streamed_draft_and_completes_chat(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", Mock())
    owner = client_for_user("long-complete")
    prepared = _prepare_chat(owner)
    task = _queue_chat(owner, prepared).json()

    async def stream_model(_row, _payload):
        yield ServerModelStreamEvent(delta="第一段")
        yield ServerModelStreamEvent(delta="第二段")

    executor = LongTaskExecutor(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
        stream_model=stream_model,
    )
    asyncio.run(executor.run(task["task_id"]))

    detail = owner.get(f"/api/ai/long-tasks/{task['task_id']}").json()
    chat = owner.get(f"/api/ai/chat/sessions/{prepared['session_uuid']}").json()
    assert detail["status"] == "completed"
    assert detail["progress"] == 100
    assert detail["draft"] == "第一段第二段"
    assert chat["messages"][-1]["content"] == "第一段第二段"


def test_executor_failure_keeps_partial_draft(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", Mock())
    owner = client_for_user("long-partial")
    prepared = _prepare_chat(owner)
    task = _queue_chat(owner, prepared).json()

    async def stream_model(_row, _payload):
        yield ServerModelStreamEvent(delta="已完成的草稿")
        raise RuntimeError("upstream disconnected")

    executor = LongTaskExecutor(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
        stream_model=stream_model,
    )
    asyncio.run(executor.run(task["task_id"]))

    detail = owner.get(f"/api/ai/long-tasks/{task['task_id']}").json()
    assert detail["status"] == "failed"
    assert detail["draft"] == "已完成的草稿"
    assert detail["error_message"] == "任务执行失败，已保留当前草稿，可稍后重试"


def test_cancelling_running_executor_interrupts_external_stream(
    client_for_user,
    generation_db,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.long_task_routes.dispatcher.enqueue", Mock())
    owner = client_for_user("long-interrupt")
    prepared = _prepare_chat(owner)
    task = _queue_chat(owner, prepared).json()
    entered_stream = asyncio.Event()

    async def stream_model(_row, _payload):
        entered_stream.set()
        await asyncio.Event().wait()
        yield ServerModelStreamEvent(delta="不应写入")

    executor = LongTaskExecutor(
        generation_db,
        ContentCipher(get_settings().content_encryption_key),
        stream_model=stream_model,
    )

    async def run_and_cancel():
        running = asyncio.create_task(executor.run(task["task_id"]))
        await entered_stream.wait()
        running.cancel()
        try:
            await running
        except asyncio.CancelledError:
            pass

    asyncio.run(run_and_cancel())

    detail = owner.get(f"/api/ai/long-tasks/{task['task_id']}").json()
    chat = owner.get(f"/api/ai/chat/sessions/{prepared['session_uuid']}").json()
    assert detail["status"] == "cancelled"
    assert detail["draft"] == ""
    assert chat["messages"][-1]["content"] == ""
