# Tender Clause Subtype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic clause subtype classification for original/copy, demo/prototype, and authorization variants, and expose it through the clause contract and routing layer.

**Architecture:** Extend parse-time clause classification with a new subtype helper, then update clause contract generation so `clause_subtype` survives into `clause_contract_v2` and influences response mode for the targeted scenarios.

**Tech Stack:** Node.js, Vitest

---

### Task 1: Lock subtype extraction with failing parse tests

**Files:**
- Modify: `tender/backend/tests/parse-workspace.test.js`
- Modify: `tender/backend/src/parse-workspace.js`

**Step 1: Write the failing tests**

Cover:

- original requirement subtype
- copy requirement subtype
- demo subtype
- prototype subtype
- manufacturer authorization subtype
- distributor authorization subtype

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js`

Expected: fail because subtype is not emitted yet.

**Step 3: Write minimal implementation**

Add:

- subtype classifier
- subtype field in parse clause rows

**Step 4: Run test to verify it passes**

Run the same command again.

### Task 2: Expose subtype through clause contract and routing

**Files:**
- Modify: `tender/backend/src/final-draft-registry.js`
- Modify: `tender/backend/tests/clause-contract-routing.test.js`

**Step 1: Write the failing tests**

Cover:

- clause contract includes `clause_subtype`
- authorization subtype defaults to `EVIDENCE_BINDING`
- demo/prototype subtype defaults to `MANUAL_ONLY`

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/clause-contract-routing.test.js`

Expected: fail because subtype is not in the contract yet.

**Step 3: Write minimal implementation**

Update:

- subtype inference from source/title/text
- response mode defaults for targeted subtypes

**Step 4: Run test to verify it passes**

Run the same command again.

### Task 3: Update status tracking

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-09.md`

**Step 1: Mark backlog**

If subtype field and routing are verified:

- mark `GAP-0006` as `DONE`

**Step 2: Update memory**

Record:

- supported subtypes
- routing implications
- verification commands

### Task 4: Verify regression

**Files:**
- No code changes in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/clause-contract-routing.test.js`

**Step 2: Run syntax checks**

Run:

- `node --check tender/backend/src/parse-workspace.js`
- `node --check tender/backend/src/final-draft-registry.js`

**Step 3: Run full tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: subtype additions do not break the tender analyze and generate flow.
