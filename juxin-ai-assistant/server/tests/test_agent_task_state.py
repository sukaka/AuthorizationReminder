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
    store.mark_completed(
        state.uuid,
        next_action="可以复制、导出或继续追问",
    )

    saved = generation_db.query(AgentTaskState).one()
    assert saved.conversation_id == "conv-1"
    assert saved.stage == "completed"
    assert saved.status == "completed"
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
    assert saved.next_action == "可以复制、导出或继续追问"


def test_task_state_store_marks_failure_with_retry_safe_public_payload(
    generation_db,
) -> None:
    from app.agent_loop.task_state import TaskStateStore

    store = TaskStateStore(generation_db)
    state = store.create(
        user_id="user-1",
        conversation_id="conv-1",
        goal="联网查资料",
        stage="analyzing",
        next_action="正在理解你的需求",
    )

    store.mark_failed(
        state.uuid,
        reason="模型服务暂时不可用",
        retry_suggestion="请稍后重试或切换模型",
    )

    payload = store.public_payload_by_id(state.uuid)
    assert payload["stage"] == "failed"
    assert payload["status"] == "failed"
    assert payload["label"] == "生成失败，可重试"
    assert payload["retry_allowed"] is True
    assert payload["failure_reason"] == "模型服务暂时不可用"
    assert payload["next_action"] == "请稍后重试或切换模型"
    assert "TaskState" not in str(payload)


def test_task_state_store_collapses_consecutive_duplicate_stages(
    generation_db,
) -> None:
    from app.agent_loop.task_state import TaskStateStore

    store = TaskStateStore(generation_db)
    state = store.create(
        user_id="user-1",
        conversation_id="conv-1",
        goal="查找项目资料",
        stage="analyzing",
        next_action="正在理解你的需求",
    )

    store.update_stage(
        state.uuid,
        stage="retrieving",
        next_action="正在查找当前附件",
    )
    store.update_stage(
        state.uuid,
        stage="retrieving",
        next_action="正在查找公司知识库",
    )

    payload = store.public_payload_by_id(state.uuid)
    assert [item["stage"] for item in payload["stage_history"]] == [
        "analyzing",
        "retrieving",
    ]
    assert payload["stage_history"][-1]["next_action"] == "正在查找公司知识库"


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
    assert states[0].stage == "generating"
    assert states[0].status == "active"
    assert states[0].goal == "帮我写一份项目沟通纪要"
    assert states[0].verification_status == "prepared"
    assert states[0].next_action == "正在调用模型生成内容"
    assert [item["stage"] for item in states[0].stage_history_json] == [
        "analyzing",
        "building_context",
        "retrieving",
        "generating",
    ]
