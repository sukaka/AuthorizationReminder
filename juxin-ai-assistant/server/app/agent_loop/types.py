from dataclasses import asdict, dataclass, field
from enum import Enum

from app.knowledge_search import RetrievedKnowledgeChunk
from app.schemas import MessageOut


class LoopState(str, Enum):
    START = "START"
    ANALYZE_TASK = "ANALYZE_TASK"
    BUILD_CONTEXT = "BUILD_CONTEXT"
    PLAN_ACTION = "PLAN_ACTION"
    EXECUTE_TOOL = "EXECUTE_TOOL"
    OBSERVE_RESULT = "OBSERVE_RESULT"
    REFLECT = "REFLECT"
    GENERATE_ANSWER = "GENERATE_ANSWER"
    QUALITY_CHECK = "QUALITY_CHECK"
    REVISE = "REVISE"
    FINISH = "FINISH"
    FAILED = "FAILED"


@dataclass(frozen=True)
class LoopLimits:
    max_loop_steps: int = 5
    max_tool_calls: int = 8
    max_rag_search: int = 3
    max_retry: int = 2


@dataclass(frozen=True)
class TaskAnalysis:
    mode: str
    task_type: str
    strategy: str
    needs_knowledge: bool
    require_knowledge_evidence: bool


@dataclass(frozen=True)
class LoopTraceStep:
    state: LoopState
    action: str
    query: str = ""
    observation: str = ""
    strategy: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["state"] = self.state.value
        return payload


@dataclass(frozen=True)
class ToolResult:
    name: str
    query: str = ""
    chunks: list[RetrievedKnowledgeChunk] = field(default_factory=list)
    search_log_ids: list[int] = field(default_factory=list)
    content: str = ""
    error: str = ""


@dataclass(frozen=True)
class Observation:
    is_empty: bool
    sufficient: bool
    has_sources: bool
    summary: str


@dataclass(frozen=True)
class QualityCheckResult:
    passed: bool
    issues: list[str]


@dataclass(frozen=True)
class LoopRunResult:
    messages: list[MessageOut]
    chunks: list[RetrievedKnowledgeChunk]
    personal_reference_chunks: list[RetrievedKnowledgeChunk] = field(default_factory=list)
    completed_answer: str = ""
    loop_trace: list[dict[str, object]] = field(default_factory=list)
    search_log_ids: list[int] = field(default_factory=list)
