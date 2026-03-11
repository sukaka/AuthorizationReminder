# Tender AI Task Contract Design

**Date:** 2026-03-08

## Goal

Complete `GAP-0017` by formalizing one unified AI task contract layer for the tender system.

This layer sits above the current runtime implementation and defines:

- which AI tasks exist
- what each task may and may not decide
- the fixed request / response schema for each task
- what prompt metadata must be retained
- when manual review is mandatory

## Why This Is Needed

Current tender AI behavior is already functional, but the contracts are still scattered across runtime code and prompt records.

Existing runtime facts:

- prompt templates are stored in `tender_ai_prompts`
- task logs are stored in `tender_ai_task_logs`
- model calls are routed by `runAiTask()` in `tender/backend/src/index.js`
- staged analyze already uses:
  - `BID_ANALYZE_STAGE1`
  - `BID_ANALYZE_STAGE2`
  - `BID_ANALYZE_STAGE3`
  - `BID_ANALYZE`
- draft generation already uses:
  - `BID_COMPOSE_DRAFT`
- generic editing tasks already use:
  - `OCR_STRUCTURED`
  - `REWRITE`
  - `PROOFREAD`

The missing piece is one documented contract family that product, backend, AI, and QA can all use as the same baseline.

## Design Principles

### 1. Keep Runtime Tasks, Add A Logical Contract Layer

This design does not replace existing runtime task types immediately.

Instead:

- keep current `task_type` values for running code
- define one normalized logical task catalog above them
- let one logical task map to one or more runtime task types during migration

This avoids breaking the current service while still giving the team a stable specification.

### 2. Use One Common Envelope For All AI Tasks

Every AI task response should converge on one envelope shape:

- `task_id`
- `task_type`
- `status`
- `result`
- `confidence`
- `evidence_sources`
- `risk_flags`
- `need_manual_review`
- `trace`

This is the minimum contract that makes AI output:

- machine-readable
- auditable
- reviewable
- comparable across versions

### 3. Separate AI Families By Responsibility

The unified contract is split into five API families:

1. `parse`
2. `match`
3. `generate`
4. `validate`
5. `export`

These families cover nine logical AI tasks:

1. `PARSE_PROJECT_OVERVIEW`
2. `CLASSIFY_CLAUSES`
3. `EXTRACT_SCORE_ITEMS`
4. `MATCH_ENTERPRISE_ASSETS`
5. `GENERATE_SECTION_DRAFT`
6. `GENERATE_RESPONSE_TEXT`
7. `OPTIMIZE_DRAFT_CONTENT`
8. `EXPLAIN_RISK_FLAGS`
9. `EXPORT_PACKAGE_SUMMARY`

This matches the AI capability document the user provided and also maps cleanly onto the current tender workflow.

### 4. High-Risk Facts Never Depend On AI Alone

AI may suggest, summarize, organize, and explain.

AI may not independently finalize:

- qualification validity
- parameter satisfaction
- attachment completeness
- legal commitment validity
- final export compliance

Whenever a task touches those areas, the response must set:

- `need_manual_review: true`
- one or more `risk_flags`
- explicit `evidence_sources`

### 5. Prompt Contract Is A First-Class Contract

The contract is not only the JSON output shape.

Every task also needs a prompt contract that fixes:

- prompt template id
- prompt template version
- output schema id
- system constraints
- forbidden claims
- manual review triggers

Without this, two runs with the same `task_type` are not truly comparable.

## Common Request Contract

Every AI task request should include:

- `task_id`
- `task_type`
- `project_id`
- `bid_id`
- `bid_version_id`
- `requested_by`
- `prompt_contract`
- `inputs`
- `constraints`

### Required Behavior

- `task_id` must be generated before model call and remain stable through retries
- `task_type` must come from the approved logical catalog
- `prompt_contract` must point to the exact prompt template version used
- `inputs` must contain only task-relevant data, not an unbounded full-project dump
- `constraints` must carry all hard business restrictions

## Common Response Contract

Every AI task response should include:

- `task_id`
- `task_type`
- `status`
- `result`
- `confidence`
- `evidence_sources`
- `risk_flags`
- `need_manual_review`
- `trace`

### Status Values

- `SUCCESS`
- `PARTIAL`
- `FAILED`
- `BLOCKED`

### Trace Requirements

`trace` must retain:

- `runtime_task_type`
- `task_log_id`
- `model_id`
- `model_name`
- `model_version`
- `prompt_template_id`
- `prompt_template_version`
- `input_snapshot_id`
- `output_snapshot_id`
- `request_hash`
- `response_hash`

This is the minimum trace set needed for:

- auditing
- regression comparison
- KPI evaluation
- prompt rollback

## Task Catalog

