# Tender Semantic Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the first hybrid semantic retrieval loop for parse workspace material matching so clause recommendations combine rule filtering, chunk-level semantic recall, rerank, and manual review signals.

**Architecture:** Add one pure retrieval helper module that normalizes runtime assets and knowledge-base records into retrieval chunks, scores them with a local semantic scorer, reranks them with rule and quality boosts, and writes the top results back into existing parse match rows. Keep current APIs and tables; only enrich payloads and frontend display.

**Tech Stack:** Node.js, Express, MySQL, React 18, Vite, plain CSS, Vitest, Node built-in test runner

---

### Task 1: Add failing backend tests for hybrid retrieval helpers

**Files:**
- Create: `tender/backend/tests/semantic-retrieval.test.js`
- Create: `tender/backend/src/semantic-retrieval.js`

**Step 1: Write the failing tests**

Cover:

- candidate chunk normalization from project assets and kb rows
- clause-type filtering
- semantic scoring with wording variation
- hybrid rerank ordering
- manual review gate

**Step 2: Run test to verify it fails**

Run: `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js`

Expected: fail because the helper module does not exist yet

**Step 3: Write minimal implementation**

Add only pure helpers:

- chunk builders
- semantic scorer
- hybrid rerank
- manual review resolver

**Step 4: Run test to verify it passes**

Run: `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js`

Expected: pass

### Task 2: Wire hybrid retrieval into parse match recommendation API

**Files:**
- Modify: `tender/backend/src/index.js`
- Test: `tender/backend/tests/parse-workspace.test.js`
- Test: `tender/backend/tests/smoke.e2e.test.js`

**Step 1: Write the failing tests**

Cover:

- recommendations can come from `RULE`, `SEMANTIC`, or `HYBRID`
- payload includes `rule_score`, `semantic_score`, `rerank_score`, `chunk_preview`
- mandatory or sensitive matches are marked for manual review

**Step 2: Run tests to verify they fail**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/smoke.e2e.test.js`

Expected: fail because current endpoint only emits rule-based recommendations

**Step 3: Write minimal implementation**

Keep the same endpoint and same table, only enrich:

- candidate loading
- ranking logic
- persisted payload fields

**Step 4: Run tests to verify it passes**

Run: `cd tender/backend && npx vitest run tests/parse-workspace.test.js tests/smoke.e2e.test.js`

Expected: pass

### Task 3: Add frontend normalization for semantic recommendation metadata

**Files:**
- Modify: `tender/frontend/src/parse-workspace.js`
- Create: `tender/frontend/src/semantic-retrieval.test.js`

**Step 1: Write the failing tests**

Cover:

- match rows normalize `match_source`
- score breakdown survives missing fields
- manual-review badge state derives from payload

**Step 2: Run test to verify it fails**

Run: `node --test tender/frontend/src/semantic-retrieval.test.js`

Expected: fail because frontend helpers do not yet normalize semantic retrieval metadata

**Step 3: Write minimal implementation**

Add pure normalization helpers only.

**Step 4: Run test to verify it passes**

Run: `node --test tender/frontend/src/semantic-retrieval.test.js`

Expected: pass

### Task 4: Expose semantic retrieval metadata in parse workspace UI

**Files:**
- Modify: `tender/frontend/src/App.jsx`
- Modify: `tender/frontend/src/App.css`

**Step 1: Add source and score columns**

Show:

- source label
- confidence
- semantic score
- rerank score

**Step 2: Add review state**

Show:

- manual review badge
- review reasons tooltip or inline text
- chunk preview

**Step 3: Keep current confirmation flow**

Do not change:

- bulk confirm action
- replace / ignore flows

### Task 5: Update docs and status

**Files:**
- Modify: `docs/requirements/tender-gap-backlog.md`
- Modify: `memory/2026-03-08.md`

**Step 1: Update backlog**

If scope matches acceptance:

- mark `GAP-0007` as `DONE`
- mark `GAP-0016` as `DONE`

**Step 2: Update memory**

Record:

- retrieval design
- current limitations
- next dependency on `GAP-0013 / GAP-0015 / GAP-0019`

### Task 6: Verify full regression

**Files:**
- No code changes required in this step

**Step 1: Run backend tests**

Run:

- `cd tender/backend && npx vitest run tests/semantic-retrieval.test.js tests/parse-workspace.test.js`

**Step 2: Run frontend tests**

Run:

- `node --test tender/frontend/src/semantic-retrieval.test.js tender/frontend/src/parse-workspace.test.js`

**Step 3: Run fast syntax and build checks**

Run:

- `node --check tender/backend/src/semantic-retrieval.js`
- `node --check tender/backend/src/index.js`
- `npm --prefix tender/frontend run build`

**Step 4: Run integrated tender regression**

Run:

- `ADMIN_LOGIN='admin' ADMIN_PASSWORD='Ss544364@' COMPOSE_PROJECT_NAME=codex-new ./scripts/tests/tender.sh`

Expected: parse workspace recommendation upgrade does not break the existing tender main flow.
