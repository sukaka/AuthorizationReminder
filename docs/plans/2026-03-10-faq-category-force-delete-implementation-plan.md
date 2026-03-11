# FAQ Category Force Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin-only force-delete operation for FAQ categories that recursively deletes subcategories and moves linked FAQ articles to the recycle bin with `category_id = NULL`.

**Architecture:** Keep ordinary delete behavior unchanged. Extend the existing category deletion helper module with force-delete tree collection and summary helpers, add one new backend endpoint for admin-only force delete, and expose one extra “强制删除” action in the category management UI. Force delete recycles linked FAQ articles and releases active editor sessions before removing categories from leaf to root.

**Tech Stack:** Node.js, Express, MySQL, React, Vite, Vitest

---

### Task 1: Add failing tests for force-delete helpers and smoke behavior

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/tests/category-delete.test.js`
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing helper test**

Add assertions for:
- recursive category id collection order
- force-delete summary structure

**Step 2: Run helper test to verify it fails**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/category-delete.test.js
```

Expected: FAIL because the new helper contract does not exist yet.

**Step 3: Add the failing smoke test**

Add a targeted smoke case that:
- creates parent + child categories
- creates one FAQ under the child category
- calls `POST /api/faq/categories/:id/force-delete`
- expects category deletion and article recycle side effects

**Step 4: Run smoke to verify it fails**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend && AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5186' npm test -- tests/smoke.e2e.test.js -t "force delete"
```

Expected: FAIL because the endpoint does not exist yet.

### Task 2: Implement backend force-delete helpers and endpoint

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/src/category-delete.js`
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/src/index.js`

**Step 1: Extend helper module**

Add pure helpers for:
- recursive category subtree collection
- force-delete result summary

**Step 2: Implement force-delete execution**

In backend route logic:
- load the target category
- collect subtree categories
- query active FAQ articles under these categories
- recycle those FAQ articles and clear `category_id`
- release active editor sessions
- delete categories from deepest child to root

**Step 3: Add admin-only endpoint**

Create:

```http
POST /api/faq/categories/:id/force-delete
```

Return:
- `deleted_category_count`
- `deleted_category_ids`
- `recycled_article_count`
- `recycled_article_ids`

**Step 4: Keep ordinary delete unchanged**

Do not change current behavior for:
- `DELETE /api/faq/categories/:id`
- `POST /api/faq/categories/batch-delete`

**Step 5: Re-run backend tests**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/category-delete.test.js
cd /Users/zhanglei/Documents/codex-new/faq/backend && AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5186' npm test -- tests/smoke.e2e.test.js -t "force delete"
```

Expected: PASS

### Task 3: Add frontend admin-only force-delete action

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.jsx`
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.css`

**Step 1: Add row action**

In category management row actions:
- keep `编辑`
- keep `删除`
- add `强制删除` only for `admin`

**Step 2: Add confirmation flow**

Show a confirm dialog explaining:
- child categories will be deleted
- linked FAQ articles will move to recycle bin
- restored FAQ articles will become uncategorized

**Step 3: Call backend endpoint and refresh**

After success:
- refresh categories
- show summary message using returned counts

**Step 4: Keep non-admin experience unchanged**

`writer` and `editor` must not see the force-delete action.

**Step 5: Build frontend**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build
```

Expected: PASS

### Task 4: Final verification and memory update

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/memory/2026-03-10.md`

**Step 1: Run final focused verification**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/backend && npm test -- tests/category-delete.test.js
cd /Users/zhanglei/Documents/codex-new/faq/backend && AUTH_BASE='http://localhost:5180' API_BASE='http://localhost:5186' npm test -- tests/smoke.e2e.test.js -t "force delete"
cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build
```

**Step 2: Inspect diff**

Run:

```bash
git diff -- docs/plans/2026-03-10-faq-category-force-delete-design.md docs/plans/2026-03-10-faq-category-force-delete-implementation-plan.md faq/backend/src/category-delete.js faq/backend/src/index.js faq/backend/tests/category-delete.test.js faq/backend/tests/smoke.e2e.test.js faq/frontend/src/App.jsx faq/frontend/src/App.css memory/2026-03-10.md
```

**Step 3: Update memory**

Append the force-delete design, implementation, verification, and any runtime rebuild notes into the daily memory file.
