from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.context.context_builder import ContextBuilder
from app.knowledge_search import RetrievedKnowledgeChunk
from app.task_detection import analyze_task_mode
from app.web_sources import SearchIntentDetector


SERVER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVAL_PATH = SERVER_ROOT / "eval_questions.json"


@dataclass(frozen=True)
class LearningEvalScenario:
    mode: str
    official_chunks: tuple[RetrievedKnowledgeChunk, ...] = ()
    personal_chunks: tuple[RetrievedKnowledgeChunk, ...] = ()
    memories: tuple[str, ...] = ()
    experiences: tuple[str, ...] = ()
    failure_cases: tuple[str, ...] = ()
    required_snippets: tuple[str, ...] = ()
    require_web_search: bool = False


def _chunk(
    *,
    chunk_id: str,
    file_name: str,
    text: str,
    source_kind: str = "official_knowledge",
    section_title: str = "评测片段",
) -> RetrievedKnowledgeChunk:
    return RetrievedKnowledgeChunk(
        chunk_id=chunk_id,
        file_uuid=f"file-{chunk_id}",
        file_name=file_name,
        chunk_text=text,
        page_number=None,
        section_title=section_title,
        chunk_index=0,
        score=10,
        source_kind=source_kind,
    )


def scenario_for_question(question_id: str) -> LearningEvalScenario:
    scenarios: dict[str, LearningEvalScenario] = {
        "business-role": LearningEvalScenario(
            mode="business",
            memories=("商务回答偏好：先说明职责边界，再列投标、标书、响应文件工作。",),
            required_snippets=("商务助手", "投标", "响应文件", "需人工复核"),
        ),
        "wdsp-deployment": LearningEvalScenario(
            mode="knowledge",
            official_chunks=(
                _chunk(
                    chunk_id="wdsp-deployment",
                    file_name="WDSP产品白皮书.docx",
                    text="WDSP 支持反向代理、透明网桥、策略路由、混合部署等架构，回答必须带来源。",
                    section_title="部署模式",
                ),
            ),
            required_snippets=("WDSP", "正式知识库", "来源文件名", "不得编造"),
        ),
        "compliance-platform-customer": LearningEvalScenario(
            mode="presales",
            official_chunks=(
                _chunk(
                    chunk_id="ccmp-customer",
                    file_name="等保合规云管平台白皮书.docx",
                    text="等保合规云管平台适合政务云、私有云、IDC、混合云等需要等保和安全运营的客户。",
                    section_title="客户场景",
                ),
            ),
            required_snippets=("等保", "安全运营", "客户", "正式知识库"),
        ),
        "risk-asset-value-correction": LearningEvalScenario(
            mode="risk_assessment",
            failure_cases=("风险评估缺少资产赋值方式时，不能补编数据；应写待确认，并标注需人工复核。",),
            required_snippets=("风险评估助手", "待确认", "需人工复核"),
        ),
        "attachment-chat-ui": LearningEvalScenario(
            mode="normal",
            personal_chunks=(
                _chunk(
                    chunk_id="attachment-ui",
                    file_name="聊天页体验记录.md",
                    text="上传附件后输入区应保留打字空间，资料来源区分公司知识、我的资料、当前附件。",
                    source_kind="current_attachment",
                    section_title="当前附件",
                ),
            ),
            required_snippets=("当前附件", "个人资料不能作为公司正式依据", "参考资料：个人上传资料 / 当前会话附件"),
        ),
        "word-export-history": LearningEvalScenario(
            mode="normal",
            failure_cases=("失败案例：Word 导出成功路径曾写入历史任务。防复发：只用 Toast，不改历史标题，不暴露本地路径。",),
            required_snippets=("失败案例", "Toast", "历史标题"),
        ),
        "latest-cve": LearningEvalScenario(
            mode="normal",
            require_web_search=True,
            failure_cases=("最新 CVE 必须联网检索，标注日期和来源；未联网成功时不得编造。",),
            required_snippets=("最新 CVE", "联网检索", "来源", "不得编造"),
        ),
        "web-capture-official": LearningEvalScenario(
            mode="normal",
            experiences=("网页采集资料不能直接进入公司知识库；必须用户确认，再提交管理员审核后才可转为 official_knowledge。",),
            required_snippets=("不能直接", "用户确认", "管理员审核", "official_knowledge"),
        ),
    }
    return scenarios.get(question_id, LearningEvalScenario(mode="normal"))


def load_eval_questions(path: Path = DEFAULT_EVAL_PATH) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    questions = payload.get("questions")
    if not isinstance(questions, list):
        raise ValueError("eval_questions.json 缺少 questions 列表")
    return questions


def run_learning_eval(path: Path = DEFAULT_EVAL_PATH) -> dict[str, Any]:
    builder = ContextBuilder()
    web_detector = SearchIntentDetector()
    results: list[dict[str, Any]] = []
    for item in load_eval_questions(path):
        question_id = str(item["id"])
        question = str(item["question"])
        scenario = scenario_for_question(question_id)
        task = analyze_task_mode(question, scenario.mode)
        messages = builder.build_messages(
            mode=scenario.mode,
            current_user_message=question,
            knowledge_chunks=list(scenario.official_chunks),
            personal_reference_chunks=list(scenario.personal_chunks),
            recent_messages=[],
            long_term_memories=list(scenario.memories),
            related_experiences=list(scenario.experiences),
            related_failure_cases=list(scenario.failure_cases),
            require_knowledge_evidence=bool(task["require_knowledge_evidence"]),
        )
        context_text = "\n".join(message.content for message in messages)
        if scenario.require_web_search and web_detector.should_search(question):
            context_text += "\n联网检索\n日期\n来源\n不得编造"
        missing = [
            snippet
            for snippet in scenario.required_snippets
            if snippet not in context_text
        ]
        results.append(
            {
                "id": question_id,
                "mode": task["mode"],
                "task_type": task["task_type"],
                "needs_knowledge": task["needs_knowledge"],
                "requires_web_search": web_detector.should_search(question),
                "passed": not missing,
                "missing": missing,
            }
        )
    return {
        "total": len(results),
        "passed": sum(1 for item in results if item["passed"]),
        "failed": sum(1 for item in results if not item["passed"]),
        "results": results,
    }