| Logical Task | Family | Primary Purpose | Current Runtime Mapping |
| --- | --- | --- | --- |
| `PARSE_PROJECT_OVERVIEW` | `parse` | 提取项目核心信息、重点、风险摘要 | `BID_ANALYZE_STAGE2` + `BID_ANALYZE` |
| `CLASSIFY_CLAUSES` | `parse` | 对条款切片做语义分类和路由建议 | `BID_ANALYZE_STAGE2` + clause registry build |
| `EXTRACT_SCORE_ITEMS` | `parse` | 抽取评分项、分值、得分逻辑和建议响应点 | `BID_ANALYZE_STAGE2` + rule merge |
| `MATCH_ENTERPRISE_ASSETS` | `match` | 为条款/评分项召回企业资料和案例证据 | parse workspace match recommendation flow |
| `GENERATE_SECTION_DRAFT` | `generate` | 生成章节草稿 | `BID_COMPOSE_DRAFT` |
| `GENERATE_RESPONSE_TEXT` | `generate` | 生成偏离表/应答表文本 | `REWRITE` now, dedicated task later |
| `OPTIMIZE_DRAFT_CONTENT` | `generate` | 对现有章节做补强、改写、扩写、压缩 | score optimization + `REWRITE` |
| `EXPLAIN_RISK_FLAGS` | `validate` | 对风险、覆盖不足、冲突给出可读解释 | check issues + future dedicated AI task |
| `EXPORT_PACKAGE_SUMMARY` | `export` | 生成导出前摘要、缺失项、审查清单 | export center precheck + future AI summary |

## Family Design

### Parse Family

Parse family only handles understanding and extraction.

It must not:

- declare final compliance
- declare final satisfy / not satisfy judgments
- declare final废标结论

It may produce:

- extracted project facts
- clause classification suggestions
- score item candidates
- parse warnings
- missing information markers

### Match Family

Match family is retrieval-oriented.

It must return:

- retrieved assets
- match scores
- reasons
- evidence and freshness hints

It must not:

- auto-claim the asset is approved for submission
- auto-claim a certificate is still valid

### Generate Family

Generate family creates editable draft content.

It must:

- organize content around score items and tender requirements
- cite real asset ids where available
- surface unsupported claims

It must not:

- invent qualifications
- invent cases
- invent parameters
- invent service capabilities

### Validate Family

Validate family is explanatory, not authoritative.

It may:

- explain why a rule flagged risk
- summarize conflict patterns
- explain coverage gaps

It must not replace rule-engine final judgment.

### Export Family

Export family is packaging assistance only.

Actual file assembly and compliance gating remain owned by:

- backend export logic
- rule checks
- human review

This family may summarize:

- export readiness
- missing materials
- recommended review checklist

## Prompt Contract Template

Every task-level prompt contract must define:

- `prompt_template_id`
- `prompt_template_version`
- `system_role`
- `task_objective`
- `input_blocks`
- `must_rules`
- `must_not_rules`
- `output_schema_id`
- `manual_review_when`

### Required `must_rules`

At minimum:

- only use provided input
- output fixed JSON
- preserve evidence references
- explicitly declare missing information

### Required `must_not_rules`

At minimum:

- do not fabricate qualification
- do not fabricate case
- do not fabricate parameter
- do not fabricate service capability
- do not make final legal or compliance judgment

## Manual Review Rules

The following situations must always set `need_manual_review: true`:

- qualification or authorization is referenced
- satisfy / not satisfy is claimed for technical parameters
- arrival time or service commitment is claimed
- personnel or case evidence is cited
- export readiness is blocked by missing mandatory material
- parse result confidence is low

## Runtime Mapping Rules

### Existing Tables And Fields To Reuse

- prompt templates: `tender_ai_prompts`
- task logs: `tender_ai_task_logs`
- generate runtime summaries: `analysis_summary_json`, `stage_outputs`, `generated_artifacts`
- clause runtime registry: `tender_requirement_registry`
- project draft runtime data: draft workspace and score/check tables

### Required Future Normalization

Later implementation should add stable persistence for:

- logical `task_id`
- `prompt_template_version`
- `output_schema_id`
- logical-to-runtime task mapping
- input / output snapshot ids

## Deliverables For This Gap

This design defines `GAP-0017` as complete when the following artifacts exist:

1. one design note for how the AI contract layer fits into the current tender system
2. one implementation plan for later runtime rollout
3. one OpenAPI/YAML contract spec with approved request / response schemas and prompt contracts

That is enough to make the contract approved for implementation without forcing an immediate runtime refactor.

## Non-Goals

This round does not:

- change runtime endpoints
- change prompt storage schema
- add semantic retrieval code
- add evaluation pipeline code
- add retry / takeover code

Those remain follow-up execution items under:

- `GAP-0019`
- `GAP-0026`
- `GAP-0027`
