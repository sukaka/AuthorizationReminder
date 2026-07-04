def test_task_state_store_records_stage_sources_tools_and_verification(
    generation_db,
) -> None:
    from app.agent_loop.task_state import TaskStateStore
    from app.models import AgentTaskState

    store = TaskStateStore(generation_db)
    state = store.create(
        user_id="user-1",
        conversation_id="conv-1",
        goal="写一份安全运维方案",
        stage="analyzing",
        next_action="正在识别任务",
        selected_sources=[{"type": "official_knowledge", "count": 2}],
    )

    store.update_stage(
        state.uuid,
        stage="checking_sources",
        next_action="正在整理依据",
        selected_sources=[{"type": "official_knowledge", "count": 3}],
    )
    store.append_tool_call(
        state.uuid,
        tool_name="search_knowledge_base",
        status="success",
        summary="chunks=3",
        error_code="",
    )
    store.record_verification(
        state.uuid,
        status="passed",
        summary="引用和格式检查通过",
        issues=[],
    )

    saved = generation_db.query(AgentTaskState).one()
    assert saved.conversation_id == "conv-1"
    assert saved.stage == "checking_sources"
    assert saved.goal == "写一份安全运维方案"
    assert saved.selected_sources_json == [{"type": "official_knowledge", "count": 3}]
    assert saved.tool_calls_json == [
        {
            "tool_name": "search_knowledge_base",
            "status": "success",
            "summary": "chunks=3",
            "error_code": "",
        }
    ]
    assert saved.verification_status == "passed"
    assert saved.verification_json == {
        "status": "passed",
        "summary": "引用和格式检查通过",
        "issues": [],
    }
    assert saved.next_action == "正在整理依据"


def test_loop_runner_persists_task_state_stages_for_chat_run(
    generation_db,
) -> None:
    from app.agent_loop.loop_runner import LoopRunner
    from app.context.context_builder import RecentChatMessage
    from app.crypto import ContentCipher
    from app.models import AgentTaskState

    cipher = ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=")

    result = LoopRunner().run_chat(
        db=generation_db,
        sso_user_id="user-1",
        question="帮我写一份项目沟通纪要",
        mode="normal",
        cipher=cipher,
        recent_messages=[RecentChatMessage(role="user", content="上一轮")],
        top_k=3,
        conversation_id="conv-1",
    )

    states = generation_db.query(AgentTaskState).order_by(AgentTaskState.id).all()
    assert result.messages
    assert len(states) == 1
    assert states[0].conversation_id == "conv-1"
    assert states[0].stage == "completed"
    assert states[0].goal == "帮我写一份项目沟通纪要"
    assert states[0].verification_status == "prepared"
    assert states[0].next_action == "等待模型生成回答"
    assert [item["stage"] for item in states[0].stage_history_json] == [
        "analyzing",
        "building_context",
        "generating",
        "completed",
    ]
