from datetime import datetime, timedelta


def test_external_reports_cluster_questions_by_channel_and_combined(generation_db) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher, EncryptedPayload
    from app.external_question_events import (
        generate_external_question_report,
        record_external_question,
    )
    from app.models import ExternalHotQuestionReportItem

    cipher = ContentCipher(get_settings().content_encryption_key)
    start = datetime(2026, 7, 12)
    end = start + timedelta(days=1)
    for index, (channel, question, status) in enumerate([
        ("wechat_official", "WDSP 怎么使用？", "ANSWERED"),
        ("wechat_official", "WEB动态安全管理平台怎么用", "ANSWERED"),
        ("wecom_kf", "WAF 如何配置", "HANDOFF"),
    ]):
        record_external_question(
            generation_db,
            cipher=cipher,
            source_channel=channel,
            external_identity_hash=f"identity-{index}",
            conversation_key=f"conversation-{index}",
            external_message_id=f"message-{index}",
            question=question,
            status=status,
            created_at=start + timedelta(hours=index + 1),
        )
    generation_db.commit()

    assert generate_external_question_report(
        generation_db,
        period_type="daily",
        period_start=start,
        period_end=end,
        source_channel="wechat_official",
        cipher=cipher,
    ) == 1
    assert generate_external_question_report(
        generation_db,
        period_type="daily",
        period_start=start,
        period_end=end,
        source_channel="all",
        cipher=cipher,
    ) == 2

    rows = generation_db.query(ExternalHotQuestionReportItem).order_by(
        ExternalHotQuestionReportItem.source_channel,
        ExternalHotQuestionReportItem.rank,
    ).all()
    assert [(row.source_channel, row.question_count) for row in rows] == [
        ("all", 2),
        ("all", 1),
        ("wechat_official", 2),
    ]
    representative = cipher.decrypt_json(
        EncryptedPayload(
            ciphertext=rows[2].question_ciphertext,
            nonce=rows[2].question_nonce,
        ),
        rows[2].uuid.encode(),
    )["text"]
    assert representative == "WDSP 怎么使用？"
    assert rows[0].direct_answer_count == 2
    assert rows[1].handoff_count == 1


def test_external_hot_question_admin_api_lists_latest_channel_report(
    client_for_user, generation_db
) -> None:
    from app.config import get_settings
    from app.crypto import ContentCipher
    from app.external_question_events import (
        generate_external_question_report,
        record_external_question,
    )

    cipher = ContentCipher(get_settings().content_encryption_key)
    start = datetime(2026, 7, 12)
    record_external_question(
        generation_db,
        cipher=cipher,
        source_channel="wechat_official",
        external_identity_hash="visitor-hash",
        conversation_key="visitor-1",
        external_message_id="message-api-1",
        question="WDSP 手册在哪里下载",
        status="ANSWERED",
        source_file_ids=["file-1"],
        created_at=start + timedelta(hours=1),
    )
    generation_db.commit()
    generate_external_question_report(
        generation_db,
        period_type="daily",
        period_start=start,
        period_end=start + timedelta(days=1),
        source_channel="wechat_official",
        cipher=cipher,
    )
    generation_db.commit()

    response = client_for_user("external-hot-admin", role="admin").get(
        "/api/ai/admin/external-hot-questions?source_channel=wechat_official"
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [{
            "uuid": response.json()["items"][0]["uuid"],
            "period_start": "2026-07-12T00:00:00",
            "period_end": "2026-07-13T00:00:00",
            "source_channel": "wechat_official",
            "rank": 1,
            "question_count": 1,
            "direct_answer_count": 1,
            "handoff_count": 0,
            "representative_question": "WDSP 手册在哪里下载",
            "sample_questions": ["WDSP 手册在哪里下载"],
            "source_file_ids": ["file-1"],
            "analysis_summary": "共出现 1 次，直接回答 1 次，转人工 0 次。",
        }],
        "total": 1,
    }
