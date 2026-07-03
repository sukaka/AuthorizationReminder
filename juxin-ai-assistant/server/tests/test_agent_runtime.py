from __future__ import annotations

from app.agent_runtime import BaseTool, ToolContext, ToolRegistry, ToolResult


class EchoTool(BaseTool):
    name = "echo"
    description = "Echo input for registry tests"
    required_permission = "tools.echo"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        return ToolResult(
            tool_name=self.name,
            payload={"echo": tool_input["text"], "user_id": context.user_id},
            output_summary={"echoed": True},
            source_count=1,
        )


class FailingTool(BaseTool):
    name = "failing"
    description = "Raise a controlled failure"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        raise RuntimeError("upstream exploded with secret sk-hidden-value")


def test_tool_registry_executes_tool_and_writes_success_log(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool())

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(
            user_id="user-1",
            db=generation_db,
            permissions={"tools.echo"},
            mode="normal",
            conversation_id="conversation-1",
        ),
    )

    assert result.status == "success"
    assert result.payload == {"echo": "hello", "user_id": "user-1"}

    logs = generation_db.query(AgentToolCallLog).all()
    assert len(logs) == 1
    assert logs[0].tool_name == "echo"
    assert logs[0].user_id == "user-1"
    assert logs[0].conversation_id == "conversation-1"
    assert logs[0].status == "success"
    assert logs[0].source_count == 1
    assert logs[0].input_summary_json == {"text": "hello"}
    assert logs[0].output_summary_json == {"echoed": True}
    assert logs[0].latency_ms >= 0


def test_tool_registry_blocks_missing_permission_and_logs_denial(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool())

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db, permissions=set()),
    )

    assert result.status == "forbidden"
    assert result.error_code == "TOOL_PERMISSION_DENIED"
    assert result.payload == {}

    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "echo"
    assert log.status == "forbidden"
    assert log.error_code == "TOOL_PERMISSION_DENIED"


def test_tool_registry_supports_disabled_tools_without_calling_them(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(EchoTool(), enabled=False)

    result = registry.execute(
        "echo",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db, permissions={"tools.echo"}),
    )

    assert result.status == "disabled"
    assert result.error_code == "TOOL_DISABLED"

    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "echo"
    assert log.status == "disabled"
    assert log.error_code == "TOOL_DISABLED"


def test_tool_registry_sanitizes_unhandled_tool_errors(generation_db) -> None:
    from app.models import AgentToolCallLog

    registry = ToolRegistry()
    registry.register(FailingTool())

    result = registry.execute(
        "failing",
        {"text": "hello"},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert result.status == "error"
    assert result.error_code == "TOOL_EXECUTION_FAILED"
    assert "sk-hidden-value" not in result.error_message_safe

    log = generation_db.query(AgentToolCallLog).one()
    assert log.status == "error"
    assert log.error_code == "TOOL_EXECUTION_FAILED"
    assert "sk-hidden-value" not in log.error_message_safe


def test_agent_loop_tool_executor_logs_company_knowledge_tool_call(
    generation_db,
    monkeypatch,
) -> None:
    from app.agent_loop.tool_executor import ToolExecutor
    from app.crypto import ContentCipher
    from app.models import AgentToolCallLog

    def fake_search_knowledge_chunks(*args, **kwargs):
        assert kwargs["query"] == "等保要求"
        return []

    monkeypatch.setattr(
        "app.agent_runtime.tools.knowledge_tools.search_knowledge_chunks",
        fake_search_knowledge_chunks,
    )

    executor = ToolExecutor(
        db=generation_db,
        sso_user_id="user-1",
        cipher=ContentCipher("a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="),
        top_k=5,
    )

    result = executor.search_knowledge_base("等保要求", mode="knowledge")

    assert result.name == "search_knowledge_base"
    assert result.error == ""
    log = generation_db.query(AgentToolCallLog).one()
    assert log.tool_name == "company_knowledge_search"
    assert log.user_id == "user-1"
    assert log.mode == "knowledge"
    assert log.status == "success"
    assert log.input_summary_json["query"] == "等保要求"
    assert log.output_summary_json == {"chunk_count": 0, "search_log_ids": []}
