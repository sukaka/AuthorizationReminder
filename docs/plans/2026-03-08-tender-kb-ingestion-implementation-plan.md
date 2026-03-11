# Tender KB Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first project-scoped knowledge-base ingestion pipeline so an existing bid project can be normalized into reusable `kb_*` records with unified tags and chunk outputs.

**Architecture:** Add one pure backend helper module to normalize project, clause, score-item, section, table, and attachment data into KB records and chunks. Wire it into new bid-scoped workspace and ingest APIs, then expose one ingestion card inside the existing project lifecycle page with recent job history and editable overrides.

**Tech Stack:** Node.js, Express, MySQL, React 18, Vite, plain CSS, Vitest, Node built-in test runner

---

### Task 1: Add failing backend tests for KB ingest helpers

**Files:**
- Create: `tender/backend/tests/kb-ingest.test.js`
- Create: `tender/backend/src/kb-ingest.js`

**Step 1: Write the failing tests**

Cover:

- project draft normalization from bid + parse summary + overrides
- scoring clause to `kb_score_items`
- unified tag normalization
- standardized chunk generation for clause / section / table / attachment sources

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/kb-ingest.test.js`

Expected: fail because the helper module does not exist yet

**Step 3: Write minimal implementation**

Add only pure helpers:

- project normalization
- score-item derivation
- tag normalization
- chunk builders

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/kb-ingest.test.js`

Expected: pass

### Task 2: Add bid-scoped KB workspace and ingest APIs

**Files:**
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing tests**

Cover:

- `GET /api/tender/bids/:id/kb/workspace`
- `POST /api/tender/bids/:id/kb/ingest`
- ingest requires parsed project context
- ingest links `source_kb_project_id`
- ingest creates KB child rows and chunk counts

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/smoke.e2e.test.js`

Expected: fail because the APIs do not exist yet

**Step 3: Write minimal implementation**

Keep schema unchanged and reuse:

- `kb_projects`
- `kb_tender_clauses`
- `kb_score_items`
- `kb_section_assets`
- `kb_asset_chunks`
- `kb_ingest_jobs`

**Step 4: Run tests to verify it passes**

Run: `cd tender/backend && npx vitest run tests/kb-ingest.test.js tests/smoke.e2e.test.js`

Expected: pass

### Task 3: Add frontend normalization helpers for KB ingest workspace

**Files:**
- Create: `tender/frontend/src/kb-ingest.js`
- Create: `tender/frontend/src/kb-ingest.test.js`

**Step 1: Write the failing tests**

Cover:

- workspace payload normalization
- count summary normalization
- ingest form payload cleanup
- tag text to array conversion

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/kb-ingest.test.js`

Expected: fail because helper module does not exist yet

**Step 3: Write minimal implementation**

Add pure helpers only.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/kb-ingest.test.js`

Expected: pass

### Task 4: Expose KB ingest card in project lifecycle page

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Add workspace state and fetch logic**

Load:

- linked KB project
- ingest counts
- recent jobs
- ingest defaults

**Step 2: Add ingest action**

Support:

- editable metadata
- one-click refresh
- one-click ingest

**Step 3: Keep current information architecture**

Do not add a new top-level tab. Keep the feature under the selected project detail panel.

### Task 5: Update docs and status

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Update backlog**

If scope matches acceptance:

- mark `GAP-0013` as `DONE`
- mark `GAP-0015` as `DONE`

**Step 2: Update memory**

Record:

- project-scoped ingest route
- standardized tags / chunk types
- current limitations and next dependencies

### Task 6: Verify regression

**Files:**
- No code changes required in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/kb-ingest.test.js tests/smoke.e2e.test.js`

**Step 2: Run frontend tests**

Run:

- `node --test tender/frontend/src/kb-ingest.test.js`

**Step 3: Run syntax and build checks**

Run:

- `node --check tender/backend/src/kb-ingest.js`
- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

**Step 4: Run integrated tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: the new ingestion loop does not break the tender main flow and the project-level workspace remains usable.
