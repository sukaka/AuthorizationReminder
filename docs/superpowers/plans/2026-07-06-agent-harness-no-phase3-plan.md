# 聚信 AI 助手 Agent Harness 去 Phase 3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务推进。所有步骤用 checkbox 跟踪。

**Goal:** 按“先底座、再数据、再治理闭环”的顺序落地聚信 AI 助手 Agent Harness，并明确跳过原 Phase 3“前端 Agent 运行观测台”。

**Architecture:** 先把 `agent-harness/` 作为项目级 Agent 工作规约固定下来，再让后端记录真实运行过程，随后治理知识库、工具和质量指标。前端只做已有页面必要接入，不新增完整 Agent 运行观测台，避免范围失控。

**Tech Stack:** Markdown 规约、FastAPI、SQLAlchemy/Alembic、React/Tauri、Pytest、Vitest、现有 MySQL/SQLite 开发数据库。

## Global Constraints

- 明确删除原 Phase 3：前端升级成完整“Agent 运行观测台”。
- 阶段编号保留空档：执行顺序为 Phase 0、Phase 1、Phase 2、Phase 4、Phase 5、Phase 6。
- 不做大型 Agent 平台重构，先跑通可验收闭环。
- 不绑定 Claude/OpenAI 等供应商目录名。
- 不接入 MCP/A2A 等外部工具平台作为当前主架构。
- 不新增密钥，不把密钥写入仓库、日志或文档。
- 外部写操作默认关闭。
- 每个阶段必须可独立验收。
- 版本规则沿用：大改版升第一位，功能优化升第二位，Bug 修复升第三位。

---

## 删除 Phase 3 的原因

原 Phase 3 是“前端升级成完整 Agent 运行观测台”。本轮删除它，不是说前端永远不做，而是暂时不进入本批开发。

原因：

1. 当前最缺的是 Agent 运行底座和真实数据，而不是先做管理看板。
2. 观测台页面容易扩大范围，拖慢“能记录、能追溯、能验证”的核心闭环。
3. 先把后端 Agent Run、工具记录、引用证据、质量结果跑通，后续前端页面才不会做成静态展示。
4. 管理端观测台可后续单独立项，基于稳定 API 做，不混在底座开发里。

---

## 最终阶段结构

保留：

- Phase 0：整理当前工作区
- Phase 1：完善并提交 Agent Harness 骨架
- Phase 2：后端接入 Agent Run 真实数据
- Phase 4：知识库治理精细化
- Phase 5：技能/工具治理
- Phase 6：质量指标和验收闭环

删除：

- Phase 3：前端 Agent 运行观测台

---

## 计划涉及文件

### Harness 规约文件

- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/AGENTS.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/settings.json`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/agents/planner.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/agents/verifier.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/agents/replayer.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/memory/progress.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/memory/risks.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/skills/knowledge.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/skills/task-run.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/skills/governance.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/skills/desktop.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/skills/quality.md`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/tools/registry.json`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/docs/agent-harness-vault-structure.md`

### 后端运行数据文件

- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/agent_runs.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/models.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/schemas.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/main.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/alembic/versions/0019_agent_runs.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_agent_runs_api.py`

### 质量与治理测试文件

- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_agent_quality_metrics.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_tool_registry_api.py`
- `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_knowledge_governance_api.py`

---

## Phase 0：整理当前工作区

**目标：** 先把历史脏改动、业务接口改动、Harness 文档改动分清楚。

**要做：**

- [ ] 查看当前 worktree 状态。
- [ ] 核对这些旧改动是否仍要保留：
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/src/api/client.ts`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/main.py`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/app/schemas.py`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop/tests/employee-flow.test.tsx`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server/tests/test_catalog_api.py`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/agent-harness/`
  - `/Users/zhanglei/.codex/worktrees/29dc/codex-new/docs/agent-harness-vault-structure.md`
- [ ] 如果保留，分两次提交：
  - Phase1 业务接口/测试改动。
  - Agent Harness 文档骨架。
- [ ] 不提交本地 SQLite DB、`.env`、真实密钥和临时缓存。

**推荐命令：**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
git status --short --branch
git diff -- juxin-ai-assistant/apps/desktop/src/api/client.ts \
  juxin-ai-assistant/server/app/main.py \
  juxin-ai-assistant/server/app/schemas.py \
  juxin-ai-assistant/apps/desktop/tests/employee-flow.test.tsx \
  juxin-ai-assistant/server/tests/test_catalog_api.py
