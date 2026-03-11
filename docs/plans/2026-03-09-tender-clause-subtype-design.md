# Tender Clause Subtype Design

**Date:** 2026-03-09

## Goal

Complete `GAP-0006` by refining tender clause classification so the system can deterministically expose subtype information for:

- original vs copy requirements
- demo vs prototype requirements
- authorization variants

This round keeps the current clause type families and adds one subtype layer.

## Current Gap

The system already has coarse clause families such as:

- `QUALIFICATION`
- `TECHNICAL`
- `BUSINESS`
- `SCORING`

But it cannot distinguish several high-impact operational variants:

- original document required vs copy allowed
- demo required vs prototype required
- manufacturer authorization vs distributor authorization

That makes downstream routing and manual review prompts too generic.

## Recommendation

Keep the existing `clause_type` and add one stable field:

- `clause_subtype`

This field should be emitted by:

- parse clause extraction
- clause contract generation

It should also influence routing where necessary without replacing existing `requirement_type`.

## Target Subtypes

The first version should support these deterministic subtypes:

- `ORIGINAL_REQUIRED`
- `COPY_REQUIRED`
- `DEMO_REQUIRED`
- `PROTOTYPE_REQUIRED`
- `MANUFACTURER_AUTHORIZATION`
- `DISTRIBUTOR_AUTHORIZATION`

Fallback:

- `GENERAL`

## Classification Rules

### Original / Copy

Examples:

- `须提供原件`
- `提供复印件并加盖公章`

Rules:

- if text matches `原件|原章|原始件` -> `ORIGINAL_REQUIRED`
- else if text matches `复印件|扫描件|影印件` -> `COPY_REQUIRED`

### Demo / Prototype

Examples:

- `须现场演示`
- `须提供样机`

Rules:

- if text matches `演示|现场演示|demo` -> `DEMO_REQUIRED`
- else if text matches `样机|原型机|试制样品` -> `PROTOTYPE_REQUIRED`

### Authorization Variants

Examples:

- `须提供原厂授权`
- `须提供代理商授权`

Rules:

- if text matches `原厂授权|制造商授权|生产厂家授权` -> `MANUFACTURER_AUTHORIZATION`
- else if text matches `代理授权|经销商授权|渠道授权` -> `DISTRIBUTOR_AUTHORIZATION`

## Routing Strategy

Subtype should not replace `requirement_type`, but it should refine response mode defaults:

- `ORIGINAL_REQUIRED`
- `COPY_REQUIRED`
- `MANUFACTURER_AUTHORIZATION`
- `DISTRIBUTOR_AUTHORIZATION`
  - default `response_mode = EVIDENCE_BINDING`

- `DEMO_REQUIRED`
- `PROTOTYPE_REQUIRED`
  - default `response_mode = MANUAL_ONLY`

Everything else keeps the existing routing defaults.

## Contract Shape

`clause_contract_v2` should add:

```json
{
  "clause_type": "QUALIFICATION_REQUIREMENT",
  "clause_subtype": "MANUFACTURER_AUTHORIZATION",
  "response_mode": "EVIDENCE_BINDING"
}
```

Design rule:

- subtype must always be present
- use `GENERAL` when no specific subtype is recognized

## Testing Strategy

Regression should prove:

1. parse extraction tags subtype correctly for the six target scenarios
2. clause contract exposes `clause_subtype`
3. routing changes for authorization and demo/prototype scenarios are deterministic

## Expected Outcome

After this change, the clause contract will carry enough subtype information for downstream routing, manual review instructions, and later rule expansion.
