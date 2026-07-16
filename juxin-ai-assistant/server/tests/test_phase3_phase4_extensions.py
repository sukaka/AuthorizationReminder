"""Phase 3 hybrid wiring + Phase 4 multi-format + templates + 7.0 channels."""

from __future__ import annotations

from app.agent_runtime.deep_retrieve import deep_retrieve, classify_query
from app.artifact_export import (
    export_artifact_bytes,
    markdown_to_rows,
    markdown_to_slides,
    render_artifact_pdf,
    render_artifact_pptx,
    render_artifact_xlsx,
)
from app.channel_gateway import ChannelGateway, ChannelReply, get_channel_gateway
from app.document_templates.registry import DOCUMENT_TEMPLATES, list_document_templates


def test_classify_and_hybrid_fallback_without_cipher(generation_db) -> None:
    # Without indexed chunks / cipher, deep_retrieve must still return safely
    result = deep_retrieve(generation_db, "dev", "VPN 如何申请", prefer_hybrid=True)
    assert result.mode in {
        "precise",
        "summary",
        "compare",
        "complex",
        "hybrid_precise",
        "hybrid_summary",
        "hybrid_compare",
        "hybrid_complex",
    }
    assert isinstance(result.snippets, list)


def test_enterprise_templates_count() -> None:
    # generic + 10 enterprise templates
    assert len(DOCUMENT_TEMPLATES) >= 11
    codes = {t["code"] for t in list_document_templates()}
    assert "incident_report_v1" in codes
    assert "acceptance_report_v1" in codes
    assert "sop_v1" in codes


def test_document_templates_api(generation_client) -> None:
    resp = generation_client.get("/api/ai/document-templates")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 11
    assert any(i["code"] == "weekly_report_v1" for i in body["items"])


def test_markdown_export_helpers() -> None:
    md = "# 标题\n- 事项A\n- 事项B\n\n## 第二节\n正文内容"
    rows = markdown_to_rows(md)
    assert rows[0] == ["章节/段落", "内容"]
    assert any("事项A" in r for r in rows)
    slides = markdown_to_slides(md, title="演示")
    assert slides
    assert slides[0]["title"]


def test_render_xlsx_pptx_pdf_bytes() -> None:
    md = "# 进展\n- 完成混合检索\n- 完成多格式导出\n\n## 风险\n- 需回归测试"
    xlsx = render_artifact_xlsx(title="周报", markdown=md)
    assert xlsx[:2] == b"PK"
    pptx = render_artifact_pptx(title="周报", markdown=md)
    assert pptx[:2] == b"PK"
    pdf = render_artifact_pdf(title="Weekly", markdown="Hello progress")
    assert pdf.startswith(b"%PDF")


def test_export_artifact_bytes_formats() -> None:
    md = "# A\n- b"
    for fmt in ("xlsx", "pptx", "pdf", "md"):
        payload, media, ext = export_artifact_bytes(title="t", markdown=md, fmt=fmt)
        assert payload
        assert ext == fmt or (fmt == "md" and ext == "md")
        assert media


def test_channel_gateway_web_and_feishu() -> None:
    gw = ChannelGateway()
    assert "web" in gw.list_channels()
    assert "feishu" in gw.list_channels()
    web = gw.normalize("web", {"text": "你好", "user_id": "u1", "conversation_id": "c1"})
    assert web is not None
    assert web.text == "你好"
    assert web.external_user_id == "u1"
    feishu = gw.normalize(
        "feishu",
        {
            "event": {
                "sender": {"sender_id": {"open_id": "ou_x"}},
                "message": {
                    "chat_id": "oc_1",
                    "content": '{"text":"飞书消息"}',
                    "message_id": "om_1",
                },
            }
        },
    )
    assert feishu is not None
    assert feishu.text == "飞书消息"
    rendered = gw.render("wecom", ChannelReply(text="回复"))
    assert rendered["msgtype"] == "text"


def test_artifact_multi_format_api(generation_client, generation_db) -> None:
    created = generation_client.post(
        "/api/ai/artifacts",
        json={
            "title": "多格式成果",
            "content_markdown": "## 本周\n- 混合检索\n- 导出能力\n\n| 项 | 值 |\n|---|---|\n| a | 1 |",
            "artifact_type": "markdown",
        },
    )
    assert created.status_code == 201, created.text
    aid = created.json()["artifact_id"]
    for path, magic in (
        (f"/api/ai/artifacts/{aid}/export.xlsx", b"PK"),
        (f"/api/ai/artifacts/{aid}/export.pptx", b"PK"),
        (f"/api/ai/artifacts/{aid}/export.pdf", b"%PDF"),
        (f"/api/ai/artifacts/{aid}/export/md", None),
    ):
        resp = generation_client.get(path)
        assert resp.status_code == 200, f"{path}: {resp.text}"
        if magic:
            assert resp.content[: len(magic)] == magic


def test_ops_and_channels_api(generation_client) -> None:
    # feature flags available to normal use role
    flags = generation_client.get("/api/ai/ops/feature-flags")
    assert flags.status_code == 200, flags.text
    body = flags.json()
    assert "channels" in body
    ch = generation_client.get("/api/ai/channels")
    assert ch.status_code == 200, ch.text
    assert "web" in ch.json()["channels"]
    norm = generation_client.post(
        "/api/ai/channels/normalize",
        json={"channel": "web", "payload": {"text": "测试通道", "user_id": "dev"}},
    )
    assert norm.status_code == 200, norm.text
    assert norm.json()["ok"] is True
    assert norm.json()["text"] == "测试通道"


def test_learning_candidates_admin_api(generation_client, generation_db) -> None:
    from app.learning_candidate_service import LearningCandidateService

    row = LearningCandidateService(generation_db).create(
        owner_user_id="dev",
        source_run_id="r1",
        candidate_type="correction",
        title="修正候选",
        payload={"comment": "应引用手册"},
        actor="dev",
    )
    generation_db.commit()
    listed = generation_client.get(
        "/api/ai/learning-candidates",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1
    eval_resp = generation_client.post(
        f"/api/ai/learning-candidates/{row.uuid}/transition",
        json={"status": "evaluated"},
        headers={"X-Test-Role": "admin"},
    )
    assert eval_resp.status_code == 200, eval_resp.text
    assert eval_resp.json()["status"] == "evaluated"
    pub = generation_client.post(
        f"/api/ai/learning-candidates/{row.uuid}/transition",
        json={"status": "published"},
        headers={"X-Test-Role": "admin"},
    )
    assert pub.status_code == 200, pub.text
    # jump draft→published without evaluation must fail
    row2 = LearningCandidateService(generation_db).create(
        owner_user_id="dev",
        candidate_type="experience",
        title="跳级候选",
        payload={},
        actor="dev",
    )
    generation_db.commit()
    bad = generation_client.post(
        f"/api/ai/learning-candidates/{row2.uuid}/transition",
        json={"status": "published"},
        headers={"X-Test-Role": "admin"},
    )
    assert bad.status_code == 400
