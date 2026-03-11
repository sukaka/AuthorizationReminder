# Tender Parse Workspace Design

**Date:** 2026-03-08

## Goal

Build a project-scoped parse workspace for `GAP-0022` so each created tender project can upload and manage:

- main tender documents
- clarification documents
- attachments and supplementary files
- ZIP packages with recursive extraction
- Excel files with user-selected sheets

The workspace must support parse, clause classification, and asset matching as one continuous workflow.

## Product Scope

The workspace is attached to an existing project. It is not a standalone temporary wizard.

Users must be able to:

- upload `pdf/doc/docx/xls/xlsx/zip`
- see all files under the current project
- automatically expand ZIP contents recursively
- choose which Excel sheets participate in parsing
- run full parse or partial parse modes
- inspect parsed project fields, sections, clauses, and tables
- manually adjust clause classification fields
- inspect and confirm recommended assets

## File and Merge Rules

### File Roles

- `MAIN`: tender main file
- `CLARIFICATION`: clarification documents
- `ATTACHMENT`: attachments
- `SUPPLEMENT`: other supplementary files

### ZIP

- ZIP files are automatically unpacked
- supported descendants: `pdf/doc/docx/xls/xlsx`
- unpacking is recursive
- unsupported descendants are kept as skipped records for display only

### Excel

- `xls` is converted to `xlsx` before structured parsing
- `xlsx` is parsed directly
- only user-selected sheets participate in parse

### Merge Priority

- main tender file provides the base result
- clarification files override conflicting project fields and clause conclusions
- attachments supplement clauses and tables, but do not override by default
- a clarification attachment may be treated as clarification only if uploaded under clarification role

## Information Architecture

The project parse workspace contains three linked stages in one screen:

1. Upload and parse
2. Clause classification
3. Asset matching

### Left Column

- file tree grouped by role
- ZIP child files
- Excel sheets and selection state

### Center Column

- parse overview
- project fields
- section summaries
- clause grid
- table grid
- matching grid

### Right Column

- selected file details
- parse warnings
- merge conflict hints
- selected clause/table/match detail

## Data Model

Do not overload `tender_bid_generate_jobs`. Its semantics are tied to the existing generate wizard.

Add dedicated project-scoped parse tables:

### `tender_bid_parse_jobs`

Stores each parse run:

- `bid_id`
- `parse_mode`
- `status`
- `warning_text`
- `project_fields_json`
- `section_summaries_json`
- summary counts

### `tender_bid_parse_files`

Stores all workspace files:

- `bid_id`
- `parse_job_id`
- `file_role`
- `source_kind`
- `parent_file_id`
- file metadata
- `parse_enabled`
- `sheet_manifest_json`
- `selected_sheets_json`
- `merge_priority`

### `tender_bid_parse_clauses`

Stores structured clause rows for manual review:

- source references
- classification fields
- override flag

### `tender_bid_parse_tables`

Stores structured table rows:

- source file reference
- sheet name
- table headers and rows

### `tender_bid_parse_matches`

Stores recommended and confirmed asset matches:

- target type and target id
- asset id
- score and reason
- confirmation decision

## Backend API Design

### Workspace

- `GET /api/tender/bids/:id/parse/workspace`
  - current parse workspace state

### Files

- `POST /api/tender/bids/:id/parse/files`
  - upload project parse files
- `DELETE /api/tender/bids/:id/parse/files/:fileId`
  - remove project parse files
- `POST /api/tender/bids/:id/parse/files/:fileId/sheets/select`
  - save selected Excel sheets

### Parse

- `POST /api/tender/bids/:id/parse/start`
  - start `FULL`, `SCORE_ONLY`, `PARAM_ONLY`, `QUAL_ONLY`
- `GET /api/tender/bids/:id/parse/jobs/:jobId`
  - fetch parse result detail

### Manual Review

- `PUT /api/tender/bids/:id/parse/clauses/bulk`
  - save clause classification updates
- `POST /api/tender/bids/:id/parse/matches/recommend`
  - generate match recommendations
- `PUT /api/tender/bids/:id/parse/matches/bulk`
  - confirm/replace/ignore matches

## Parse Pipeline

### Step 1: Ingestion

- validate file type
- create parse file records
- unpack ZIP recursively
- discover Excel sheets

### Step 2: Extraction

- extract text and tables from `doc/docx/pdf`
- convert `xls` to `xlsx`
- extract sheet text and sheet tables from selected `xlsx` sheets

### Step 3: Merge

- build project field candidates
- merge by role priority
- clarification wins on conflicts

### Step 4: Structuring

- create structured project fields
- write clause rows
- write table rows

### Step 5: Matching

- derive targets from clause/table parse result
- recommend assets from existing asset library
- allow manual confirmation later

## Frontend UI Design

The current parse and generate flow inside `App.jsx` is already too coupled to generation. The new workspace should be a dedicated project-level UI, not an extension of the existing generate wizard.

The first version should add a new project-level tab or panel under the selected bid area:

- upload/parse toolbar
- file tree
- parse overview
- clause classification table
- table preview panel
- matching decision panel

## Error Handling

- unsupported ZIP descendants are marked skipped, not fatal
- corrupted ZIP returns a structured parse error
- Excel with no selected sheets cannot start parse
- partial parse failures preserve uploaded files and previous results
- parse warnings stay visible in the workspace until next successful parse

## Testing Strategy

### Backend

- ZIP recursive extraction
- Excel sheet discovery
- selected sheet filtering
- clarification override merge behavior
- workspace and bulk update APIs

### Frontend

- file tree state rendering
- sheet selection state
- clause edit state
- asset match decision state

### Regression

- existing `bid-generate` flow remains functional
- existing asset library and project management pages remain functional
