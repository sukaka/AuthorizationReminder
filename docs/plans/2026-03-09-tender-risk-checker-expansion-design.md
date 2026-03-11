# Tender Risk Checker Expansion Design

**Date:** 2026-03-09

## Goal

Complete `GAP-0011` by extending the draft risk checker with three missing rule classes:

- signature and seal slot completeness
- cross-table conflict detection
- advanced contradiction detection between draft sections and table artifacts

This round stays inside the existing `/api/tender/bids/:id/check` flow. It does not introduce a new rule engine service.

## Current Gap

The current checker already covers missing requirements, missing evidence, score gaps, stale template text, consistency conflicts, expiration risks, and simple docx risks.

What is still missing:

- `signature_slot_missing` is only a loose paragraph keyword check
- draft artifact rows are not passed into `runStructuredChecks`
- the checker cannot compare deviation tables, response tables, and narrative sections against each other

That leaves a blind spot for high-risk tender submission errors.

## Recommendation

Keep the current split:

- `runStructuredChecks` handles business-aware semantic and cross-artifact checks
- `runDocxChecks` keeps lightweight document-shape checks
- `mergeCheckResults` remains the single output aggregator

Add artifact-aware checks to `runStructuredChecks` instead of building a separate checker. This keeps the API surface stable and lets risk center reuse the same issue list immediately.

## New Rule Scope

### 1. Signature / Seal Completeness

Continue to emit `signature_slot_missing` when the draft has no signature-related content at all.

Add `signature_slot_incomplete` when the draft shows a partial signature area but lacks one or more required parts:

- signer marker: `法定代表人` / `授权代表` / `签字`
- seal marker: `盖章` / `签章`
- date marker: `日期` / `年 月 日`

Design rule:

- no signature markers at all -> `signature_slot_missing`
- some signature markers but required parts incomplete -> `signature_slot_incomplete`

This is still deterministic and avoids pretending we can verify an actual stamped file.

### 2. Cross-Table Conflict

Compare persisted draft artifact rows for the same tender requirement across:

- `DEVIATION_TABLE`
- `RESPONSE_TABLE`

Normalize each row to:

- requirement text key
- status polarity: `SATISFIED`, `UNSATISFIED`, `DEVIATED`, `UNKNOWN`

Emit `artifact_table_conflict` when the same requirement has incompatible statuses across tables, for example:

- deviation row says `无偏离 / 满足`
- response row says `不满足 / 有偏离`

### 3. Section vs Artifact Conflict

Use covered draft sections and artifact rows that refer to the same requirement.

Emit `section_artifact_conflict` when narrative text and artifact rows disagree on status polarity, for example:

- section says `完全满足 / 无偏离`
- table row says `存在偏离 / 不满足`

This focuses on direct contradiction, not general wording style differences.

## Data Flow Change

Current check flow:

1. load requirement registry
2. load draft section registry
3. load evidence registry
4. build paragraphs
5. run checks

Required change:

1. load draft artifact rows for current bid version
2. sanitize and pass them into `runStructuredChecks`

No database schema change is needed because draft artifact rows already exist.

## Output Contract

All new issues should continue to use the existing issue shape:

```json
{
  "type": "artifact_table_conflict",
  "severity": "WARN",
  "title": "",
  "message": "",
  "requirement_code": "",
  "requirement_title": "",
  "requirement_type": "",
  "section_title": "",
  "paragraph_text": ""
}
```

The new issue types for this round are:

- `signature_slot_incomplete`
- `artifact_table_conflict`
- `section_artifact_conflict`

## Risk and Boundary

This round does not attempt:

- OCR-level stamp recognition
- fuzzy semantic contradiction detection across unrelated paragraphs
- full document legality verification

The goal is to close obvious, high-impact contradictions with deterministic rules that are easy to test.

## Testing Strategy

Regression coverage should prove:

1. partial signature block emits `signature_slot_incomplete`
2. deviation table and response table contradiction emits `artifact_table_conflict`
3. section narrative and table contradiction emits `section_artifact_conflict`
4. existing checks still merge correctly through the API path

## Expected Outcome

After this change, `/api/tender/bids/:id/check` will catch a broader class of pre-submission risks without changing the frontend contract or introducing a new workflow.
