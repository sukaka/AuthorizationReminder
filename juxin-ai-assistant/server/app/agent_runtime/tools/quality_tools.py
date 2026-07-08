from __future__ import annotations

import re

from ..tool_base import BaseTool, ToolContext, ToolResult

ROLE_KEYWORDS = {
    "business": ("投标", "标书", "响应文件"),
    "hr_admin": ("行政", "人力", "员工", "制度", "流程"),
    "delivery": ("实施", "部署", "培训", "验收", "排查"),
    "security_ops": ("巡检", "漏洞", "日志", "加固", "应急"),
    "risk_assessment": ("资产", "威胁", "脆弱性", "风险", "整改"),
    "incident_response": ("发现", "研判", "遏制", "排查", "恢复", "复盘"),
}


def _has_structure(answer: str) -> bool:
    return bool(re.search(r"(^|\n)\s*(#{1,6}\s+|[一二三四五六七八九十]+、|\d+[.．、])\S+", answer))


def _has_source(answer: str) -> bool:
    return any(keyword in answer for keyword in ("来源", "文件", "章节", "页码", "根据《", ".docx", ".pdf", ".xlsx", ".pptx"))


def _has_risk_control(answer: str) -> bool:
    return any(keyword in answer for keyword in ("需人工复核", "待确认", "风险提醒", "不编造", "当前知识库未找到明确依据"))


def _grade(score: int) -> str:
    if score >= 80:
        return "A"
    if score >= 60:
        return "B"
    if score >= 40:
        return "C"
    return "D"


class AdvancedQualityScoreTool(BaseTool):
    name = "advanced_quality_score"
    description = "Score generated answer quality for Juxin business context, evidence and document readiness"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        answer = str(tool_input.get("answer") or "")
        mode = str(tool_input.get("mode") or "normal")
        used_knowledge = bool(tool_input.get("used_knowledge"))
        issues: list[str] = []
        score = 100

        if "聚信" not in answer and "聚信得仁" not in answer:
            issues.append("聚信语境不足")
            score -= 20
        if not any(keyword in answer for keyword in ("安全", "等保", "交付", "投标", "运维", "风险", "应急", "内部")):
            issues.append("安全业务场景不足")
            score -= 15
        role_keywords = ROLE_KEYWORDS.get(mode, ())
        if role_keywords and not any(keyword in answer for keyword in role_keywords):
            issues.append("角色重点不足")
            score -= 15
        if not _has_structure(answer):
            issues.append("结构不清晰")
            score -= 15
        if used_knowledge and not _has_source(answer):
            issues.append("缺少引用来源")
            score -= 20
        if not _has_risk_control(answer):
            issues.append("缺少风险或复核提示")
            score -= 10

        final_score = max(0, min(100, score))
        payload = {
            "score": final_score,
            "grade": _grade(final_score),
            "passed": final_score >= 80,
            "issues": issues,
            "mode": mode,
            "used_knowledge": used_knowledge,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "score": final_score,
                "grade": payload["grade"],
                "passed": payload["passed"],
                "issue_count": len(issues),
            },
        )
