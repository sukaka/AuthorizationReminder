from __future__ import annotations

from app.context.mode_router import ModeRouter
from app.web_sources import SearchIntentDetector, UrlExtractor


MODE_STRATEGIES = {
    "normal": "single_turn",
    "knowledge": "rag_loop",
    "business": "bid_material_loop",
    "hr_admin": "hr_admin_loop",
    "delivery": "delivery_troubleshooting_loop",
    "security_ops": "security_analysis_loop",
    "risk_assessment": "risk_assessment_loop",
    "incident_response": "incident_response_loop",
    "sales": "sales_followup_loop",
    "presales": "presales_solution_loop",
    "software_test": "software_test_loop",
    "pentest": "pentest_authorized_loop",
}


def analyze_task_mode(question: str, mode: str) -> dict[str, object]:
    route = ModeRouter.route(mode=mode, question=question)
    normalized = route.mode
    decision = ModeRouter.decide(mode=normalized, question=question)
    strategy = MODE_STRATEGIES.get(normalized, "single_turn")
    task_type = "chat"
    if UrlExtractor().extract_first(question):
        task_type = "web_capture"
    elif "导出" in question and "Word" in question:
        task_type = "word_export"
    elif SearchIntentDetector().should_search(question):
        task_type = "web_search"
    elif any(keyword in question.lower() for keyword in ("codex", "提示词", "prompt")) and any(
        keyword in question for keyword in ("代码", "审查", "开发", "任务", "步骤", "Agent", "智能体")
    ):
        task_type = "codex_prompt"
    elif any(keyword in question.upper() for keyword in ("UI", "UX")) or any(
        keyword in question for keyword in ("界面", "页面", "交互", "视觉", "布局", "窗口", "按钮")
    ):
        task_type = "ui_design"
    elif normalized == "knowledge":
        task_type = "knowledge_qa"
    elif normalized == "sales":
        task_type = "sales_followup"
    elif normalized == "presales":
        task_type = "presales_solution"
    elif normalized == "business":
        task_type = "bid_material"
    elif normalized == "hr_admin":
        task_type = "hr_admin"
    elif normalized == "delivery":
        task_type = "delivery_troubleshooting"
    elif normalized == "software_test":
        task_type = "software_test"
    elif normalized == "pentest":
        task_type = "pentest"
    elif normalized == "security_ops":
        task_type = "security_analysis"
    elif normalized == "risk_assessment":
        task_type = "risk_assessment"
    elif normalized == "incident_response":
        task_type = "incident_response"
    elif any(keyword in question for keyword in ("文档", "报告", "纪要", "材料", "方案")):
        task_type = "document_generation"
    return {
        "mode": normalized,
        "requested_mode": route.requested_mode,
        "routing_reason": route.reason,
        "routing_confidence": route.confidence,
        "task_type": task_type,
        "strategy": strategy,
        "needs_knowledge": decision.should_search_knowledge,
        "require_knowledge_evidence": decision.require_knowledge_evidence,
    }
