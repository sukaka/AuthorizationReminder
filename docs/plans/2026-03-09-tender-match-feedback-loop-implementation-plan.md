# Tender Match Feedback Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 parse workspace 资产推荐补上反馈闭环，让人工确认/替换/忽略结果参与下一次推荐排序。

**Architecture:** 保持现有 `semantic-retrieval` 纯函数中心不变，在 `index.js` 中聚合历史反馈并作为先验输入；bulk 保存时把反馈摘要写回 `payload_json`，推荐时把反馈得分和摘要再写回返回 payload。

**Tech Stack:** Node.js, Express, MySQL, Vitest

---

### Task 1: 锁定反馈排序行为

**Files:**
- Modify: `tender/backend/tests/semantic-retrieval.test.js`
- Modify: `tender/backend/src/semantic-retrieval.js`

**Step 1: Write the failing test**

新增用例：

- 正向反馈候选在相近语义分下应高于无反馈候选
- 负向反馈候选应低于正向反馈候选

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js`

Expected: 新用例失败，因为当前排序没有反馈先验。

**Step 3: Write minimal implementation**

在 `rankSemanticAssetRecommendations` 中接收 `feedbackIndex`，加入 `feedback_score` 和 `feedback_summary`。

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js`

Expected: 新老用例全部通过。

### Task 2: 聚合历史反馈并接入推荐接口

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing test**

新增 smoke/接口级断言：

- 保存 `IGNORED` 或 `CONFIRMED` 后，返回 match payload 含反馈摘要
- 重新推荐后，推荐 match payload 含 `feedback_score` 与 `feedback_summary`

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js -t 'parse match feedback loop'`

Expected: 失败，因为接口还未写入反馈摘要。

**Step 3: Write minimal implementation**

- 新增反馈聚合 helper
- `recommend` 调用排序时传入反馈索引
- `bulk` 保存时合并原 payload 并补充反馈元数据

**Step 4: Run test to verify it passes**

Run: 同上

Expected: 用例通过。

### Task 3: 回归与文档

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Run focused verification**

Run: `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js`

Expected: PASS

**Step 2: Run integration verification**

Run: `cd tender/backend && ADMIN_PASSWORD='***' ADMIN_LOGIN='admin' AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5187' npx vitest run tests/smoke.e2e.test.js`

Expected: PASS

**Step 3: Update docs**

- backlog 更新 `3.3` 已完成项，补充“反馈闭环”
- daily memory 记录实现、验证、剩余项

**Step 4: Commit**

```bash
git add tender/backend/src/semantic-retrieval.js tender/backend/src/index.js tender/backend/tests/semantic-retrieval.test.js tender/backend/tests/smoke.e2e.test.js docs/requirements/tender-gap-backlog.md memory/2026-03-09.md docs/plans/2026-03-09-tender-match-feedback-loop-design.md docs/plans/2026-03-09-tender-match-feedback-loop-implementation-plan.md
git commit -m "feat: close parse match feedback loop"
```
