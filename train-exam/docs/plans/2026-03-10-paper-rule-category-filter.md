# Random Paper Category Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow each random paper rule to filter questions by one or more question bank categories.

**Architecture:** Store selected category names as JSON on each random paper rule, normalize them on write/read, and apply them as an `IN` filter during random question selection. Reuse the existing question category list in the frontend and present it as a multi-select per rule.

**Tech Stack:** Node.js, Express, MySQL, React, Vitest

---

### Task 1: Add failing tests for rule category normalization

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/train-exam/backend/tests/paper-rule-utils.test.js`
- Create: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/paper-rule-utils.js`

**Step 1: Write the failing test**

Cover:
- empty category input returns `[]`
- single category remains single-item array
- multiple categories are trimmed and deduplicated

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/paper-rule-utils.test.js`

**Step 3: Write minimal implementation**

Add a pure helper for category normalization.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/paper-rule-utils.test.js`

### Task 2: Persist rule categories in backend

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/db.js`
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/index.js`
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/backend/src/paper-rule-utils.js`

**Step 1: Update schema**

Add `question_categories_json` to `te_paper_question_rules` and a migration guard.

**Step 2: Update rule write/read paths**

Persist normalized category arrays when creating or updating papers, and expose them back on paper detail payloads.

**Step 3: Update random selection**

Apply `question_category IN (...)` when the current rule contains selected categories.

**Step 4: Run focused tests**

Run: `npm test -- tests/paper-rule-utils.test.js`

### Task 3: Add category multi-select to paper creation UI

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/train-exam/frontend/src/App.jsx`

**Step 1: Extend paper rule state**

Store `question_categories` on each rule.

**Step 2: Send categories in create payload**

Map selected category names into `rules[].question_categories`.

**Step 3: Render multi-select**

Use the loaded question category rows to render a per-rule `<select multiple>`.

**Step 4: Build frontend**

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
