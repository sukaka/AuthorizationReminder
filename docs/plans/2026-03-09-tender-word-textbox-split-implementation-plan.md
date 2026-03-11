# Tender Word Textbox Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `w:txbxContent` 文本框中的正文占位符也能拆段并提升标题，同时不破坏外层段落结构。

**Architecture:** 在 `word-layout.js` 抽出统一的 paragraph replace 逻辑；对 `w:txbxContent` 先 tokenization，再分别处理 textbox inner XML 和 body XML，最后 restore。现有 `index.js` 接口不变。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增 textbox 场景测试**

- 在 `w:txbxContent` 里放一个带 `<w:br/>` 的正文占位符段落
- 断言拆段后 `w:txbxContent` 仍存在
- 断言内部章节标题变成 `Heading1`

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: textbox 场景断言失败。

### Task 2: 实现 textbox tokenization/restore

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 抽出通用 paragraph replace helper**

- 输入一段 XML 片段
- 按现有逻辑处理其中段落
- 返回 `{ xml, changed }`

**Step 2: 处理 `w:txbxContent`**

- 先抽离 block
- 处理内部 XML
- restore 回正文

### Task 3: 验证和同步记录

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: 跑验证**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`
Run: `node --check tender/backend/src/word-layout.js`
Run: `node --check tender/backend/src/index.js`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 2: 更新状态**

- backlog 缩小“文本框等更复杂模板结构”范围
- memory 记录 textbox 支持与剩余边界
