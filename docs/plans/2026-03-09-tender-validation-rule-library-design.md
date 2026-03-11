# Tender Validation Rule Library Design

**Date:** 2026-03-09

## Goal

Complete `GAP-0018` by turning scattered tender validation knowledge into one reusable rule library that:

- persists at least 100 normalized rule records in `kb_validation_rules`
- can be listed and resynced through backend APIs
- is executed by the draft validation layer through rule-to-issue matching

This round does not replace the existing deterministic checker implementation. It adds a maintainable rule metadata layer on top of it.

## Current Gap

The repository already has:

- deterministic validation logic in `final-draft-checks.js`
- draft check issue persistence in `tender_draft_check_runs / tender_draft_check_issues`
- a reserved table `kb_validation_rules`

What is missing:

- no seed rule library
- no normalized rule catalog for tender failures and compliance checks
- no API to view or resync validation rules
- no execution summary linking runtime issues back to rule library records

## Recommendation

Use the existing `kb_validation_rules` table as the canonical rule metadata store and add a backend-only rule library module with three responsibilities:

1. generate and normalize the base seed library
2. sync missing seed records into `kb_validation_rules`
3. map runtime check issues to active rule records and produce an execution summary

This keeps the core checker deterministic while making rule governance visible and maintainable.

## Library Scope

The first seed version should include at least 120 rules across five families:

### 1. Qualification Validity

Examples:

- qualification expired
- authorization expired
- personnel certificate missing
- performance window exceeded

### 2. Attachment Completeness

Examples:

- mandatory attachment missing
- attachment count mismatch
- signed page missing
- evidence reference missing

### 3. Deviation and Response

Examples:

- satisfied without evidence
- parameter compare missing
- deviation table conflict
- narrative vs table contradiction

### 4. Draft Consistency

Examples:

- project name mismatch
- project number mismatch
- stale template content
- placeholder not replaced

### 5. Export and Submission Readiness

Examples:

- toc missing
- signature slot missing
- signature slot incomplete
- appendix ordering risk

Each rule remains metadata-driven. The actual checking logic still runs inside existing code.

## Normalized Rule Shape

Each seed rule should fill the current table fields in a normalized way:

```json
{
  "rule_name": "DV-DRAFT-001 占位符未替换",
  "rule_type": "DRAFT_CONSISTENCY",
  "trigger_condition": "issue_type=placeholder_risk",
  "check_logic": "扫描正文和导出段落中的模板占位符。",
  "severity": "MEDIUM",
  "suggested_action": "替换全部模板变量后重新校验。",
  "active_flag": 1,
  "tags_json": {
    "issue_type": "placeholder_risk",
    "execution_module": "final_draft_checks",
    "scenario_key": "template_placeholder",
    "source_family": "draft"
  }
}
```

Design rule:

- `rule_type` is the coarse family
- `tags_json.issue_type` links the rule to runtime issue types
- `scenario_key` keeps seed records stable and reviewable

## Execution Model

Runtime flow:

1. `/api/tender/bids/:id/check` runs deterministic checks as before
2. backend loads active rules from `kb_validation_rules`
3. issues are decorated with matched rule summaries based on `tags_json.issue_type`
4. response returns:
   - decorated issues
   - `rule_execution` summary

This means the validation layer can say not only "what failed", but also "which maintained rules were triggered".

## Backend API Scope

Add two lightweight APIs:

- `GET /api/tender/kb/validation-rules`
  - list rules
  - filter by `rule_type`, `issue_type`, `active_flag`
- `POST /api/tender/kb/validation-rules/sync`
  - insert missing base seed rules
  - return inserted count and total count

No full CRUD is required in this round because the main acceptance is normalized persistence plus execution linkage.

## Rule Execution Summary

The check response should add:

```json
{
  "rule_execution": {
    "active_rule_count": 120,
    "matched_rule_count": 18,
    "triggered_issue_count": 4,
    "unmapped_issue_types": []
  }
}
```

Each issue may also carry:

- `matched_rules`

That array should stay compact and contain only the fields needed for traceability.

## Seeding Strategy

Seed rules on startup in an idempotent way:

- read existing `rule_name` values
- insert only missing seed records
- do not overwrite user-created rows

This avoids destructive migration behavior and works with a dirty dev database.

## Testing Strategy

Regression should prove:

1. seed library size is at least 100
2. sync logic inserts missing records only once
3. issue decoration links runtime issues to matching rule metadata
4. `/api/tender/kb/validation-rules` returns normalized records
5. `/api/tender/bids/:id/check` exposes `rule_execution`

## Expected Outcome

After this round, the tender system will have a real validation rule library foundation rather than isolated hard-coded checks, while still keeping the existing checker fast and deterministic.
