# 聚信 AI 助手 Agent 产品化与自检 Loop 开发方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. 每个任务必须先写测试，再实现，再由独立子代理做“需求符合性审查”和“代码质量审查”。

**Goal:** 在已有 Agent Runtime、ToolRegistry、资料库、引用治理和学习闭环基础上，把聚信 AI 助手打磨成可控、可审计、可自检的私人工作助理。

**Architecture:** 不重写现有 FastAPI + React/Tauri 架构，不重复 v5.113.0 之后已经完成的工具层；新增或收敛“任务状态、Loop 自检、子代理审查、质量看板、前端任务进度”四类产品化能力。普通用户只看到“查资料、写材料、整理文档、导出 Word、保存资料、申请入库”，开发者内部使用 Agent Runtime / ContextBuilder / ToolRegistry / Verifier / TaskState 等概念。

**Tech Stack:** FastAPI、SQLAlchemy、Alembic、React、Tauri、pytest、Vitest、现有 `server/app/agent_runtime/`、`server/app/agent_loop/`、`server/app/context/`、`server/app/knowledge_*`、`apps/desktop/src/pages/`。

---

## 一、当前基线

### 已完成能力

1. `ToolRegistry` 和 P0/P1/P2 工具已完成最小闭环。
2. `ContextBuilder` 已有 Gather / Select / Compress / Structure 基础拆分。
3. 公司知识、我的资料、当前附件、联网查找、Word 导出、引用过滤、资料审核、学习反馈均已有代码基础。
4. 模板上下文闭环已提交：`v5.125.0 / 5fcf548c`。
5. 本地 SQLite：`server/juxin-ai-assistant-dev.db` 不允许提交。

### 当前主要缺口

1. Agent 的“任务状态”还不够产品化，用户和开发者都难以追踪一轮复杂任务做到哪一步。
2. Loop 自检更多停留在提示词/上下文层，缺少结构化的自检结果和失败恢复策略。
3. 工具调用已经有了，但缺少按任务维度聚合的质量看板和回放入口。
4. 前端复杂任务体验还可以更明确展示“正在查资料 / 正在整理依据 / 正在生成 / 正在复核”。
5. 子代理开发流程尚未固化为项目执行规则，容易出现一次性大改、验证不足或重复造功能。

---

## 二、执行方式：子代理 + 自检 Loop

### 1. 子代理分工

每个开发任务只允许一个实现子代理动手，完成后必须经过两个独立审查子代理：

1. **实现子代理**
   - 只做当前任务。
   - 必须 TDD：先补失败测试，再实现。
   - 不得提交 `server/juxin-ai-assistant-dev.db`。
   - 不得重写已完成的 ToolRegistry / P0-P2 工具。

2. **需求审查子代理**
   - 只检查是否符合本方案和对应任务验收标准。
   - 重点看有没有漏需求、越界改动、UI 是否暴露技术词。

3. **代码质量审查子代理**
   - 只检查实现质量、边界处理、测试覆盖、权限和安全。
   - 重点看是否引入大重构、硬编码、真实密钥、无界循环、危险操作直通。

4. **总控代理**
   - 负责维护计划状态、派发子代理、合并审查意见、跑最终回归。
   - 每完成一个任务更新本文件勾选状态和验证结果。

### 2. 每任务固定 Loop

每个任务执行以下闭环：

1. **Goal**：明确本任务完成定义。
2. **Plan**：列出要改的文件和最小测试。
3. **Act**：只做小步改动。
4. **Verify**：跑最小测试和相关回归。
5. **Review**：需求审查子代理 + 代码质量审查子代理。
6. **Persist**：更新计划文件、记录验证命令和剩余问题。
7. **Continue / Stop**：只有无阻塞且下一步明确才继续。

---

## 三、阶段计划

## Phase A：保护当前未提交改动并补齐模板上下文闭环

**目标：** 先确认当前未提交的模板学习上下文改动是否完整，避免后续子代理踩坏半成品。

**状态：** 已完成并提交 `v5.125.0 / 5fcf548c`。

