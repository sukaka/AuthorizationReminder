# Tender Project Lifecycle Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the tender project lifecycle management page by adding a selected-project detail panel with basic info editing, lifecycle progress, member assignment, and review history.

**Architecture:** Keep the implementation inside the existing `bids` page flow. Introduce a small pure helper module for lifecycle and member logic, test it with `node:test`, and then wire the UI into `App.jsx` with targeted CSS additions.

**Tech Stack:** React 18, Vite, plain CSS, Node built-in test runner, existing tender backend APIs

---

### Task 1: Add lifecycle helper tests

**Files:**
- Create: `tender/frontend/src/bid-workflow.test.js`
- Create: `tender/frontend/src/bid-workflow.js`

**Step 1: Write the failing test**

Cover:

- status to lifecycle step mapping
- member row normalization
- member row validation
- review stage / review status labels

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/bid-workflow.test.js`

Expected: fail because helper module does not exist yet

**Step 3: Write minimal implementation**

Implement only the helper functions required by the tests.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/bid-workflow.test.js`

Expected: pass

### Task 2: Add selected-project detail state and loaders

**Files:**
- Modify: `tender/frontend/src/App.jsx`

**Step 1: Load selected project detail**

Add dedicated state for:

- selected bid detail
- member draft rows
- review rows
- loading and saving flags

**Step 2: Add fetch helpers**

Use existing APIs:

- `GET /api/tender/bids/:id`
- `GET /api/tender/bids/:id/members`
- `GET /api/tender/bids/:id/reviews?limit=30`

**Step 3: Wire selection refresh**

When selecting a project or after save actions, refresh list + detail consistently.

### Task 3: Add basic info editor and member assignment UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Build basic info form**

Fields:

- title
- customer_name
- project_name
- summary

**Step 2: Build member assignment table**

Support:

- list current members
- add row
- edit username / role / title
- remove non-owner row
- save all rows

**Step 3: Save actions**

Use:

- `PUT /api/tender/bids/:id`
- `PUT /api/tender/bids/:id/members`

### Task 4: Add lifecycle progress and review history blocks

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Render lifecycle progress**

Use helper-derived rows to show complete/current/pending steps.

**Step 2: Render review history**

Show round, stage, status, people, comment, and timestamps.

**Step 3: Add empty/loading/error states**

Keep the detail panel usable even if one sub-request fails.

### Task 5: Verify

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`

**Step 1: Run helper tests**

Run: `node --test tender/frontend/src/bid-workflow.test.js`

**Step 2: Run frontend build**

Run: `npm --prefix tender/frontend run build`

**Step 3: Update backlog**

If implementation matches the accepted scope, update `GAP-0021` from `IN_PROGRESS` to `DONE`.
