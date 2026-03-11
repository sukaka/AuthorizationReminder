# Tender Draft Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete `GAP-0023` by adding a project-level draft workspace with structured section editing, deviation/response table editing, score coverage analysis, and autosave rollback.

**Architecture:** Add a thin project-scoped workspace layer on top of existing generate/check/optimize/runtime tables. Persist new editable table rows in one generic artifact table, expose one aggregate read API plus two save APIs, and wire the selected-project UI to those endpoints.

**Tech Stack:** Node.js, Express, MySQL, React 18, Vite, plain CSS, Vitest, Node built-in test runner

---

### Task 1: Add backend failing tests for draft workspace APIs

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`
- Create: `tender/backend/tests/draft-workspace.test.js`

**Step 1: Write the failing tests**

Cover:

- workspace read falls back to latest generate artifacts
- saving structured sections persists editable rows
- saving draft artifacts persists deviation / response rows

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/draft-workspace.test.js`

Expected: fail because the new APIs and table do not exist yet

**Step 3: Write minimal implementation**

Add only the schema and handlers required by the tests.

**Step 4: Run tests to verify they pass**

Run: `cd tender/backend && npx vitest run tests/draft-workspace.test.js`

Expected: pass

### Task 2: Implement backend schema and draft workspace loaders

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`

**Step 1: Add table**

Create `tender_draft_artifact_rows`.

**Step 2: Add normalization helpers**

Implement helpers to:

- load persisted artifact rows
- fallback to latest generate job artifacts
- normalize structured section rows and artifact rows

**Step 3: Add APIs**

Implement:

- `GET /api/tender/bids/:id/draft/workspace`
- `PUT /api/tender/bids/:id/draft/sections`
- `PUT /api/tender/bids/:id/draft/artifacts`

### Task 3: Add frontend helper failing tests

**Files:**
- Create: `tender/frontend/src/draft-workspace.js`
- Create: `tender/frontend/src/draft-workspace.test.js`

**Step 1: Write the failing test**

Cover:

- section row normalization
- artifact group normalization
- check summary aggregation
- optimization summary derivation

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/draft-workspace.test.js`

Expected: fail because helper module does not exist yet

**Step 3: Write minimal implementation**

Implement only the helper functions required by the tests.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/draft-workspace.test.js`

Expected: pass

### Task 4: Add selected-project draft workspace state and actions

**Files:**
- Modify: `tender/frontend/src/App.jsx`

**Step 1: Load draft workspace**

Use:

- `GET /api/tender/bids/:id/draft/workspace`

**Step 2: Save actions**

Use:

- `PUT /api/tender/bids/:id/draft/sections`
- `PUT /api/tender/bids/:id/draft/artifacts`
- existing check / optimize / autosave / rollback APIs

**Step 3: Refresh orchestration**

When draft actions complete, refresh:

- draft workspace
- versions
- selected bid detail when needed

### Task 5: Render draft workspace UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Add section editor block**

Support:

- edit title
- edit paragraph
- inspect ids
- save sections

**Step 2: Add artifact table editor block**

Support:

- technical / business deviation
- technical / business response
- row editing
- save artifacts

**Step 3: Add score coverage and autosave block**

Support:

- view matrix and latest check issues
- run check
- run optimization
- create autosave
- rollback

### Task 6: Verify and update docs

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Run backend tests**

Run: `cd tender/backend && npx vitest run tests/draft-workspace.test.js`

**Step 2: Run frontend tests**

Run: `node --test tender/frontend/src/draft-workspace.test.js tender/frontend/src/parse-workspace.test.js tender/frontend/src/bid-workflow.test.js`

**Step 3: Run fast syntax/build checks**

Run:

- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

**Step 4: Update backlog**

If scope matches acceptance, update `GAP-0023` from `TODO` to `DONE`.
