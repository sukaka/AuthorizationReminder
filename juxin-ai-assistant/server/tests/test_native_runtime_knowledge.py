import base64

from app.agent_runtime.answer_engine import DefaultAnswerEngine, RetrievedSnippet
from app.agent_runtime.native_runtime import NativeRuntime
from app.agent_runtime.protocol import RunRequest
from app.agent_run_service import AgentRunService
from app.crypto import ContentCipher


def _cipher() -> ContentCipher:
    return ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))


def test_non_faq_runtime_records_retrieve_and_answer(generation_db) -> None:
    snippets = [
        RetrievedSnippet(
            name="安全手册.pdf",
            text="员工外出须双人复核。",
            location="第 3 页",
            file_uuid="file-1",
        )
    ]

    def retrieve_fn(_db, _owner, _query):
        return snippets

    def generate_fn(query, found):
        assert found
        return f"关于「{query}」：{found[0].text}", 1, {"path": "model"}

    engine = DefaultAnswerEngine(retrieve_fn=retrieve_fn, generate_fn=generate_fn)
    cipher = _cipher()
    service = AgentRunService(generation_db, cipher)
    question = "请分析外出复核要求并整理成简要报告"
    row = service.create_run(owner_user_id="dev", input_text=question, max_model_calls=5)
    generation_db.flush()

    runtime = NativeRuntime(generation_db, cipher, answer_engine=engine)
    snapshot = runtime.start_sync(
        RunRequest(
            run_id=row.uuid,
            owner_user_id="dev",
            input_text=question,
        )
    )
    generation_db.commit()
    generation_db.refresh(row)

    assert snapshot.status == "succeeded"
    assert row.result_json["kind"] != "faq"
    assert "双人复核" in row.result_json["answer"]
    assert row.model_calls == 1
    assert "native_placeholder" not in str(row.result_json)
    assert "任务已接收" not in str(row.result_json.get("answer", ""))

    steps = service.list_steps(row.uuid)
    step_types = {s.step_type for s in steps}
    assert "coordinate" in step_types
    assert "research" in step_types
    assert "write" in step_types
    assert "review" in step_types
    events = service.list_events(row.uuid)
    assert any(e.event_type == "source" for e in events)
    assert any(e.event_type == "completed" for e in events)
    assert any(e.event_type == "review" for e in events)


def test_non_faq_api_path(generation_client, generation_db) -> None:
    # Inject via monkeypatch on DefaultAnswerEngine used by route construction
    from app.agent_runtime import native_runtime as nr_mod
    from app.agent_runtime.answer_engine import DefaultAnswerEngine, RetrievedSnippet

    snippets = [
        RetrievedSnippet(name="制度.docx", text="年假满一年 5 天。", location="第1页", file_uuid="f2")
    ]
    engine = DefaultAnswerEngine(
        retrieve_fn=lambda *_a, **_k: snippets,
        generate_fn=lambda q, s: (f"答复：{s[0].text}", 0, {"path": "retrieve_synthesize"}),
    )
    original = nr_mod.NativeRuntime.__init__

    def patched_init(self, db, cipher, *, key_version="v1", answer_engine=None):
        original(self, db, cipher, key_version=key_version, answer_engine=engine)

    nr_mod.NativeRuntime.__init__ = patched_init  # type: ignore[method-assign]
    try:
        response = generation_client.post(
            "/api/ai/runs",
            json={"input_text": "年假规定是什么"},
        )
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["snapshot"]["status"] == "succeeded"
        assert body["snapshot"]["result"]["kind"] != "faq"
        assert "年假" in body["snapshot"]["result"]["answer"] or "5 天" in body["snapshot"]["result"]["answer"]
        detail = generation_client.get(f"/api/ai/runs/{body['run']['run_id']}")
        assert detail.status_code == 200
        assert any(s["step_type"] == "research" for s in detail.json()["steps"])
        assert any(s["step_type"] == "review" for s in detail.json()["steps"])
    finally:
        nr_mod.NativeRuntime.__init__ = original  # type: ignore[method-assign]
