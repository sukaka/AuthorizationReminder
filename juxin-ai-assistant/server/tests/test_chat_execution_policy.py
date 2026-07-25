from app.chat_execution_policy import decide_chat_execution


def test_ppt_generation_defaults_to_background() -> None:
    decision = decide_chat_execution(
        "请制作一份年度经营汇报 PPT",
        ppt_intent="create",
    )

    assert decision.mode == "background"
    assert "PPT" in decision.reason


def test_long_report_generation_defaults_to_background() -> None:
    decision = decide_chat_execution("请根据这些资料撰写一份季度经营分析报告")

    assert decision.mode == "background"
    assert "长报告" in decision.reason


def test_short_question_keeps_foreground_streaming() -> None:
    decision = decide_chat_execution("今天上海天气怎么样？")

    assert decision.mode == "foreground"
    assert "流式" in decision.reason


def test_report_how_to_question_is_not_mistaken_for_generation() -> None:
    decision = decide_chat_execution("如何写一份好的季度经营分析报告？")

    assert decision.mode == "foreground"


def test_explicit_short_summary_stays_in_foreground() -> None:
    decision = decide_chat_execution("请简短总结这份报告的三个要点")

    assert decision.mode == "foreground"


def test_deep_research_defaults_to_background() -> None:
    decision = decide_chat_execution("请深度研究企业智能体市场、竞品、技术架构和风险")

    assert decision.mode == "background"
    assert "深度研究" in decision.reason
