# Tender AI Capability Spec Integration Notes

**Date:** 2026-03-08

## Purpose

This note compares the user-provided "投标文件 AI 自动生成系统 AI 能力设计说明书" with the current tender system implementation and backlog, then defines how it should be integrated into the system as the upper-level AI capability design document.

## Core Judgment

The provided document should not replace the current runtime/module design.

It should sit above the current implementation as the system-wide AI design spec because it defines:

- AI boundary
- AI vs rules split
- task decomposition
- input and output contracts
- RAG principles
- risk control
- evaluation strategy
- version and trace requirements

The current codebase already implements part of this design, but the implementation is still scattered across runtime modules and lacks one unified AI contract layer.

## How It Maps To The Current System

### 1. AI Positioning

The document says:

- AI handles understanding, summarization, generation, optimization, and explanation
- rules handle fact validation and high-risk control
- manual review handles final risk decisions

This is already consistent with the current system direction:

- parsing / generation / optimization exist
- rule checks already exist
- review flow and audit traces already exist

This means the document can be adopted directly as the system's AI positioning statement.

### 2. Eight AI Capability Modules

The document defines these AI modules:

1. tender understanding
2. clause classification
3. score item extraction
4. knowledge recall enhancement
5. section generation
6. response-table text generation
7. content optimization and rewrite
8. risk explanation and assisted validation

The current system already has corresponding runtime modules:

- `3.1 招标文件解析器` -> tender understanding
- `3.2 条款分类引擎` -> clause classification
- `3.3 企业资料匹配器` -> knowledge recall enhancement
- `3.4 章节生成器` -> section generation
- `3.5 偏离表/应答表生成器` -> response-table text generation
- `3.6 评分点优化器` -> content optimization and rewrite
- `3.7 风险校验器` -> assisted validation

The main difference is:

- the current module snapshot mixes AI modules and non-AI runtime modules
- the provided document is a pure AI capability decomposition

So the right integration is:

- keep the current runtime decomposition for engineering delivery
- use the new document as the AI capability decomposition

### 3. AI Task Chain

The document recommends:

- project extraction
- clause splitting
- clause classification
- score extraction
- material retrieval
- section generation
- local optimization
- risk explanation

This matches the direction of the current staged pipeline, but the current system still lacks a fully formalized task contract layer.

This directly maps to existing backlog gap:

- `GAP-0017`: staged AI task contract formalization

### 4. Input / Output / Prompt / Traceability Rules

The document requires:

- structured input
- structured output
- fixed fields
- evidence sources
- confidence
- risk flags
- manual review marker
- prompt version, model version, output version trace

Current system status:

- some tasks already output structured JSON
- some stages already retain audit data and runtime artifacts
- but there is no fully unified AI response envelope across tasks
- prompt and model trace are not yet fully normalized as one contract system

This is one of the most important integration points.

### 5. RAG Design

The document requires:

- keyword filtering
- tag matching
- industry matching
- project-type matching
- semantic retrieval
- winning-bid priority
- quality priority
- validity filtering

Current system status:

- rule-based matching and asset confirmation already exist
- dedicated `kb_*` tables already exist
- hybrid semantic retrieval is still incomplete

This maps directly to:

- `GAP-0007`
- `GAP-0013`
- `GAP-0015`
- `GAP-0016`

### 6. Risk Control And Human Collaboration

The document requires:

- AI not to make factual decisions alone
- high-risk outputs to require manual review
- structured risk explanations
- manual confirmation at key nodes

Current system status:

- check and governance behaviors exist
- project review flow exists
- parse workspace already has manual classification and asset confirmation
- draft workspace is being added to support manual structured editing
- retry / takeover / exception taxonomy is still incomplete

This maps to:

- `GAP-0023`
- `GAP-0026`
- `GAP-0027`

### 7. Evaluation Strategy

The document defines KPI-oriented evaluation instead of “looks good” evaluation.

Current system status:

- there are tests and smoke checks
- but there is no formal evaluation dataset + KPI pipeline for extraction, retrieval, generation, and risk tasks

This maps directly to:

- `GAP-0019`

## What Is Already Aligned

