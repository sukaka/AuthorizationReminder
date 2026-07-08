# Agent LoopRunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有聚信 AI 助手中增量增加 LoopRunner，让复杂任务支持“任务分析 → 上下文构建 → 工具调用 → 结果观察 → 自我检查 → 修正输出”的循环式执行准备能力。

**Architecture:** 后端新增 `server/app/agent_loop/`，以确定性 LoopRunner 在调用本地模型前完成任务分析、知识库/模板/公司画像工具调用、观察和反思，并把 Loop 策略、工具结果、质量检查规则注入现有消息上下文。聊天路径仍由桌面端本地模型生成最终答案；任务生成路径增加文档生成 Loop 指令，要求模型输出前完成初稿、自检和修正。

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic + pytest；桌面端 React/Vitest 继续消费后端 `messages`。

---

### Task 1: Backend LoopRunner tests

**Files:**
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_chat_api.py`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_generation_flow.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_agent_loop.py`

- [ ] 写失败测试：普通聊天返回轻量 Loop 策略且不强制 RAG。
- [ ] 写失败测试：知识库问答先检索，检索不足时改写关键词再次检索，并限制 `max_rag_search <= 3`。
- [ ] 写失败测试：商务/交付/安全运维/风险评估/应急响应模式注入对应 Loop 策略。
- [ ] 写失败测试：任务生成上下文包含“初稿 → 自检 → 修正”的文档生成 Loop 指令。
- [ ] 运行 `cd juxin-ai-assistant/server && ./.venv/bin/python -m pytest tests/test_agent_loop.py tests/test_chat_api.py tests/test_generation_flow.py -q`，预期失败点为 LoopRunner 尚未实现。

### Task 2: Agent loop components

**Files:**
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/__init__.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/types.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/task_analyzer.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/planner.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/tool_executor.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/observer.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/reflector.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/answer_generator.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/quality_checker.py`
- Create: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_loop/loop_runner.py`

- [ ] 实现 `LoopLimits(max_loop_steps=5, max_tool_calls=8, max_rag_search=3, max_retry=2)`。
- [ ] 实现 Loop 状态：START、ANALYZE_TASK、BUILD_CONTEXT、PLAN_ACTION、EXECUTE_TOOL、OBSERVE_RESULT、REFLECT、GENERATE_ANSWER、QUALITY_CHECK、REVISE、FINISH、FAILED。
- [ ] 实现工具：`search_knowledge_base`、`read_file_chunk`、`get_prompt_template`、`get_company_profile`。
- [ ] 实现 RAG 查询改写，优先把“突发事件/处置/故障恢复”等词改写为“应急响应/安全服务/恢复/复盘”。
- [ ] 实现质量检查规则文本，覆盖聚信业务、角色、引用来源、禁止编造、内部可落地。

### Task 3: Chat service integration

**Files:**
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/chat_service.py`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/schemas.py`

- [ ] 用 `LoopRunner.run_chat()` 替换聊天准备中的直接知识库检索与 ContextBuilder 调用。
- [ ] `knowledge` 和产品资料类问题无依据时返回 `当前知识库未找到明确依据`。
- [ ] 普通聊天仅构建上下文，不进入多轮 RAG。
- [ ] 返回 `loop_trace`，用于调试和验收循环限制。

### Task 4: Document generation integration

**Files:**
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/generation_service.py`
- Modify: `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/schemas.py`

- [ ] 在任务生成 system sections 中加入 `LoopRunner.document_generation_instructions()`。
- [ ] 对正式文档、投标材料、交付文档、安全报告类任务要求模型执行“生成初稿 → 自检格式/事实/风险 → 修正输出”。
- [ ] 返回 `loop_trace`，记录文档生成 Loop 策略。

### Task 5: Verification

**Files:**
- Test only; no new production files.

- [ ] 运行 `cd juxin-ai-assistant/server && ./.venv/bin/python -m pytest tests/test_agent_loop.py tests/test_chat_api.py tests/test_generation_flow.py tests/test_knowledge_search.py tests/test_knowledge_files.py -q`。
- [ ] 运行 `cd juxin-ai-assistant/apps/desktop && npm run test -- tests/chat-page.test.tsx && npm run typecheck && npm run build`。
- [ ] 按验收标准逐项审计：普通聊天、知识库重试、文档自检、商务/交付/安全运维策略、最大循环限制、无无限循环、聚信化输出。
