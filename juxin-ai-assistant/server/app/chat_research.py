from __future__ import annotations

from dataclasses import dataclass


_EXPLICIT_RESEARCH_MARKERS = (
    "深度研究",
    "深度调研",
    "全面研究",
    "全面调研",
    "系统研究",
    "系统调研",
    "研究报告",
    "调研报告",
    "竞品对比",
)
_RESEARCH_ACTION_MARKERS = ("研究", "调研", "调查", "分析")
_RESEARCH_DIMENSION_MARKERS = (
    "行业",
    "市场",
    "趋势",
    "政策",
    "标准",
    "合规",
    "竞品",
    "方案",
    "技术",
    "架构",
    "风险",
    "采购",
    "案例",
)


@dataclass(frozen=True)
class ChatResearchPlan:
    objective: str
    questions: tuple[str, ...]
    source_scope: str
    citation_policy: str
    uncertainty_policy: str

    def public_payload(self) -> dict[str, object]:
        return {
            "objective": self.objective,
            "questions": list(self.questions),
            "source_scope": self.source_scope,
            "citation_policy": self.citation_policy,
            "uncertainty_policy": self.uncertainty_policy,
        }

    def system_instructions(self) -> str:
        dimensions = "\n".join(
            f"{index}. {question}"
            for index, question in enumerate(self.questions, start=1)
        )
        return "\n".join([
            "【自动深度研究计划】",
            f"研究目标：{self.objective}",
            "研究维度：",
            dimensions,
            f"来源范围：{self.source_scope}",
            f"引用规则：{self.citation_policy}",
            f"不确定性规则：{self.uncertainty_policy}",
            "",
            "【交付要求】",
            "1. 先给结论摘要，再按研究维度组织证据、差异、风险和建议。",
            "2. 明确区分来源事实、综合判断和仍需验证的内容。",
            "3. 关键结论必须附来源标题和 URL，不得伪造来源。",
            "4. 来源不足或相互冲突时，必须明确说明，不得用模型记忆补齐。",
        ])


def is_deep_research_request(text: str) -> bool:
    normalized = "".join(str(text).casefold().split())
    if not normalized:
        return False
    if any(marker in normalized for marker in _EXPLICIT_RESEARCH_MARKERS):
        return True
    has_research_action = any(marker in normalized for marker in _RESEARCH_ACTION_MARKERS)
    dimension_count = sum(
        marker in normalized
        for marker in _RESEARCH_DIMENSION_MARKERS
    )
    return has_research_action and dimension_count >= 2


def build_chat_research_plan(text: str) -> ChatResearchPlan | None:
    objective = " ".join(str(text).split()).strip()
    if not is_deep_research_request(objective):
        return None
    return ChatResearchPlan(
        objective=objective,
        questions=(
            f"{objective}：背景、现状和发展趋势",
            f"{objective}：政策、标准和合规要求",
            f"{objective}：用户需求、应用场景和核心痛点",
            f"{objective}：产品能力、技术架构和实施路径",
            f"{objective}：典型案例、交付效果和可验证数据",
            f"{objective}：主要风险、限制条件和失败因素",
            f"{objective}：竞品、替代方案和差异化建议",
        ),
        source_scope="公开网页、当前会话附件和用户已授权知识库",
        citation_policy="关键事实必须标注来源标题和 URL，并保留检索记录",
        uncertainty_policy="资料不足、来源冲突或无法验证时明确标记，不推测为事实",
    )
