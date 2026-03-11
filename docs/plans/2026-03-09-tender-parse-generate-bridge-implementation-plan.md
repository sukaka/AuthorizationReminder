# Tender Parse Generate Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让当前项目的最新 parse job 可以直接生成初稿，并把生成任务、版本和 draft sections 关联回当前 `bid`。

**Architecture:** 保留旧单文件向导不动，新增项目级桥接接口。后端从 parse workspace 产出的结构化结果构造 analysis summary，再复用现有章节 schema、条款路由、Word 装配和生成任务落库逻辑，在当前项目内创建新版本。前端只在解析工作台补最小入口。

**Tech Stack:** Node.js + Express + MySQL + Vitest + React

---

### Task 1: 写失败的项目级 smoke 用例

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing test**

- 新增用例：创建项目，上传 `MAIN` / `CLARIFICATION` / `ATTACHMENT`，执行 `/parse/start` 后调用新接口 `/api/tender/bids/:id/generate/from-parse`。
- 断言：
  - 返回 `201`
  - `job.created_bid_id === bidId`
  - `version.id > 0`
  - `draft_sections.length > 0`
  - `chapter_schema_validation` 为对象

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/smoke.e2e.test.js -t 'should generate draft from latest parse workspace result for the current bid'`

Expected: FAIL，因为接口不存在或返回非预期。

**Step 3: Commit**

- 不提交，只进入下一任务。

### Task 2: 实现后端桥接接口

**Files:**
- Modify: `tender/backend/src/index.js`

**Step 1: Write the minimal helper changes**

- 新增从 latest parse job 构建生成输入的 helper：
  - 归并 parse fields、clauses、tables
  - 构造 `analysis_summary_json`
  - 构造 `requirement_registry`
- 新增项目级桥接接口：
  - `POST /api/tender/bids/:id/generate/from-parse`

**Step 2: Reuse existing generation path**

- 在当前 `bid` 上创建新版本和 draft sections。
- 生成任务 `created_bid_id` 直接绑定当前项目。
- 保持 `draft workspace`、`check`、`score-optimize` 可以继续通过 `loadLatestGenerateJobForBid` 找到最新任务。

**Step 3: Run smoke test**

Run: `cd tender/backend && npx vitest run tests/smoke.e2e.test.js -t 'should generate draft from latest parse workspace result for the current bid'`

Expected: PASS

### Task 3: 补前端解析工作台入口

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Add state**

- 在 `createBidParseWorkspaceState` 补：
  - `generateBusy`
  - `generateModelId`
  - `generateDocTemplateId`

**Step 2: Add action**

- 新增“从解析结果生成初稿”请求函数。
- 使用当前项目 `bidId` 调用新接口。
- 成功后刷新：
  - `fetchBids`
  - `refreshSelectedBidWorkspace`
  - `fetchVersions`
  - `fetchGenerateJobs`
  - `fetchBootstrap`

**Step 3: Add UI**

- 在解析工作台补：
  - 模型选择框
  - 模板选择框
  - 生成按钮

**Step 4: Run the fastest frontend check**

Run: `npm --prefix tender/frontend run build`

Expected: PASS

### Task 4: 回归与文档收口

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Run focused regression**

Run: `cd tender/backend && npx vitest run tests/draft-schema.test.js tests/parse-workspace.test.js tests/smoke.e2e.test.js -t 'should generate draft from latest parse workspace result for the current bid'`

Expected: PASS

**Step 2: Update docs after verification**

- 将 `GAP-0005` 标记为 `DONE`
- 在 daily memory 里补本次桥接链路完成情况与验证命令

**Step 3: Commit**

- 不提交，留给用户决定。
