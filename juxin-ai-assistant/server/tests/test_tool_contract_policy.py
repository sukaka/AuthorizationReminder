from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.agent_runtime import BaseTool, ToolContext, ToolRegistry, ToolResult, ToolSpec


class ScopedWriteTool(BaseTool):
    name = "scoped_write"
    version = "2"
    data_scopes = frozenset({"user"})

    def __init__(self) -> None:
        self.calls = 0

    @property
    def tool_spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            effect="idempotent_write",
            required_permission="tools.scoped_write",
            allowed_scopes=frozenset({"knowledge:write"}),
            data_scopes=frozenset({"user"}),
            input_schema={
                "type": "object",
                "required": ["value"],
                "properties": {"value": {"type": "string"}},
            },
            output_schema={
                "type": "object",
                "required": ["written"],
                "properties": {"written": {"type": "boolean"}},
            },
        )

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        self.calls += 1
        return ToolResult(tool_name=self.name, payload={"written": True})


class InvalidOutputTool(ScopedWriteTool):
    name = "invalid_output"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        return ToolResult(tool_name=self.name, payload={"written": "yes"})


class NonObjectOutputTool(ScopedWriteTool):
    name = "non_object_output"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        return ToolResult(tool_name=self.name, payload=["not-an-object"])  # type: ignore[arg-type]


class DowngradeTool(ScopedWriteTool):
    name = "downgrade_tool"

    def resolve_tool_spec(self, tool_input: dict) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            effect="read_only",
        )


class ConfirmationDowngradeTool(ScopedWriteTool):
    name = "confirmation_downgrade_tool"

    def resolve_tool_spec(self, tool_input: dict) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            effect="idempotent_write",
            data_scopes=frozenset({"user"}),
            requires_confirmation=False,
        )


class ScopeDowngradeTool(ScopedWriteTool):
    name = "scope_downgrade_tool"

    def resolve_tool_spec(self, tool_input: dict) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            effect="idempotent_write",
            data_scopes=frozenset({"resource"}),
        )


def _context(generation_db, *, scopes: set[str] | None = None) -> ToolContext:
    return ToolContext(
        user_id="user-1",
        db=generation_db,
        permissions={"tools.scoped_write"},
        tool_scopes=scopes or set(),
        run_id="run-1",
        idempotency_key="change-1",
        confirmed_idempotency_keys={"change-1"},
    )


def test_policy_gate_validates_input_and_scope_before_side_effect(generation_db) -> None:
    registry = ToolRegistry()
    registry.register(ScopedWriteTool())

    malformed = registry.execute("scoped_write", {}, _context(generation_db, scopes={"knowledge:write"}))
    denied = registry.execute("scoped_write", {"value": "x"}, _context(generation_db))
    allowed = registry.execute("scoped_write", {"value": "x"}, _context(generation_db, scopes={"knowledge:write"}))

    assert malformed.error_code == "TOOL_INPUT_SCHEMA_INVALID"
    assert malformed.status == "error"
    assert denied.status == "forbidden"
    assert denied.error_code == "TOOL_SCOPE_DENIED"
    assert allowed.status == "success"
    assert registry.get_spec("scoped_write").effect == "idempotent_write"


def test_invalid_success_output_requires_reconciliation(generation_db) -> None:
    from app.models import AgentToolInvocation

    registry = ToolRegistry()
    registry.register(InvalidOutputTool())

    result = registry.execute("invalid_output", {"value": "x"}, _context(generation_db, scopes={"knowledge:write"}))

    invocation = generation_db.query(AgentToolInvocation).one()
    assert result.error_code == "TOOL_OUTPUT_SCHEMA_INVALID"
    assert invocation.status == "reconciliation_required"


def test_non_object_input_is_rejected_before_side_effect(generation_db) -> None:
    registry = ToolRegistry()
    tool = ScopedWriteTool()
    registry.register(tool)

    result = registry.execute(
        "scoped_write",
        ["not-an-object"],  # type: ignore[arg-type]
        _context(generation_db, scopes={"knowledge:write"}),
    )

    assert result.error_code == "TOOL_INPUT_SCHEMA_INVALID"
    assert result.status == "error"
    assert tool.calls == 0


def test_non_object_success_output_requires_reconciliation(generation_db) -> None:
    from app.models import AgentToolInvocation

    registry = ToolRegistry()
    registry.register(NonObjectOutputTool())

    result = registry.execute(
        "non_object_output",
        {"value": "x"},
        _context(generation_db, scopes={"knowledge:write"}),
    )

    invocation = generation_db.scalar(select(AgentToolInvocation))
    assert result.error_code == "TOOL_OUTPUT_SCHEMA_INVALID"
    assert invocation is not None
    assert invocation.status == "reconciliation_required"


def test_dynamic_tool_spec_cannot_weaken_registered_side_effect_contract(generation_db) -> None:
    registry = ToolRegistry()
    registry.register(DowngradeTool())

    with pytest.raises(ValueError, match="cannot weaken"):
        registry.execute(
            "downgrade_tool",
            {"value": "x"},
            _context(generation_db, scopes={"knowledge:write"}),
        )


def test_dynamic_tool_spec_cannot_weaken_registered_confirmation_contract(generation_db) -> None:
    registry = ToolRegistry()
    registry.register(ConfirmationDowngradeTool())

    with pytest.raises(ValueError, match="cannot weaken"):
        registry.execute(
            "confirmation_downgrade_tool",
            {"value": "x"},
            _context(generation_db, scopes={"knowledge:write"}),
        )


