# Tender Word 节级页码样式 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 tender Word 导出支持默认页脚页码域，以及“封面不显示页码、目录/正文从 1 开始”的最小节级页码样式。

**Architecture:** 在 `word-layout.js` 增加默认 footer 页码域和 section 级页码 helper；基础导出与无正文占位符模板导出在分页后统一调用，已有复杂模板页脚保持保守。

**Tech Stack:** Node.js, PizZip, OpenXML(docx), Vitest

---

### Task 1: 用失败测试锁定页码域和节拆分结构

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`
- Modify: `tender/backend/src/word-layout.js`

**Step 1: Write the failing test**

- 默认 footer 含 `PAGE` field
- 有封面和目录时：
  - 第一节含 `titlePg`
  - 最终节含 `pgNumType start=1`
  - 总 `sectPr` 数量为 2
- 重复执行不重复注入

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

**Step 3: Write minimal implementation**

- 默认 footer XML 改为带页码域
- 新增 `ensureDocxSectionPageNumberBuffer`

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

### Task 2: 接入基础导出与模板导出

**Files:**
- Modify: `tender/backend/src/index.js`

**Step 1: 基础导出**

- `buildSimpleDocxBuffer` / `writeSimpleDocx` 接收页码节选项
- 在分页注入后执行 section 页码 helper

**Step 2: 模板导出**

- `writeDocxWithTemplate` 仅在 `!hasBodyPlaceholder` 场景接入 section 页码 helper

### Task 3: 回归和文档同步

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Focused verification**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Run: `node --check tender/backend/src/word-layout.js`

Run: `node --check tender/backend/src/index.js`

**Step 2: Smoke**

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 3: Update docs**

- backlog 更新 3.8 已完成边界
- `memory/2026-03-09.md` 追加实现和验证
