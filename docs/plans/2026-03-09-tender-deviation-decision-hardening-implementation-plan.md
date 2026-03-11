# Tender Deviation Decision Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade deviation and response rows so each row carries a stable parameter key, satisfy decision basis, evidence source, and risk grade through generation, persistence, and editing workflows.

**Architecture:** Extend the backend deviation-response helper first, then update backend/frontend draft workspace normalization so the stronger row contract survives save/load cycles. Finally expose the new fields in the existing artifact editor UI without changing route paths.

**Tech Stack:** Node.js, Express, React 18, plain CSS, Vitest, Node built-in test runner

---

### Task 1: Lock the stronger row contract with failing backend tests

**Files:**
- Modify: `tender/backend/tests/deviation-response.test.js`
- Modify: `tender/backend/src/deviation-response.js`

**Step 1: Write the failing tests**

Cover:

- product technical rows include `parameter_key`
- rows include `satisfy_basis`
- rows expose `risk_grade`
- response table rows preserve the stronger fields

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/deviation-response.test.js`

Expected: fail because the stronger fields are not implemented yet.

**Step 3: Write minimal implementation**

Add:

- deterministic `parameter_key` builder
- `satisfy_basis` builder
- `risk_grade` aliasing
- response row normalization to `response_text`

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/deviation-response.test.js`

Expected: pass.

### Task 2: Preserve the stronger fields through draft workspace helpers

**Files:**
- Modify: `tender/backend/src/draft-workspace.js`
- Modify: `tender/backend/tests/draft-workspace.test.js`
- Modify: `tender/frontend/src/draft-workspace.js`
- Modify: `tender/frontend/src/draft-workspace.test.js`

**Step 1: Add failing helper tests**

Cover:

- generated artifact rows preserve `parameter_key`
- save payload preserves `satisfy_basis`
- response rows keep `risk_grade`

**Step 2: Run tests to verify they fail**

Run:

- `cd tender/backend && npx vitest run tests/draft-workspace.test.js`
- `node --test tender/frontend/src/draft-workspace.test.js`

Expected: fail because normalization drops the new fields.

**Step 3: Write minimal implementation**

Update backend and frontend helper modules to keep the fields across load/save.

**Step 4: Run tests to verify they pass**

Run the same commands again.

### Task 3: Expose the stronger fields in the draft workspace UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Extend artifact editor rows**

Show:

- parameter key
- satisfy basis
- evidence source
- risk grade

Keep existing edit interactions and save action.

### Task 4: Update status tracking

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Mark backlog**

If the stronger row contract is live and verified:

- mark `GAP-0009` as `DONE`

**Step 2: Update memory**

Record:

- new row fields
- helper modules touched
- verification commands

### Task 5: Verify regression

**Files:**
- No code changes in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/deviation-response.test.js tests/draft-workspace.test.js`

**Step 2: Run frontend tests**

Run:

- `node --test tender/frontend/src/draft-workspace.test.js`

**Step 3: Run build and integrated regression**

Run:

- `npm --prefix tender/frontend run build`
- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: stronger artifact row fields do not break generation, draft workspace, or smoke regression.
