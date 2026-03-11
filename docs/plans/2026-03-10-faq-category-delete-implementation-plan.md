# FAQ Category Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add single-delete and batch-delete support to FAQ category management with unified backend validation for linked FAQ articles and child categories.

**Architecture:** Keep deletion rules on the backend. Extract one reusable category deletion validator, reuse it in the existing single-delete endpoint, and add a new batch-delete endpoint that supports partial success. Extend the React category management table with row selection, row delete, and batch delete actions.

**Tech Stack:** Node.js, Express, MySQL, React, Vite, Vitest

---

### Task 1: Write failing backend smoke coverage for category deletion

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing test**

Add smoke steps that:
- create a parent category, child category, linked category, and free category
- create one FAQ article bound to the linked category
- assert single delete on linked category returns `409`
- assert single delete on parent category returns `409`
- assert batch delete returns one success and failures for blocked categories

**Step 2: Run test to verify it fails**

Run: `cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/smoke.e2e.test.js`

Expected: FAIL because batch delete endpoint or child-category blocking is not implemented.

**Step 3: Keep the failing assertions minimal**

Do not add frontend expectations here. This test only proves backend contract.

**Step 4: Re-run until failure is the expected one**

Expected failure should point at the missing delete rule or missing batch endpoint.

### Task 2: Implement backend category delete rules and batch delete endpoint

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/src/index.js`

**Step 1: Extract reusable delete validation**

Add a helper that loads the category row and checks:
- category exists
- no active FAQ article references it
- no child category points to it

**Step 2: Reuse helper in single delete**

Update `DELETE /api/faq/categories/:id` to call the shared helper before deleting.

**Step 3: Add batch delete endpoint**

Create `POST /api/faq/categories/batch-delete` that:
- validates `ids`
- de-duplicates valid ids
- iterates ids in order
- deletes what can be deleted
- returns `success_count`, `failure_count`, `deleted_ids`, and `failures`

**Step 4: Keep audit logging consistent**

For each successful deletion, write the same category delete log entry pattern used by single delete.

**Step 5: Run backend smoke test**

Run: `cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/smoke.e2e.test.js`

Expected: PASS

### Task 3: Add frontend single delete and batch delete interactions

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.jsx`
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.css`

**Step 1: Extend category page state**

Add selected category id state and helpers for:
- row checkbox toggle
- select all toggle
- clearing selection after refresh/delete

**Step 2: Add row delete action**

Render a `删除` action beside `编辑`, confirm before delete, call the single delete API, refresh category list, and clear stale selections.

**Step 3: Add batch delete action**

Render a batch action bar with selected count and `批量删除` button, confirm before submit, call the batch delete API, refresh the list, and show concise success/failure messages.

**Step 4: Add minimal styling**

Update layout for:
- checkbox column
- batch action bar
- row action spacing

**Step 5: Build frontend**

Run: `cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build`

Expected: PASS

### Task 4: Final verification and memory update

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/memory/2026-03-10.md`

**Step 1: Run focused verification**

Run:
- `cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/smoke.e2e.test.js`
- `cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build`

**Step 2: Inspect changed files**

Run: `git diff -- docs/plans/2026-03-10-faq-category-delete-design.md docs/plans/2026-03-10-faq-category-delete-implementation-plan.md faq/backend/src/index.js faq/backend/tests/smoke.e2e.test.js faq/frontend/src/App.jsx faq/frontend/src/App.css memory/2026-03-10.md`

**Step 3: Update daily memory**

Append today’s FAQ category delete work summary into the existing daily memory file without changing unrelated notes.
