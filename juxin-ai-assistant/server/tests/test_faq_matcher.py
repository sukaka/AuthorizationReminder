from datetime import datetime

from app.faq_matcher import match_shared_faq, normalize_question
from app.models import SharedFaq


def test_normalize_question_strips_punct_and_fullwidth() -> None:
    assert normalize_question("  如何　登录？ ") == normalize_question("如何登录")


def test_match_shared_faq_exact_and_alias(generation_db) -> None:
    row = SharedFaq(
        question="如何重置密码",
        question_normalized=normalize_question("如何重置密码"),
        aliases_json=["密码忘了怎么办", "重置登录密码"],
        answer="请联系管理员重置密码。",
        status="active",
    )
    generation_db.add(row)
    generation_db.commit()

    exact = match_shared_faq(generation_db, "如何重置密码")
    assert exact is not None
    assert exact.match_type == "exact"
    assert exact.model_calls == 0
    assert exact.answer.startswith("请联系管理员")

    alias = match_shared_faq(generation_db, "密码忘了怎么办")
    assert alias is not None
    assert alias.match_type == "alias"

    normalized = match_shared_faq(generation_db, "如何重置密码？")
    assert normalized is not None
    assert normalized.match_type == "normalized"

    generation_db.refresh(row)
    # exact + alias + normalized (punctuation variant)
    assert row.hit_count >= 2
    assert isinstance(row.last_hit_at, datetime)


def test_match_shared_faq_miss(generation_db) -> None:
    assert match_shared_faq(generation_db, "完全无关的问题") is None
