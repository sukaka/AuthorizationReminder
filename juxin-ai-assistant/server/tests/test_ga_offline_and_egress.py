"""Offline GA eval + data egress policy."""

from app.channel_gateway import ChannelReply
from app.channel_outbound import RecordingOutboundSender
from app.data_egress import (
    DEST_CHANNEL,
    DEST_EXTERNAL_AGENT,
    DEST_LOCAL,
    DataLevel,
    classify_text,
    evaluate_egress,
)
from app.ga_offline_eval import run_ga_offline_eval, score_answer


def test_ga_offline_eval_rates() -> None:
    report = run_ga_offline_eval(use_synthetic=True)
    assert report["answer_eval"]["total"] >= 5
    assert report["learning_context_eval"]["total"] >= 5
    rates = report["ga_rates"]
    # citation / refusal samples may be small but structure exists
    assert "citation_accuracy" in rates
    assert "no_evidence_refusal_rate" in rates


def test_score_no_evidence() -> None:
    from app.agent_runtime.deep_retrieve import no_evidence_answer

    q = "产品参数是多少"
    ans = no_evidence_answer(q)
    row = score_answer(
        question_id="no-source-guard",
        question=q,
        answer=ans + "\n不能编造\n缺少依据\n补充资料",
        meta={"path": "no_evidence", "refused": True, "citations": []},
    )
    assert row["checks"]["no_evidence_correct"] is True


def test_classify_and_egress_l3() -> None:
    text = "本文件为机密，含未解密商密条款"
    assert classify_text(text) == DataLevel.L3_CONFIDENTIAL
    denied = evaluate_egress(text, destination=DEST_EXTERNAL_AGENT)
    assert denied.allowed is False
    local = evaluate_egress(text, destination=DEST_LOCAL)
    assert local.allowed is True


def test_egress_l2_requires_confirm() -> None:
    text = "登录密码: Secret123 请勿外传"
    d1 = evaluate_egress(text, destination=DEST_CHANNEL, confirmed=False)
    assert d1.allowed is False
    assert d1.requires_confirmation is True
    d2 = evaluate_egress(text, destination=DEST_CHANNEL, confirmed=True)
    assert d2.allowed is True
    assert d2.redaction_applied is True
    assert "已脱敏" in d2.redacted_text or "password" not in d2.redacted_text.lower()


def test_outbound_blocked_by_egress(tmp_path, monkeypatch) -> None:
    from app import channel_outbound as co

    monkeypatch.setattr(co, "_outbox_path", lambda settings=None: tmp_path / "outbox.jsonl")

    class S:
        knowledge_storage_dir = str(tmp_path)

    sender = RecordingOutboundSender("feishu", S())  # type: ignore[arg-type]
    result = sender.send(
        reply=ChannelReply(text="机密：绝密项目代号 Alpha"),
        external_user_id="ou_x",
    )
    assert result.ok is False
    assert result.mode == "blocked"


def test_apis(generation_client) -> None:
    suite = generation_client.post(
        "/api/ai/learning-eval/ga-suite",
        headers={"X-Test-Role": "admin"},
    )
    assert suite.status_code == 200, suite.text
    assert suite.json()["answer_eval"]["total"] >= 1

    egress = generation_client.post(
        "/api/ai/data-egress/evaluate",
        json={"text": "公开产品介绍", "destination": "external_agent"},
    )
    assert egress.status_code == 200, egress.text
    assert egress.json()["allowed"] is True

    blocked = generation_client.post(
        "/api/ai/data-egress/evaluate",
        json={"text": "机密 商密 合同全文", "destination": "external_agent"},
    )
    assert blocked.status_code == 200
    assert blocked.json()["allowed"] is False

    ga = generation_client.get(
        "/api/ai/ops/ga-report",
        headers={"X-Test-Role": "admin"},
    )
    assert ga.status_code == 200
    body = ga.json()
    assert body.get("offline_eval") is not None or "offline_eval" in body
