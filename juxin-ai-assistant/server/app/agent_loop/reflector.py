from .types import LoopLimits, Observation, TaskAnalysis


class Reflector:
    def should_continue(
        self,
        *,
        analysis: TaskAnalysis,
        observation: Observation,
        rag_search_count: int,
        limits: LoopLimits,
    ) -> bool:
        return (
            analysis.needs_knowledge
            and not observation.sufficient
            and rag_search_count < limits.max_rag_search
        )

    def rewrite_query(self, question: str, attempt: int) -> str:
        if attempt <= 1:
            return question
        if any(keyword in question for keyword in ("突发事件", "处理", "处置", "故障恢复")):
            return "应急响应 恢复 复盘"
        if any(keyword in question for keyword in ("投标", "标书", "响应")):
            return "投标 标书 响应文件"
        if any(keyword in question for keyword in ("部署", "实施", "验收")):
            return "交付 实施 部署 验收"
        if any(keyword in question for keyword in ("漏洞", "日志", "巡检", "加固")):
            return "安全运维 漏洞 日志 加固 应急"
        return " ".join(question.split()[:6]) or question

