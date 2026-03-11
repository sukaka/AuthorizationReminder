# Tender Word 章节级分页 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 tender Word 导出增加稳定的章节级分页控制，让目录、正文各章、附录各章按边界起新页。

**Architecture:** 在 `word-layout.js` 输出分页计划并提供 docx buffer 级分页 helper；基础导出和无正文占位符模板导出在 TOC 注入之后统一调用，复杂正文占位符模板暂不介入。

**Tech Stack:** Node.js, PizZip, OpenXML(docx), Vitest

---

### Task 1: 先锁定分页计划与 helper 行为

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`
- Modify: `tender/backend/src/word-layout.js`

**Step 1: Write the failing test**

- 断言 `buildWordLayoutPlan` 返回 `page_break_titles`
- 断言 page break 会插在指定标题段落前
- 断言重复执行不重复插入

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: FAIL，说明分页计划/helper 尚未实现。

**Step 3: Write minimal implementation**

- 在 `buildWordLayoutPlan` 中补 `page_break_titles`
- 新增 `ensureDocxPageBreakBeforeHeadingsBuffer`

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: PASS

### Task 2: 接入基础导出与模板导出

**Files:**
- Modify: `tender/backend/src/index.js`

**Step 1: Wire simple docx**

- `buildSimpleDocxBuffer` / `writeSimpleDocx` 接收 `pageBreakTitles`
- 在 TOC 注入之后执行分页注入

**Step 2: Wire template docx**

- `writeDocxWithTemplate` 接收 `pageBreakTitles`
- 仅在 `!hasBodyPlaceholder` 场景启用分页 helper

**Step 3: 主链路透传**

- `buildWordLayoutPlan` 结果里的 `page_break_titles` 传到生成主链路和模板包自动生成链路

### Task 3: 回归与文档同步

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Run focused verification**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

**Step 2: Run syntax and smoke**

Run: `node --check tender/backend/src/word-layout.js`

Run: `node --check tender/backend/src/index.js`

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 3: Update docs**

- backlog 更新 3.8 的已完成边界
- `memory/2026-03-09.md` 追加实现与验证记录
