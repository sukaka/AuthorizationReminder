"""NativeRuntime: default production runtime for 6.0.

FAQ zero-model path first; non-FAQ uses multi-agent research/write/review.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agent_contracts import AgentEventType, AgentRunStage, AgentRunStatus
from ..agent_run_service import AgentRunService, BudgetExceededError, LeaseLostError
from ..crypto import ContentCipher
from ..models import AgentRun
from .answer_engine import AnswerEngine, DefaultAnswerEngine
from .loop_kernel import LoopKernel, LoopKernelInput
from .lease_heartbeat import LeaseHeartbeat
from .multi_agent import coordinate, research_from_snippets, write_from_research
from .outcome_evaluator import OutcomeEvaluator, SuccessContract
from .protocol import ResumeCommand, RunRequest, RunSnapshot
from .run_quality import check_delivery_quality


class NativeRuntime:
    def __init__(
        self,
        db: Session,
        cipher: ContentCipher,
        *,
        key_version: str = "v1",
        answer_engine: AnswerEngine | None = None,
        worker_id: str | None = None,
        lease_heartbeat_interval_seconds: float = 5.0,
        lease_ttl_seconds: int = 20,
    ) -> None:
        self.db = db
        self.service = AgentRunService(db, cipher, key_version=key_version)
        self.answer_engine = answer_engine or DefaultAnswerEngine()
        self.worker_id = worker_id or f"native-{uuid4()}"
        self.lease_heartbeat_interval_seconds = lease_heartbeat_interval_seconds
        self.lease_ttl_seconds = lease_ttl_seconds
        self.loop_kernel = LoopKernel()
        self.outcome_evaluator = OutcomeEvaluator()

    async def start(self, request: RunRequest) -> RunSnapshot:
        return self.start_sync(request)

    def start_sync(self, request: RunRequest) -> RunSnapshot:
        return self._start_sync_with_executor(
            request,
            lambda row, run_request, _worker_id, _fencing_token: self._execute_multi_agent_path(
                row, run_request
            ),
        )

    def start_sync_with_executor(
        self,
        request: RunRequest,
        executor: Callable[[AgentRun, RunRequest, str, int], None],
    ) -> RunSnapshot:
        """Run the normal lease lifecycle with an alternate phase executor.

        The NativeRuntime remains the owner of lease, heartbeat, retry, FAQ,
        cancellation and error semantics.  The callback is an orchestration
        seam for the LangGraph pilot; business behavior is still supplied by
        this runtime unless the caller explicitly opts into another adapter.
        """

        return self._start_sync_with_executor(request, executor)

    def _start_sync_with_executor(
        self,
        request: RunRequest,
        executor: Callable[[AgentRun, RunRequest, str, int], None],
    ) -> RunSnapshot:
        row = self.service.get_owned_run(request.run_id, request.owner_user_id)
        if row is None:
            return RunSnapshot(
                run_id=request.run_id,
                status=AgentRunStatus.FAILED.value,
                stage=AgentRunStage.FAILED.value,
                error_code="RUN_NOT_FOUND",
                error_message_safe="任务不存在",
            )

        if row.cancel_requested:
            return self._snapshot(row)

        # A paused run is an operator-controlled durable gate.  Only the
        # explicit ops resume path may move it back to running before execute.
        if row.status == AgentRunStatus.PAUSED.value:
            return self._snapshot(row)

        fencing_token = self.service.acquire_lease(row.uuid, self.worker_id)
        if fencing_token is None:
            return RunSnapshot(
                run_id=row.uuid,
                status=row.status,
                stage=row.stage,
                progress=int(row.progress or 0),
                model_calls=int(row.model_calls or 0),
                result=row.result_json if isinstance(row.result_json, dict) else {},
                error_code="RUN_LEASE_HELD",
                error_message_safe="任务正在由其他执行器处理",
            )
        # Commit before the separate heartbeat session starts so ownership is
        # observable and recoverable by other workers after a crash.
        self.db.commit()
        self.db.refresh(row)
        self.service.bind_lease(self.worker_id, fencing_token)
        heartbeat = LeaseHeartbeat(
            self.db.get_bind(),
            self.service.cipher,
            run_id=row.uuid,
            worker_id=self.worker_id,
            fencing_token=fencing_token,
            interval_seconds=self.lease_heartbeat_interval_seconds,
            ttl_seconds=self.lease_ttl_seconds,
        )
        heartbeat.start()

        try:
            # Legacy callers invoke ``start`` to resume a failed task.  Convert it
            # into an explicit retry attempt before work resumes so terminal states
            # never transition directly back to running.
            if row.status in {AgentRunStatus.FAILED.value, AgentRunStatus.CANCELLED.value}:
                self.service.retry(row)

            handled = self.service.execute_faq_fast_path(row, request.input_text)
            if handled:
                if heartbeat.lost:
                    raise LeaseLostError("agent_run_lease_lost")
                self.db.flush()
                return self._snapshot(row)

            try:
                executor(row, request, self.worker_id, fencing_token)
            except BudgetExceededError as exc:
                self.service.mark_failed(row, code=exc.code, message=exc.message)
                self.service.append_event(
                    row,
                    event_type=AgentEventType.FAILED,
                    stage=AgentRunStage.FAILED,
                    label=exc.message,
                    event_key=f"budget-{row.attempt}",
                )
            if heartbeat.lost:
                raise LeaseLostError("agent_run_lease_lost")
            self.db.flush()
            return self._snapshot(row)
        except LeaseLostError:
            self.db.expire(row)
            self.db.refresh(row)
            return RunSnapshot(
                run_id=row.uuid,
                status=row.status,
                stage=row.stage,
                progress=int(row.progress or 0),
                model_calls=int(row.model_calls or 0),
                result=row.result_json if isinstance(row.result_json, dict) else {},
                error_code="RUN_LEASE_LOST",
                error_message_safe="任务执行租约已失效，已停止当前执行器",
            )
        finally:
            heartbeat.stop()
            self.service.release_lease(row.uuid, self.worker_id, fencing_token)
            self.service.unbind_lease()

    _SAFE_STEP = frozenset({"succeeded", "completed", "ok"})

    def _succeeded_step_types(self, run_id: str) -> set[str]:
        return {
            s.step_type
            for s in self.service.list_steps(run_id)
            if s.status in self._SAFE_STEP
        }

    def _execute_multi_agent_path(self, row: AgentRun, request: RunRequest) -> None:
        done = self._succeeded_step_types(row.uuid)
        prior_result = row.result_json if isinstance(row.result_json, dict) else {}
        prior_draft = str(prior_result.get("answer") or "").strip()
        resumed = bool(done) or bool(
            isinstance(row.checkpoint_json, dict) and row.checkpoint_json.get("resume_source")
        )
        if resumed:
            self.service.append_event(
                row,
                event_type=AgentEventType.STAGE,
                stage=AgentRunStage.EXECUTING,
                label=f"从 checkpoint 续跑（已完成步骤: {', '.join(sorted(done)) or '无'}）",
                progress=max(int(row.progress or 0), 10),
                event_key=f"checkpoint-continue-{row.attempt}",
            )

        plan = coordinate(request.input_text)
        self.service.mark_running(row, stage=AgentRunStage.PLANNING)

        if "coordinate" not in done:
            self.service.add_step(
                row,
                step_type="coordinate",
                status="succeeded",
                role="coordinator",
                output_summary={
                    "summary": "已制定执行计划",
                    "workflow": plan.workflow,
                    "needs_review": plan.needs_review,
                },
                checkpoint={
                    "workflow": plan.workflow,
                    "goal": plan.goal,
                    "stage": AgentRunStage.PLANNING.value,
                    "progress": 12,
                },
            )
            self.service.append_event(
                row,
                event_type=AgentEventType.STAGE,
                stage=AgentRunStage.PLANNING,
                label="正在制定计划",
                progress=12,
                event_key=f"coordinate-{row.attempt}",
            )
            self.service.persist_safe_checkpoint(
                row,
                checkpoint={
                    **(
                        row.checkpoint_json
                        if isinstance(row.checkpoint_json, dict)
                        else {}
                    ),
                    "last_safe_step": "coordinate",
                },
                stage=AgentRunStage.PLANNING,
                progress=12,
                durable=True,
            )

        # Fast path: write already succeeded and draft retained → skip to review
        skip_research_write = "write" in done and bool(prior_draft)
        research = research_from_snippets([], request.input_text)
        draft = prior_draft
        retrieval_meta: dict = {}
        model_calls = 0
        usage_meta: dict = {"path": "checkpoint_resume" if skip_research_write else "multi_agent_write"}

        if not skip_research_write:
            # Researcher
            if "research" not in done:
                self.service.append_event(
                    row,
                    event_type=AgentEventType.STAGE,
                    stage=AgentRunStage.RETRIEVING,
                    label="研究员正在查找资料",
                    progress=30,
                    event_key=f"research-start-{row.attempt}",
                )
                snippets = self.answer_engine.retrieve(
                    self.db, request.owner_user_id, request.input_text
                )
                last = getattr(self.answer_engine, "last_retrieval", None)
                extra_gaps: list[str] = []
                if last is not None:
                    retrieval_meta = {
                        "mode": last.mode,
                        "second_pass_used": last.second_pass_used,
                        "file_coverage": last.file_coverage,
                        "primary_hits": last.primary_hits,
                        "secondary_hits": last.secondary_hits,
                        "expanded_terms": last.expanded_terms,
                        "query_variants": last.query_variants,
                        "retry_reason": last.retry_reason,
                        "retrieval_grade": last.retrieval_grade,
                    }
                    extra_gaps = list(last.gaps or [])
                research = research_from_snippets(
                    snippets,
                    request.input_text,
                    extra_gaps=extra_gaps,
                )
                self.service.add_step(
                    row,
                    step_type="research",
                    status="succeeded",
                    role="researcher",
                    output_summary={
                        "summary": f"证据 {len(research.snippets)} 条，缺口 {len(research.gaps)}",
                        "snippet_count": len(research.snippets),
                        "gaps": research.gaps,
                        **retrieval_meta,
                    },
                    checkpoint={
                        "snippet_count": len(research.snippets),
                        "stage": AgentRunStage.RETRIEVING.value,
                        "progress": 50,
                        **retrieval_meta,
                    },
                )
                for index, snip in enumerate(research.snippets[:8], start=1):
                    self.service.append_event(
                        row,
                        event_type=AgentEventType.SOURCE,
                        stage=AgentRunStage.RETRIEVING,
                        label="资料来源",
                        progress=min(55, 30 + index * 3),
                        source={
                            "citation_id": snip.file_uuid or f"snip-{index}",
                            "name": snip.name or "资料",
                            "location": snip.location or "",
                            "source_type": "knowledge",
                        },
                        event_key=f"source-{row.attempt}-{index}",
                    )
                self.service.persist_safe_checkpoint(
                    row,
                    checkpoint={
                        **(
                            row.checkpoint_json
                            if isinstance(row.checkpoint_json, dict)
                            else {}
                        ),
                        "last_safe_step": "research",
                        "snippet_count": len(research.snippets),
                    },
                    stage=AgentRunStage.RETRIEVING,
                    progress=50,
                    durable=True,
                )
            else:
                # Research done earlier in this run lineage — re-retrieve lightly for write context
                snippets = self.answer_engine.retrieve(
                    self.db, request.owner_user_id, request.input_text
                )
                research = research_from_snippets(snippets, request.input_text)
                self.service.append_event(
                    row,
                    event_type=AgentEventType.STAGE,
                    stage=AgentRunStage.RETRIEVING,
                    label="复用已完成检索步骤",
                    progress=50,
                    event_key=f"research-skip-{row.attempt}",
                )

            # Writer
            if "write" not in done:
                self.service.append_event(
                    row,
                    event_type=AgentEventType.STAGE,
                    stage=AgentRunStage.EXECUTING,
                    label="写作者正在整理回答",
                    progress=70,
                    event_key=f"write-start-{row.attempt}",
                )
                draft = write_from_research(request.input_text, research)
                usage_meta = {"path": "multi_agent_write", "workflow": plan.workflow}
                if not research.snippets or plan.needs_review:
                    engineered, calls, meta = self.answer_engine.generate(
                        request.input_text, research.snippets
                    )
                    if engineered and engineered.strip():
                        if research.snippets or meta.get("path") != "no_evidence":
                            draft = engineered
                        model_calls = int(calls or 0)
                        usage_meta = {**usage_meta, **(meta or {})}
                if model_calls:
                    for _ in range(model_calls):
                        self.service.record_model_call(row)
                self.service.add_step(
                    row,
                    step_type="write",
                    status="succeeded",
                    role="writer",
                    output_summary={"summary": "已生成草稿", "model_calls": model_calls},
                    usage={"model_calls": model_calls, **usage_meta},
                    checkpoint={
                        "draft_chars": len(draft),
                        "stage": AgentRunStage.EXECUTING.value,
                        "progress": 75,
                    },
                )
                # Persist draft early for future checkpoint resume
                self.service.persist_safe_checkpoint(
                    row,
                    checkpoint={
                        **(
                            row.checkpoint_json
                            if isinstance(row.checkpoint_json, dict)
                            else {}
                        ),
                        "last_safe_step": "write",
                        "draft_chars": len(draft),
                    },
                    stage=AgentRunStage.EXECUTING,
                    progress=75,
                    result={
                        **(row.result_json if isinstance(row.result_json, dict) else {}),
                        "answer": draft,
                        "kind": "draft",
                    },
                    durable=True,
                )
            else:
                draft = prior_draft or write_from_research(request.input_text, research)
        else:
            self.service.append_event(
                row,
                event_type=AgentEventType.STAGE,
                stage=AgentRunStage.EXECUTING,
                label="复用 checkpoint 草稿，跳过检索/写作",
                progress=max(int(row.progress or 0), 75),
                event_key=f"write-skip-{row.attempt}",
            )
            # Best-effort rehydrate snippet count for quality gate
            snippet_count = int(
                (row.checkpoint_json or {}).get("snippet_count")
                if isinstance(row.checkpoint_json, dict)
                else 0
            )
            if snippet_count > 0:
                from .deep_retrieve import RetrievedSnippet
                from .multi_agent import ResearchBundle

                placeholder = RetrievedSnippet(
                    name="checkpoint-source",
                    location="",
                    file_uuid="",
                    text="[restored from checkpoint]",
                )
                research = ResearchBundle(
                    snippets=[placeholder] * min(snippet_count, 3),
                    gaps=[],
                )

        # Reviewer quality gate
        self.service.append_event(
            row,
            event_type=AgentEventType.REVIEW,
            stage=AgentRunStage.REVIEWING,
            label="审核员正在复核",
            progress=88,
            event_key=f"review-start-{row.attempt}",
        )
        quality = check_delivery_quality(
            answer=draft,
            snippets_used=len(research.snippets),
            require_citations=bool(research.snippets),
        )
        revision_count = 0
        while (not quality.passed) and revision_count < 2 and quality.risk != "high":
            revision_count += 1
            # Deterministic repair: append citation footer
            if research.snippets and "来源" not in draft and "《" not in draft:
                footer = "\n\n来源：\n" + "\n".join(
                    f"- 《{s.name}》{(' ' + s.location) if s.location else ''}"
                    for s in research.snippets[:5]
                )
                draft = draft + footer
            quality = check_delivery_quality(
                answer=draft,
                snippets_used=len(research.snippets),
                require_citations=bool(research.snippets),
            )

        no_evidence_refusal = "未找到明确依据" in draft or "无依据拒答" in draft
        outcome = self.outcome_evaluator.evaluate(
            SuccessContract(
                min_answer_chars=8,
                require_evidence=not no_evidence_refusal,
            ),
            output={"answer": draft},
            evidence_count=len(research.snippets),
            effects=(),
        )
        quality_passed = quality.passed and outcome.passed
        evaluator_issues = [*quality.issues, *outcome.issue_codes]

        self.service.add_step(
            row,
            step_type="review",
            status="succeeded" if quality_passed else "failed",
            role="reviewer",
            output_summary={
                "summary": "自检通过" if quality.passed else "自检发现问题",
                "passed": quality_passed,
                "issues": evaluator_issues,
                "risk": quality.risk,
                "revisions": revision_count,
                "outcome": outcome.outcome,
            },
        )

        decision = self.loop_kernel.decide(
            LoopKernelInput(
                step_count=len(self.service.list_steps(row.uuid)),
                tool_calls=0,
                retries=max(0, int(row.attempt or 1) - 1),
                max_steps=int(row.max_steps or 32),
                has_output=bool(draft.strip()),
                quality_passed=quality_passed,
                quality_risk=quality.risk,
                cancel_requested=bool(row.cancel_requested),
            )
        )

        if decision.action == "cancel":
            self.service.request_cancel(row)
            return

        if decision.action in {"fail", "continue"}:
            self.service.mark_failed(
                row,
                code=decision.code,
                message=decision.message,
            )
            self.service.append_event(
                row,
                event_type=AgentEventType.FAILED,
                stage=AgentRunStage.FAILED,
                label=decision.message,
                progress=100,
                quality={"passed": False, "issues": evaluator_issues},
                event_key=f"kernel-failed-{row.attempt}-{decision.code.lower()}",
            )
            # Keep draft in result for human review
            self.service.persist_result(
                row,
                {
                    "kind": "needs_human_review",
                    "answer": draft,
                    "model_calls": int(row.model_calls or 0),
                    "quality": {
                        "passed": False,
                        "issues": evaluator_issues,
                        "risk": quality.risk,
                        "outcome": outcome.outcome,
                    },
                    "snippet_count": len(research.snippets),
                },
            )
            return

        self.service.append_event(
            row,
            event_type=AgentEventType.DELTA,
            stage=AgentRunStage.EXECUTING,
            label="回答",
            progress=95,
            content=draft,
            event_key=f"delta-answer-{row.attempt}",
        )
        kind = "multi_agent" if plan.needs_review else "knowledge"
        if not research.snippets:
            kind = "no_evidence_refusal"
        citations = []
        try:
            from .deep_retrieve import build_citation_cards

            citations = build_citation_cards(research.snippets)
        except Exception:
            citations = []
        artifact_id = ""
        if plan.needs_review or len(draft) >= 200:
            try:
                from ..artifact_service import ArtifactService

                artifact = ArtifactService(self.db).create_from_run(
                    owner_user_id=row.owner_user_id,
                    run_id=row.uuid,
                    title=(plan.goal or "任务成果")[:80],
                    content_markdown=draft,
                    quality={
                        "passed": quality_passed,
                        "issues": evaluator_issues,
                        "risk": quality.risk,
                    },
                    actor=row.owner_user_id,
                )
                artifact_id = artifact.uuid
            except Exception:
                artifact_id = ""

        result_payload = {
            "kind": kind,
            "answer": draft,
            "model_calls": int(row.model_calls or 0),
            "snippet_count": len(research.snippets),
            "workflow": plan.workflow,
            "quality": {
                "passed": quality_passed,
                "issues": evaluator_issues,
                "risk": quality.risk,
                "revisions": revision_count,
                "outcome": outcome.outcome,
            },
            "runtime": "native",
            "artifact_id": artifact_id,
            "citations": citations,
            "retrieval": retrieval_meta,
            "refused": kind == "no_evidence_refusal",
        }
        self.service.mark_succeeded(row, result=result_payload)
        self.service.append_event(
            row,
            event_type=AgentEventType.COMPLETED,
            stage=AgentRunStage.COMPLETED,
            label="已完成",
            progress=100,
            quality={"passed": quality_passed, "issues": evaluator_issues},
            artifact={"artifact_id": artifact_id} if artifact_id else None,
            event_key=f"completed-{row.attempt}",
        )

    async def resume(self, run_id: str, command: ResumeCommand) -> RunSnapshot:
        run = self.db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
        if run is None:
            return RunSnapshot(
                run_id=run_id,
                status=AgentRunStatus.FAILED.value,
                stage=AgentRunStage.FAILED.value,
                error_code="RUN_NOT_FOUND",
                error_message_safe="任务不存在",
            )
        if command.action == "retry":
            self.service.retry(run)
            request_payload = self.service.decrypt_request(run)
            return self.start_sync(
                RunRequest(
                    run_id=run.uuid,
                    owner_user_id=run.owner_user_id,
                    input_text=str(request_payload.get("input_text") or ""),
                    conversation_id=run.conversation_id,
                    message_id=run.message_id,
                    run_type=run.run_type,
                )
            )
        return self._snapshot(run)

    async def cancel(self, run_id: str) -> RunSnapshot:
        run = self.db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
        if run is None:
            return RunSnapshot(
                run_id=run_id,
                status=AgentRunStatus.FAILED.value,
                stage=AgentRunStage.FAILED.value,
                error_code="RUN_NOT_FOUND",
                error_message_safe="任务不存在",
            )
        self.service.request_cancel(run)
        self.db.flush()
        return self._snapshot(run)

    async def inspect(self, run_id: str) -> RunSnapshot:
        run = self.db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
        if run is None:
            return RunSnapshot(
                run_id=run_id,
                status=AgentRunStatus.FAILED.value,
                stage=AgentRunStage.FAILED.value,
                error_code="RUN_NOT_FOUND",
                error_message_safe="任务不存在",
            )
        return self._snapshot(run)

    def _snapshot(self, row: AgentRun) -> RunSnapshot:
        return RunSnapshot(
            run_id=row.uuid,
            status=row.status,
            stage=row.stage,
            progress=int(row.progress or 0),
            model_calls=int(row.model_calls or 0),
            result=row.result_json or {},
            error_code=row.error_code or "",
            error_message_safe=row.error_message_safe or "",
        )
