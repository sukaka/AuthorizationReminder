from dataclasses import dataclass


CHAT_MODES = {
    "normal",
    "sales",
    "business",
    "hr_admin",
    "presales",
    "delivery",
    "software_test",
    "pentest",
    "security_ops",
    "risk_assessment",
    "incident_response",
    "knowledge",
}


KNOWLEDGE_REQUIRED_KEYWORDS = (
    "产品",
    "白皮书",
    "方案",
    "手册",
    "参数",
    "功能",
    "投标模板",
    "标书模板",
    "响应文件模板",
    "交付文档",
    "安全服务模板",
    "prompt 手册",
    "提示词手册",
    "上传资料",
    "资料中",
    "文档中",
    "其他文件",
    "全部资料",
)

KNOWLEDGE_HELPFUL_KEYWORDS = KNOWLEDGE_REQUIRED_KEYWORDS + (
    "等保",
    "测评",
    "运维",
    "应急响应",
    "风险评估",
    "渗透测试",
    "代码审计",
    "漏洞验证",
    "报价",
    "合同",
    "招投标",
)


@dataclass(frozen=True)
class ModeDecision:
    mode: str
    should_search_knowledge: bool
    require_knowledge_evidence: bool


class ModeRouter:
    @staticmethod
    def normalize(mode: str) -> str:
        normalized = mode.strip().lower()
        return normalized if normalized in CHAT_MODES else "normal"

    @classmethod
    def decide(cls, *, mode: str, question: str) -> ModeDecision:
        normalized = cls.normalize(mode)
        lowered = question.lower()
        required = normalized == "knowledge" or any(
            keyword.lower() in lowered
            for keyword in KNOWLEDGE_REQUIRED_KEYWORDS
        )
        helpful = required or any(
            keyword.lower() in lowered
            for keyword in KNOWLEDGE_HELPFUL_KEYWORDS
        )
        return ModeDecision(
            mode=normalized,
            should_search_knowledge=helpful,
            require_knowledge_evidence=required,
        )
