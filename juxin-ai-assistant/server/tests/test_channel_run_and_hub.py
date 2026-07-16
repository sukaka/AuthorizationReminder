"""Channel → Run bridge, outbound outbox, Agent Hub."""

from __future__ import annotations

from pathlib import Path
from datetime import UTC, datetime, timedelta

from app.channel_gateway import ChannelMessage, get_channel_gateway
from app.channel_outbound import append_outbox, get_outbound_sender
from app.channel_run_bridge import (
    channel_message_key,
    channel_owner_id,
    extract_answer,
    process_channel_message,
    _send_outbound_once,
)
from app.channel_gateway import ChannelReply
from app.feature_flags import save_feature_flags
from sqlalchemy import select


def test_channel_owner_and_dedupe_key() -> None:
    msg = ChannelMessage(
        channel="feishu",
        external_user_id="ou_abc",
        text="VPN 怎么申请",
        thread_id="oc_1",
        metadata={"message_id": "om_99"},
    )
    assert channel_owner_id(msg) == "feishu:ou_abc"
    assert channel_message_key(msg) == "feishu:om_99"


def test_extract_answer_variants() -> None:
    assert "hello" in extract_answer({"answer": "hello"})
    assert "out" in extract_answer({"delivery": {"output": "out"}})
    assert extract_answer({})


def test_process_channel_message_creates_run(generation_db, tmp_path, monkeypatch) -> None:
    from app import channel_outbound as co
    from app.config import get_settings

    monkeypatch.setattr(co, "_outbox_path", lambda settings=None: tmp_path / "outbox.jsonl")
    settings = get_settings()
    msg = ChannelMessage(
        channel="feishu",
        external_user_id="ou_test",
        text="你好，请介绍一下系统能力",
        thread_id="oc_chat",
        metadata={"message_id": "om_unique_1"},
    )
    outcome = process_channel_message(
        generation_db,
        settings,
        msg,
        execute=True,
        send_outbound=True,
    )
    generation_db.commit()
    assert outcome.run_id
    assert outcome.deduped is False
    assert outcome.owner_user_id == "feishu:ou_test"
    assert outcome.outbound is not None
    assert outcome.outbound.mode == "recorded"
    # dedupe second time
    again = process_channel_message(
        generation_db,
        settings,
        msg,
        execute=True,
        send_outbound=True,
    )
    assert again.deduped is True
    assert again.run_id == outcome.run_id
    outbox = (tmp_path / "outbox.jsonl").read_text(encoding="utf-8")
    assert "feishu" in outbox
    assert len(outbox.splitlines()) == 1
    from app.models import ChannelIdentityBinding, ChannelMessageBinding

    identity = generation_db.scalar(select(ChannelIdentityBinding).where(
        ChannelIdentityBinding.channel == "feishu",
        ChannelIdentityBinding.external_user_id == "ou_test",
    ))
    assert identity is not None
    links = generation_db.scalars(select(ChannelMessageBinding).where(
        ChannelMessageBinding.run_id == outcome.run_id,
    )).all()
    assert {item.direction for item in links} == {"inbound", "outbound"}
    outbound_link = next(item for item in links if item.direction == "outbound")
    assert outbound_link.metadata_json["state"] == "sent"
    assert outbound_link.metadata_json["idempotency_key"] == "om_unique_1:outbound"


def test_channel_outbound_failure_is_reconcilable(generation_db, monkeypatch) -> None:
    from app.config import get_settings
    from app.models import ChannelIdentityBinding

    class FailingSender:
        def send(self, **_kwargs):
            raise RuntimeError("sender outcome unknown")

    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ou_reconcile",
        owner_user_id="feishu:ou_reconcile",
        last_thread_id="oc_reconcile",
    )
    generation_db.add(identity)
    generation_db.commit()
    msg = ChannelMessage(
        channel="feishu",
        external_user_id="ou_reconcile",
        text="需要对账",
        thread_id="oc_reconcile",
        metadata={"message_id": "om_reconcile_1"},
    )
    monkeypatch.setattr(
        "app.channel_run_bridge.get_outbound_sender",
        lambda *_args, **_kwargs: FailingSender(),
    )

    import pytest

    with pytest.raises(RuntimeError, match="sender outcome unknown"):
        _send_outbound_once(
            generation_db,
            get_settings(),
            identity=identity,
            msg=msg,
            run_id="run-reconcile",
            inbound_message_id="om_reconcile_1",
            reply=ChannelReply(text="待对账"),
            metadata={"run_id": "run-reconcile"},
        )

    from app.models import ChannelMessageBinding

    binding = generation_db.scalar(select(ChannelMessageBinding).where(
        ChannelMessageBinding.external_message_id == "om_reconcile_1:outbound",
    ))
    assert binding is not None
    assert binding.metadata_json["state"] == "reconciliation_required"

    class ExplodingSender:
        def send(self, **_kwargs):
            raise AssertionError("reconciliation marker must prevent a retry")

    monkeypatch.setattr(
        "app.channel_run_bridge.get_outbound_sender",
        lambda *_args, **_kwargs: ExplodingSender(),
    )
    assert _send_outbound_once(
        generation_db,
        get_settings(),
        identity=identity,
        msg=msg,
        run_id="run-reconcile",
        inbound_message_id="om_reconcile_1",
        reply=ChannelReply(text="不能盲重试"),
        metadata={"run_id": "run-reconcile"},
    ) is None


