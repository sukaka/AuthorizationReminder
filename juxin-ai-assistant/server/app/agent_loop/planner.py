from .types import Observation, TaskAnalysis


class Planner:
    SUPPORTED_ACTIONS = (
        "answer_directly",
        "search_knowledge",
        "read_file",
        "generate_draft",
        "revise_answer",
        "ask_clarification",
        "finish",
    )

    def next_action(
        self,
        *,
        analysis: TaskAnalysis,
        observation: Observation | None,
        rag_search_count: int,
        max_rag_search: int,
    ) -> str:
        if not analysis.needs_knowledge:
            return "answer_directly"
        if observation is None:
            return "search_knowledge"
        if observation.sufficient:
            return "finish"
        if rag_search_count < max_rag_search:
            return "search_knowledge"
        if analysis.require_knowledge_evidence:
            return "finish"
        return "answer_directly"
