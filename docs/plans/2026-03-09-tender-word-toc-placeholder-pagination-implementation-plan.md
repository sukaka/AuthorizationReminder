# Tender Word TOC Placeholder Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让显式 `{{TOC_CONTENT}}` 模板在没有文字“目录”标题时，仍能正确命中分页和节级页码边界。

**Architecture:** 在 `word-layout.js` 增加 TOC field 段落识别函数，并让分页 helper、section helper 在 `目录` 标题缺失时回退到 TOC field 边界。`index.js` 无需新增业务字段，只继续复用原有导出顺序。

**Tech Stack:** Node.js, PizZip, Vitest, DOCX XML

---

### Task 1: 写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`

**Step 1: 新增 TOC field 边界测试**

- 构造 `封面 -> TOC field -> 第一章` 文档
- 断言 page break helper 会在 TOC field 前生效
- 断言 section helper 仍能生成三节模型

**Step 2: 运行测试确认失败**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

Expected: TOC field 场景的分页或节样式断言失败。

### Task 2: 实现 TOC field 边界识别

**Files:**
- Modify: `tender/backend/src/word-layout.js`

**Step 1: 增加 TOC field 段落识别 helper**

- 通过 `DOCX_NATIVE_TOC_INSTRUCTION` 判断段落是否为 TOC field

**Step 2: 扩展分页 helper**

- `headings` 包含 `目录` 时，TOC field 段落也视为命中

**Step 3: 扩展 section helper**

- `restartHeading` 未命中时，回退到 TOC field 段落

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

- backlog 收缩“更复杂分页控制”的剩余范围
- memory 记录本轮实现与验证
