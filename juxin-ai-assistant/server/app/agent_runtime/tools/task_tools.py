from __future__ import annotations

from app.task_detection import analyze_task_mode

from ..tool_base import BaseTool, ToolContext, ToolResult


class TaskModeDetectTool(BaseTool):
    name = "task_mode_detect"
    description = "Detect task type, loop strategy, and knowledge needs from user input"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        question = str(tool_input.get("question") or "")
        mode = str(tool_input.get("mode") or context.mode or "normal")
        payload = analyze_task_mode(question, mode)
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary=payload,
        )
