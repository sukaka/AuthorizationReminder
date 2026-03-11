# Tender Risk Checker Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend draft validation so the tender check API detects incomplete signature blocks, deviation/response table conflicts, and contradictions between narrative sections and table artifacts.

**Architecture:** Keep the current checker split. Add pure normalization and conflict helpers in `final-draft-checks.js`, pass persisted artifact rows from the check API, and rely on existing issue persistence plus frontend rendering without changing the response contract.

**Tech Stack:** Node.js, Express, MySQL, Vitest

---

### Task 1: Lock the missing rules with failing unit tests

**Files:**
- Modify: `tender/backend/tests/final-draft-checks.test.js`
- Modify: `tender/backend/src/final-draft-checks.js`

**Step 1: Write the failing tests**

Add tests for:

- partial signature area emits `signature_slot_incomplete`
- deviation and response rows for one requirement emit `artifact_table_conflict`
- narrative section and artifact row contradiction emits `section_artifact_conflict`

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/final-draft-checks.test.js`

Expected: fail because the new issue types are not implemented yet.

**Step 3: Write minimal implementation**

Add:

- artifact row normalization
- requirement key matching
- status polarity detection
- three focused rule evaluators

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/final-draft-checks.test.js`

Expected: pass.

### Task 2: Pass artifact rows into the check API

**Files:**
- Modify: `tender/backend/src/index.js`

**Step 1: Extend current check handler**

Load current version artifact rows through existing helpers and pass them to `runStructuredChecks`.

**Step 2: Keep response shape stable**

Do not change:

- route path
- issue persistence table
- check summary format

**Step 3: Run a focused syntax check**

Run:

- `node --check tender/backend/src/final-draft-checks.js`
- `node --check tender/backend/src/index.js`

Expected: both pass.

### Task 3: Update status tracking

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Mark backlog**

If tests and integrated regression are green:

- mark `GAP-0011` as `DONE`
- update module snapshot 3.7 not-done wording

**Step 2: Update memory**

Record:

- new issue types
- API data flow change
- validation commands and results

### Task 4: Verify regression

**Files:**
- No code changes in this step

**Step 1: Run backend unit tests**

Run:

- `cd tender/backend && npx vitest run tests/final-draft-checks.test.js`

**Step 2: Run integration checks**

Run:

- `node --check tender/backend/src/final-draft-checks.js`
- `node --check tender/backend/src/index.js`

**Step 3: Run full tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: the new risk rules do not break the tender main flow and are preserved in the full smoke regression.
