# Tender Word 前置页码样式 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 tender Word 导出形成“封面无页码、目录 lowerRoman、正文从 1 开始”的最小前置页码样式。

**Architecture:** 扩展现有 section 页码 helper 为三节模型；基础导出和无正文占位符模板导出传入正文起始标题，复杂正文占位符模板继续保守。

**Tech Stack:** Node.js, PizZip, OpenXML(docx), Vitest

---

### Task 1: 先写失败测试

**Files:**
- Modify: `tender/backend/tests/word-layout.test.js`
- Modify: `tender/backend/src/word-layout.js`

**Step 1: Write the failing test**

- 断言文档含 3 个 `sectPr`
- 断言目录节含 `w:pgNumType w:start="1" w:fmt="lowerRoman"`
- 断言正文最终节含 `w:pgNumType w:start="1"`
- 断言重复执行不重复插入

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/word-layout.test.js`

### Task 2: 实现 helper 并接线

**Files:**
- Modify: `tender/backend/src/word-layout.js`
- Modify: `tender/backend/src/index.js`

**Step 1: 扩展 helper**

- 增加 `bodyStartHeading`
- TOC 节使用 `lowerRoman`
- 正文节重置为阿拉伯数字 1

**Step 2: 接入导出链路**

- 基础导出从 `pageBreakTitles` 派生正文起始标题
- 无正文占位符模板导出复用同一逻辑

### Task 3: 回归和文档同步

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Verification:**

- `cd tender/backend && npx vitest run tests/word-layout.test.js`
- `node --check tender/backend/src/word-layout.js`
- `node --check tender/backend/src/index.js`
- `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should upload sample then analyze and create draft from generate job'`
- `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`
