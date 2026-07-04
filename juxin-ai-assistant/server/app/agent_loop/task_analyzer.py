from app.task_detection import analyze_task_mode

from .types import TaskAnalysis


class TaskAnalyzer:
    def analyze(self, question: str, mode: str) -> TaskAnalysis:
        payload = analyze_task_mode(question, mode)
        return TaskAnalysis(
            mode=str(payload["mode"]),
            task_type=str(payload["task_type"]),
            strategy=str(payload["strategy"]),
            needs_knowledge=bool(payload["needs_knowledge"]),
            require_knowledge_evidence=bool(payload["require_knowledge_evidence"]),
        )
