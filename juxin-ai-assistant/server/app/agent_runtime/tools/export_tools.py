from __future__ import annotations

from app.chat_word_export import DocxExportService
from app.schemas import ExportWordIn

from ..tool_base import BaseTool, ToolContext, ToolResult, ToolSpec


class WordExportTool(BaseTool):
    name = "word_export"
    description = "Export chat content to Word"

    @property
    def tool_spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            version=self.version,
            data_scopes=frozenset({"user"}),
            effect="non_idempotent_write",
            input_schema={
                "type": "object",
                "required": ["body"],
                "properties": {
                    "body": {"type": "object"},
                    "username": {"type": "string"},
                    "department": {"type": "string"},
                },
            },
            output_schema={
                "type": "object",
                "required": ["export"],
                "properties": {"export": {"type": "object"}},
            },
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
                error_message_safe="工具缺少内容解密组件",
            )
        file_manager = context.resources.get("file_manager")
        if file_manager is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_EXPORT_STORAGE_MISSING",
                error_message_safe="工具缺少导出文件管理组件",
            )
        body = ExportWordIn.model_validate(tool_input.get("body") or tool_input)
        result = DocxExportService(file_manager=file_manager).export_word(
            context.db,
            body=body,
            sso_user_id=context.user_id,
            username=str(tool_input.get("username") or context.user_id),
            department=str(tool_input.get("department") or "待确认"),
            cipher=cipher,
        )
        return ToolResult(
            tool_name=self.name,
            payload={"export": result.model_dump()},
            output_summary={
                "file_name": result.file_name,
                "download_url": result.download_url,
            },
        )
