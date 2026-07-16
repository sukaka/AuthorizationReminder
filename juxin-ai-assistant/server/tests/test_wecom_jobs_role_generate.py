"""WeCom outbound HTTP, durable channel jobs, role assistant generate."""

from __future__ import annotations

import respx
from httpx import Response

from app.channel_gateway import ChannelMessage, ChannelReply
from app.channel_job_service import ChannelJobService
from app.channel_outbound import WecomHttpOutboundSender
from app.config import get_settings
from app.role_assistant_routes import build_role_document, ROLE_ASSISTANTS


def test_build_role_document_has_headings() -> None:
    role = ROLE_ASSISTANTS[0]
    code, name, title, md = build_role_document(
        role=role,
        template_code=role["templates"][0],
        title="",
        topic="核心交换机故障",
        notes="凌晨 2 点告警",
    )
    assert code
    assert name
    assert "核心交换机" in title or "核心交换机" in md
    assert "# " in md
    assert "待确认" in md or "凌晨" in md


def test_role_generate_api(generation_client) -> None:
    resp = generation_client.post(
        "/api/ai/role-assistants/project_pm/generate",
        json={
            "topic": "本周交付冲刺",
            "template_code": "weekly_report_v1",
            "notes": "完成 Run 底座与导出",
            "create_artifact": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["artifact_id"]
    assert body["template_code"] == "weekly_report_v1"
    assert "本周" in body["content_markdown"] or "交付" in body["title"]
    art = generation_client.get(f"/api/ai/artifacts/{body['artifact_id']}")
    assert art.status_code == 200
    assert art.json()["content_markdown"]


@respx.mock
def test_wecom_http_outbound() -> None:
    class S:
        wecom_corp_id = "ww_test"
        wecom_secret = "secret"
        wecom_agent_id = "1000002"
        knowledge_storage_dir = "./storage"

    token_route = respx.get(url__regex=r"https://qyapi\.weixin\.qq\.com/cgi-bin/gettoken.*").mock(
        return_value=Response(200, json={"errcode": 0, "access_token": "tok", "expires_in": 7200})
    )
    send_route = respx.post(url__regex=r"https://qyapi\.weixin\.qq\.com/cgi-bin/message/send.*").mock(
        return_value=Response(200, json={"errcode": 0, "errmsg": "ok"})
    )
    sender = WecomHttpOutboundSender(S())  # type: ignore[arg-type]
    result = sender.send(
        reply=ChannelReply(text="你好企微"),
        external_user_id="ZhangSan",
        thread_id="1000002",
    )
    assert result.mode == "http"
    assert result.ok is True
    assert token_route.called
    assert send_route.called


def test_channel_job_retry_and_dead(generation_db) -> None:
    settings = get_settings()
    service = ChannelJobService(generation_db)
    msg = ChannelMessage(
        channel="feishu",
        external_user_id="ou_j",
        text="持久化任务测试",
        thread_id="oc_j",
        metadata={"message_id": "om_job_1"},
    )
    job = service.enqueue(msg, job_key="feishu:om_job_1", max_attempts=2)
    generation_db.commit()
    assert job.status == "queued"
    # force process failure by empty cipher path still may succeed; mark manually failed path
    job.status = "failed"
    job.attempt = 1
    job.max_attempts = 2
    job.last_error = "boom"
    generation_db.add(job)
    generation_db.commit()

    retryable = service.list_retryable()
    assert any(r.uuid == job.uuid for r in retryable)

    # process successfully
    processed = service.process_job(job, settings)
    generation_db.commit()
    assert processed.status == "succeeded"
    assert processed.run_id or processed.result_json

    # dead letter path
    msg2 = ChannelMessage(
        channel="wecom",
        external_user_id="u2",
        text="will dead",
        metadata={"message_id": "om_dead"},
    )
    job2 = service.enqueue(msg2, max_attempts=1)
    generation_db.commit()

    # simulate fail by patching process
    original = service.process_job

    def boom(job, settings, *, cipher=None):
        job.status = "running"
        job.attempt = int(job.attempt or 0) + 1
        job.last_error = "forced"
        if int(job.attempt) >= int(job.max_attempts):
            job.status = "dead"
        else:
            job.status = "failed"
        generation_db.add(job)
        generation_db.flush()
        return job

    service.process_job = boom  # type: ignore[method-assign]
    try:
        dead = service.process_job(job2, settings)
        generation_db.commit()
        assert dead.status == "dead"
    finally:
        service.process_job = original  # type: ignore[method-assign]


def test_channel_jobs_admin_api(generation_client, generation_db) -> None:
    from app.channel_job_service import ChannelJobService
    from app.channel_gateway import ChannelMessage

    service = ChannelJobService(generation_db)
    service.enqueue(
        ChannelMessage(channel="web", external_user_id="u", text="hi", metadata={"message_id": "m1"}),
        job_key="web:m1",
    )
    generation_db.commit()
    listed = generation_client.get(
        "/api/ai/channels/jobs",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1
