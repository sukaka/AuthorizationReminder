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

AUTO_MODE = "auto"

AUTO_ROUTE_RULES = (
    ("knowledge", ("公司知识", "知识库", "资料", "文档中", "文件中", "模板", "白皮书", "手册")),
    ("incident_response", ("应急响应", "事件响应", "入侵", "勒索", "安全事件", "溯源")),
    ("pentest", ("渗透", "攻防", "授权测试", "漏洞利用")),
    ("security_ops", ("安全运维", "安全告警", "告警", "日志分析", "监控", "cve", "漏洞")),
    ("risk_assessment", ("风险评估", "风险分析", "合规", "等保")),
    ("software_test", ("测试用例", "回归测试", "测试报告", "缺陷", "bug", "软件测试")),
    ("delivery", ("交付", "验收", "部署", "上线", "实施", "运维交接")),
    ("business", ("投标", "标书", "招标", "响应文件", "商务")),
    ("presales", ("售前", "解决方案", "技术方案", "客户方案", "报价")),
    ("sales", ("销售", "客户跟进", "跟进客户", "商机", "拜访客户", "销售合同")),
    ("hr_admin", ("行政", "人事", "招聘", "请假", "员工", "行政通知")),
)


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


@dataclass(frozen=True)
class ModeRoute:
    mode: str
    requested_mode: str
    reason: str
    confidence: float


class ModeRouter:
    @staticmethod
    def normalize(mode: str) -> str:
        normalized = mode.strip().lower()
        return normalized if normalized in CHAT_MODES else "normal"

    @classmethod
    def route(cls, *, mode: str, question: str) -> ModeRoute:
        requested = mode.strip().lower()
        if requested != AUTO_MODE:
            normalized = cls.normalize(requested)
            return ModeRoute(
                mode=normalized,
                requested_mode=normalized,
                reason="手动指定助手",
                confidence=1.0,
            )

        lowered = question.lower()
        best_mode = "normal"
        best_matches: tuple[str, ...] = ()
        best_score = 0
        for candidate, keywords in AUTO_ROUTE_RULES:
            matches = tuple(keyword for keyword in keywords if keyword.lower() in lowered)
            score = sum(max(1, len(keyword)) for keyword in matches)
            if score > best_score:
                best_mode = candidate
                best_matches = matches
                best_score = score
        if not best_matches:
            return ModeRoute(
                mode="normal",
                requested_mode=AUTO_MODE,
                reason="未命中专业关键词，使用普通助手",
                confidence=0.35,
            )
        return ModeRoute(
            mode=best_mode,
            requested_mode=AUTO_MODE,
            reason=f"命中关键词：{'、'.join(best_matches[:3])}",
            confidence=min(0.98, 0.55 + best_score / 100),
        )

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
