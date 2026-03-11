# Question Bulk Publish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add batch publish and one-click publish for draft questions in the question list.

**Architecture:** Share one backend question filter builder between list queries and bulk publish operations, then expose a new reviewer-only bulk publish endpoint that can target either selected question IDs or the current filter set. Update the React question list toolbar and row actions to surface publish controls without changing delete behavior.

**Tech Stack:** Node.js, Express, React, Vitest, Docker Compose

---

### Task 1: Add failing tests for question filter query building

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/question-filter-utils.js`
- Create: `/Users/zhanglei/Documents/codex-new/train-exam/backend/tests/question-filter-utils.test.js`

**Step 1: Write the failing test**

Cover:
- empty filters build no `WHERE`
- keyword/status/source/category produce stable clauses
- `all` values are ignored

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/question-filter-utils.test.js`

**Step 3: Write minimal implementation**

Add pure filter normalization and SQL parts builder helpers.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/question-filter-utils.test.js`

### Task 2: Implement backend bulk publish

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/index.js`
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/question-filter-utils.js`

**Step 1: Reuse shared filter builder in question list API**

Replace the inline `WHERE` construction in `GET /api/train-exam/questions`.

**Step 2: Add reviewer-only bulk publish API**

Support:
- `question_ids`
- `filters`

Only draft questions are published. Return counts for published/skipped/failed.

**Step 3: Keep review logs consistent**

Insert review logs for published items and emit one aggregate audit log.

**Step 4: Run focused backend tests**

Run: `npm test -- tests/question-filter-utils.test.js tests/question-category-utils.test.js tests/paper-rule-utils.test.js tests/question-import-utils.test.js`

### Task 3: Update question list UI

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/src/App.jsx`

**Step 1: Add publish loading states**

Track single publish and batch publish progress separately from delete progress.

**Step 2: Add toolbar actions**

Render:
- `发布选中(N)`
- `一键发布当前筛选草稿`

**Step 3: Relax row selection permission**

Allow row selection for reviewers so they can batch publish without delete permission.

**Step 4: Rename row action**

Change single-row `通过` to `发布`.

**Step 5: Run frontend build**

Run: `npm run build`

### Task 4: Rebuild and verify containers

**Files:**
- None

**Step 1: Rebuild images**

Run: `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml build train-exam-api web-train-exam`

**Step 2: Restart services**

Run: `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml up -d train-exam-api web-train-exam`

**Step 3: Verify**

Run:
- `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml ps train-exam-api web-train-exam`
- `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml logs --tail=20 train-exam-api web-train-exam`
