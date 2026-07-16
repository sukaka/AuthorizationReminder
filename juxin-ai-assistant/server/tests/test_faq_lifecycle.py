from app.faq_matcher import match_shared_faq, normalize_question
from app.faq_service import FaqService, FaqServiceError
import pytest


def test_faq_lifecycle_publish_disable_and_rollback(generation_db) -> None:
    service = FaqService(generation_db)
    row = service.create(
        question="出差报销标准",
        answer="市内交通凭票据实报实销。",
        aliases=["报销标准"],
        actor="admin",
        status="draft",
    )
    generation_db.commit()

    # draft must not match
    assert match_shared_faq(generation_db, "出差报销标准") is None

    service.publish(row.uuid, actor="admin")
    generation_db.commit()
    hit = match_shared_faq(generation_db, "出差报销标准")
    assert hit is not None
    assert hit.model_calls == 0
    assert "实报实销" in hit.answer

    service.update(row.uuid, answer="市内交通每日限额 80 元。", actor="admin")
    generation_db.commit()
    generation_db.refresh(row)
    assert row.previous_answer.startswith("市内交通凭票据")
    assert row.version >= 2
    hit2 = match_shared_faq(generation_db, "报销标准")
    assert hit2 is not None
    assert "80" in hit2.answer

    service.rollback(row.uuid, actor="admin")
    generation_db.commit()
    generation_db.refresh(row)
    assert "实报实销" in row.answer
    hit3 = match_shared_faq(generation_db, "出差报销标准")
    assert hit3 is not None
    assert "实报实销" in hit3.answer

    service.disable(row.uuid, actor="admin")
    generation_db.commit()
    assert match_shared_faq(generation_db, "出差报销标准") is None


def test_faq_admin_api_lifecycle(generation_client, generation_db) -> None:
    created = generation_client.post(
        "/api/ai/admin/faqs",
        json={
            "question": "VPN 如何申请",
            "answer": "提交 IT 工单申请。",
            "aliases": ["申请VPN"],
            "status": "draft",
        },
    )
    assert created.status_code == 201, created.text
    faq_uuid = created.json()["uuid"]
    assert created.json()["status"] == "draft"

    published = generation_client.post(f"/api/ai/admin/faqs/{faq_uuid}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"

    updated = generation_client.put(
        f"/api/ai/admin/faqs/{faq_uuid}",
        json={"answer": "在门户提交 VPN 申请单。"},
    )
    assert updated.status_code == 200
    assert updated.json()["previous_answer"]
    assert updated.json()["version"] >= 2

    rolled = generation_client.post(f"/api/ai/admin/faqs/{faq_uuid}/rollback")
    assert rolled.status_code == 200, rolled.text
    assert "IT 工单" in rolled.json()["answer"]

    disabled = generation_client.post(f"/api/ai/admin/faqs/{faq_uuid}/disable")
    assert disabled.status_code == 200
    assert disabled.json()["status"] == "disabled"

    listed = generation_client.get("/api/ai/admin/faqs")
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1


def test_faq_rollback_without_history_fails(generation_db) -> None:
    service = FaqService(generation_db)
    row = service.create(
        question="无历史答案",
        answer="初始答案",
        actor="admin",
        status="published",
    )
    generation_db.commit()
    with pytest.raises(FaqServiceError) as exc:
        service.rollback(row.uuid, actor="admin")
    assert exc.value.code == "NO_PREVIOUS"
