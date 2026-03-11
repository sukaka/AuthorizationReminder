# Tender Word 原生目录域 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 tender 的 Word 导出支持原生目录域和打开时字段刷新，同时不破坏现有文本目录与模板导出链路。

**Architecture:** 在 `word-layout.js` 增加 docx settings 与 TOC field helper，基础导出直接走章节级 XML 输出目录域，模板导出则对“追加章节”和 `{{TOC_CONTENT}}` 占位符两类场景做最小接入。复杂正文占位符模板继续保留静态文本目录。

**Tech Stack:** Node.js, PizZip, Docxtemplater, Vitest, OpenXML(docx)

---

### Task 1: 锁定原生 TOC 的 docx 结构行为

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`
- Modify: `tender/backend/src/word-layout.js`

**Step 1: Write the failing test**

- 新增一个最小 docx case，断言 helper 执行后：
  - `word/document.xml` 含 `TOC \\o "1-3" \\h \\z \\u`
  - `word/settings.xml` 含 `w:updateFields`
  - `[Content_Types].xml` 和 `_rels/.rels` 已补齐 settings part

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: FAIL，提示缺少原生 TOC / settings 注入能力。

**Step 3: Write minimal implementation**

- 新增 settings helper
- 新增 TOC field helper
- 先只做到 buffer 级注入，不接业务链路

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: PASS

### Task 2: 让基础导出按章节生成原生目录域

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/word-layout.js`
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: Write the failing test**

- 在 `word-layout.test.js` 增加章节级 XML case：
  - 输入包含 `目录` 章节
  - 输出正文只保留目录标题和 TOC field，不再写入静态目录行

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: FAIL，目录章节仍是文本行。

**Step 3: Write minimal implementation**

- `buildSimpleDocxBuffer` 支持 `chapters`
- `buildChapterParagraphXmlRows` 识别 `TOC` 章节并输出 field XML
- 主生成链路 simple fallback 改传 `chapters`

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: PASS

### Task 3: 模板导出支持最小原生 TOC 注入

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/word-layout.js`

**Step 1: Write the failing test**

- 如现有测试足以覆盖 helper 行为，则不额外扩大型模板测试；只补最小 marker 替换断言

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: FAIL，marker 不会被替换为 field。

**Step 3: Write minimal implementation**

- 模板存在 `{{TOC_CONTENT}}` 时，渲染阶段用内部 marker 替代
- 渲染后将 marker 段落替换为 TOC field
- 最后统一注入 settings updateFields

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: PASS

### Task 4: 完成回归和文档同步

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Run focused verification**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: PASS

**Step 2: Run syntax and smoke**

Run: `node --check tender/backend/src/word-layout.js`

Run: `node --check tender/backend/src/index.js`

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

Expected: PASS

**Step 3: Update docs**

- backlog 标记 3.8 的最新能力边界
- `memory/2026-03-09.md` 追加当日实现记录与验证结果
