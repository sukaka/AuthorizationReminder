from app.context.context_builder import ContextBuilder, RecentChatMessage
from app.knowledge_search import RetrievedKnowledgeChunk
from app.schemas import MessageOut

from .quality_checker import QualityChecker
from .types import TaskAnalysis


STRATEGY_INSTRUCTIONS = {
    "single_turn": "普通聊天模式：不启用复杂 Loop，只执行一次上下文构建和模型回答。",
    "rag_loop": "知识库问答模式：启用 RAG Loop，先检索知识库；资料不足时改写关键词再次检索；回答必须带来源；没有资料时不能编造。",
    "bid_material_loop": "商务助手策略 bid_material_loop：启用投标材料 Loop，回答偏向投标、标书、响应文件、偏离表和附件清单；不要把合同、报价、回款归入商务职责，相关事项只作为需协同销售、财务、法务复核的边界提醒。",
    "hr_admin_loop": "行政人力助手策略 hr_admin_loop：围绕行政制度、人事流程、招聘入转调离、考勤假勤、培训通知、会议组织、资产办公和内部通知输出，涉及劳动关系、薪酬绩效、用工合规或个人隐私时必须提示由人力/法务人工复核。",
    "delivery_troubleshooting_loop": "交付助手策略 delivery_troubleshooting_loop：按环境、网络、配置、日志、产品状态、复现步骤进行部署、实施、排查、培训、验收分析。",
    "security_analysis_loop": "安全运维助手策略 security_analysis_loop：按资产、漏洞、日志、告警、整改、复测、报告输出进行巡检、漏洞、日志、加固、应急分析。",
    "risk_assessment_loop": "风险评估助手策略 risk_assessment_loop：按资产识别、威胁识别、脆弱性识别、风险分析、风险评价、整改建议输出。",
    "incident_response_loop": "应急响应助手策略 incident_response_loop：按发现、研判、遏制、排查、根除、恢复、复盘输出。",
    "sales_followup_loop": "销售助手策略 sales_followup_loop：围绕客户沟通、需求初筛、商机推进和跟进记录输出。",
    "presales_solution_loop": "售前助手策略 presales_solution_loop：围绕需求分析、解决方案、技术交流、方案架构和客户答疑输出。",
    "software_test_loop": "软测助手策略 software_test_loop：围绕测试计划、测试用例、缺陷分析、测试报告和验收测试输出。",
    "pentest_authorized_loop": "渗透测试助手策略 pentest_authorized_loop：仅限客户授权范围内使用，输出计划、记录、风险说明和整改建议。",
}


class AnswerGenerator:
    def __init__(self, context_builder: ContextBuilder | None = None) -> None:
        self.context_builder = context_builder or ContextBuilder()
        self.quality_checker = QualityChecker()

    def build_messages(
        self,
        *,
        analysis: TaskAnalysis,
        current_user_message: str,
        knowledge_chunks: list[RetrievedKnowledgeChunk],
        personal_reference_chunks: list[RetrievedKnowledgeChunk] | None = None,
        recent_messages: list[RecentChatMessage],
    ) -> list[MessageOut]:
        messages = self.context_builder.build_messages(
            mode=analysis.mode,
            current_user_message=current_user_message,
            knowledge_chunks=knowledge_chunks,
            personal_reference_chunks=personal_reference_chunks,
            recent_messages=recent_messages,
            require_knowledge_evidence=analysis.require_knowledge_evidence,
        )
        loop_context = "\n\n".join([
            "## agent_loop_strategy",
            STRATEGY_INSTRUCTIONS.get(analysis.strategy, STRATEGY_INSTRUCTIONS["single_turn"]),
            "## agent_loop_flow",
            "任务分析 → 上下文构建 → 工具调用 → 结果观察 → 自我检查 → 修正输出。",
            "Loop 限制：max_loop_steps=5，max_tool_calls=8，max_rag_search=3，max_retry=2；达到限制后输出当前最可靠结果，不允许无限循环。",
            "## quality_checker",
            self.quality_checker.instructions(
                mode=analysis.mode,
                used_knowledge=bool(knowledge_chunks),
            ),
        ])
        messages[0] = MessageOut(
            role="system",
            content=f"{messages[0].content}\n\n{loop_context}",
        )
        return messages
