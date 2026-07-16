from __future__ import annotations

from fastapi import HTTPException
from pydantic import ValidationError

from app.feedback_service import create_feedback
from app.schemas import FeedbackIn, FeedbackType

from ..tool_base import BaseTool, ToolContext, ToolResult, ToolSpec


class UserFeedbackTool(BaseTool):
    name = "user_feedback"
    description = "Collect user feedback for a completed generation result"

    @property
    def tool_spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            input_schema={
                "type": "object",
                "required": ["generation_uuid", "feedback_type"],
                "properties": {
                    "generation_uuid": {"type": "string"},
                    "feedback_type": {"type": "string"},
                    "content": {"type": "string"},
                },
            },
            data_scopes=frozenset({"user"}),
            effect="idempotent_write",
        )

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_DB_MISSING",
                error_message_safe="工具缺少数据库连接",
            )
        cipher = context.resources.get("cipher")
        if cipher is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_CIPHER_MISSING",
                error_message_safe="工具缺少内容加密组件",
            )
        generation_uuid = str(tool_input.get("generation_uuid") or "").strip()
        try:
            body = FeedbackIn.model_validate(
                {
                    "feedback_type": tool_input.get("feedback_type"),
                    "content": tool_input.get("content"),
                }
            )
            record = create_feedback(
                context.db,
                context.user_id,
                generation_uuid,
                FeedbackType(body.feedback_type),
                body.content,
                cipher,
                str(context.resources.get("key_version") or "v1"),
            )
        except ValidationError as exc:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FEEDBACK_INVALID",
                error_message_safe=str(exc.errors()[0].get("msg") or "反馈内容无效"),
            )
        except HTTPException as exc:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FEEDBACK_REJECTED",
                error_message_safe=str(exc.detail),
            )
        payload = {
            "feedback_uuid": record.uuid,
            "generation_uuid": generation_uuid,
            "feedback_type": record.feedback_type,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "generation_uuid": generation_uuid,
                "feedback_type": record.feedback_type,
            },
        )
