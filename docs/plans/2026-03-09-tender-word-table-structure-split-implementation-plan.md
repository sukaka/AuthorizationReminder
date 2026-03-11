# Tender Word Table Structure Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让正文占位符在表格单元格中拆段时保持 `w:tbl / w:tr / w:tc` 容器结构不丢失。

**Architecture:** 把 `ensureDocxLogicalParagraphsBuffer` 改为基于原始 `contentXml` 的段落原位替换，而不是全局抽取段落后重组 body。这样 plain body 和 table cell 都能共用同一逻辑，且不破坏外层容器。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增表格容器测试**

- 在 `w:tc` 里放一个含 `<w:br/>` 的正文占位符段落
- 断言拆段后 `w:tbl / w:tc` 仍存在
- 断言标题提升为 `Heading1`

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: 表格容器断言失败。

### Task 2: 实现原位替换

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 抽出单段拆分逻辑**

- 输入单个 paragraph XML
- 输出原段或多个新段落 XML

**Step 2: 把 helper 改成 replace 驱动**

- 在 `contentXml` 上按 paragraph regex 替换
- 保留非 paragraph XML 不变

### Task 3: 验证和记录

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: 跑验证**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`
Run: `node --check tender/backend/src/word-layout.js`
Run: `node --check tender/backend/src/index.js`
Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

**Step 2: 更新状态**

- backlog 缩小“表格/文本框等更复杂模板结构”范围
- memory 记录本轮表格结构增强