```

**验收标准：**

- Git 状态干净，或只剩明确说明的暂缓项。
- 业务接口改动和 Harness 文档不混在一个模糊提交里。

---

## Phase 1：完善并提交 Agent Harness 骨架

**目标：** 让新人只看 `agent-harness/` 就知道聚信 AI 助手 Agent 如何规划、执行、验证和复盘。

**要做：**

- [ ] 补齐 `agent-harness/skills/` 五类说明：
  - `knowledge.md`
  - `task-run.md`
  - `governance.md`
  - `desktop.md`
  - `quality.md`
- [ ] 每个 skill 一页即可，包含：
  - 适用场景
  - 输入
  - 输出
  - 验收标准
  - 禁止事项
- [ ] 补齐 `agent-harness/tools/registry.json`：
  - 只登记已有工具概念。
  - 不接 MCP。
  - 不放密钥。
  - 不开放外部写权限。
- [ ] 更新 `docs/agent-harness-vault-structure.md`：
  - 说明目录职责。
  - 说明 planner / verifier / replayer 如何协作。
  - 说明 skill 与 tool registry 的关系。

**首批工具登记建议：**

- `knowledge_search`
- `file_parse`
- `document_chunk`
- `word_export`
- `memory_lookup`
- `agent_run_record`
- `quality_check`
- `knowledge_ingest_request`
- `admin_review`

**验收标准：**

- `agent-harness/` 内结构自解释。
- 不出现供应商锁定命名。
- 不出现密钥、真实 token、私有 API Key。
- 工具注册表能表达“启用状态、允许角色、是否外部写、是否审计”。

**提交建议：**

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
git add agent-harness docs/agent-harness-vault-structure.md
git commit -m "docs(ai-assistant): formalize agent harness skeleton"
```

---

## Phase 2：后端接入 Agent Run 真实数据

**目标：** 每次 Agent 运行都有结构化记录，能回答“为什么这么做、用了什么工具、引用了什么、失败原因是什么、下一步是什么”。

**后端数据结构：**

新增 Agent Run 主表建议字段：

- `run_id`
- `task_uuid`
- `user_id`
- `model_profile_id`
- `status`
- `planner_summary`
- `verifier_status`
- `verifier_summary`
- `replay_summary`
- `quality_score`
- `tool_call_count`
- `source_count`
- `warning_count`
- `next_action`
- `created_at`
- `finished_at`

新增 Agent Run Step / Tool Call 记录建议字段：

- `id`
- `run_id`
- `step_index`
- `step_name`
- `tool_name`
- `tool_input_summary`
- `tool_output_summary`
- `status`
- `error_message`
- `started_at`
- `finished_at`

**API 范围：**

- [ ] `GET /api/ai/agent-runs`
- [ ] `GET /api/ai/agent-runs/{run_id}`
- [ ] `GET /api/ai/agent-runs/{run_id}/replay`
- [ ] `POST /api/ai/agent-runs/{run_id}/rerun` 暂缓，只保留接口设计，不在本轮实现写操作。

**TDD 步骤：**

- [ ] 先写 `server/tests/test_agent_runs_api.py`。
- [ ] 测试列表接口返回运行摘要，不含完整 prompt、密钥、私有资料正文。
- [ ] 测试详情接口返回 plan、steps、tool calls、verifier、replay、quality。
- [ ] 测试 replay 接口返回可复盘摘要。
- [ ] 再实现模型、迁移、schema、路由。

**验收标准：**

- 每次运行可查询：
  - 为什么这么做；
  - 用了哪些工具；
  - 引用了哪些知识；
  - verifier 是否通过；
  - 失败原因；
  - 下一步建议。
- API 不返回完整 prompt。
- API 不返回密钥。
- API 不返回私有资料正文。

---

## Phase 4：知识库治理精细化

**目标：** 知识库不仅能上传和搜索，还能定位“资料、解析、索引、权限、引用”哪一环影响回答质量。

**治理指标：**

- 解析成功率
- 索引成功率
- 待审核数量
- 引用命中率
- 低质量片段数量
- 未被引用资料数量
- 高频引用资料 TopN

**资料详情增加：**

- `parse_status`
- `chunk_count`
- `last_referenced_at`
- `last_referenced_task_id`
- `official_status`
- `suggest_reparse`

**审核体验：**

- [ ] 待审核资料批量处理。
- [ ] 审核历史。
- [ ] 驳回原因模板。
- [ ] 一键重新解析。
- [ ] 一键重新索引。

**TDD 步骤：**

- [ ] 先写 `server/tests/test_knowledge_governance_api.py`。
- [ ] 覆盖资料详情治理字段。
- [ ] 覆盖待审核统计。
- [ ] 覆盖重解析/重索引请求只创建任务，不直接无审计写入。

**验收标准：**

- 管理员能知道哪些资料影响回答质量。
- 问题能定位到资料、解析、索引、权限或引用。
- 删除、停用、重新索引等操作有审计记录。

