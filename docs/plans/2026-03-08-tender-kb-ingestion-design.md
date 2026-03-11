# Tender KB Ingestion Design

**Date:** 2026-03-08

## Goal

Complete `GAP-0013` and `GAP-0015` by adding a first project-level knowledge-base ingestion loop that:

- ingests one existing bid project into normalized `kb_*` records
- preserves traceable source linkage back to runtime project data
- standardizes tags, chunk types, quality scores, and reusable flags
- exposes ingestion controls and history inside the existing project lifecycle page

This round is intentionally based on already-created runtime projects. It does not introduce a second historical-file upload flow.

## Why This Scope

The current tender system already has the right runtime ingredients:

- project basics in `tender_bids`
- parsed clauses / tables / file tree in `tender_bid_parse_*`
- reusable draft content in `tender_draft_section_registry`
- attachment OCR in `tender_assets + tender_asset_ocr_results`
- semantic retrieval fallback consumers already reading `kb_asset_chunks`

What is missing is the pipeline that converts runtime project data into stable, reusable knowledge-base assets.

## Recommendation

Use one project-scoped ingestion pipeline:

- trigger from an existing bid project
- require the project to have parse output
- create or refresh one `kb_project`
- rebuild project-linked KB assets and chunks in one transaction
- keep ingest history in `kb_ingest_jobs`

Do not build a separate historical raw-file import wizard in this round.

## Scope

This round includes:

- project-level ingest API under an existing bid
- one backend helper module for record normalization and chunk generation
- idempotent refresh of project-linked `kb_*` records
- standardized tags / chunk types / quality scores
- project-level ingestion panel in the lifecycle workspace

This round does not include:

- asynchronous OCR or embedding jobs
- external vector database
- bulk offline import of unknown legacy folders
- automatic learning from bid result feedback

## Source Model

### Project-level

Use:

- `tender_bids`
- latest `tender_bid_parse_jobs`
- merged parse fields

to create or refresh one `kb_projects` row.

### Clause-level

Use:

- latest `tender_bid_parse_clauses`

to build:

- `kb_tender_clauses`

Each clause keeps:

- `source_file_path`
- `chapter_name`
- `tags_json`
- scoring / mandatory / response metadata

### Score-item level

Use scoring clauses from:

- latest `tender_bid_parse_clauses`

and create:

- `kb_score_items`

The first version derives score items from scoring clause title, score value, and clause text. It does not wait for a separate evaluation dataset.

### Section-level

Use:

- current version rows in `tender_draft_section_registry`

to build:

- `kb_section_assets`

This provides reusable historical section fragments for later retrieval and generation.

### Table-level

Use:

- latest `tender_bid_parse_tables`

to generate chunked table summaries inside:

- `kb_asset_chunks`

No separate `kb_table_assets` table is introduced in this round.

### Attachment-level

Use:

- `tender_assets`
- `tender_asset_ocr_results`

to generate attachment evidence chunks inside:

- `kb_asset_chunks`

This keeps attachment decomposition available for semantic retrieval without expanding schema.

## Unified Standard

All ingested records and chunks must follow one normalization standard.

### Tags

Every generated tag list should be a normalized string array with:

- unique values only
- lowercase ASCII keywords when possible
- source-role and source-type tags
- project-type and industry tags when available
- bid status and ingest-source tags

Examples:

- `bid-project`
- `parse-main`
- `parse-clarification`
- `clause-technical`
- `section-implementation`
- `attachment-qualification`

### Chunk Types

Allowed first-round chunk types:

- `PROJECT_SUMMARY`
- `CLAUSE_TEXT`
- `SCORE_RULE`
- `SECTION_PARAGRAPH`
- `TABLE_SUMMARY`
- `TABLE_ROW`
- `ATTACHMENT_OCR`

### Quality Score

Use a deterministic local score:

- parsed scoring / mandatory clauses: higher baseline
- curated draft sections: higher baseline
- OCR attachment evidence: medium baseline
- table rows: lower baseline than table summary

This score is for rerank bias only. It is not a human quality judgment.

### Reusable Flag

Rules:

- draft sections default to reusable
- project summary / clauses default to reusable
- OCR attachment evidence defaults to reusable when OCR text exists
- empty or noisy content becomes non-reusable and is skipped from chunk generation

## Ingestion API

### GET `/api/tender/bids/:id/kb/workspace`

Returns:

- linked kb project
- recent ingest jobs
- current ingestable counts
- default form values for overrides

### POST `/api/tender/bids/:id/kb/ingest`

Accepts optional overrides for:

- `project_type`
- `industry_type`
- `region`
- `result_status`
- `bid_amount`
- `tags`
- `remarks`

Behavior:

- validates bid scope
- validates latest parse result exists
- creates one ingest job
- rebuilds project-linked KB records
- links `tender_bids.source_kb_project_id`
- returns refreshed workspace summary

## Idempotency

The pipeline is refresh-based, not append-only.

When a bid is re-ingested:

- keep the same `kb_project` when one already exists for `source_bid_id`
- delete and rebuild project-linked clauses, score items, section assets, and chunks
- append a new ingest job history record

This keeps retrieval clean and avoids duplicated chunk spam.

## Frontend Integration

Add one new card to the existing project lifecycle page:

- title: `知识库沉淀`

The card shows:

- linked knowledge-base project
- current ingestable counts
- editable ingest metadata
- recent ingest job history
- one-click ingest action

This keeps the feature attached to an existing project, matching the product constraint that ingestion must live under a created project.

## Testing

Backend tests should cover:

- project record normalization
- unified tag and chunk generation
- score-item derivation from scoring clauses
- attachment/table/section chunk creation

Integration tests should cover:

- ingest endpoint requires parsed project context
- ingest creates `kb_project`
- ingest creates normalized `kb_*` children
- workspace endpoint returns linked project and counts

Frontend tests should cover:

- workspace payload normalization
- ingest form payload normalization
- job history and count rendering helpers
