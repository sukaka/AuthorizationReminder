import re

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.context.context_builder import RecentChatMessage
from app.crypto import ContentCipher
from app.models import ExperienceLibrary, FailureCaseLibrary, TemplateLibrary, UserMemory

from .answer_generator import AnswerGenerator
from .observer import Observer
from .planner import Planner
from .reflector import Reflector
from .task_state import TaskStateStore
from .task_analyzer import TaskAnalyzer
from .tool_executor import ToolExecutor
from .types import (
    LoopLimits,
    LoopRunResult,
    LoopState,
    LoopTraceStep,
    Observation,
)


NO_EVIDENCE_ANSWER = "当前知识库未找到明确依据"


class LoopRunner:
    def __init__(self, limits: LoopLimits | None = None) -> None:
        self.limits = limits or LoopLimits()
        self.task_analyzer = TaskAnalyzer()
        self.planner = Planner()
        self.observer = Observer()
        self.reflector = Reflector()
        self.answer_generator = AnswerGenerator()

    def _trim_trace(self, trace: list[LoopTraceStep]) -> list[dict[str, object]]:
        return [step.to_dict() for step in trace[: self.limits.max_loop_steps]]

    @staticmethod
    def _query_terms(question: str) -> list[str]:
        terms = re.findall(r"[A-Za-z0-9_.:-]{2,}|[\u4e00-\u9fff]{2,}", question)
        expanded: list[str] = []
        for term in terms:
            expanded.append(term)
            if re.fullmatch(r"[\u4e00-\u9fff]{4,}", term):
                expanded.extend(term[index : index + 2] for index in range(0, len(term) - 1))
                expanded.extend(term[index : index + 3] for index in range(0, len(term) - 2))
        if not terms and question.strip():
            expanded = [question.strip()[:20]]
        seen: set[str] = set()
        unique_terms = []
        for term in expanded:
            if term in seen:
                continue
            seen.add(term)
            unique_terms.append(term[:80])
        return unique_terms[:12]

    def _related_memories(self, db: Session, *, sso_user_id: str, question: str) -> list[str]:
        terms = self._query_terms(question)
        stmt = select(UserMemory).where(
            UserMemory.sso_user_id == sso_user_id,
            UserMemory.status == "active",
        )
        if terms:
            stmt = stmt.where(
                or_(
                    UserMemory.priority == "high",
                    *[UserMemory.title.contains(term) for term in terms],
                    *[UserMemory.content.contains(term) for term in terms],
                    *[UserMemory.memory_type.contains(term) for term in terms],
                )
            )
        rows = db.scalars(
            stmt.order_by(
                case(
                    (UserMemory.priority == "high", 0),
                    (UserMemory.priority == "medium", 1),
                    else_=2,
                ),
                UserMemory.updated_at.desc(),
                UserMemory.id.desc(),
            ).limit(8)
        )
        return [
            "｜".join(
                part
                for part in [
                    row.priority,
                    row.memory_type,
                    row.title,
                    row.content[:500],
                ]
                if part
            )
            for row in rows
        ]

    def _related_experiences(
        self,
        db: Session,
        *,
        sso_user_id: str,
        question: str,
        task_type: str,
    ) -> list[str]:
        terms = self._query_terms(question) + ([task_type] if task_type else [])
        stmt = select(ExperienceLibrary).where(
            ExperienceLibrary.user_id == sso_user_id,
            ExperienceLibrary.status == "active",
        )
        if terms:
            stmt = stmt.where(
                or_(
                    *[ExperienceLibrary.task_type.contains(term) for term in terms],
                    *[ExperienceLibrary.title.contains(term) for term in terms],
                    *[ExperienceLibrary.question.contains(term) for term in terms],
                    *[ExperienceLibrary.summary.contains(term) for term in terms],
                )
            )
        rows = db.scalars(
            stmt.order_by(ExperienceLibrary.updated_at.desc(), ExperienceLibrary.id.desc()).limit(5)
        )
        return [
            f"{row.task_type}｜{row.title}｜{row.summary or row.answer[:300]}"
            for row in rows
        ]

    def _related_failure_cases(
        self,
        db: Session,
        *,
        sso_user_id: str,
        question: str,
        task_type: str,
    ) -> list[str]:
        terms = self._query_terms(question) + ([task_type] if task_type else [])
        stmt = select(FailureCaseLibrary).where(
            FailureCaseLibrary.user_id == sso_user_id,
            FailureCaseLibrary.status == "active",
        )
        if terms:
            stmt = stmt.where(
                or_(
                    *[FailureCaseLibrary.task_type.contains(term) for term in terms],
                    *[FailureCaseLibrary.wrong_answer.contains(term) for term in terms],
                    *[FailureCaseLibrary.correction.contains(term) for term in terms],
                    *[FailureCaseLibrary.prevention_rule.contains(term) for term in terms],
                )
            )
        rows = db.scalars(
            stmt.order_by(FailureCaseLibrary.updated_at.desc(), FailureCaseLibrary.id.desc()).limit(5)
        )
        return [
            f"{row.task_type}｜错误：{row.wrong_answer[:180]}｜修正：{row.correction[:180]}｜防复发：{row.prevention_rule[:220]}"
            for row in rows
        ]

    def _related_templates(
        self,
        db: Session,
        *,
        sso_user_id: str,
        question: str,
        task_type: str,
    ) -> list[str]:
        terms = self._query_terms(question) + ([task_type] if task_type else [])
        stmt = select(TemplateLibrary).where(
            TemplateLibrary.status == "active",
            or_(
                TemplateLibrary.user_id == sso_user_id,
                (
                    (TemplateLibrary.scope == "company")
                    & (TemplateLibrary.review_status == "official")
                ),
            ),
        )
        if terms:
            stmt = stmt.where(
                or_(
                    *[TemplateLibrary.task_type.contains(term) for term in terms],
                    *[TemplateLibrary.template_name.contains(term) for term in terms],
                    *[TemplateLibrary.template_content.contains(term) for term in terms],
                )
            )
        rows = db.scalars(
            stmt.order_by(
                case((TemplateLibrary.user_id == sso_user_id, 0), else_=1),
                TemplateLibrary.updated_at.desc(),
                TemplateLibrary.id.desc(),
            ).limit(5)
        )
        return [
            f"{row.scope}｜{row.task_type}｜{row.template_name}｜{row.template_content[:500]}"
            for row in rows
        ]

    def run_chat(
        self,
        *,
        db: Session,
        sso_user_id: str,
        question: str,
        mode: str,
        cipher: ContentCipher,
        recent_messages: list[RecentChatMessage],
        top_k: int | None,
        conversation_id: str | None = None,
        attachment_file_ids: list[str] | None = None,
        include_personal_references: bool = False,
        include_session_attachments: bool = False,
    ) -> LoopRunResult:
        trace: list[LoopTraceStep] = []
        task_state_store = TaskStateStore(db) if conversation_id else None
        task_state_id = ""
        task_state_payload: dict[str, object] = {}
        if task_state_store is not None:
            task_state = task_state_store.create(
                user_id=sso_user_id,
                conversation_id=conversation_id or "",
                goal=question,
                stage="analyzing",
                next_action="正在识别任务",
                selected_sources=[],
            )
            task_state_id = task_state.uuid
            task_state_payload = task_state_store.public_payload(task_state)
        analysis = self.task_analyzer.analyze(question, mode)
        long_term_memories = self._related_memories(
            db,
            sso_user_id=sso_user_id,
            question=question,
        )
        related_experiences = self._related_experiences(
            db,
            sso_user_id=sso_user_id,
            question=question,
            task_type=analysis.task_type,
        )
        related_templates = self._related_templates(
            db,
            sso_user_id=sso_user_id,
            question=question,
            task_type=analysis.task_type,
        )
        related_failure_cases = self._related_failure_cases(
            db,
            sso_user_id=sso_user_id,
            question=question,
            task_type=analysis.task_type,
        )
        trace.append(
            LoopTraceStep(
                state=LoopState.START,
                action="analyze_task",
                strategy=analysis.strategy,
            )
        )
        executor = ToolExecutor(
            db=db,
            sso_user_id=sso_user_id,
            cipher=cipher,
            top_k=top_k,
        )
        if task_state_store is not None:
            task_state_store.update_stage(
                task_state_id,
                stage="building_context",
                next_action="正在整理依据",
                selected_sources=[],
            )
        chunks = []
        personal_chunks = []
        search_log_ids: list[int] = []
        observation: Observation | None = None
        rag_search_count = 0
        tool_calls = 0
        if (include_session_attachments or attachment_file_ids) and tool_calls < self.limits.max_tool_calls:
            current_attachment_result = executor.search_current_attachments(
                question,
                mode=analysis.mode,
                conversation_id=conversation_id,
                file_ids=attachment_file_ids,
            )
            personal_chunks.extend(current_attachment_result.chunks)
            search_log_ids.extend(current_attachment_result.search_log_ids)
            tool_calls += 1
            trace.append(
                LoopTraceStep(
                    state=LoopState.EXECUTE_TOOL,
                    action="search_current_attachments",
                    query=question,
                    observation=f"chunks={len(current_attachment_result.chunks)}",
                    strategy=analysis.strategy,
                    error=current_attachment_result.error,
                )
            )
            if task_state_store is not None:
                task_state_store.append_tool_call(
                    task_state_id,
                    tool_name="search_current_attachments",
                    status="failed" if current_attachment_result.error else "success",
                    summary=f"chunks={len(current_attachment_result.chunks)}",
                    error_code="search_current_attachments_failed"
                    if current_attachment_result.error
                    else "",
                )

        if include_personal_references and tool_calls < self.limits.max_tool_calls:
            personal_result = executor.search_personal_references(
                question,
                mode=analysis.mode,
                conversation_id=conversation_id,
                file_ids=[],
                include_personal_references=True,
                include_session_attachments=False,
            )
            personal_chunks.extend(personal_result.chunks)
            search_log_ids.extend(personal_result.search_log_ids)
            tool_calls += 1
            trace.append(
                LoopTraceStep(
                    state=LoopState.EXECUTE_TOOL,
                    action="search_personal_references",
                    query=question,
                    observation=f"chunks={len(personal_result.chunks)}",
                    strategy=analysis.strategy,
                    error=personal_result.error,
                )
            )
            if task_state_store is not None:
                task_state_store.append_tool_call(
                    task_state_id,
                    tool_name="search_personal_references",
                    status="failed" if personal_result.error else "success",
                    summary=f"chunks={len(personal_result.chunks)}",
                    error_code="search_personal_references_failed"
                    if personal_result.error
                    else "",
                )

        while len(trace) < self.limits.max_loop_steps and tool_calls < self.limits.max_tool_calls:
            action = self.planner.next_action(
                analysis=analysis,
                observation=observation,
                rag_search_count=rag_search_count,
                max_rag_search=self.limits.max_rag_search,
            )
            if action != "search_knowledge":
                break
            rag_search_count += 1
            tool_calls += 1
            query = self.reflector.rewrite_query(question, rag_search_count)
            result = executor.search_knowledge_base(query, mode=analysis.mode)
            chunks = result.chunks
            trace.append(
                LoopTraceStep(
                    state=LoopState.EXECUTE_TOOL,
                    action="search_knowledge_base",
                    query=query,
                    observation=f"chunks={len(chunks)}",
                    strategy=analysis.strategy,
                    error=result.error,
                )
            )
            if task_state_store is not None:
                task_state_store.append_tool_call(
                    task_state_id,
                    tool_name="search_knowledge_base",
                    status="failed" if result.error else "success",
                    summary=f"chunks={len(result.chunks)}",
                    error_code="search_knowledge_base_failed" if result.error else "",
                )
            observation = self.observer.observe(result)
            if not self.reflector.should_continue(
                analysis=analysis,
                observation=observation,
                rag_search_count=rag_search_count,
                limits=self.limits,
            ):
                break

        if analysis.require_knowledge_evidence and not chunks and not personal_chunks:
            if task_state_store is not None:
                task_state_store.record_verification(
                    task_state_id,
                    status="failed",
                    summary="未找到可用知识依据",
                    issues=["no_knowledge_evidence"],
                )
                task_state_store.update_stage(
                    task_state_id,
                    stage="failed",
                    next_action="请补充资料或切换为普通聊天",
                    selected_sources=[],
                )
                task_state_payload = task_state_store.public_payload_by_id(task_state_id)
            trace.append(
                LoopTraceStep(
                    state=LoopState.FINISH,
                    action="finish",
                    observation="no_knowledge_evidence",
                    strategy=analysis.strategy,
                )
            )
            return LoopRunResult(
                messages=[],
                chunks=[],
                personal_reference_chunks=[],
                completed_answer=NO_EVIDENCE_ANSWER,
                loop_trace=self._trim_trace(trace),
                search_log_ids=search_log_ids,
                task_state=task_state_payload,
            )

        if task_state_store is not None:
            task_state_store.update_stage(
                task_state_id,
                stage="generating",
                next_action="正在生成回答",
                selected_sources=[
                    {"type": "official_knowledge", "count": len(chunks)},
                    {"type": "personal_reference", "count": len(personal_chunks)},
                ],
            )
        messages = self.answer_generator.build_messages(
            analysis=analysis,
            current_user_message=question,
            knowledge_chunks=chunks,
            personal_reference_chunks=personal_chunks,
            recent_messages=recent_messages,
            long_term_memories=long_term_memories,
            related_experiences=related_experiences,
            related_templates=related_templates,
            related_failure_cases=related_failure_cases,
        )
        if analysis.strategy != "single_turn" and len(trace) < self.limits.max_loop_steps - 1:
            trace.append(
                LoopTraceStep(
                    state=LoopState.QUALITY_CHECK,
                    action="revise_answer",
                    observation="quality_check_after_draft",
                    strategy=analysis.strategy,
                )
            )
        trace.append(
            LoopTraceStep(
                state=LoopState.FINISH,
                action="generate_answer",
                observation="prepared_model_messages",
                strategy=analysis.strategy,
            )
        )
        if task_state_store is not None:
            task_state_store.record_verification(
                task_state_id,
                status="prepared",
                summary="上下文已准备，等待本地模型生成回答",
                issues=[],
            )
            task_state_store.update_stage(
                task_state_id,
                stage="completed",
                next_action="等待模型生成回答",
                selected_sources=[
                    {"type": "official_knowledge", "count": len(chunks)},
                    {"type": "personal_reference", "count": len(personal_chunks)},
                ],
            )
            task_state_payload = task_state_store.public_payload_by_id(task_state_id)
        return LoopRunResult(
            messages=messages,
            chunks=chunks + personal_chunks,
            personal_reference_chunks=personal_chunks,
            loop_trace=self._trim_trace(trace),
            search_log_ids=search_log_ids,
            task_state=task_state_payload,
        )

    def document_generation_instructions(self) -> tuple[str, list[dict[str, object]]]:
        trace = [
            LoopTraceStep(
                state=LoopState.START,
                action="analyze_task",
                strategy="document_generation_loop",
            ),
            LoopTraceStep(
                state=LoopState.PLAN_ACTION,
                action="generate_draft",
                strategy="document_generation_loop",
            ),
            LoopTraceStep(
                state=LoopState.QUALITY_CHECK,
                action="revise_answer",
                strategy="document_generation_loop",
            ),
            LoopTraceStep(
                state=LoopState.FINISH,
                action="finish",
                strategy="document_generation_loop",
            ),
        ]
        content = "\n".join([
            "document_generation_loop：文档生成任务必须执行生成初稿 → 自检 → 修正输出。",
            "1. 生成初稿：先按任务 Prompt、公司画像、知识库资料和用户输入生成完整初稿。",
            "2. 自检：检查事实依据、聚信语境、统一文档格式、风险提示、待确认项和需人工复核事项。",
            "3. 修正输出：如发现格式不完整、事实无依据或角色不匹配，必须在最终答案中修正后再输出。",
            "4. Loop 限制：max_loop_steps=5，max_tool_calls=8，max_rag_search=3，max_retry=2；达到限制后输出当前最可靠结果，不允许无限循环。",
        ])
        return content, self._trim_trace(trace)
