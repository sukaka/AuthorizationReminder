from __future__ import annotations

import re

from app.document_templates.registry import get_document_template

from ..tool_base import BaseTool, ToolContext, ToolResult


SECTION_RULES = {
    "方案": {
        "缺少背景与需求": ("背景", "需求", "现状", "痛点"),
        "缺少建设目标或服务目标": ("建设目标", "服务目标", "目标"),
        "缺少实施方式或交付步骤": ("实施", "步骤", "交付", "计划"),
        "缺少输出成果或验收依据": ("输出成果", "交付物", "验收", "成果"),
    },
    "报告": {
        "缺少背景或范围": ("背景", "范围", "概述"),
        "缺少发现或分析": ("发现", "分析", "问题"),
        "缺少结论或建议": ("结论", "建议", "整改"),
    },
    "纪要": {
        "缺少会议主题或背景": ("会议", "主题", "背景"),
        "缺少讨论要点": ("讨论", "要点", "事项"),
        "缺少后续动作": ("后续", "行动", "待办", "负责人"),
    },
}


def _has_section(content: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in content for keyword in keywords)


def _has_clear_structure(content: str) -> bool:
    return bool(
        re.search(r"(^|\n)\s*(#{1,6}\s+|[一二三四五六七八九十]+、|\d+[.．、])\S+", content)
    )


class DocumentStructureValidateTool(BaseTool):
    name = "document_structure_validate"
    description = "Validate whether generated office content has required document structure"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        content = str(tool_input.get("content") or "")
        document_type = str(tool_input.get("document_type") or "方案")
        require_sources = bool(tool_input.get("require_sources"))
        issues: list[str] = []
        if len(content.strip()) < 30:
            issues.append("内容过短，无法形成完整文档")
        if not _has_clear_structure(content):
            issues.append("缺少清晰标题或分节结构")
        rules = SECTION_RULES.get(document_type, SECTION_RULES["方案"])
        for issue, keywords in rules.items():
            if not _has_section(content, keywords):
                issues.append(issue)
        if require_sources and not any(keyword in content for keyword in ("来源", "文件", "章节", "页码", "依据")):
            issues.append("缺少引用来源或依据说明")
        payload = {
            "passed": not issues,
            "issues": issues,
            "document_type": document_type,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "passed": payload["passed"],
                "issue_count": len(issues),
                "document_type": document_type,
            },
        )


def _select_template_code(question: str, task_type: str, document_type: str) -> str:
    text = f"{question}\n{task_type}\n{document_type}"
    if any(keyword in text for keyword in ("会议", "纪要", "待办", "决议")):
        return "meeting_minutes_v1"
    if any(keyword in text for keyword in ("工作计划", "实施计划", "阶段计划", "任务分工")):
        return "work_plan_v1"
    if any(keyword in text for keyword in ("项目汇报", "项目复盘", "进展汇报", "汇报材料")):
        return "project_report_v1"
    return "generic_v1"


class DocumentTemplateSelectTool(BaseTool):
    name = "document_template_select"
    description = "Select an existing Word document template for a generation task"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        question = str(tool_input.get("question") or "")
        task_type = str(tool_input.get("task_type") or "")
        document_type = str(tool_input.get("document_type") or "")
        requested_code = str(tool_input.get("template_code") or "").strip()
        template_code = requested_code or _select_template_code(question, task_type, document_type)
        template = get_document_template(template_code)
        payload = {
            "template_code": template.code,
            "template_name": template.name,
            "fixed_headings": list(template.fixed_headings),
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "template_code": template.code,
                "template_name": template.name,
            },
        )
