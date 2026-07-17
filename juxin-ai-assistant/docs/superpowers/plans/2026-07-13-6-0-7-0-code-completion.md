# 6.0/7.0 代码覆盖补完 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在排除生产环境验证项目后，补齐总方案中尚未落地的运行预算、成果物审核、治理持久化和工作流版本能力。

**Architecture:** 保持既有 FastAPI、SQLAlchemy 与 Alembic 架构。新增字段和表仅作增量扩展；服务层负责业务校验，路由层暴露受现有权限保护的接口，避免改变已有 JSON 契约。

**Tech Stack:** Python、FastAPI、Pydantic、SQLAlchemy、Alembic、pytest。

---

### Task 1: 步骤级运行预算

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/agent_run_service.py`
- Modify: `server/app/agent_run_routes.py`
- Create: `server/alembic/versions/0032_run_step_budgets.py`
- Test: `server/tests/test_agent_run_service.py`

- [x] 为单个步骤写失败测试：当 `usage.tool_calls` 大于 `max_step_tool_calls` 时，`add_step` 抛出 `BudgetExceededError`。
- [x] 运行 `python3 -m pytest -q tests/test_agent_run_service.py -k step_budget`，确认实现前失败于 `create_run` 不接受步骤预算。
- [x] 在 Run 持久化预算、创建接口与 `add_step` 中加入工具调用、令牌、时延三项边界校验。
- [x] 重跑该测试，通过。

### Task 2: 成果物模板和独立审核

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/artifact_service.py`
- Modify: `server/app/artifact_routes.py`
- Create: `server/alembic/versions/0033_artifact_reviews.py`
- Test: `server/tests/test_multi_agent_and_artifacts.py`

- [x] 为“创建成果物时保存模板与受众上下文”和“AI/人工审核分别落库”写失败测试。
- [x] 运行成果物目标测试，确认失败原因是缺少审核服务/API。
- [x] 增加成果物元数据契约、审核记录模型和只允许所有者提交/查看的服务与 API。
- [x] 重跑成果物测试，通过。

### Task 3: 工作流版本发布与回滚

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/workflow_engine.py`
- Modify: `server/app/workflow_routes.py`
- Create: `server/alembic/versions/0034_workflow_versions.py`
- Test: `server/tests/test_router_and_workflows.py`

- [x] 为保存工作流生成草稿版本、发布版本和按版本回滚写失败测试。
- [x] 运行工作流目标测试并确认失败。
- [x] 添加定义与版本表、版本服务和受权限保护的发布/回滚端点。
- [x] 重跑目标测试，通过。

### Task 4: 接入治理和跨渠道绑定

**Files:**
- Modify: `server/app/models.py`
- Modify: `server/app/agent_hub_routes.py`
- Modify: `server/app/channel_run_bridge.py`
- Modify: `server/app/channel_routes.py`
- Create: `server/alembic/versions/0035_agent_governance_bindings.py`
- Test: `server/tests/test_channel_run_and_hub.py`

- [x] 为能力/策略/预算配置、外部身份绑定和入出站消息关联写失败测试。
- [x] 运行渠道与 Agent Hub 目标测试并确认失败。
- [x] 增加持久化模型、服务查询和最小管理 API；渠道任务处理时写入绑定与消息关联。
- [x] 重跑目标测试，通过。

### Task 5: 回归与状态更新

**Files:**
- Modify: `docs/plans/2026-07-12-implementation-status.md`

- [x] 运行每批目标测试和 `python3 -m pytest -q`（`706 passed, 1 skipped`）。
- [x] 在桌面端运行 `npm run typecheck` 与 `npm test -- --reporter=dot`（`245 passed`）。
- [x] 将已完成的代码项和仍需生产环境验证的项目分开记录。
