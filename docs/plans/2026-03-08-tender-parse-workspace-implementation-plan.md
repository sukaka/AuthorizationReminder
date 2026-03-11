# Tender Parse Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a project-scoped parse workspace that supports multi-file upload, ZIP recursive extraction, Excel sheet selection, clarification-priority merge, clause classification, and asset matching confirmation.

**Architecture:** Introduce dedicated parse-workspace tables and APIs instead of reusing `tender_bid_generate_jobs`. Keep extraction logic modular in the backend and build a dedicated project parse panel in the frontend, separate from the current generate wizard. Use TDD for parser helpers, merge rules, APIs, and front-end state helpers.

**Tech Stack:** Express, MySQL, multer, LibreOffice conversion, React 18, Vite, Node built-in tests, Vitest

---

### Task 1: Add parse workspace schema and helper tests

**Files:**
- Modify: `tender/backend/src/db.js`
- Create: `tender/backend/src/parse-workspace.js`
- Create: `tender/backend/tests/parse-workspace.test.js`

**Step 1: Write the failing test**

Cover:

- file role normalization
- ZIP descendant filtering
- merge priority with clarification override
- Excel selected-sheet filtering

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js`

Expected: fail because helper module or functions do not exist

**Step 3: Write minimal implementation**

Implement only the helpers required by the tests.

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js`

Expected: pass

### Task 2: Add database schema for parse workspace

**Files:**
- Modify: `tender/backend/src/db.js`
- Test: `tender/backend/tests/parse-workspace.test.js`

**Step 1: Add schema**

Create:

- `tender_bid_parse_jobs`
- `tender_bid_parse_files`
- `tender_bid_parse_clauses`
- `tender_bid_parse_tables`
- `tender_bid_parse_matches`

**Step 2: Add compatibility columns and indexes**

Ensure lookup by `bid_id`, `parse_job_id`, status, and source file is efficient.

**Step 3: Run tests**

Run targeted tests first.

### Task 3: Add backend file ingestion endpoints

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/parse-workspace.js`
- Create: `tender/backend/tests/parse-workspace-api.test.js`

**Step 1: Write the failing API tests**

Cover:

- upload main file
- upload ZIP and create descendant records
- upload Excel and return sheet manifest
- delete parse file

**Step 2: Run API test to verify failure**

Run: `cd tender/backend && npx vitest run tests/parse-workspace-api.test.js`

Expected: 404 or assertion failures

**Step 3: Implement ingestion APIs**

Add:

- `GET /api/tender/bids/:id/parse/workspace`
- `POST /api/tender/bids/:id/parse/files`
- `DELETE /api/tender/bids/:id/parse/files/:fileId`
- `POST /api/tender/bids/:id/parse/files/:fileId/sheets/select`

**Step 4: Re-run API tests**

Expected: pass

### Task 4: Add parse execution pipeline

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/parse-workspace.js`
- Test: `tender/backend/tests/parse-workspace-api.test.js`

**Step 1: Write failing tests for parse execution**

Cover:

- start full parse from uploaded files
- clarification overrides main fields
- selected sheets only
- clause/table rows written

**Step 2: Run tests to verify failure**

Run targeted API tests.

**Step 3: Implement parse start and detail APIs**

Add:

- `POST /api/tender/bids/:id/parse/start`
- `GET /api/tender/bids/:id/parse/jobs/:jobId`

**Step 4: Re-run tests**

Expected: pass

### Task 5: Add clause classification and match confirmation APIs

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/parse-workspace.js`
- Test: `tender/backend/tests/parse-workspace-api.test.js`

**Step 1: Write failing tests**

Cover:

- bulk clause updates
- generate recommended matches
- confirm/replace/ignore matches

**Step 2: Run tests to verify failure**

Run targeted API tests.

**Step 3: Implement review APIs**

Add:

- `PUT /api/tender/bids/:id/parse/clauses/bulk`
- `POST /api/tender/bids/:id/parse/matches/recommend`
- `PUT /api/tender/bids/:id/parse/matches/bulk`

**Step 4: Re-run tests**

Expected: pass

### Task 6: Build frontend parse workspace state helpers

**Files:**
- Create: `tender/frontend/src/parse-workspace.js`
- Create: `tender/frontend/src/parse-workspace.test.js`

**Step 1: Write failing test**

Cover:

- file tree grouping
- ZIP child flattening
- selected sheet draft state
- clause and match bulk payload shaping

**Step 2: Run test to verify failure**

Run: `node --test tender/frontend/src/parse-workspace.test.js`

Expected: fail because helper module does not exist

**Step 3: Write minimal implementation**

Only implement the helper functions required by the tests.

**Step 4: Run test to verify pass**

Run: `node --test tender/frontend/src/parse-workspace.test.js`

Expected: pass

### Task 7: Build frontend project parse workspace UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`
- Modify: `tender/frontend/src/bid-workflow.js` if needed for tab integration
- Create: `tender/frontend/src/parse-workspace.js`

**Step 1: Add selected-project parse workspace state**

Load and manage:

- parse files
- selected file details
- sheet selection
- parse jobs
- clauses
- tables
- matches

**Step 2: Add upload and parse panel**

Support:

- upload by role
- ZIP descendant display
- Excel sheet selection
- parse action buttons

**Step 3: Add clause classification panel**

Editable grid:

- clause type
- mandatory
- scoring
- score value
- response mode

**Step 4: Add asset matching panel**

Support:

- recommend matches
- confirm
- replace
- ignore

**Step 5: Build responsive layout**

Preserve usability on desktop and mobile widths.

### Task 8: Verification and backlog update

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Run backend targeted tests**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/parse-workspace-api.test.js`

**Step 2: Run frontend targeted tests**

Run: `node --test tender/frontend/src/parse-workspace.test.js tender/frontend/src/bid-workflow.test.js`

**Step 3: Run frontend build**

Run: `npm --prefix tender/frontend run build`

**Step 4: Run a focused backend regression**

Run existing smoke or targeted tender tests that cover bid management and generate flow.

**Step 5: Update docs**

If the implementation is complete, update `GAP-0022` status and append the outcome to today’s memory file.
