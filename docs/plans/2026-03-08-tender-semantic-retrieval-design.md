# Tender Semantic Retrieval Design

**Date:** 2026-03-08

## Goal

Complete the first usable closure for `GAP-0007` and `GAP-0016` by upgrading project parse matching from rule-only recommendation to hybrid recall:

- rule filter
- chunk-level semantic recall
- rerank
- manual review gate

This work is intentionally attached to the existing parse workspace and does not wait for the full historical ingestion pipeline.

## Why This Scope

The current matching endpoint:

- `POST /api/tender/bids/:id/parse/matches/recommend`

already supports:

- clause list input
- project asset query
- persisted recommendations in `tender_bid_parse_matches`
- manual confirmation in the parse workspace

The weak point is that recommendation quality still depends mostly on keyword overlap between:

- clause title/text
- current project asset file name / OCR text / asset type

That is enough for obvious cases, but too weak for:

- semantically related but differently worded service commitments
- case summary recall
- chunk-level solution fragment reuse
- product evidence candidates where exact words do not line up

## Recommendation

Use one hybrid retrieval layer above existing rule matching.

Do not wait for:

- full historical bid ingestion
- external vector database
- online embedding service dependency

The first version should stay local, deterministic, and testable.

## Scope

This round includes:

- chunk building from project assets and knowledge-base records
- lightweight semantic scoring at chunk level
- rule + semantic + rerank hybrid score
- persisted match payload with score breakdown
- parse workspace UI exposure of source and review state

This round does not include:

- asynchronous embedding generation jobs
- external vector store
- batch historical ingestion pipeline
- generation-stage retrieval injection

## Candidate Sources

### 1. Current Project Assets

Use:

- `tender_assets`
- `tender_asset_ocr_results`

These remain the most authoritative source for current-project evidence.

### 2. Knowledge-Base Chunks

Use:

- `kb_asset_chunks`

whenever they already exist.

These should be treated as preferred semantic candidates because they are already chunk-shaped.

### 3. Fallback Knowledge Sources

If `kb_asset_chunks` is empty or sparse, build on-the-fly chunks from:

- `kb_section_assets`
- `kb_project_cases`
- `kb_product_specs`
- `kb_company_qualifications`
- `kb_personnel_assets`

This avoids blocking retrieval improvement on `GAP-0013 / GAP-0015`.

## Unified Retrieval Chunk

Every candidate should be normalized into one retrieval chunk shape:

- `chunk_id`
- `asset_id`
- `asset_type`
- `source_table`
- `source_id`
- `chunk_type`
- `chunk_text`
- `title`
- `tags`
- `quality_score`
- `freshness_score`
- `review_required`

### Chunk Type Rules

Recommended chunk types:

- `QUALIFICATION`
- `CASE_SUMMARY`
- `SECTION_FRAGMENT`
- `PRODUCT_SPEC`
- `PERSONNEL_PROFILE`
- `GENERIC_ASSET`

## Retrieval Pipeline

### Step 1: Rule Filter

Filter candidates by clause type before semantic scoring.

Examples:

- `QUALIFICATION` clauses prefer qualification, authorization, personnel profile chunks
- `TECHNICAL` clauses prefer product spec and technical section chunks
- `SCORING` clauses prefer case summary, service fragment, personnel profile, qualification chunks
- `GENERAL` clauses allow wider fallback

This keeps semantic scoring cheap and avoids obviously irrelevant chunks.

### Step 2: Semantic Score

Use a local semantic scorer instead of exact string overlap.

The first version combines:

- normalized keyword overlap
- Chinese character bigram overlap
- title hit
- tag hit

This is not a full embedding pipeline, but it behaves as semantic recall because:

- it is chunk-based
- it tolerates wording variation better than raw exact-token overlap
- it can rank semantically related fragments above file-name-only matches

The score should be persisted as:

- `semantic_score`

### Step 3: Rerank

Final score should combine:

- `rule_score`
- `semantic_score`
- `quality_score`
- `freshness_score`
- `title_boost`
- `tag_boost`

Persist the final ranking score as:

- `rerank_score`

### Step 4: Manual Review Gate

Always mark recommendation as manual-review-required when:

- the candidate is qualification / authorization / personnel / case evidence
- semantic score is high but rule score is weak
- the top recommendation margin is too small
- the clause itself is mandatory or scoring-related

Persist:

- `need_manual_review`
- `manual_review_reasons`

## Match Source Rules

The persisted `match_source` should no longer be only `RULE`.

Allowed values:

- `RULE`
- `SEMANTIC`
- `HYBRID`

Decision:

- `RULE` when semantic score is weak but rule score dominates
- `SEMANTIC` when semantic recall brings in the candidate and rule score is weak
- `HYBRID` when both contribute materially

## Persistence

No new table is required.

Reuse:

- `tender_bid_parse_matches`

Store the new retrieval metadata inside `payload_json`:

- `rule_score`
- `semantic_score`
- `rerank_score`
- `chunk_id`
- `chunk_type`
- `source_table`
- `chunk_preview`
- `need_manual_review`
- `manual_review_reasons`

## Backend Design

Add a new pure module:

- `tender/backend/src/semantic-retrieval.js`

Responsibilities:

- normalize candidate chunks
- build fallback chunks from runtime and kb tables
- compute semantic score
- rerank candidates
- decide match source
- decide manual review gate

`index.js` should stay thin:

- load clause rows
- load asset / kb candidate rows
- call semantic retrieval helper
- persist top recommendations

## Frontend Design

The parse workspace should continue using the same backend endpoint.

Enhancements:

- show `match_source`
- show `confidence`
- show `semantic_score`
- show `need_manual_review`
- show short `chunk_preview`

This is enough for users to understand why a recommendation appeared and whether it is safe to adopt directly.

## Testing Strategy

### Backend Pure Tests

Add tests for:

- chunk normalization
- clause-type rule filter
- semantic score ranking
- hybrid rerank ordering
- manual review gate

### Existing Parse Workspace Regression

Ensure:

- recommendations still persist into `tender_bid_parse_matches`
- payload fields remain JSON-safe
- no regression in existing parse workspace tests

### End-to-End Regression

Keep:

- `smoke.e2e.test.js`
- `scripts/tests/tender.sh`

green after the recommendation logic changes.

## Acceptance Mapping

### `GAP-0007`

Satisfied when material matcher can:

- return semantic recall results
- emit confidence / score breakdown
- mark manual review when needed

### `GAP-0016`

Satisfied when parse match flow can:

- combine rule filtering with chunk-level semantic retrieval
- return hybrid ranked results from current assets and kb chunks

## Follow-Up

After this round, the next natural upgrades are:

- `GAP-0013`: historical bid ingestion into `kb_*`
- `GAP-0015`: unified chunk/tag standard
- `GAP-0019`: evaluation dataset for retrieval precision and coverage

At that point, the local semantic scorer can be replaced or complemented by real embedding vectors without changing the outer contract.
