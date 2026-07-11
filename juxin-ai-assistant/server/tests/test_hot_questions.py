from datetime import datetime, timedelta


def _encrypted(cipher, uuid: str, content: str):
    payload = cipher.encrypt_json({"content": content}, uuid.encode())
    return payload.ciphertext, payload.nonce


def test_generate_report_clusters_similar_questions_and_keeps_top_twenty(generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher, EncryptedPayload
    from app.hot_questions import generate_report
    from app.models import ChatMessage, ChatSession, HotQuestionReportItem

    cipher = ContentCipher(get_settings().content_encryption_key)
    start = datetime(2026, 7, 10)
    end = start + timedelta(days=1)
    for index, question in enumerate(["WDSP 怎么使用？", "WEB动态安全管理平台怎么用", "WAF 如何配置"]):
        session = ChatSession(uuid=f"hot-session-{index}", sso_user_id=f"user-{index}", title=question, mode="NORMAL", status="active")
        generation_db.add(session)
        generation_db.flush()
        q_uuid = f"hot-question-{index}"
        a_uuid = f"hot-answer-{index}"
        q_cipher, q_nonce = _encrypted(cipher, q_uuid, question)
        a_cipher, a_nonce = _encrypted(cipher, a_uuid, f"专项回答 {index}")
        generation_db.add_all([
            ChatMessage(uuid=q_uuid, session_id=session.id, sso_user_id=f"user-{index}", role="user", content_ciphertext=q_cipher, content_nonce=q_nonce, key_version="v1", status="COMPLETED", created_at=start + timedelta(hours=1)),
            ChatMessage(uuid=a_uuid, session_id=session.id, sso_user_id=f"user-{index}", role="assistant", content_ciphertext=a_cipher, content_nonce=a_nonce, key_version="v1", status="COMPLETED", created_at=start + timedelta(hours=1, minutes=1)),
        ])
    generation_db.commit()

    assert generate_report(generation_db, period_type="daily", period_start=start, period_end=end, cipher=cipher) == 2
    rows = generation_db.query(HotQuestionReportItem).order_by(HotQuestionReportItem.rank).all()
    assert [row.question_count for row in rows] == [2, 1]
    representative = cipher.decrypt_json(EncryptedPayload(
        ciphertext=rows[0].question_ciphertext, nonce=rows[0].question_nonce,
    ), rows[0].uuid.encode())["text"]
    assert representative == "WDSP 怎么使用？"


def test_hot_question_admin_api_lists_and_reviews_report(client_for_user, generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.hot_questions import generate_report
    from app.models import ChatMessage, ChatSession

    cipher = ContentCipher(get_settings().content_encryption_key)
    start = datetime(2026, 7, 10)
    session = ChatSession(uuid="hot-api-session", sso_user_id="u-1", title="热点问题", mode="NORMAL", status="active")
    generation_db.add(session)
    generation_db.flush()
    q_cipher, q_nonce = _encrypted(cipher, "hot-api-question", "WDSP 手册在哪里")
    generation_db.add(ChatMessage(uuid="hot-api-question", session_id=session.id, sso_user_id="u-1", role="user", content_ciphertext=q_cipher, content_nonce=q_nonce, key_version="v1", status="COMPLETED", created_at=start))
    generation_db.commit()
    generate_report(generation_db, period_type="daily", period_start=start, period_end=start + timedelta(days=1), cipher=cipher)

    admin = client_for_user("admin-1", role="admin")
    listed = admin.get("/api/ai/admin/hot-questions?period_type=daily")
    assert listed.status_code == 200
    item = listed.json()["items"][0]
    assert item["representative_question"] == "WDSP 手册在哪里"
    reviewed = admin.put(f"/api/ai/admin/hot-questions/{item['uuid']}", json={"status": "approved", "suggested_reply": "请下载 WDSP 正式手册。"})
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "approved"
    assert reviewed.json()["suggested_reply"] == "请下载 WDSP 正式手册。"