The following parts are already broadly aligned with the document:

- AI + rules + manual review split
- multi-stage pipeline instead of one-shot full tender generation
- parse / classify / generate / optimize / check separation
- traceable versions, autosave, review, and audit logs
- project-scoped parse workspace
- project-scoped draft workspace direction

## What Is Not Yet Fully Aligned

The following parts still need explicit integration work:

### 1. No unified AI task contract layer

Need one standard request / response schema family for all AI tasks.

### 2. No unified output envelope

Every AI task should converge on fields like:

- `task_id`
- `task_type`
- `result`
- `confidence`
- `evidence_sources`
- `risk_flags`
- `need_manual_review`

### 3. RAG is not yet hybrid-complete

Current matching is still stronger on rules than on semantic retrieval and reranking.

### 4. Risk explanation is not yet a first-class AI task

The current system can produce check issues, but “why this is risky” still needs a dedicated explanation layer.

### 5. Evaluation is not yet productized

Need benchmark datasets, repeatable metrics, and version comparison baselines.

### 6. Version trace is still stronger at runtime than at AI-contract level

Need a normalized way to retain:

- prompt template version
- model version
- input snapshot id
- output snapshot id
- manual revision lineage

## Recommended Integration Method

### A. Use This Document As The Upper-Level AI Design Spec

Place it above:

- module snapshot
- product backlog
- endpoint design

It becomes the answer to:

- what AI should do
- what AI must not do
- what AI output must look like

### B. Keep Current Runtime Modules As Engineering Delivery Units

Do not rewrite the whole backlog into the document's chapter structure.

Instead:

- keep runtime modules for implementation tracking
- map each runtime module to one or more AI capabilities from the document

### C. Introduce A Unified AI Task Contract Layer

Add one cross-module contract family covering:

- `extract_project_summary`
- `classify_clause`
- `extract_score_items`
- `retrieve_assets`
- `generate_section`
- `generate_response_table_text`
- `rewrite_content`
- `explain_risk`

Each task should define:

- request schema
- response schema
- allowed risk flags
- mandatory manual review conditions
- prompt template id / version

### D. Add Product Nodes That Match The Document

Map the document's human checkpoints into product flow:

- parse result confirmation
- material match confirmation
- high-risk chapter confirmation
- deviation / response table confirmation
- export pre-final review

### E. Add Evaluation As A First-Class Delivery Track

The document's KPI section should become its own implementation track rather than staying descriptive only.

## Recommended Delivery Order

### Priority 1

Formalize the AI contract layer.

Direct backlog target:

- `GAP-0017`

### Priority 2

Finish project-scoped draft workspace so generated content, structured edits, checks, and optimization are all consumed inside one project.

Direct backlog target:

- `GAP-0023`

### Priority 3

Upgrade retrieval from rule-only dominant behavior to hybrid recall + rerank.

Direct backlog target:

- `GAP-0007`
- `GAP-0016`

### Priority 4

Add formal retry / takeover / structured exception handling for AI-heavy chains.

Direct backlog target:

- `GAP-0027`

### Priority 5

Build evaluation dataset and KPI pipeline.

Direct backlog target:

- `GAP-0019`

## Concrete System Changes Triggered By This Document

### Backend

- define unified AI task schemas and prompt contracts
- retain prompt version and model version on task output records
- normalize AI output envelopes
- add explicit risk-explanation task output

### Frontend

- expose structured AI outputs, not only final prose
- expose evidence sources and manual-review flags wherever AI is used
- expose risk explanation in readable form

### Docs

- treat the provided document as the AI master design doc
- link backlog items to its module sections
- avoid writing future AI requirements without mapping them back to this doc

## Final Conclusion

This document fits the current system very well, but at a higher layer than the existing runtime/module docs.

The right way to integrate it is:

- use it as the master AI capability spec
- map it onto the current runtime modules and backlog
- prioritize contract formalization, hybrid retrieval, evaluation, and draft workspace completion

In short:

- the current system already matches the document's direction
- the biggest missing piece is not core capability logic
- the biggest missing piece is the unified AI contract / trace / evaluation layer around those capabilities
