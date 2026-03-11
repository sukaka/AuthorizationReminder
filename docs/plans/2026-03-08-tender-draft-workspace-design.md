# Tender Draft Workspace Design

**Date:** 2026-03-08

## Goal

Complete `GAP-0023` by adding a project-scoped draft workspace under each created tender project so users can:

- inspect and edit structured draft sections
- inspect and edit deviation / response tables
- run draft checks and score optimization from the same workspace
- manage autosave and rollback without leaving the project detail view

## Scope

This work is attached to an existing project. It does not replace the existing generate wizard.

The generate wizard remains responsible for:

- analyzing tender source files
- selecting model and template
- creating the first generated draft

The new draft workspace is responsible for:

- reading the latest generated project draft state
- allowing structured manual edits after generation
- exposing review, optimization, and rollback actions in one place

## Product Structure

Add one new project-level block after the parse workspace:

### Draft Workspace

Contains four linked cards:

1. `Structured Sections`
2. `Deviation / Response Tables`
3. `Score Coverage Analysis`
4. `Autosave / Rollback`

### Structured Sections

Show the current section registry tied to the active project version.

Each row should expose:

- `section_title`
- `paragraph_text`
- `requirement_ids`
- `evidence_ids`
- `score_item_ids`

Users can edit the title and paragraph text directly.

### Deviation / Response Tables

Show four editable groups:

- technical deviation
- business deviation
- technical response
- business response

Default data comes from the latest generate job artifacts.

Once the user saves edits, the workspace should prefer persisted project-scoped rows instead of the generate-job snapshot.

### Score Coverage Analysis

Show:

- coverage matrix rows
- latest optimization records
- latest check summary and issues

Actions:

- run draft check
- run score optimization
- refresh workspace state after each action

### Autosave / Rollback

Show the recent autosave list and allow:

- create manual autosave
- rollback to one autosave

This remains backed by the existing draft file behavior.

## Data Model

Reuse existing runtime tables where possible:

- `tender_draft_section_registry`
- `tender_score_coverage_matrix`
- `tender_score_optimization_records`
- `tender_draft_check_runs`
- `tender_draft_check_issues`
- `tender_bid_draft_autosaves`

Add one new table for editable structured artifact rows:

### `tender_draft_artifact_rows`

Stores project-scoped structured table rows.

Columns:

- `bid_id`
- `version_id`
- `artifact_type`
- `artifact_group`
- `row_no`
- `row_json`
- `created_by_id`
- `created_by_name`
- `updated_by_id`
- `updated_by_name`

Supported values:

- `artifact_type`: `DEVIATION_TABLE`, `RESPONSE_TABLE`
- `artifact_group`: `TECHNICAL`, `BUSINESS`

## Backend API Design

### Workspace

- `GET /api/tender/bids/:id/draft/workspace`
  - returns:
    - bid / version / draft basics
    - structured draft sections
    - structured draft tables
    - latest check summary and issues
    - score coverage matrix
    - score optimization records
    - autosave rows

### Save Sections

- `PUT /api/tender/bids/:id/draft/sections`
  - saves the structured section registry for the current version

### Save Tables

- `PUT /api/tender/bids/:id/draft/artifacts`
  - saves structured rows for deviation / response tables

Existing action APIs stay unchanged:

- `POST /api/tender/bids/:id/check`
- `POST /api/tender/bids/:id/score-optimize`
- `POST /api/tender/bids/:id/draft/autosave`
- `POST /api/tender/bids/:id/draft/rollback`
- `POST /api/tender/bids/:id/editor/session`

## Read Strategy

For draft tables:

1. load persisted `tender_draft_artifact_rows` for current bid/version
2. if empty, fallback to latest generate job `generated_artifacts`
3. normalize all rows to stable frontend shape

For draft sections:

1. load `tender_draft_section_registry`
2. if empty, fallback to extracted paragraphs from the current file

## Frontend Design

Keep implementation in the existing selected-project detail panel inside `App.jsx`.

Add:

- one new draft workspace state object
- one helper module for draft workspace normalization
- one CSS block for dense editing tables and matrix cards

The UI should stay pragmatic:

- editable textareas for section paragraphs
- compact tables for deviation / response rows
- summary cards for check and coverage status
- side-by-side actions without introducing a new route

## Non-Goals

This task does not include:

- risk center / template center / export center
- syncing structured section edits back into the physical docx immediately
- changing the generate wizard contract
- adding semantic retrieval or new model behavior