---

## Phase 5：技能/工具治理

**目标：** 把工具调用纳入治理，不乱接外部工具，不让模型随意调用高风险能力。

**后端工具注册表字段：**

- `tool_name`
- `tool_type`
- `enabled`
- `allowed_roles`
- `external_write`
- `audit_required`
- `last_called_at`
- `success_rate`
- `last_error`

**工具治理范围：**

- [ ] 查看工具状态。
- [ ] 启用/禁用工具。
- [ ] 查看调用记录。
- [ ] 查看失败统计。
- [ ] 外部写操作默认关闭。

**首批治理 skill：**

- 知识库 skill
- 任务执行 skill
- Prompt 治理 skill
- 桌面/本地模型 skill
- 质量检查 skill

**TDD 步骤：**

- [ ] 先写 `server/tests/test_tool_registry_api.py`。
- [ ] 测试禁用工具不能被调用。
- [ ] 测试外部写工具默认不可用。
- [ ] 测试工具调用结果写入审计。
- [ ] 测试错误不会泄露完整 API Key。

**验收标准：**

- 每个工具知道是谁调用、什么时候调用、成功还是失败。
- 外部写操作默认关闭。
- 不需要密钥的工具不要求用户配置密钥。
- 工具失败原因可查，但不泄露敏感信息。

---

## Phase 6：质量指标和验收闭环

**目标：** 让“生成质量好不好”可量化、可回归、可定位原因。

**每次生成增加质量摘要：**

- 完整度
- 引用可靠性
- 格式合规
- 安全风险
- 是否需要人工复核

**质量趋势维度：**

- 按任务看质量
- 按模型看质量
- 按知识库看质量
- 按失败原因看质量

**回归测试：**

- 知识库问答测试
- 表单生成测试
- Agent replay 测试
- 敏感信息不暴露测试

**TDD 步骤：**

- [ ] 先写 `server/tests/test_agent_quality_metrics.py`。
- [ ] 测试有引用证据的回答才计入引用可靠。
- [ ] 测试没有检索依据时返回“当前知识库中未找到明确依据”。
- [ ] 测试导出 Word 不包含未使用的参考来源。
- [ ] 测试敏感信息脱敏。

**验收标准：**

- 每次版本升级后能自动确认核心任务没有退化。
- 低质量输出能定位原因。
- 回答、导出和 replay 的引用来源保持一致，只展示实际使用的来源。

---

## 本轮推荐执行顺序

本轮只做 4 件，避免失控：

1. 收口并提交当前 `agent-harness/` 骨架。
2. 补齐 `agent-harness/skills/` 和 `agent-harness/tools/registry.json`。
3. 设计并实现后端 Agent Run 数据结构和 API。
4. 补充知识库、工具、质量治理的最小后端测试。

不做：

- 不做完整前端 Agent 运行观测台。
- 不做新的大屏。
- 不做复杂多 Agent 自主协作。
- 不接外部 MCP/A2A。
- 不让模型自行决定所有工具链。

---

## 最小可落地版本

最小版本只要求跑通一条链路：

1. 用户发起一次生成任务。
2. 后端创建 `agent_run`。
3. planner 记录本次任务计划摘要。
4. 工具调用写入 `tool_calls`。
5. 引用来源写入 `sources`。
6. verifier 写入验证状态。
7. replay 生成复盘摘要。
8. quality 写入质量分和风险提示。
9. 管理端或 API 能查到这次运行记录。

**最小验收：**

- 能查到一次完整 Agent Run。
- 能看到工具调用记录。
- 能看到实际引用来源。
- 能看到 verifier 结果。
- 能看到失败原因或下一步建议。
- 不泄露 prompt、密钥、私有资料正文。

---

## 交付节奏

建议按小步提交：

1. `docs(ai-assistant): formalize agent harness skeleton`
2. `feat(ai-assistant): add agent run data model`
3. `feat(ai-assistant): expose agent run api`
4. `feat(ai-assistant): add tool governance registry`
5. `feat(ai-assistant): add knowledge quality metrics`
6. `test(ai-assistant): add agent harness regression coverage`

每一步完成后运行最快相关验证：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
pytest tests/test_agent_runs_api.py -q
pytest tests/test_tool_registry_api.py -q
pytest tests/test_knowledge_governance_api.py -q
pytest tests/test_agent_quality_metrics.py -q
```

---

## 完成定义

本计划完成时，应满足：

- `agent-harness/` 是项目级 Agent 工作规约。
- 后端有真实 Agent Run 数据。
- 工具调用有记录、有审计、有失败原因。
- 知识库质量可治理。
- 生成质量可评分、可回归。
- Phase 3 前端观测台不在本轮范围内。
