# Tender Word Nonstandard Heading Heuristic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让正文占位符里常见的 `一、 / （一） / 1.1` 等非标准标题样式也能触发拆段与标题提升。

**Architecture:** 扩展 `looksLikeDocxHeadingLine` 的启发式规则，继续由 `ensureDocxLogicalParagraphsBuffer` 统一复用，不新增业务字段。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增非标准标题样式测试**

- 构造 `一、`、`（一）`、`1.1` 行
- 断言未命中 `splitHints` 时仍会拆段
- 断言标题提升为 `Heading1`

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: 非标准标题样式测试失败。

### Task 2: 实现启发式扩展

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 扩展 heading heuristic**

- 增加 `一、`
- 增加 `（一）`
- 增加 `1. / 1.1 / 1.1.1`

**Step 2: 保守收口**

- 尽量避免误判日期/普通编号

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

- backlog 缩小“非标准章节样式”范围
- memory 记录本轮启发式扩展
