"""Agent market, call cost ledger, egress audit persistence."""

from app.agent_audit_service import cost_summary, record_agent_call, record_egress_audit
from app.agent_market_service import list_market, sync_hub_to_connections
from app.data_egress import evaluate_egress


def test_market_sync_and_list(generation_db) -> None:
    items = list_market(generation_db)
    generation_db.commit()
    ids = {i["agent_id"] for i in items}
    assert "local.echo" in ids
    assert "local.summary" in ids


def test_record_call_and_cost_summary(generation_db) -> None:
    sync_hub_to_connections(generation_db)
    record_agent_call(
        generation_db,
        user_id="dev",
        agent_id="local.echo",
        status="succeeded",
        latency_ms=12,
        cost_micros=0,
        destination="local_model",
        request_summary="hi",
        result_summary="echo",
    )
    record_agent_call(
        generation_db,
        user_id="dev",
        agent_id="ext.demo",
        status="egress_denied",
        latency_ms=1,
        cost_micros=0,
        egress_allowed=False,
        destination="external_agent",
    )
    generation_db.commit()
    summary = cost_summary(generation_db)
    assert summary["calls_total"] >= 2
    assert summary["calls_blocked"] >= 1
    assert any(a["agent_id"] == "local.echo" for a in summary["by_agent"])


def test_egress_audit_persist(generation_db) -> None:
    decision = evaluate_egress("机密 商密 文本", destination="external_agent")
    row = record_egress_audit(
        generation_db,
        user_id="dev",
        decision=decision,
        agent_id="ext.x",
        text="机密 商密 文本",
    )
    generation_db.commit()
    assert row.allowed is False
    assert row.uuid


def test_invoke_with_egress_and_market_api(generation_client, generation_db) -> None:
    market = generation_client.get("/api/ai/agent-hub/market")
    assert market.status_code == 200, market.text
    assert market.json()["total"] >= 2

    ok = generation_client.post(
        "/api/ai/agent-hub/agents/local.echo/invoke",
        json={"input_text": "ping"},
    )
    assert ok.status_code == 200, ok.text
    assert "ping" in ok.json()["output"]
    assert "egress" in ok.json()

    blocked = generation_client.post(
        "/api/ai/agent-hub/agents/local.echo/invoke",
        json={"input_text": "机密 绝密 项目资料全文", "egress_confirmed": False},
    )
    # local destination allows L3
    assert blocked.status_code == 200

    # external would need registration — register and block
    reg = generation_client.post(
        "/api/ai/agent-hub/agents/http",
        json={
            "agent_id": "ext.cost",
            "name": "Cost Agent",
            "endpoint": "https://example.test/invoke",
            "cost_per_call_micros": 1000,
        },
        headers={"X-Test-Role": "admin"},
    )
    assert reg.status_code == 201, reg.text

    denied = generation_client.post(
        "/api/ai/agent-hub/agents/ext.cost/invoke",
        json={"input_text": "机密 商密 合同", "egress_confirmed": False},
    )
    assert denied.status_code == 403

    cost = generation_client.get(
        "/api/ai/ops/cost-summary",
        headers={"X-Test-Role": "admin"},
    )
    assert cost.status_code == 200, cost.text
    assert cost.json()["calls_total"] >= 1

    audits = generation_client.get("/api/ai/data-egress/audits")
    assert audits.status_code == 200
    assert audits.json()["total"] >= 1
