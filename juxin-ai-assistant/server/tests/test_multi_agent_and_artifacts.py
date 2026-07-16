import base64

from app.agent_runtime.answer_engine import DefaultAnswerEngine, RetrievedSnippet
from app.agent_runtime.multi_agent import coordinate, is_complex_task
from app.agent_runtime.native_runtime import NativeRuntime
from app.agent_runtime.protocol import RunRequest
from app.agent_runtime.run_quality import check_delivery_quality
from app.agent_run_service import AgentRunService
from app.artifact_service import ArtifactService
from app.crypto import ContentCipher
from app.models import HotQuestionReportItem
from sqlalchemy import select


def _cipher() -> ContentCipher:
    return ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))


def test_complex_task_detection() -> None:
    assert is_complex_task("请汇总多份方案生成验收报告")
    assert not is_complex_task("你好")


def test_quality_gate_requires_citation_when_snippets_used() -> None:
    bad = check_delivery_quality(answer="随便写点内容而已足够长", snippets_used=2)
    assert not bad.passed
    good = check_delivery_quality(
        answer="根据来源《安全手册》第 3 页，外出须双人复核。",
        snippets_used=1,
    )
    assert good.passed


def test_multi_agent_complex_run_creates_artifact(generation_db) -> None:
    snippets = [
        RetrievedSnippet(name="方案A.pdf", text="一期完成等保二级。", location="第2页", file_uuid="a"),
        RetrievedSnippet(name="方案B.pdf", text="二期覆盖总部与分支。", location="第5页", file_uuid="b"),
    ]
    engine = DefaultAnswerEngine(
        retrieve_fn=lambda *_a, **_k: snippets,
        generate_fn=lambda q, s: ("", 0, {"path": "skip"}),
    )
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    row = service.create_run(
        owner_user_id="dev",
        input_text="请汇总多份方案生成验收报告",
        max_model_calls=5,
    )
    snap = NativeRuntime(generation_db, cipher, answer_engine=engine).start_sync(
        RunRequest(
            run_id=row.uuid,
            owner_user_id="dev",
            input_text="请汇总多份方案生成验收报告",
        )
    )
    generation_db.commit()
    generation_db.refresh(row)
    assert snap.status == "succeeded"
    assert row.result_json["kind"] == "multi_agent"
    assert row.result_json.get("workflow") == "research_write_review"
    assert row.result_json.get("artifact_id")
    art = ArtifactService(generation_db).get_owned(row.result_json["artifact_id"], "dev")
    assert art is not None
    assert "验收" in art.title or "汇总" in art.content_markdown or "等保" in art.content_markdown


def test_artifact_api(generation_client, generation_db) -> None:
    created = generation_client.post(
        "/api/ai/artifacts",
        json={
            "title": "周报草稿",
            "content_markdown": "## 本周进展\n- 完成 Run 底座",
            "artifact_type": "markdown",
        },
    )
    assert created.status_code == 201, created.text
    artifact_id = created.json()["artifact_id"]
    listed = generation_client.get("/api/ai/artifacts")
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1
    got = generation_client.get(f"/api/ai/artifacts/{artifact_id}")
    assert got.status_code == 200
    assert "本周进展" in got.json()["content_markdown"]
    docx = generation_client.get(f"/api/ai/artifacts/{artifact_id}/export.docx")
    assert docx.status_code == 200, docx.text
    assert docx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )
    assert docx.content[:2] == b"PK"


def test_artifact_cannot_reference_another_users_run(client_for_user) -> None:
    foreign_run = client_for_user("alice").post(
        "/api/ai/runs",
        json={"input_text": "其他用户的任务"},
    )
    assert foreign_run.status_code == 202, foreign_run.text

    response = client_for_user("dev").post(
        "/api/ai/artifacts",
        json={
            "run_id": foreign_run.json()["run"]["run_id"],
            "title": "越权关联",
            "content_markdown": "不应创建",
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "关联任务不存在或无权访问"


def test_artifact_preserves_template_context_and_review_history(generation_client) -> None:
    created = generation_client.post(
        "/api/ai/artifacts",
        json={
            "title": "验收报告",
            "content_markdown": "# 验收结论\n满足上线条件。",
            "template_code": "acceptance_report",
            "audience": "项目负责人",
            "style": "formal",
        },
    )
    assert created.status_code == 201, created.text
    artifact_id = created.json()["artifact_id"]
    assert created.json()["context"]["template_code"] == "acceptance_report"

    reviewed = generation_client.post(
        f"/api/ai/artifacts/{artifact_id}/reviews",
        json={"reviewer_type": "human", "decision": "approved", "comment": "可以提交"},
    )
    assert reviewed.status_code == 201, reviewed.text
    assert reviewed.json()["decision"] == "approved"

    history = generation_client.get(f"/api/ai/artifacts/{artifact_id}/reviews")
    assert history.status_code == 200
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["reviewer_type"] == "human"


def test_learning_candidate_from_run_feedback(generation_client, generation_db) -> None:
    created = generation_client.post("/api/ai/runs", json={"input_text": "随便问一句"})
    assert created.status_code == 202
    run_id = created.json()["run"]["run_id"]
    fb = generation_client.post(
        f"/api/ai/runs/{run_id}/feedback",
        json={"feedback_type": "correction", "comment": "答案应引用手册第2页"},
    )
    assert fb.status_code == 204
    from app.models import LearningCandidate
    from sqlalchemy import select

    rows = list(generation_db.scalars(select(LearningCandidate)))
    assert len(rows) >= 1
    assert rows[0].status == "draft"
    assert rows[0].source_run_id == run_id


def test_hot_question_to_faq_api(generation_client, generation_db) -> None:
    from app.crypto import ContentCipher
    import base64
    from app.config import get_settings

    settings = get_settings()
    cipher = ContentCipher(settings.content_encryption_key)
    item = HotQuestionReportItem(
        period_type="daily",
        period_start=__import__("datetime").datetime(2026, 7, 1),
        period_end=__import__("datetime").datetime(2026, 7, 2),
        rank=1,
        question_count=12,
        analysis_summary="高频",
        status="pending",
        question_ciphertext=b"\x00",
        question_nonce=b"\x00" * 12,
        samples_ciphertext=b"\x00",
        samples_nonce=b"\x00" * 12,
        reply_ciphertext=b"\x00",
        reply_nonce=b"\x00" * 12,
    )
    generation_db.add(item)
    generation_db.flush()
    q_enc = cipher.encrypt_json({"text": "如何申请门禁卡"}, item.uuid.encode())
    samples = cipher.encrypt_json({"items": ["门禁卡申请", "办卡流程"]}, f"{item.uuid}:samples".encode())
    reply = cipher.encrypt_json({"text": "到行政前台提交申请表。"}, f"{item.uuid}:reply".encode())
    item.question_ciphertext = q_enc.ciphertext
    item.question_nonce = q_enc.nonce
    item.samples_ciphertext = samples.ciphertext
    item.samples_nonce = samples.nonce
    item.reply_ciphertext = reply.ciphertext
    item.reply_nonce = reply.nonce
    generation_db.commit()

    resp = generation_client.post(f"/api/ai/admin/hot-questions/{item.uuid}/to-faq")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["question"] == "如何申请门禁卡"
    assert "申请表" in body["answer"]
