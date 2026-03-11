# Tender Evaluation KPI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repeatable evaluation dataset and KPI pipeline so the tender system can run project-based evaluations and compare the latest result against a saved baseline.

**Architecture:** Introduce one pure backend helper module to normalize KPI metrics from current bid runtime data, then wire it into new evaluation dataset and run tables plus bid- and center-scoped APIs. Expose a lightweight evaluation center in the existing frontend shell with overview, dataset management, run history, and run detail.

**Tech Stack:** Node.js, Express, MySQL, React 18, Vite, plain CSS, Vitest, Node built-in test runner

---

### Task 1: Add failing backend tests for KPI helper logic

**Files:**
- Create: `tender/backend/tests/evaluation-kpi.test.js`
- Create: `tender/backend/src/evaluation-kpi.js`

**Step 1: Write the failing tests**

Cover:

- clause recognition KPI normalization
- score coverage KPI normalization
- material matching KPI normalization
- risk recall KPI normalization
- export completeness KPI normalization
- run summary aggregation and baseline delta calculation

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/evaluation-kpi.test.js`

Expected: fail because the helper module does not exist yet

**Step 3: Write minimal implementation**

Add pure helpers only:

- per-eval-type KPI calculators
- shared ratio helpers
- run summary aggregator
- baseline delta builder

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/evaluation-kpi.test.js`

Expected: pass

### Task 2: Add evaluation schema and backend APIs

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing integration tests**

Cover:

- `GET /api/tender/evaluations/overview`
- `GET /api/tender/evaluations/datasets`
- `POST /api/tender/evaluations/datasets`
- `GET /api/tender/evaluations/runs`
- `GET /api/tender/evaluations/runs/:id`
- `POST /api/tender/evaluations/runs`

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/smoke.e2e.test.js -t 'evaluation'`

Expected: fail because the schema and APIs do not exist yet

**Step 3: Write minimal implementation**

Add:

- `tender_eval_datasets`
- `tender_eval_runs`
- `tender_eval_run_items`

Implement:

- dataset sanitizer and expected-payload normalization
- bid-to-dataset creation from current runtime data
- synchronous run execution from selected datasets
- run summary persistence

**Step 4: Run tests to verify it passes**

Run: `cd tender/backend && npx vitest run tests/evaluation-kpi.test.js tests/smoke.e2e.test.js -t 'evaluation'`

Expected: pass

### Task 3: Add frontend normalization helpers for evaluation center

**Files:**
- Create: `tender/frontend/src/evaluation-kpi.js`
- Create: `tender/frontend/src/evaluation-kpi.test.js`

**Step 1: Write the failing tests**

Cover:

- overview payload normalization
- dataset form payload cleanup
- run detail normalization
- KPI summary card derivation

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/evaluation-kpi.test.js`

Expected: fail because helper module does not exist yet

**Step 3: Write minimal implementation**

Add pure helpers only.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/evaluation-kpi.test.js`

Expected: pass

### Task 4: Expose the evaluation center in the frontend shell

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Add app tab and state**

Load:

- overview
- datasets
- runs
- selected run detail

**Step 2: Add dataset creation and run trigger actions**

Support:

- choose project
- set eval type
- save expected payload
- start run

**Step 3: Keep UI scope tight**

Do not build a full analytics suite. Keep to:

- KPI summary cards
- dataset table
- recent run table
- run detail panel

### Task 5: Update governance, docs, and status

**Files:**
- Modify: `tender/backend/src/governance.js`
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Extend permission catalog**

Add menu/page/button permissions for the evaluation center.

**Step 2: Update backlog**

If scope matches acceptance:

- mark `GAP-0019` as `DONE`
- update module snapshot 3.3 not-done wording if needed

**Step 3: Update memory**

Record:

- dataset schema
- KPI types
- baseline run behavior
- current limitations and next likely gaps

### Task 6: Verify regression

**Files:**
- No code changes required in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/evaluation-kpi.test.js tests/governance.test.js`

**Step 2: Run frontend tests**

Run:

- `node --test tender/frontend/src/evaluation-kpi.test.js tender/frontend/src/ops-center.test.js`

**Step 3: Run syntax and build checks**

Run:

- `node --check tender/backend/src/evaluation-kpi.js`
- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

**Step 4: Run integrated tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: evaluation center additions do not break the tender main flow and the new APIs are covered by regression.
