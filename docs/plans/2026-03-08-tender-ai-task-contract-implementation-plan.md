# Tender AI Task Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Roll out the unified AI task contract into the tender runtime so parse, match, generate, validate, and export AI flows all use one stable envelope, one trace model, and one prompt contract registry.

**Architecture:** Keep the current AI runtime behavior working, then add a thin normalization layer above existing task types. First normalize contract constants and trace fields, then adapt parse/generate flows, then add validate/export contract coverage, and finally wire evaluation and exception handling onto the same task ids.

**Tech Stack:** Node.js, Express, MySQL, React 18, Vite, plain CSS, Vitest, Node built-in test runner, OpenAPI YAML

---

### Task 1: Introduce contract constants and schema references

**Files:**
- Modify: `tender/backend/src/index.js`
- Create: `tender/backend/src/ai-task-contract.js`
- Test: `tender/backend/tests/ai-task-contract.test.js`

**Step 1: Write the failing test**

Cover:

- logical task catalog enum
- runtime task mapping table
- manual review defaults by logical task
- output schema id mapping

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/ai-task-contract.test.js`

Expected: fail because the new contract module does not exist yet

**Step 3: Write minimal implementation**

Add constants and pure helpers only:

- logical task enum
- family enum
- runtime mapping
- default prompt contract metadata

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/ai-task-contract.test.js`

Expected: pass

### Task 2: Persist normalized trace fields in AI logs

**Files:**
- Modify: `tender/backend/src/db.js`
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/ai-task-contract.test.js`

**Step 1: Write the failing test**

Cover:

- `task_id`
- logical `task_type`
- `prompt_template_version`
- `output_schema_id`
- `input_snapshot_id`
- `output_snapshot_id`

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/ai-task-contract.test.js`

Expected: fail because the log schema does not yet expose normalized fields

**Step 3: Write minimal implementation**

Extend runtime persistence without breaking existing log readers.

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/ai-task-contract.test.js`

Expected: pass

### Task 3: Wrap parse and match flows with the common envelope

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/parse-workspace.js`
- Test: `tender/backend/tests/parse-workspace.test.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing tests**

Cover:

- parse responses include common AI envelope fields
- clause classify / score extract outputs emit evidence and manual review hints
- asset match recommendations expose logical task metadata

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/smoke.e2e.test.js`

Expected: fail because current responses are runtime-shaped only

**Step 3: Write minimal implementation**

Wrap existing results instead of rewriting the underlying pipeline.

**Step 4: Run tests to verify it passes**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/smoke.e2e.test.js`

Expected: pass

### Task 4: Wrap generate, optimize, validate, and export summaries

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `tender/backend/src/draft-workspace.js`
- Modify: `tender/backend/src/ops-center.js`
- Test: `tender/backend/tests/draft-workspace.test.js`
- Test: `tender/backend/tests/ops-center.test.js`

**Step 1: Write the failing tests**

Cover:

- section generation returns logical task metadata
- optimization results return coverage deltas and unsupported-claim markers
- risk explanation returns `need_manual_review`
- export precheck summary returns blocking items and checklist

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/draft-workspace.test.js tests/ops-center.test.js`

Expected: fail because these responses do not yet use the normalized contract

**Step 3: Write minimal implementation**

Keep existing endpoints, add normalized envelope fields and prompt trace only.

**Step 4: Run tests to verify it passes**

Run: `cd tender/backend && npx vitest run tests/draft-workspace.test.js tests/ops-center.test.js`

Expected: pass

### Task 5: Expose contract metadata to frontend workspaces

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Create: `tender/frontend/src/ai-task-contract.js`
- Test: `tender/frontend/src/ai-task-contract.test.js`

**Step 1: Write the failing test**

Cover:

- frontend normalizes common envelope fields
- low-confidence or manual-review tasks render warning state
- evidence source count and risk flag count can be summarized consistently

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/ai-task-contract.test.js`

Expected: fail because the helper module does not exist yet

**Step 3: Write minimal implementation**

Add pure normalization helpers and render-only state derivation.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/ai-task-contract.test.js`

Expected: pass

### Task 6: Add prompt governance and evaluation hooks

**Files:**
- Modify: `tender/backend/src/index.js`
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Extend prompt management**

Ensure prompt records can carry:

- template version
- output schema id
- logical task type

**Step 2: Add evaluation linkage**

Emit stable task ids and schema ids so `GAP-0019` KPI jobs can compare outputs across versions.

**Step 3: Update backlog**

Mark follow-up execution dependencies clearly under:

- `GAP-0019`
- `GAP-0027`

### Task 7: Verify runtime compatibility

**Files:**
- Modify: `tender/backend/tests/smoke.e2e.test.js`
- Modify: `tender/frontend/src/draft-workspace.test.js`
- Modify: `tender/frontend/src/ops-center.test.js`

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/ai-task-contract.test.js`
- `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/draft-workspace.test.js tests/ops-center.test.js`

**Step 2: Run frontend tests**

Run:

- `node --test tender/frontend/src/ai-task-contract.test.js`
- `node --test tender/frontend/src/draft-workspace.test.js tender/frontend/src/ops-center.test.js`

**Step 3: Run fast syntax and build checks**

Run:

- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

**Step 4: Run integrated regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: the existing tender flows still pass while returning normalized AI contract fields.
