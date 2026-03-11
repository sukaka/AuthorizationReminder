# Tender Word Body Heading Heuristic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让正文占位符在未命中 `pageBreakTitles` 时，也能通过保守章节样式启发式完成拆段和标题提升。

**Architecture:** 在 `word-layout.js` 为 logical paragraph helper 增加章节标题启发式识别，只覆盖 `第X章/附录X/附件X/目录` 等安全模式。`index.js` 不需要新增字段，继续复用现有 helper 接口。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增启发式拆段测试**

- 构造不在 `splitHints` 中，但逻辑行包含 `第X章` / `附录X`
- 断言 helper 仍会拆段
- 断言启发式标题被提升为 `Heading1`

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: 启发式拆段测试失败。

### Task 2: 实现启发式识别

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 增加章节样式启发式函数**

- 识别 `目录`
- 识别 `第X章`
- 识别 `附录X`
- 识别 `附件X`

**Step 2: 接入 logical paragraph helper**

- `splitHints` 未命中时，允许启发式标题触发拆段
- 命中启发式的行同样提升为 `Heading1`

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

- backlog 缩小“未命中章节标题的正文占位符段落”范围
- memory 记录本轮增强与验证
