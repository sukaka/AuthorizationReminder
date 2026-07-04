from __future__ import annotations

from app.context.mode_router import ModeRouter


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
    normalized = ModeRouter.normalize(mode)
    decision = ModeRouter.decide(mode=normalized, question=question)
    strategy = MODE_STRATEGIES.get(normalized, "single_turn")
    task_type = "chat"
    if normalized == "knowledge":
        task_type = "knowledge_qa"
    elif normalized == "business":
        task_type = "bid_material"
    elif normalized == "hr_admin":
        task_type = "hr_admin"
    elif normalized == "delivery":
        task_type = "delivery_troubleshooting"
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
        "task_type": task_type,
        "strategy": strategy,
        "needs_knowledge": decision.should_search_knowledge,
        "require_knowledge_evidence": decision.require_knowledge_evidence,
    }
