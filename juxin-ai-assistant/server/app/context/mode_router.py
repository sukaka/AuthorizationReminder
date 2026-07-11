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
    "命令行",
    "控制台命令",
    "cli",
    "console",
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
        return ModeDecision(
            mode=normalized,
            # Retrieval is cheap and relevance-gated downstream. Keywords only
            # determine whether an answer must have formal evidence; they no
            # longer decide whether the knowledge base is searched at all.
            should_search_knowledge=bool(lowered.strip()),
            require_knowledge_evidence=required,
        )
