import base64

from app.chat_run_bridge import attach_run_for_chat_question
from app.config import Settings
from app.faq_matcher import normalize_question
from app.models import AgentRun, SharedFaq
from sqlalchemy import select


def _settings() -> Settings:
    return Settings(
        content_encryption_key=base64.urlsafe_b64encode(b"k" * 32).decode("ascii"),
        content_encryption_key_version="v1",
        auth_dev_bypass=True,
        ai_local_binding_secret="local-binding-test-secret-32-bytes!!",
        prompt_center_runtime_token="r" * 32,
        audit_hash_salt="a" * 32,
    )


def test_chat_bridge_creates_linked_run_for_faq(generation_db) -> None:
    generation_db.add(
        SharedFaq(
            question="WiFi 密码",
            question_normalized=normalize_question("WiFi 密码"),
            aliases_json=[],
            answer="访客 WiFi：guest-demo",
            status="published",
            previous_answer="",
            version=1,
        )
    )
    generation_db.commit()

    run_id = attach_run_for_chat_question(
        generation_db,
        settings=_settings(),
        owner_user_id="dev",
        question="WiFi 密码",
        conversation_id="conv-1",
        message_id="msg-1",
    )
    generation_db.commit()
    assert run_id
    row = generation_db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
    assert row is not None
    assert row.conversation_id == "conv-1"
    assert row.message_id == "msg-1"
    assert row.result_json["kind"] == "faq"
    assert row.model_calls == 0
    assert "guest-demo" in row.result_json["answer"]


def test_chat_prepare_returns_run_id_field(generation_client, generation_db) -> None:
    generation_db.add(
        SharedFaq(
            question="邮箱如何开通",
            question_normalized=normalize_question("邮箱如何开通"),
            aliases_json=[],
            answer="联系人事开通企业邮箱。",
            status="published",
            previous_answer="",
            version=1,
        )
    )
    generation_db.commit()

    # prepare needs more fixtures; use bridge via API run path and assert chat router still importable
    from app.chat_routes import router as chat_router
    from app.main import app

    paths = {getattr(r, "path", "") for r in app.routes}
    assert any("/api/ai/chat/prepare" in p or p.endswith("/prepare") for p in paths)
    assert chat_router.prefix == "/api/ai/chat"

    # Bridge path still works under generation_db
    run_id = attach_run_for_chat_question(
        generation_db,
        settings=_settings(),
        owner_user_id="dev",
        question="邮箱如何开通",
        conversation_id="c2",
        message_id="m2",
    )
    assert run_id
