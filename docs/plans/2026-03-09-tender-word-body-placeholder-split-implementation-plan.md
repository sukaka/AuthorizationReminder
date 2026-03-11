# Tender Word Body Placeholder Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让复杂正文占位符模板在渲染后可被安全拆成独立段落，并接回现有 TOC/分页/节样式链路。

**Architecture:** 在 `word-layout.js` 增加针对 `<w:br/>` 多行段落的拆段 helper，并通过 `pageBreakTitles` 精准识别章节标题。`index.js` 只在成功拆段后对 `hasBodyPlaceholder` 模板启用现有 TOC、分页和节样式 helper，保持保守。

**Tech Stack:** Node.js, PizZip, Docxtemplater, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增拆段测试**

- 构造单段内多次 `<w:br/>` 的正文
- 断言 helper 会拆成多个 `<w:p>`
- 断言章节标题被提升成 `Heading1`

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: 新增 body placeholder 拆段测试失败。

### Task 2: 实现最小拆段 helper

**Files:**
- Modify: `tender/backend/src/word-layout.js`
- Modify: `tender/backend/src/index.js`

**Step 1: 在 `word-layout.js` 增加 helper**

- 识别带 `<w:br/>` 的段落
- 仅在命中章节标题时拆段
- 空行转 `<w:p/>`
- 标题转 `Heading1`

**Step 2: 在 `index.js` 接入**

- `hasBodyPlaceholder` 时先尝试拆段
- 只有成功拆段时才继续套用 page break / section page number
- TOC 注入对成功拆段的正文占位符模板开放

### Task 3: 验证和记录

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: 跑验证**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`
Run: `node --check tender/backend/src/word-layout.js`
Run: `node --check tender/backend/src/index.js`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 2: 更新状态**

- backlog 缩小 `3.8` 剩余范围
- memory 记录实验、实现和验证