def test_channel_stale_outbound_reservation_fails_closed(generation_db, monkeypatch) -> None:
    from app.channel_run_bridge import _send_outbound_once
    from app.config import get_settings
    from app.models import ChannelIdentityBinding, ChannelMessageBinding

    identity = ChannelIdentityBinding(
        channel="feishu",
        external_user_id="ou_stale",
        owner_user_id="feishu:ou_stale",
        last_thread_id="oc_stale",
    )
    generation_db.add(identity)
    generation_db.flush()
    binding = ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel="feishu",
        external_message_id="om_stale_1:outbound",
        direction="outbound",
        thread_id="oc_stale",
        run_id="run-stale",
        related_message_id="om_stale_1",
        metadata_json={"state": "sending", "idempotency_key": "om_stale_1:outbound"},
    )
    generation_db.add(binding)
    generation_db.commit()
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=301)
    binding.created_at = old
    binding.updated_at = old
    generation_db.commit()

    class ExplodingSender:
        def send(self, **_kwargs):
            raise AssertionError("stale reservation must not be retried")

    monkeypatch.setattr(
        "app.channel_run_bridge.get_outbound_sender",
        lambda *_args, **_kwargs: ExplodingSender(),
    )
    msg = ChannelMessage(
        channel="feishu",
        external_user_id="ou_stale",
        text="旧预约",
        thread_id="oc_stale",
        metadata={"message_id": "om_stale_1"},
    )
    assert _send_outbound_once(
        generation_db,
        get_settings(),
        identity=identity,
        msg=msg,
        run_id="run-stale",
        inbound_message_id="om_stale_1",
        reply=ChannelReply(text="不应重试"),
        metadata={"run_id": "run-stale"},
    ) is None
    refreshed = generation_db.scalar(select(ChannelMessageBinding).where(
        ChannelMessageBinding.external_message_id == "om_stale_1:outbound",
    ))
    assert refreshed is not None
    assert refreshed.metadata_json["state"] == "reconciliation_required"


def test_feishu_webhook_runs(generation_client, generation_db, tmp_path, monkeypatch) -> None:
    from app import feature_flags as ff
    from app import channel_outbound as co

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    monkeypatch.setattr(co, "_outbox_path", lambda settings=None: tmp_path / "outbox.jsonl")
    save_feature_flags({"channels": {"feishu": True, "wecom": True, "web": True, "desktop": True}})

    resp = generation_client.post(
        "/api/ai/channels/webhooks/feishu",
        json={
            "event": {
                "sender": {"sender_id": {"open_id": "ou_webhook"}},
                "message": {
                    "chat_id": "oc_w",
                    "message_id": "om_webhook_1",
                    "content": '{"text":"等保要求是什么"}',
                },
            }
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["run_id"]
    assert body["action"] in {"run_completed", "deduped"}
    assert body["outbound_mode"] in {"recorded", "http", ""}


def test_agent_hub_api(generation_client) -> None:
    listed = generation_client.get("/api/ai/agent-hub/agents")
    assert listed.status_code == 200, listed.text
    agents = listed.json()
    assert any(a["agent_id"] == "local.echo" for a in agents)
    inv = generation_client.post(
        "/api/ai/agent-hub/agents/local.echo/invoke",
        json={"input_text": "ping", "context": {"k": 1}},
    )
    assert inv.status_code == 200, inv.text
    assert "ping" in inv.json()["output"]
    missing = generation_client.post(
        "/api/ai/agent-hub/agents/no.such/invoke",
        json={"input_text": "x"},
    )
    assert missing.status_code == 404


def test_agent_governance_configuration(generation_client) -> None:
    assert generation_client.get("/api/ai/agent-hub/market").status_code == 200
    configured = generation_client.put(
        "/api/ai/agent-hub/agents/local.echo/governance",
        json={
            "capabilities": ["chat", "summary"],
            "policy": {"allow_external": False},
            "budget": {"max_cost_micros": 1000, "max_latency_ms": 5000},
        },
    )
    assert configured.status_code == 200, configured.text
    assert configured.json()["capabilities"] == ["chat", "summary"]
    assert configured.json()["policy"]["allow_external"] is False
    assert configured.json()["budget"]["max_cost_micros"] == 1000