**影响文件：**
- `server/app/agent_loop/loop_runner.py`
- `server/app/agent_loop/answer_generator.py`
- `server/app/context/context_builder.py`
- `server/tests/test_agent_runtime.py`
- `server/tests/test_context_builder.py`

**子代理任务 A1：模板上下文需求补齐**

- [x] 写或补齐测试：个人模板 + 已审核公司模板可进入上下文，待审核公司模板不可进入上下文。
- [x] 写或补齐测试：模板只能作为结构/措辞参考，不能作为正式知识事实依据。
- [x] 实现最小代码：确保 `LoopRunner` → `ContextBuilder` → 最终消息链路都传递 `related_templates`。
- [x] 跑测试：`python -m pytest tests/test_agent_runtime.py tests/test_learning_routes.py tests/test_context_builder.py tests/test_eval_questions.py -q`，结果 `45 passed, 1 warning`。
- [ ] 需求审查：确认未改变公司知识 / 我的资料 / 当前附件引用规则。（待独立审查）
- [ ] 代码审查：确认查询有权限边界，未引入 N+1 放大风险或真实数据泄漏。（待独立审查）

**验收标准：**

- 个人模板可用于本人上下文。
- 公司模板必须 `scope=company` 且 `review_status=official` 才可用。
- 待审、停用、其他用户私有模板不可进入当前用户上下文。
- 模板上下文文案明确“不得替代正式知识事实依据”。

---

## Phase B：任务状态 TaskState 产品化

**目标：** 让复杂任务不再只依赖聊天历史，后端有结构化状态，前端能展示任务进度。

**状态：** 后端 B1/B2 已完成本地实现；B3 前端待做；独立审查待做。

