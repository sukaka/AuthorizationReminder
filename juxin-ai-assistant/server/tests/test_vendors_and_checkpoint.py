"""Vendor connectors (Kimi / 即梦) + checkpoint recovery suite."""

from __future__ import annotations

import base64

from app.agent_hub import AgentHub, reset_agent_hub
from app.agent_run_service import AgentRunService
from app.checkpoint_recovery import (
    extract_safe_checkpoint,
    simulate_checkpoint_recovery,
)
from app.connector_sdk import InvokeRequest
from app.connector_sdk.vendors.jimeng import JimengConnector
from app.connector_sdk.vendors.kimi import KimiConnector
from app.crypto import ContentCipher


def _cipher() -> ContentCipher:
    key = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    return ContentCipher(key)


def test_kimi_dry_run_invoke_and_health() -> None:
    conn = KimiConnector(api_key="", dry_run=True)
    assert conn.dry_run is True
    h = conn.health()
    assert h.ok is True
    assert h.detail == "dry_run"
    result = conn.invoke(InvokeRequest(input_text="请分析这份长文档的风险点" * 5))
    assert result.ok is True
    assert "kimi-dry-run" in result.output
    assert result.data.get("vendor") == "moonshot"


def test_jimeng_dry_run_and_brand_block() -> None:
    conn = JimengConnector(api_key="", dry_run=True)
    ok = conn.invoke(InvokeRequest(input_text="生成培训封面，蓝色科技风"))
    assert ok.ok is True
    assert "jimeng-dry-run" in ok.output
    assert ok.data.get("review_required") is True

    blocked = conn.invoke(InvokeRequest(input_text="请做竞品商标伪造宣传图"))
    assert blocked.ok is False
    assert blocked.error_code == "brand_policy_blocked"


def test_hub_registers_vendor_agents() -> None:
    reset_agent_hub()
    hub = AgentHub()
    ids = {d.agent_id for d in hub.list_agents()}
    assert "kimi.chat" in ids
    assert "jimeng.image" in ids
    kimi = hub.invoke("kimi.chat", input_text="总结三点")
    assert "error" not in kimi or kimi.get("output")
    assert "output" in kimi
    jimeng = hub.invoke("jimeng.image", input_text="公司年会海报")
    assert "output" in jimeng
    health = hub.health("kimi.chat")
    assert health and health[0].get("ok") is True
    reset_agent_hub()


def test_checkpoint_extract_and_retry_restores_progress(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    row = service.create_run(owner_user_id="dev", input_text="长任务", run_type="complex")
    service.add_step(
        row,
        step_type="draft",
        status="succeeded",
        role="writer",
        checkpoint={"stage": "executing", "progress": 55, "summary": "draft ok"},
    )
    row.status = "failed"
    row.stage = "failed"
    row.progress = 55
    row.checkpoint_json = {"stage": "executing", "progress": 55, "summary": "draft ok"}
    generation_db.add(row)
    generation_db.flush()

    cp = extract_safe_checkpoint(generation_db, row)
    assert cp is not None
    assert cp.progress == 55

    service.retry(row)
    generation_db.commit()
    assert row.status == "retrying"
    assert row.attempt == 2
    assert int(row.progress) >= 55
    assert row.stage == "executing"
    assert isinstance(row.checkpoint_json, dict)
    assert row.checkpoint_json.get("resume_source") in {"run", "step"}


def test_simulate_checkpoint_recovery_suite(generation_db) -> None:
    service = AgentRunService(generation_db, _cipher())
    report = simulate_checkpoint_recovery(service, cases=8)
    generation_db.commit()
    assert report["total"] == 8
    assert report["recovered"] == 8
    assert report["recovery_rate"] == 1.0
    assert report["passed"] is True


def test_checkpoint_suite_api(generation_client, generation_db) -> None:
    resp = generation_client.post(
        "/api/ai/ops/checkpoint-suite?cases=5",
        headers={"X-Test-User-ID": "admin", "X-Test-Role": "admin"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 5
    assert body["recovery_rate"] >= 0.99
    assert body["passed"] is True


def test_vendor_workflow_and_condition(generation_client) -> None:
    long_text = "请分析本季度风险与机会，并给出可执行建议。" * 3
    resp = generation_client.post(
        "/api/ai/workflows/condition_route_demo/run",
        headers={"X-Test-User-ID": "dev", "X-Test-Role": "user"},
        json={"input_text": long_text, "egress_confirmed": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("status") in {"succeeded", "waiting_human", "partial", "failed"}
    steps = body.get("steps") or []
    assert any(s.get("type") == "condition" for s in steps)


def test_ga_report_includes_checkpoint_metric(generation_client) -> None:
    resp = generation_client.get(
        "/api/ai/ops/ga-report",
        headers={"X-Test-User-ID": "admin", "X-Test-Role": "admin"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    items = {i["key"]: i for i in body.get("items", [])}
    assert "checkpoint_recovery_rate" in items
    # suite may pass or unknown if nested rollback unsupported — prefer measured
    metric = items["checkpoint_recovery_rate"]
    assert metric["status"] in {"pass", "fail", "unknown"}
