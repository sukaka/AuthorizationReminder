from __future__ import annotations


def _encrypt(cipher, message_uuid: str, content: str):
    payload = cipher.encrypt_json({"content": content}, message_uuid.encode())
    return payload.ciphertext, payload.nonce


def _seed_completed_chat(generation_db, *, user_id: str = "u-1"):
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.models import ChatMessage, ChatMessageSource, ChatSession

    cipher = ContentCipher(get_settings().content_encryption_key)
    session = ChatSession(
        uuid="artifact-chat-session",
        sso_user_id=user_id,
        title="交付方案",
        mode="NORMAL",
        status="active",
    )
    generation_db.add(session)
    generation_db.flush()

    user_ciphertext, user_nonce = _encrypt(cipher, "artifact-user-message", "请输出交付方案")
    answer_ciphertext, answer_nonce = _encrypt(
        cipher,
        "artifact-assistant-message",
        "根据《交付手册.pdf》的验收交付物章节，交付时需要提交测试报告。",
    )
    user_message = ChatMessage(
        uuid="artifact-user-message",
        session_id=session.id,
        sso_user_id=user_id,
        role="user",
        content_ciphertext=user_ciphertext,
        content_nonce=user_nonce,
        key_version="v1",
        status="COMPLETED",
    )
    assistant_message = ChatMessage(
        uuid="artifact-assistant-message",
        session_id=session.id,
        sso_user_id=user_id,
        role="assistant",
        content_ciphertext=answer_ciphertext,
        content_nonce=answer_nonce,
        key_version="v1",
        status="COMPLETED",
    )
    generation_db.add_all([user_message, assistant_message])
    generation_db.flush()
    generation_db.add(ChatMessageSource(
        message_id=assistant_message.id,
        source_type="official_knowledge",
        source_uuid="source-file",
        title="交付手册",
        file_name="交付手册.pdf",
        chunk_id="chunk-1",
        page_number=6,
        section_title="验收交付物",
        chunk_index=0,
        score=9,
    ))
    generation_db.commit()
    return session


def test_word_export_creates_user_scoped_work_artifact(
    client_for_user,
    generation_db,
    tmp_path,
):
    from app.config import get_settings
    from app.main import app

    session = _seed_completed_chat(generation_db)
    settings = get_settings().model_copy(update={"export_storage_dir": str(tmp_path)})
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = client_for_user("u-1")

        response = client.post(
            "/api/export/word",
            headers={"Idempotency-Key": "work-artifact-export"},
            json={
                "conversation_id": session.uuid,
                "message_id": "artifact-assistant-message",
                "export_type": "single_answer",
                "template": "juxin_standard",
                "format_before_export": False,
            },
        )
        assert response.status_code == 201

        artifacts = client.get("/api/ai/work-artifacts").json()
        assert artifacts["total"] == 1
        item = artifacts["items"][0]
        assert item["artifact_type"] == "word_document"
        assert item["title"] == "交付方案"
        assert item["file_name"].endswith(".docx")
        assert item["source_summary"] == [{
            "source_type": "official_knowledge",
            "file_name": "交付手册.pdf",
            "file_uuid": "source-file",
            "chunk_id": "chunk-1",
            "page_number": 6,
            "section_title": "验收交付物",
            "chunk_index": 0,
        }]
        assert "测试报告" not in str(item)

        detail = client.get(f"/api/ai/work-artifacts/{item['artifact_uuid']}").json()
        assert detail["download_url"] == response.json()["download_url"]
        assert detail["content"] is None
        assert detail["versions"][0]["version"] == 1

        other_user = client_for_user("u-2")
        assert other_user.get("/api/ai/work-artifacts").json()["total"] == 0
        assert other_user.get(f"/api/ai/work-artifacts/{item['artifact_uuid']}").status_code == 404
        admin_user = client_for_user("admin-1", role="admin")
        assert admin_user.get("/api/ai/work-artifacts").json()["total"] == 0
        assert admin_user.get(f"/api/ai/work-artifacts/{item['artifact_uuid']}").status_code == 404
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_reexporting_same_answer_creates_new_artifact_version(
    client_for_user,
    generation_db,
    tmp_path,
):
    from app.config import get_settings
    from app.main import app

    session = _seed_completed_chat(generation_db)
    settings = get_settings().model_copy(update={"export_storage_dir": str(tmp_path)})
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = client_for_user("u-1")
        payload = {
            "conversation_id": session.uuid,
            "message_id": "artifact-assistant-message",
            "export_type": "single_answer",
            "template": "juxin_standard",
            "format_before_export": False,
        }

        first = client.post("/api/export/word", headers={"Idempotency-Key": "work-artifact-export-1"}, json=payload)
        second = client.post("/api/export/word", headers={"Idempotency-Key": "work-artifact-export-2"}, json=payload)

        assert first.status_code == 201
        assert second.status_code == 201
        artifacts = client.get("/api/ai/work-artifacts").json()
        assert artifacts["total"] == 1
        item = artifacts["items"][0]
        assert item["version"] == 2
        detail = client.get(f"/api/ai/work-artifacts/{item['artifact_uuid']}").json()
        assert [version["version"] for version in detail["versions"]] == [2, 1]
        assert detail["download_url"] == second.json()["download_url"]
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_assistant_message_can_be_saved_as_work_artifact(client_for_user, generation_db):
    session = _seed_completed_chat(generation_db)
    client = client_for_user("u-1")

    response = client.post(
        "/api/ai/work-artifacts/chat-message",
        json={
            "conversation_id": session.uuid,
            "message_id": "artifact-assistant-message",
            "title": "客户交付方案草稿",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["artifact_type"] == "ordinary_answer"
    assert payload["title"] == "客户交付方案草稿"

    detail = client.get(f"/api/ai/work-artifacts/{payload['artifact_uuid']}").json()
    assert detail["content"] == "根据《交付手册.pdf》的验收交付物章节，交付时需要提交测试报告。"
    assert detail["source_summary"][0]["file_name"] == "交付手册.pdf"
    assert detail["versions"][0]["source"] == "chat_message"


def test_work_artifacts_filter_by_type_and_created_date(
    client_for_user,
    generation_db,
) -> None:
    from datetime import datetime

    from app.models import WorkArtifact

    session = _seed_completed_chat(generation_db)
    client = client_for_user("u-1")
    created = client.post(
        "/api/ai/work-artifacts/chat-message",
        json={
            "conversation_id": session.uuid,
            "message_id": "artifact-assistant-message",
            "title": "交付方案",
        },
    )
    artifact = generation_db.query(WorkArtifact).one()
    artifact.created_at = datetime(2026, 6, 20, 8, 0, 0)
    generation_db.commit()

    matched = client.get(
        "/api/ai/work-artifacts",
        params={
            "artifact_type": "ordinary_answer",
            "created_from": "2026-06-01T00:00:00",
            "created_to": "2026-06-30T23:59:59",
        },
    )
    excluded = client.get(
        "/api/ai/work-artifacts",
        params={"created_from": "2026-07-01T00:00:00"},
    )

    assert created.status_code == 201
    assert matched.status_code == 200
    assert matched.json()["total"] == 1
    assert excluded.status_code == 200
    assert excluded.json()["total"] == 0
