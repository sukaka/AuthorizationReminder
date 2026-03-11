# Tender Validation Rule Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Seed and expose a reusable validation rule library with at least 100 normalized records, and connect it to the tender check flow through rule execution summaries.

**Architecture:** Add one pure backend helper for rule seed generation, normalization, issue-to-rule matching, and execution summary building. Reuse the existing `kb_validation_rules` table, add idempotent seed sync in DB bootstrap, and expose lightweight list/sync APIs plus rule execution data in `/api/tender/bids/:id/check`.

**Tech Stack:** Node.js, Express, MySQL, Vitest

---

### Task 1: Lock the rule library shape with failing tests

**Files:**
- Create: `tender/backend/src/validation-rule-library.js`
- Create: `tender/backend/tests/validation-rule-library.test.js`

**Step 1: Write the failing tests**

Cover:

- seed library size is at least 100
- seed rows normalize into stable payloads
- issue decoration matches runtime issue types to rule rows
- execution summary reports active, matched, and unmapped counts

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/validation-rule-library.test.js`

Expected: fail because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Add:

- base seed generator
- row normalizer
- issue matcher
- execution summary builder

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/validation-rule-library.test.js`

Expected: pass.

### Task 2: Seed and expose the rule library

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`

**Step 1: Seed missing base rules during init**

Insert only missing rule names into `kb_validation_rules`.

**Step 2: Add rule library APIs**

Implement:

- `GET /api/tender/kb/validation-rules`
- `POST /api/tender/kb/validation-rules/sync`

**Step 3: Run syntax checks**

Run:

- `node --check tender/backend/src/validation-rule-library.js`
- `node --check tender/backend/src/index.js`

Expected: both pass.

### Task 3: Connect the rule library to `/check`

**Files:**
- Modify: `tender/backend/src/index.js`

**Step 1: Load active rules during draft check**

After computing issues, decorate them with matched rule metadata and build `rule_execution`.

**Step 2: Keep check output backward compatible**

Do not remove existing fields. Only add:

- `matched_rules` per issue
- `rule_execution` at response top level

### Task 4: Add smoke coverage

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Add focused assertions**

Cover:

- validation rule library list returns at least 100 rows
- check response includes `rule_execution`

### Task 5: Update status tracking

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Mark backlog**

If the acceptance is met:

- mark `GAP-0018` as `DONE`
- update module snapshot 3.7 or 3.8 wording only if needed

**Step 2: Update memory**

Record:

- rule library seed count
- new APIs
- rule execution summary shape

### Task 6: Verify regression

**Files:**
- No code changes in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/validation-rule-library.test.js tests/final-draft-checks.test.js`

**Step 2: Run syntax checks**

Run:

- `node --check tender/backend/src/validation-rule-library.js`
- `node --check tender/backend/src/index.js`

**Step 3: Run full tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: rule library seeding and check decoration do not break the tender main flow.
