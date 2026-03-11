# Tender Deviation Decision Hardening Design

**Date:** 2026-03-09

## Goal

Complete `GAP-0009` by upgrading deviation and response artifacts from plain wording rows to structured decision rows that always carry:

- `parameter_key`
- satisfy or not-satisfy decision basis
- `evidence_source`
- `risk_grade`

This round keeps the existing deviation/response generation entry point and strengthens the row schema plus workspace persistence.

## Current Gap

The current `buildDeviationAndResponseTables` already outputs:

- `satisfy_status`
- `evidence_source`
- `risk_level`
- `manual_review_required`

But it still has three gaps:

- no stable `parameter_key` for downstream linking
- no structured decision basis explaining why a row is marked satisfied or not
- draft workspace normalization and UI do not preserve or expose these stronger fields

That means the response tables still look usable but are not strict enough for downstream audit and review.

## Recommendation

Keep one row contract shared by both:

- generated artifacts
- draft workspace persistence
- frontend editing state

Use additive fields only. Do not remove existing fields like `satisfy_status`, `risk_level`, or `manual_review_required`.

## Target Row Contract

### Deviation Table Row

```json
{
  "item_no": "3.2.1",
  "parameter_key": "PARAM_3_2_1_CPU_MAIN_FREQ",
  "tender_requirement": "CPU 主频不低于 3.0GHz",
  "bidder_response": "满足，详见产品参数表。",
  "deviation_note": "无偏离",
  "satisfy_status": "SATISFIED",
  "satisfy_basis": "依据投标响应“满足”与偏离说明“无偏离”综合判定。",
  "evidence_source": "产品参数表",
  "risk_level": "LOW",
  "risk_grade": "LOW",
  "manual_review_required": false
}
```

### Response Table Row

```json
{
  "item_no": "3.2.1",
  "parameter_key": "PARAM_3_2_1_CPU_MAIN_FREQ",
  "tender_requirement": "CPU 主频不低于 3.0GHz",
  "response_text": "满足，所投产品 CPU 主频不低于 3.0GHz。",
  "satisfy_status": "SATISFIED",
  "satisfy_basis": "依据参数要求与响应文本判定。",
  "evidence_source": "产品参数表",
  "risk_level": "LOW",
  "risk_grade": "LOW",
  "manual_review_required": false
}
```

Design rule:

- `risk_grade` is the public-facing alias of `risk_level`
- `parameter_key` must be stable for one requirement row
- `satisfy_basis` must explain the rule basis, not只是复制响应文本

## Parameter Key Strategy

Build `parameter_key` deterministically from:

1. explicit serial like `item_no / param_serial`
2. parameter name if present
3. normalized requirement text fallback

Examples:

- `3.2.1 + 双机热备` -> `PARAM_3_2_1_双机热备`
- no serial + `支持双机热备` -> `PARAM_支持双机热备`

Final storage should normalize punctuation and spaces so the key stays stable across save/load cycles.

## Decision Basis Strategy

`satisfy_basis` should be synthesized from deterministic inputs:

- response tokens: `满足 / 不满足 / 支持 / 无法满足`
- deviation tokens: `无偏离 / 有偏离 / 负偏离`
- mandatory or invalid-on-negative flags

Examples:

- positive response + no deviation -> `依据投标响应“满足”和偏离说明“无偏离”判定为满足。`
- negative response or negative deviation -> `依据投标响应“不满足”或偏离说明“负偏离”判定为不满足。`
- no explicit token -> `缺少明确满足/不满足判定词，需人工确认。`

## Risk Grade Strategy

Continue existing logic but expose one stable public field:

- mandatory or invalid-on-negative and not satisfied -> `HIGH`
- ambiguous decision -> `MEDIUM`
- clearly satisfied -> `LOW`

Both `risk_level` and `risk_grade` should carry the same normalized value in this round.

## Persistence and UI Scope

Required backend/frontend updates:

- generated artifact rows include the new fields
- draft workspace save/load preserves the new fields
- artifact editor UI exposes:
  - `parameter_key`
  - `satisfy_basis`
  - `evidence_source`
  - `risk_grade`

Do not build a separate parameter review page in this round.

## Testing Strategy

Regression should prove:

1. generated rows always contain `parameter_key`
2. generated rows always contain `satisfy_basis`
3. risk grade follows strict rule outcomes
4. workspace normalization preserves the new fields
5. save payload keeps the fields intact

## Expected Outcome

After this change, every deviation or response row will be auditable enough for later rule checks, manual review, and downstream export logic.
