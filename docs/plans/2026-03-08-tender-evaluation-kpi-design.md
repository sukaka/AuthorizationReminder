# Tender Evaluation KPI Design

**Date:** 2026-03-08

## Goal

Complete `GAP-0019` by adding a repeatable evaluation dataset and KPI pipeline for the tender system so the team can:

- define stable golden samples for key AI-assisted tasks
- execute one evaluation run against the current runtime logic
- compare the latest run against a saved baseline
- inspect metric drift from the product UI

This round focuses on an internal evaluation loop inside the existing tender app. It does not introduce a standalone MLOps platform.

## Why This Scope

The current codebase already has most of the runtime ingredients needed for evaluation:

- unified AI task contract in `docs/swagger/tender-ai-task-contracts.yaml`
- AI task execution logs in `tender_ai_task_logs`
- project parse, draft, risk, export, and KB runtime snapshots in existing `tender_*` and `kb_*` tables
- governance and ops center pages already exposed in the frontend shell

What is missing is the layer that turns those runtime capabilities into versioned, repeatable KPI evidence.

## Recommendation

Use one application-local evaluation center with four layers:

1. dataset definitions
2. evaluation run snapshots
3. per-sample metric details
4. baseline comparison summary

Keep the implementation deterministic and rules-based for now. The pipeline should evaluate current structured outputs rather than calling a separate model-only benchmark service.

## Scope

This round includes:

- evaluation dataset tables and seed-safe schema
- one backend helper module for KPI metric calculation
- APIs for overview, dataset list, run history, run creation, and run detail
- one frontend evaluation center page
- baseline comparison against the most recent baseline run

This round does not include:

- offline batch import of hundreds of historical benchmark projects
- external experiment tracker
- chart-heavy analytics platform
- automatic prompt tuning based on results

## Evaluation Objects

The first version evaluates five KPI areas that map directly to `GAP-0019` acceptance.

### 1. Clause Recognition

Input:

- golden clause dataset sample
- expected recognized clause count
- expected clause type distribution
- expected mandatory / scoring counts

Metric:

- recognition coverage ratio
- type hit ratio

### 2. Score Coverage

Input:

- expected score item names
- expected recommended response points
- current parse / draft workspace score data

Metric:

- score item coverage ratio
- response point coverage ratio

### 3. Material Matching

Input:

- expected evidence asset ids or required tags
- latest project match recommendations / confirmed links

Metric:

- matched item hit ratio
- manual-review ratio

### 4. Risk Recall

Input:

- expected risk types / issue codes
- latest check and risk center results

Metric:

- risk recall ratio
- high-risk miss count

### 5. Export Completeness

Input:

- expected required deliverables
- latest draft/export records

Metric:

- export completeness ratio
- latest export success flag

## Data Model

### `tender_eval_datasets`

One row per evaluation sample.

Fields:

- `dataset_code`
- `dataset_name`
- `eval_type`
- `source_bid_id`
- `baseline_flag`
- `status`
- `expected_payload_json`
- `notes`

Design rules:

- datasets are project-scoped in v1
- the golden truth stays in `expected_payload_json`
- `baseline_flag=1` means the dataset participates in the default baseline run

### `tender_eval_runs`

One row per batch execution.

Fields:

- `run_no`
- `run_label`
- `run_scope`
- `status`
- `dataset_count`
- `summary_json`
- `baseline_summary_json`
- `started_by_*`
- `completed_at`

Design rules:

- one run can evaluate multiple datasets
- `summary_json` stores rolled-up KPI metrics
- `baseline_summary_json` stores delta vs the chosen baseline run

### `tender_eval_run_items`

One row per dataset inside a run.

Fields:

- `run_id`
- `dataset_id`
- `eval_type`
- `source_bid_id`
- `score`
- `status`
- `result_json`
- `delta_json`

Design rules:

- item rows preserve detailed evidence for debugging KPI drift
- `result_json` keeps actual vs expected counts and reasons

## KPI Standard

Each evaluation result should normalize to one structure:

```json
{
  "eval_type": "CLAUSE_RECOGNITION",
  "score": 0.92,
  "metrics": {
    "coverage_ratio": 0.95,
    "mandatory_hit_ratio": 1,
    "scoring_hit_ratio": 0.8
  },
  "expected": {},
  "actual": {},
  "misses": [],
  "high_risk_misses": [],
  "need_manual_review": false
}
```

Top-level run summary should always expose:

- `overall_score`
- `dataset_count`
- `pass_count`
- `warning_count`
- `fail_count`
- `kpis`
  - `clause_recognition`
  - `score_coverage`
  - `material_matching`
  - `risk_recall`
  - `export_completeness`

## Baseline Strategy

Use the latest completed run with `run_scope='BASELINE'` as the comparison target.

Rules:

- first baseline run has zero delta
- later ad-hoc runs compare to the latest baseline
- baseline delta stores metric changes as `current - baseline`
- negative drift on risk recall or export completeness must be highlighted as warning

This keeps comparison simple and deterministic without introducing experiment branches.

## API Design

### GET `/api/tender/evaluations/overview`

Returns:

- latest summary
- latest baseline summary
- dataset counts by type
- recent run list

### GET `/api/tender/evaluations/datasets`

Returns:

- dataset list
- normalized expected payload preview

### POST `/api/tender/evaluations/datasets`

Creates or updates one dataset entry from an existing project.

### GET `/api/tender/evaluations/runs`

Returns recent evaluation runs.

### GET `/api/tender/evaluations/runs/:id`

Returns run summary and per-item details.

### POST `/api/tender/evaluations/runs`

Starts one synchronous evaluation batch for selected datasets or for all baseline datasets.

Request supports:

- `run_label`
- `run_scope`
- `dataset_ids`

## Execution Flow

1. user creates dataset from an existing bid project
2. expected golden payload is stored in `tender_eval_datasets`
3. user starts one run
4. backend reads current runtime facts from bid parse / draft / risk / export tables
5. helper module computes normalized KPI result per dataset
6. backend aggregates run summary and baseline delta
7. frontend shows overview, recent runs, and per-sample evidence

## Frontend Integration

Add one top-level `评测中心` page in the existing app shell.

The page should contain:

- KPI summary cards
- dataset table
- recent run table
- selected run detail panel

Do not build a separate route system in this round. Reuse the current tab-based app shell.

## Permissions

Use existing governance style:

- menu permission: `evaluation-center`
- page permission: `evaluation.center`
- button permissions:
  - `evaluation.dataset.manage`
  - `evaluation.run.start`
  - `evaluation.run.view`

Editors can view runs and datasets. Admin can create datasets and start runs.

## Risks And Guardrails

Main risks:

- golden payload quality is poor
- current runtime facts are incomplete for some datasets
- KPI scores appear precise but are only first-order heuristics

Guardrails:

- every run stores expected vs actual evidence
- high-risk miss counts are separated from generic misses
- baseline comparison is explicit and versioned
- datasets remain manually curated in v1

## Acceptance Mapping

`GAP-0019` acceptance requires repeatable evaluations and baseline comparison.

This design satisfies it by:

- storing reusable datasets
- allowing repeatable run execution
- normalizing KPI outputs
- persisting run history
- computing baseline deltas for version comparison
