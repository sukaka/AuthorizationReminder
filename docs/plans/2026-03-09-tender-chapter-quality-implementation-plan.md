# Tender Chapter Quality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 tender 初稿生成链路补章节级质量评分，并在接口与前端详情中展示。

**Architecture:** 在 `draft-schema` 层生成可解释的章节质量摘要；create 阶段把摘要写入 `analysis_summary_json.stage_outputs` 并透出到 create/get detail 接口；前端复用 generate detail 数据渲染质量卡。

**Tech Stack:** Node.js, Express, Vitest, React, Vite

---

### Task 1: 写章节质量评分失败测试

**Files:**
- Modify: `tender/backend/tests/draft-schema.test.js`

**Step 1: 写 failing test**
- 新增用例覆盖：
  - required + AI 命中章节应高分
  - required + fallback 章节应低于 AI
  - extra AI 章节应保留独立评分
  - 过短章节应进入 warning/high risk

**Step 2: 跑定向测试确认失败**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && npx vitest run tests/draft-schema.test.js
```

### Task 2: 实现 `draft-schema` 质量评分 helper

**Files:**
- Modify: `tender/backend/src/draft-schema.js`
- Test: `tender/backend/tests/draft-schema.test.js`

**Step 1: 最小实现**
- 新增 `buildDraftChapterQualitySummary`
- 输入 `bidCategory / chapters / validation`
- 返回总分、等级、逐章分数、summary lines

**Step 2: 再跑测试转绿**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && npx vitest run tests/draft-schema.test.js
```

### Task 3: 写接口 smoke 失败断言

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: 新增断言**
- 解析工作台生成初稿
- 传统 analyze -> create 初稿
- 都应返回 `chapter_quality_summary`

**Step 2: 跑目标 smoke，确认先失败**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && ADMIN_PASSWORD='Ss544364@' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should generate draft from latest parse workspace result for the current bid'
```

### Task 4: 实现后端返回与持久化

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/draft-schema.js`

**Step 1: create 阶段生成质量摘要**
- 在 schema normalize + route 注入后计算章节质量摘要

**Step 2: 写入 `analysis_summary_json.stage_outputs.chapter_quality_summary`**

**Step 3: create 接口、job detail 接口返回该字段**

**Step 4: 跑后端测试**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && npx vitest run tests/draft-schema.test.js
```

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && ADMIN_PASSWORD='Ss544364@' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'should generate draft from latest parse workspace result for the current bid'
```

### Task 5: 前端展示章节质量卡

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: 从 generate detail/create result 读取 `chapter_quality_summary`**

**Step 2: 在生成详情页增加总分、等级、重点预警、逐章列表**

**Step 3: 跑前端构建**

Run:

```bash
npm --prefix /Users/zhanglei/Documents/codex-new/tender/frontend run build
```

### Task 6: 最终验证

**Files:**
- Modify: `memory/2026-03-09.md`

**Step 1: 跑完整 smoke**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/tender/backend && ADMIN_PASSWORD='Ss544364@' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js
```

**Step 2: 更新 memory，记录章节质量评分已接通与验证结果**
