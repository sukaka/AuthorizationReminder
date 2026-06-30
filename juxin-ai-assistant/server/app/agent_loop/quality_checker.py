from .types import QualityCheckResult
from app.schemas import MessageOut


ROLE_KEYWORDS = {
    "business": ("投标", "标书", "响应文件"),
    "hr_admin": ("行政", "人力", "员工", "制度", "流程"),
    "delivery": ("实施", "部署", "培训", "验收", "排查"),
    "security_ops": ("巡检", "漏洞", "日志", "加固", "应急"),
    "risk_assessment": ("资产", "威胁", "脆弱性", "风险", "整改"),
    "incident_response": ("发现", "研判", "遏制", "排查", "恢复", "复盘"),
}


class QualityChecker:
    max_retry = 2

    def check(self, *, answer: str, mode: str, used_knowledge: bool) -> QualityCheckResult:
        issues: list[str] = []
        if "聚信" not in answer and "聚信得仁" not in answer:
            issues.append("聚信得仁业务场景")
        if not any(keyword in answer for keyword in ("安全", "等保", "交付", "投标", "运维", "风险", "应急", "内部")):
            issues.append("网络安全公司内部员工")
        expected = ROLE_KEYWORDS.get(mode, ())
        if expected and not any(keyword in answer for keyword in expected):
            issues.append("当前角色")
        if used_knowledge and not any(keyword in answer for keyword in ("来源", "文件", "章节", "页码")):
            issues.append("引用来源")
        if "产品功能" in answer and "来源" not in answer:
            issues.append("知识库无依据")
        return QualityCheckResult(passed=not issues, issues=issues)

    def revision_messages(
        self,
        *,
        messages: list[MessageOut],
        answer: str,
        issues: list[str],
        retry_count: int,
    ) -> list[MessageOut]:
        if retry_count >= self.max_retry:
            return []
        issue_text = "、".join(issues) if issues else "未通过质量检查"
        return [
            *messages,
            MessageOut(role="assistant", content=answer),
            MessageOut(
                role="user",
                content=(
                    "请修正输出：上一版未通过聚信 Agent Loop 的 QualityChecker。"
                    f"问题包括：{issue_text}。"
                    "请在不编造知识库无依据产品能力的前提下，补足聚信得仁业务语境、当前角色重点、"
                    "可落地步骤、必要的来源或无依据说明，并只输出修正后的最终答案。"
                ),
            ),
        ]

    def instructions(self, *, mode: str, used_knowledge: bool) -> str:
        source_rule = (
            "本次使用了知识库资料，最终答案必须列出来源文件名、章节或页码。"
            if used_knowledge
            else "如涉及产品、方案、参数、手册但没有知识库来源，必须说明“当前知识库未找到明确依据”。"
        )
        return "\n".join([
            "QualityChecker 必须在输出前检查：",
            "1. 是否结合聚信得仁业务场景。",
            "2. 是否适合网络安全公司内部员工使用。",
            "3. 是否贴合当前角色。",
            "4. 是否使用聚信常见业务词汇。",
            "5. 是否可落地到安全运维、等保、交付、投标、风险评估、应急响应等场景。",
            "6. 是否编造聚信没有的产品功能。",
            f"7. {source_rule}",
            f"当前模式：{mode}。",
        ])
