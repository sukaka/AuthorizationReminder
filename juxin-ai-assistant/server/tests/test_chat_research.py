from app.chat_research import build_chat_research_plan, is_deep_research_request


def test_explicit_deep_research_builds_seven_dimension_plan() -> None:
    plan = build_chat_research_plan("深度研究企业智能体市场")

    assert plan is not None
    assert len(plan.questions) == 7
    assert "企业智能体市场" in plan.objective
    assert "URL" in plan.citation_policy
    assert "明确标记" in plan.uncertainty_policy


def test_multi_dimension_research_is_detected_without_explicit_deep_marker() -> None:
    assert is_deep_research_request("调研这个行业的政策、竞品和技术架构")


def test_normal_question_does_not_create_research_plan() -> None:
    assert build_chat_research_plan("这个功能怎么使用？") is None
