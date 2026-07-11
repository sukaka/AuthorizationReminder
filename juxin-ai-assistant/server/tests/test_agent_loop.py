def test_loop_limits_are_bounded_by_default() -> None:
    from app.agent_loop import LoopLimits, LoopState

    limits = LoopLimits()

    assert limits.max_loop_steps == 5
    assert limits.max_tool_calls == 8
    assert limits.max_rag_search == 3
    assert limits.max_retry == 2
    assert LoopState.START.value == "START"
    assert LoopState.FINISH.value == "FINISH"


def test_task_analyzer_maps_modes_to_loop_strategies() -> None:
    from app.agent_loop import TaskAnalyzer

    analyzer = TaskAnalyzer()

    ordinary = analyzer.analyze("普通问题", "normal")
    assert ordinary.strategy == "single_turn"
    assert ordinary.needs_knowledge is True
    assert ordinary.require_knowledge_evidence is False
    assert analyzer.analyze("请根据知识库回答", "knowledge").strategy == "rag_loop"
    assert analyzer.analyze("帮我写投标响应材料", "business").strategy == "bid_material_loop"
    assert analyzer.analyze("整理员工入职材料", "hr_admin").strategy == "hr_admin_loop"
    assert analyzer.analyze("排查部署失败", "delivery").strategy == "delivery_troubleshooting_loop"
    assert analyzer.analyze("分析漏洞和日志", "security_ops").strategy == "security_analysis_loop"
    assert analyzer.analyze("生成风险评估", "risk_assessment").strategy == "risk_assessment_loop"
    assert analyzer.analyze("生成应急响应报告", "incident_response").strategy == "incident_response_loop"
    assert analyzer.analyze("上传资料中是否有说明", "normal").needs_knowledge is True
    command_query = analyzer.analyze("CCMP 有哪些命令行命令", "normal")
    assert command_query.needs_knowledge is True
    assert command_query.require_knowledge_evidence is True


def test_knowledge_follow_up_query_carries_previous_user_subject() -> None:
    from app.agent_loop.loop_runner import knowledge_search_query
    from app.context.context_builder import RecentChatMessage

    recent_messages = [
        RecentChatMessage(role="user", content="未知云安全设施由谁负责"),
        RecentChatMessage(role="assistant", content="需要查看正式资料。"),
    ]

    assert knowledge_search_query("上传资料中是否有说明", recent_messages) == (
        "未知云安全设施由谁负责 上传资料中是否有说明"
    )
    assert knowledge_search_query("云管平台有哪些功能", recent_messages) == "云管平台有哪些功能"
    assert knowledge_search_query("新产品文档中如何部署？", recent_messages) == "新产品文档中如何部署？"


def test_planner_declares_required_action_types() -> None:
    from app.agent_loop.planner import Planner

    assert set(Planner.SUPPORTED_ACTIONS) == {
        "answer_directly",
        "search_knowledge",
        "read_file",
        "generate_draft",
        "revise_answer",
        "ask_clarification",
        "finish",
    }


def test_reflector_does_not_repeat_optional_semantic_search() -> None:
    from app.agent_loop.reflector import Reflector
    from app.agent_loop.types import LoopLimits, Observation, TaskAnalysis

    should_continue = Reflector().should_continue(
        analysis=TaskAnalysis(
            mode="normal",
            task_type="chat",
            strategy="single_turn",
            needs_knowledge=True,
            require_knowledge_evidence=False,
        ),
        observation=Observation(
            is_empty=True,
            sufficient=False,
            has_sources=False,
            summary="未检索到资料",
        ),
        rag_search_count=1,
        limits=LoopLimits(),
    )

    assert should_continue is False


def test_quality_checker_flags_missing_juxin_context_and_sources() -> None:
    from app.agent_loop import QualityChecker

    checker = QualityChecker()

    result = checker.check(
        answer="这是一个通用回答，没有公司语境。",
        mode="knowledge",
        used_knowledge=True,
    )

    assert result.passed is False
    assert "聚信得仁业务场景" in result.issues
    assert "引用来源" in result.issues
    assert "网络安全公司内部员工" in result.issues


def test_quality_check_route_returns_revision_messages(client_for_user) -> None:
    client = client_for_user("user-1")

    response = client.post(
        "/api/ai/agent-loop/quality-check",
        json={
            "mode": "business",
            "answer": "这是一个通用回答。",
            "used_knowledge": False,
            "retry_count": 0,
            "messages": [
                {"role": "system", "content": "商务助手：投标、标书、响应文件"},
                {"role": "user", "content": "帮我写投标响应"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is False
    assert body["retry_allowed"] is True
    assert "聚信得仁业务场景" in body["issues"]
    assert body["revision_messages"][-2]["role"] == "assistant"
    assert body["revision_messages"][-2]["content"] == "这是一个通用回答。"
    assert body["revision_messages"][-1]["role"] == "user"
    assert "请修正输出" in body["revision_messages"][-1]["content"]
