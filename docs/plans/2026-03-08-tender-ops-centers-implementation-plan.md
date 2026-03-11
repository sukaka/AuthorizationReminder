# Tender 风险中心、模板中心与导出中心 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成 `GAP-0024`，为 tender 系统新增风险中心、模板中心、导出中心三个独立运营页面，并补齐项目级导出记录能力。

**Architecture:** 后端新增 ops-center 聚合与导出记录持久化；前端在现有 `App.jsx` 中新增三类中心页和对应状态装配。模板底层 CRUD 复用既有接口，避免重复实现。

**Tech Stack:** Node.js、Express、MySQL、React、Vite、Vitest、node:test

---

### Task 1: 新增后端聚合纯函数测试

**Files:**
- Create: `tender/backend/tests/ops-center.test.js`
- Create: `tender/backend/src/ops-center.js`

**Step 1: Write the failing test**

- 覆盖风险项目聚合
- 覆盖风险中心概览统计
- 覆盖导出记录标准化

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/ops-center.test.js`

Expected: FAIL，提示模块或函数不存在

**Step 3: Write minimal implementation**

- 实现风险等级、推荐动作、导出记录标准化纯函数

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/ops-center.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add tender/backend/src/ops-center.js tender/backend/tests/ops-center.test.js
git commit -m "test: add ops center backend helpers"
```

### Task 2: 补导出记录表与后端接口

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`

**Step 1: Write the failing test**

- 先复用 Task 1 的纯函数测试
- 若必要，为导出载荷构造补一条失败用例

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/ops-center.test.js`

Expected: FAIL，提示新的行为未实现

**Step 3: Write minimal implementation**

- 新增 `tender_bid_export_records`
- 新增：
  - `GET /api/tender/risk-center/summary`
  - `GET /api/tender/export-center/summary`
  - `POST /api/tender/bids/:id/export`
  - `GET /api/tender/export-records/:id/download`
- 导出成功时写记录；当前状态为 `EXPORT_READY` 时推进到 `EXPORTED`

**Step 4: Run test to verify it passes**

Run:

```bash
cd tender/backend && npx vitest run tests/ops-center.test.js
node --check src/index.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add tender/backend/src/db.js tender/backend/src/index.js
git commit -m "feat: add tender ops center backend APIs"
```

### Task 3: 新增前端纯函数测试

**Files:**
- Create: `tender/frontend/src/ops-center.js`
- Create: `tender/frontend/src/ops-center.test.js`

**Step 1: Write the failing test**

- 覆盖风险中心数据装配
- 覆盖模板包提交载荷构造
- 覆盖导出记录排序与状态归一化

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/ops-center.test.js`

Expected: FAIL

**Step 3: Write minimal implementation**

- 实现前端状态初始化和数据标准化方法

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/ops-center.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add tender/frontend/src/ops-center.js tender/frontend/src/ops-center.test.js
git commit -m "test: add ops center frontend helpers"
```

### Task 4: 接入三大中心页 UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Write the failing test**

- 先运行前端纯函数测试，确保 UI 依赖数据装配逻辑稳定

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/ops-center.test.js`

Expected: 若新增 UI 依赖的新装配函数未实现则 FAIL

**Step 3: Write minimal implementation**

- 新增主导航 tab
- 新增风险中心页面
- 新增模板中心页面
- 新增导出中心页面
- 接入现有模板 CRUD 和新导出 API

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tender/frontend/src/ops-center.test.js tender/frontend/src/draft-workspace.test.js tender/frontend/src/parse-workspace.test.js tender/frontend/src/bid-workflow.test.js
npm --prefix tender/frontend run build
```

Expected: PASS

**Step 5: Commit**

```bash
git add tender/frontend/src/App.jsx tender/frontend/src/App.css
git commit -m "feat: add tender risk template and export centers"
```

### Task 5: 回填文档与验证

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Update backlog**

- 将 `GAP-0024` 标记为 `DONE`

**Step 2: Update memory**

- 记录本轮后端导出能力、风险中心和模板中心收口情况

**Step 3: Run verification**

Run:

```bash
cd tender/backend && npx vitest run tests/ops-center.test.js tests/draft-workspace.test.js tests/parse-workspace.test.js
node --test /Users/zhanglei/Documents/codex-new/tender/frontend/src/ops-center.test.js /Users/zhanglei/Documents/codex-new/tender/frontend/src/draft-workspace.test.js /Users/zhanglei/Documents/codex-new/tender/frontend/src/parse-workspace.test.js /Users/zhanglei/Documents/codex-new/tender/frontend/src/bid-workflow.test.js
node --check /Users/zhanglei/Documents/codex-new/tender/backend/src/index.js
npm --prefix /Users/zhanglei/Documents/codex-new/tender/frontend run build
```

Expected: 全部通过

**Step 4: Commit**

```bash
git add docs/requirements/tender-gap-backlog.md memory/2026-03-08.md
git commit -m "docs: mark gap 0024 complete"
```