def test_dynamic_tool_spec_cannot_weaken_registered_data_scope_contract(generation_db) -> None:
    registry = ToolRegistry()
    registry.register(ScopeDowngradeTool())

    with pytest.raises(ValueError, match="data scope"):
        registry.execute(
            "scope_downgrade_tool",
            {"value": "x"},
            _context(generation_db, scopes={"knowledge:write"}),
        )


def test_timed_out_write_invocation_requires_reconciliation_without_replay(generation_db) -> None:
    from app.models import AgentToolInvocation

    registry = ToolRegistry()
    tool = ScopedWriteTool()
    registry.register(tool)
    context = _context(generation_db, scopes={"knowledge:write"})

    first = registry.execute("scoped_write", {"value": "first"}, context)
    assert first.status == "success"
    invocation = generation_db.scalar(select(AgentToolInvocation))
    assert invocation is not None

    invocation.status = "in_progress"
    invocation.result_payload_json = None
    invocation.finished_at = None
    invocation.started_at = (
        datetime.now(UTC).replace(tzinfo=None)
        - timedelta(seconds=tool.tool_spec.timeout_seconds + 1)
    )
    generation_db.commit()

    retry = registry.execute("scoped_write", {"value": "first"}, context)
    generation_db.refresh(invocation)

    assert retry.status == "error"
    assert retry.error_code == "TOOL_RECONCILIATION_REQUIRED"
    assert invocation.status == "reconciliation_required"
    assert invocation.finished_at is not None
    assert tool.calls == 1


def test_core_mutating_tools_declare_explicit_side_effect_contracts() -> None:
    from app.agent_runtime.tools import (
        KnowledgeReviewApproveTool,
        KnowledgeReviewRejectTool,
        KnowledgeReviewSubmitTool,
        PptxExportTool,
        UserFeedbackTool,
        DeepWebResearchTool,
        WebCaptureTool,
        WebResearchTool,
        WordExportTool,
    )

    specs = {
        tool.name: tool.tool_spec
        for tool in (
            UserFeedbackTool(),
            KnowledgeReviewSubmitTool(),
            KnowledgeReviewApproveTool(),
            KnowledgeReviewRejectTool(),
            WordExportTool(),
            PptxExportTool(),
            WebCaptureTool(),
            WebResearchTool(),
            DeepWebResearchTool(),
        )
    }

    assert specs["user_feedback"].effect == "idempotent_write"
    assert specs["knowledge_review_submit"].effect == "idempotent_write"
    assert specs["knowledge_review_approve"].effect == "non_idempotent_write"
    assert specs["knowledge_review_reject"].effect == "non_idempotent_write"
    assert specs["word_export"].effect == "non_idempotent_write"
    assert specs["pptx_export"].effect == "non_idempotent_write"
    assert specs["web_capture"].effect == "non_idempotent_write"
    assert specs["web_research"].effect == "non_idempotent_write"
    assert specs["deep_web_research"].effect == "non_idempotent_write"
    assert specs["knowledge_review_approve"].required_permission == "knowledge.review.manage"
    assert "generation_uuid" in specs["user_feedback"].input_schema["required"]
    assert "file_id" in specs["knowledge_review_submit"].input_schema["required"]
    assert "body" in specs["word_export"].input_schema["required"]
    assert "slides" in specs["pptx_export"].input_schema["required"]
    assert specs["web_capture"].allowed_scopes == frozenset({"web:capture"})
    assert specs["web_research"].allowed_scopes == frozenset({"web:research"})
    assert specs["deep_web_research"].confirmation_required is True


def test_mutating_tool_must_declare_data_scope() -> None:
    class UndeclaredScopeTool(BaseTool):
        name = "undeclared_scope"

        @property
        def tool_spec(self) -> ToolSpec:
            return ToolSpec(name=self.name, version=self.version, effect="idempotent_write")

    with pytest.raises(ValueError, match="data scope"):
        ToolRegistry().register(UndeclaredScopeTool())


def test_mixed_action_tools_require_confirmation_only_for_writes(generation_db) -> None:
    from app.agent_runtime.tools.learning_tools import LearningLibraryTool
    from app.agent_runtime.tools.memory_tools import PersonalMemoryTool

    registry = ToolRegistry()
    registry.register(PersonalMemoryTool())
    registry.register(LearningLibraryTool())
    read_context = ToolContext(user_id="user-1", db=generation_db)

    memory_read = registry.execute("personal_memory", {"action": "list"}, read_context)
    memory_write = registry.execute(
        "personal_memory",
        {"action": "save", "content": "偏好简洁回复"},
        read_context,
    )
    learning_read = registry.execute("learning_library", {"action": "list"}, read_context)
    learning_write = registry.execute(
        "learning_library",
        {"action": "save_experience", "question": "Q", "answer": "A"},
        read_context,
    )

    assert memory_read.status == "success"
    assert learning_read.status == "success"
    assert memory_write.error_code == "TOOL_IDEMPOTENCY_KEY_REQUIRED"
    assert learning_write.error_code == "TOOL_IDEMPOTENCY_KEY_REQUIRED"


def test_reference_source_delete_mode_requires_durable_confirmation(generation_db) -> None:
    from app.agent_runtime.tools import ReferenceSourceValidateTool

    registry = ToolRegistry()
    registry.register(ReferenceSourceValidateTool())

    read_result = registry.execute(
        "reference_source_validate",
        {"answer": "答案", "sources": [], "delete_unmentioned": False},
        ToolContext(user_id="user-1", db=generation_db),
    )
    write_result = registry.execute(
        "reference_source_validate",
        {"answer": "答案", "sources": [], "delete_unmentioned": True},
        ToolContext(user_id="user-1", db=generation_db),
    )

    assert read_result.status == "success"
    assert write_result.status == "confirmation_required"
    assert write_result.error_code == "TOOL_IDEMPOTENCY_KEY_REQUIRED"