**建议新增 / 修改文件：**
- Create: `server/app/agent_loop/task_state.py`
- Modify: `server/app/agent_loop/loop_runner.py`
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/<next>_agent_task_state.py`
- Create: `server/tests/test_agent_task_state.py`
- Modify: `apps/desktop/src/api/chat.ts`
- Modify: `apps/desktop/src/pages/ChatPage.tsx`

**子代理任务 B1：后端 TaskState 模型与存储**

- [x] 写失败测试：创建任务状态时记录 `conversation_id`、`stage`、`goal`、`selected_sources`、`tool_calls`、`verification_status`、`next_action`。
- [x] 增加表：`ai_agent_task_states`，不要存完整 API Key、原始大文件或完整长上下文。
- [x] 实现 `TaskStateStore`：创建、更新阶段、追加工具摘要、记录校验结果。
- [x] 跑测试：`python -m pytest tests/test_agent_task_state.py -q`，结果 `2 passed`。
- [ ] 需求审查：确认状态字段可支持前端展示“查资料 / 整理依据 / 生成 / 复核 / 完成”。（待独立审查）
- [ ] 代码审查：确认不记录敏感密钥，不保存完整文件内容。（待独立审查）

**子代理任务 B2：LoopRunner 接入 TaskState**

- [x] 写失败测试：一次 `run_chat()` 至少产生阶段流转记录。
- [x] 在 `LoopRunner` 的分析、工具执行、回答生成、质量检查后更新 TaskState。
- [x] 工具失败时记录 `failed` 状态和可读错误码，但不让整轮不可恢复。
- [x] 跑测试：`python -m pytest tests/test_agent_task_state.py tests/test_agent_runtime.py tests/test_context_builder.py tests/test_migrations.py::test_migration_revision_graph_is_single_linear_head -q`，结果 `43 passed`。
- [ ] 需求审查：确认状态只面向任务追踪，不改变最终回答语义。（待独立审查）
- [ ] 代码审查：确认失败路径可恢复，无无限循环。（待独立审查）

**子代理任务 B3：前端任务进度展示**

- [x] 写前端测试：生成中显示“正在查资料 / 正在整理依据 / 正在生成 / 正在复核”的当前阶段。
- [x] 在聊天消息卡片或顶部轻量状态条展示任务进度。
- [x] 普通用户界面不得出现 `TaskState`、`Tool Call`、`RAG` 等技术词。
- [x] 跑测试：`npm test -- --run tests/chat-page.test.tsx -t "shows user-facing task progress"`，结果 `1 passed`。
- [ ] 需求审查：确认进度信息不遮挡输入框、不扩大附件条。
- [ ] 代码审查：确认无轮询风暴，失败状态可读。

**验收标准：**

- 后端能按任务保存阶段、工具摘要、引用摘要和自检结果。
- 前端能看到当前任务做到哪一步。
- 历史任务恢复时能看到上次任务摘要和下一步建议。

---

## Phase C：Verifier 自检器

**目标：** 回答展示和 Word 导出前，做结构化校验，而不是只靠模型自觉。

**建议新增 / 修改文件：**
- Create: `server/app/agent_loop/verifier.py`
- Modify: `server/app/agent_loop/loop_runner.py`
- Modify: `server/app/reference_matching.py`
- Modify: `server/app/chat_word_export.py`
- Create: `server/tests/test_agent_verifier.py`

**子代理任务 C1：引用自检**

- [x] 写失败测试：回答提到文件名但没有实际使用片段时，不列为参考来源。
- [x] 写失败测试：回答中使用了资料片段时，保留文件名、章节/页码/片段位置。
- [x] 实现 `Verifier.verify_references(answer, candidate_sources)`。
- [x] 跑测试：`python -m pytest tests/test_agent_verifier.py -q`，结果 `4 passed`。
- [ ] 需求审查：确认聊天展示和 Word 导出共用同一套实际引用结果。
- [ ] 代码审查：确认过滤逻辑不会误删当前附件真实引用。

**子代理任务 C2：文档结构自检**

- [x] 写失败测试：安全运维报告缺少“待确认事项 / 人工复核事项”时标记为需补充。
- [x] 写失败测试：输出包含危险绝对承诺时标记为风险提示。
- [x] 实现 `Verifier.verify_document_structure(answer, task_type)`。
- [ ] 将自检结果写入 TaskState，但不强行改写用户答案。
- [x] 跑测试：`python -m pytest tests/test_agent_verifier.py -q`，结果 `4 passed`。
- [ ] 需求审查：确认普通用户看到的是“建议复核”，不是技术错误堆栈。
- [ ] 代码审查：确认规则可维护，不写死大量不可配置文本。

**验收标准：**

- 参考来源只显示实际使用来源。
- Word 导出引用与聊天卡片一致。
- 文档生成结果能标记格式风险和需人工复核项。

---

## Phase D：质量看板与回放

**目标：** 让内测质量能看见：哪些工具失败、哪些回答无来源、哪些任务被用户反馈不好。

**建议新增 / 修改文件：**
- Modify: `server/app/stats_routes.py` 或现有统计路由
- Modify: `server/app/agent_runtime/tool_registry.py`
- Create: `server/app/agent_loop/quality_metrics.py`
- Create: `server/tests/test_agent_quality_metrics.py`
- Modify: `apps/desktop/src/pages/AdminStatsPage.tsx` 或现有治理/学习页面

**子代理任务 D1：后端质量指标聚合**

- [x] 写失败测试：统计工具成功率、失败率、平均耗时、无来源回答比例、引用覆盖率、用户负反馈数。
- [x] 在现有统计服务聚合质量指标，只返回元数据，不返回完整敏感内容。
- [x] 复用现有管理员统计 API，普通用户不可访问。
- [x] 跑测试：`python -m pytest tests/test_stats.py::test_admin_stats_include_agent_quality_metrics -q`，结果 `1 passed`。
- [x] 需求审查：确认指标覆盖内测评估核心问题。
- [x] 代码审查：初审发现回放暴露原始问题、来源字段不兼容；已改为安全任务标题、元数据白名单和本地 DB 忽略规则。

**子代理任务 D2：前端质量看板最小页**

- [x] 写前端测试：管理员能看到工具调用成功率、引用覆盖率、负反馈指标。
- [x] 增加治理中心质量卡片：工具成功率、平均耗时、引用质量、资料命中、用户负反馈。
- [x] 增加“查看任务回放”入口，只展示元数据和摘要。
- [x] 跑测试：`npm test -- --run tests/governance-pages.test.tsx -t "shows global agent quality metrics"` 与 `-t "loads task replay metadata"`，结果均 `1 passed`。
- [x] 需求审查：确认普通员工不可见治理数据。
- [x] 代码审查：初审发现 UI 暴露技术字段；已映射为“查公司知识 / 成功 / 已完成 / 当前附件”等中文办公文案。

**验收标准：**

- 管理员能看到基础质量统计。
- 能抽样回放一轮任务的工具调用摘要、引用摘要和自检结果。
- 普通用户无法访问质量看板。

---

## Phase E：长任务与联网调研体验

**目标：** 把已有深度联网调研和工具链包装成用户能理解的“任务流程”。

**建议新增 / 修改文件：**
- Modify: `server/app/agent_runtime/tools/web_tools.py`
- Modify: `server/app/agent_loop/loop_runner.py`
- Modify: `apps/desktop/src/pages/ChatPage.tsx`
- Create: `apps/desktop/src/components/TaskProgressTimeline.tsx`
- Create: `apps/desktop/tests/task-progress-timeline.test.tsx`

**子代理任务 E1：长任务进度事件**

- [x] 写后端测试：深度联网调研返回 Planner / Searcher / Summarizer / Reporter 四类阶段摘要。
- [x] 将阶段摘要写入 TaskState。
- [x] 搜索失败时保留可读失败原因，并降级普通回答。
- [x] 跑测试：`python -m pytest tests/test_web_routes.py tests/test_agent_loop.py tests/test_agent_runtime.py::test_deep_web_research_tool_returns_user_facing_stage_summaries tests/test_chat_api.py::test_latest_question_web_search_failure_records_task_state_and_continues -q`，结果 `11 passed, 1 warning`。
- [ ] 需求审查：确认联网资料不会自动进入公司知识库。
- [ ] 代码审查：确认网络失败和超时可恢复。

**子代理任务 E2：前端时间线**

- [x] 写组件测试：任务阶段按顺序展示，失败阶段显示“可重试/继续普通回答”。
- [x] 实现轻量时间线，不遮挡聊天内容和输入框。
- [x] 用户确认后才提供“保存到我的资料 / 申请加入公司知识库”。
- [x] 跑测试：`npm test -- --run tests/chat-page.test.tsx -t "shows user-facing task progress"`，结果 `1 passed`；`npm run typecheck` 通过。
- [x] 需求审查：确认用户只看到办公语言，未在聊天进度中展示 TaskState / Tool Call 等技术词。
- [x] 代码审查：通过 `npm run typecheck` 和聊天进度测试；任务进度使用现有轻量状态条，不新增遮挡输入框的浮层。

**验收标准：**

- 长任务有清晰阶段反馈。
- 联网失败不导致任务卡死。
- 用户确认前，联网资料不会自动入库。

---

## 四、版本策略

这批属于“功能优化”，按约定升级第二位版本号。当前最近提交为 `v5.124.0`，建议本计划完成后发布：

- 后端 TaskState + Verifier：`v5.125.0`
- 质量看板 + 长任务体验：`v5.126.0`
- 若只是修当前模板上下文或引用小问题：`v5.124.1`

提交规则：版本号、commit message、tag、push 分支保持一致；不得提交本地 SQLite DB。

---

## 五、不做清单

1. 不重写现有项目。
2. 不重复实现已完成的 P0/P1/P2 工具。
3. 不引入复杂多 Agent 自主协作作为产品运行时。
4. 不在普通用户界面展示 Agent、RAG、Tool Call、Memory、Embedding。
5. 不把完整公司画像、PDF、长历史每轮塞进模型。
6. 不允许模型自动删除、审核、入库或执行管理员动作。
7. 不提交 `server/juxin-ai-assistant-dev.db`。

---

## 六、总体验收

1. 普通用户可以完成：提问、查公司知识、查我的资料、上传当前附件、生成文档、导出 Word。
2. 复杂任务有阶段进度，不再像黑盒等待。
3. 后端有任务状态、自检结果、工具摘要和引用摘要。
4. 回答和 Word 导出只展示实际使用的来源。
5. 管理员能查看质量指标和任务回放摘要。
6. 子代理每个任务均经过需求审查和代码质量审查。
7. 所有改动有最小测试覆盖，相关回归通过。
