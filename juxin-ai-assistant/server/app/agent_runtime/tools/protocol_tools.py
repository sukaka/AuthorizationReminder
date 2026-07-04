from __future__ import annotations

from ..tool_base import BaseTool, ToolContext, ToolResult


DEFAULT_EXPOSED_TOOLS = [
    "company_knowledge_search",
    "personal_reference_search",
    "current_attachment_search",
    "web_search",
    "web_capture",
    "web_research",
    "deep_web_research",
    "word_export",
    "pptx_export",
    "document_template_select",
    "document_structure_validate",
    "advanced_quality_score",
    "bulk_knowledge_governance",
]


class ProtocolAdapterStatusTool(BaseTool):
    name = "protocol_adapter_status"
    description = "Return local MCP/A2A adapter manifest for exposing safe Juxin agent tools"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        requested = [
            str(item).strip().lower()
            for item in (tool_input.get("protocols") or ["mcp", "a2a"])
            if str(item).strip().lower() in {"mcp", "a2a"}
        ]
        protocols = requested or ["mcp", "a2a"]
        tools = [
            str(item).strip()
            for item in (tool_input.get("tools") or DEFAULT_EXPOSED_TOOLS)
            if str(item).strip()
        ]
        manifest = {
            "name": "juxin-ai-assistant",
            "version": "1",
            "description": "聚信 AI 助手 Agent 工具适配清单",
            "capabilities": {
                "mcp": "mcp" in protocols,
                "a2a": "a2a" in protocols,
                "streaming": True,
                "requires_user_auth": True,
            },
            "tools": [
                {
                    "name": tool_name,
                    "scope": "user",
                    "requires_review": tool_name in {"web_capture", "bulk_knowledge_governance"},
                }
                for tool_name in tools
            ],
            "security": {
                "secret_passthrough": False,
                "external_write_default": False,
                "audit_log_required": True,
            },
        }
        payload = {
            "protocols": protocols,
            "status": "local_manifest_ready",
            "tools": tools,
            "manifest": manifest,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "protocols": protocols,
                "status": payload["status"],
                "tool_count": len(tools),
            },
            source_count=len(tools),
        )
