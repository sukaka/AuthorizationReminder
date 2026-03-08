# Tender Gap Backlog (v4.0.5)

Last updated: 2026-03-07
Owner: Codex + user

## Purpose

This file tracks items that are still "to be completed" for the tender auto-generation system.
For any new gaps found later, append them to this file instead of creating scattered notes.

## Append Rule

When a new gap is found, append a new item using this format:

- ID: `GAP-XXXX`
- Date: `YYYY-MM-DD`
- Area: `backend|frontend|pipeline|model|rules|docs`
- Status: `TODO|IN_PROGRESS|DONE|BLOCKED`
- Description: one clear sentence
- Acceptance: one measurable completion condition

## Current Gaps

### GAP-0001

- Date: `2026-03-07`
- Area: `rules`
- Status: `DONE`
- Description: Extend draft-check rules beyond current baseline, especially conflict checks, cross-section consistency checks, and parameter-by-parameter comparison.
- Acceptance: `/api/tender/bids/:id/check` includes these rule results with structured issue types and regression tests.

### GAP-0002

- Date: `2026-03-07`
- Area: `model`
- Status: `DONE`
- Description: Upgrade score optimization from rule-based suggestions to model-driven deep rewrite and close the loop with section write-back.
- Acceptance: optimization output can be applied to draft sections with traceable before/after records.

### GAP-0003

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `DONE`
- Description: Strengthen generated deliverables for deviation table, response table, implementation plan, after-sales plan, and training plan from usable skeleton to high-quality content.
- Acceptance: each deliverable has explicit completeness checks and quality thresholds in automated verification.

### GAP-0004

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Introduce unified clause contract and routing fields, and make analyze/create/check/score-optimize consume the same contract.
- Acceptance: analyze returns clause contract with routing metadata and downstream modules can execute by `response_mode`.

## Module Status Snapshot (3.1 ~ 3.8)

Snapshot date: `2026-03-07`

### 3.1 招标文件解析器

- Status: `PARTIAL`
- Done: 基础解析、章节识别、评分项/风险项提取、结构化输出与条款契约落库已完成。
- Not Done: 澄清文件并入、多附件联合解析、原文定位精度与稳定性增强。

### 3.2 条款分类引擎

- Status: `PARTIAL`
- Done: requirement_type + response_mode + route 路由链路可运行。
- Not Done: 原件/复印件、演示/样机、授权细分类等规则细化。

### 3.3 企业资料匹配器

- Status: `PARTIAL`
- Done: 规则匹配与证据注册链路已完成。
- Not Done: embeddings 语义检索召回与重排闭环。

### 3.4 章节生成器

- Status: `PARTIAL`
- Done: 固定章节骨架 + AI 起草 + 路由注入 + 模板出稿已完成。
- Not Done: 全章节强 Schema 约束输出与一致风格控制。

### 3.5 偏离表/应答表生成器

- Status: `PARTIAL`
- Done: 满足判定、证据来源、风险级别、人工复核标记已完成。
- Not Done: 参数字段映射完整性与更严格判定规则。

### 3.6 评分点优化器

- Status: `PARTIAL`
- Done: 覆盖矩阵、候选提取、优化建议、章节回写、before/after 审计已完成。
- Not Done: 历史中标经验学习与自动策略更新。

### 3.7 风险校验器

- Status: `PARTIAL`
- Done: 完整性/一致性/风险/格式核心规则已实现并入接口。
- Not Done: 签字盖章位、复杂跨表冲突、更多高风险规则扩展。

### 3.8 Word 装配与导出器

- Status: `PARTIAL`
- Done: 模板填充、导出、onlyoffice 编辑链路可用。
- Not Done: 目录/编号/页眉页脚/附录排序自动精排能力完善。

## New Gaps (from module snapshot)

### GAP-0005

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `TODO`
- Description: Add clarification-file merge and multi-attachment combined parsing into analyze pipeline.
- Acceptance: analyze input supports tender main file + clarification + attachments and outputs one unified parsed project object.

### GAP-0006

- Date: `2026-03-07`
- Area: `rules`
- Status: `TODO`
- Description: Refine clause taxonomy for original/copy requirements, demo/prototype requirements, and authorization variants.
- Acceptance: clause contract exposes deterministic subtype for those scenarios with route coverage tests.

### GAP-0007

- Date: `2026-03-07`
- Area: `model`
- Status: `TODO`
- Description: Introduce embeddings-based semantic retrieval for cases and solution fragments.
- Acceptance: enterprise material matcher supports semantic recall + score output + manual review gate.

### GAP-0008

- Date: `2026-03-07`
- Area: `backend`
- Status: `TODO`
- Description: Enforce structured section generation schema for all major draft chapters.
- Acceptance: chapter generator output validates fixed JSON schema for required chapters before assemble.

### GAP-0009

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `TODO`
- Description: Strengthen parameter mapping and strict satisfy/not-satisfy decision rules in deviation/response generation.
- Acceptance: every deviation row links parameter key, satisfy decision basis, evidence source, and risk grade.

### GAP-0010

- Date: `2026-03-07`
- Area: `model`
- Status: `TODO`
- Description: Add learning loop from winning bids to optimization strategy selection.
- Acceptance: score optimizer supports strategy profiles derived from historical winning records with audit trace.

### GAP-0011

- Date: `2026-03-07`
- Area: `rules`
- Status: `TODO`
- Description: Expand risk checker with signature/seal slot, cross-table conflict, and advanced contradiction rules.
- Acceptance: check API returns those new issue types with regression tests.

### GAP-0012

- Date: `2026-03-07`
- Area: `backend`
- Status: `TODO`
- Description: Improve Word assembly auto-layout for TOC/numbering/header-footer/appendix ordering.
- Acceptance: generated doc has deterministic TOC, numbering, header-footer, and appendix index alignment.

### GAP-0013

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `TODO`
- Description: Build the historical bid ingestion pipeline for project-level, section-level, clause-level, table-level, and attachment-level decomposition.
- Acceptance: one historical project can be ingested into normalized `kb_*` records with traceable source files and chunk outputs.

### GAP-0014

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Add dedicated knowledge-base tables for projects, clauses, score items, qualifications, specs, cases, personnel, templates, rules, and chunks instead of overloading runtime tables.
- Acceptance: schema migration creates `kb_*` tables and bridge fields between runtime snapshot tables and knowledge-base records.

### GAP-0015

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `TODO`
- Description: Standardize asset tagging and chunking rules for historical bids, enterprise materials, product specs, and reusable sections.
- Acceptance: all ingested assets produce normalized tags, chunk types, quality grades, and reusable flags under one standard.

### GAP-0016

- Date: `2026-03-07`
- Area: `model`
- Status: `TODO`
- Description: Add semantic retrieval on top of knowledge-base chunks for cases, solution fragments, and evidence candidates.
- Acceptance: material match flow can return hybrid recall results from rule-based filters plus chunk-level semantic search.

### GAP-0017

- Date: `2026-03-07`
- Area: `docs`
- Status: `TODO`
- Description: Formalize the staged AI task contract for parse, match, generate, validate, and export APIs with structured JSON outputs.
- Acceptance: each task has an approved request/response schema and prompt contract documented for implementation.

### GAP-0018

- Date: `2026-03-07`
- Area: `rules`
- Status: `TODO`
- Description: Build a reusable validation rule library from historical tender failures, qualification checks, attachment checks, and deviation rules.
- Acceptance: at least 100 normalized rule records can be maintained and executed by the validation layer.

### GAP-0019

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `TODO`
- Description: Establish the evaluation dataset and KPI pipeline for clause recognition, scoring coverage, material matching, risk recall, and export completeness.
- Acceptance: the system can run repeatable evaluations and compare versions against the agreed KPI baseline.

### GAP-0020

- Date: `2026-03-07`
- Area: `frontend`
- Status: `DONE`
- Description: Build the homepage workbench with project statistics, personal todo items, risk reminders, and recent project list.
- Acceptance: users can view dashboard metrics and navigate into project/risk/todo flows from one page.

### GAP-0021

- Date: `2026-03-07`
- Area: `frontend`
- Status: `IN_PROGRESS`
- Description: Complete the project lifecycle management page with create/edit/delete/archive, member assignment, and state transitions.
- Acceptance: project management supports the full lifecycle states defined in the product spec and records assignment/audit actions.

### GAP-0022

- Date: `2026-03-07`
- Area: `frontend`
- Status: `TODO`
- Description: Build the upload-and-parse workspace, clause classification page, and asset matching workspace defined in the product spec.
- Acceptance: users can upload tender/clarification/attachments, inspect parsed outputs, classify clauses, and confirm recommended assets in dedicated pages.

### GAP-0023

- Date: `2026-03-07`
- Area: `frontend`
- Status: `TODO`
- Description: Build the AI chapter editor, deviation/response table editor, and score coverage analysis views.
- Acceptance: users can generate, edit, compare, review, and optimize draft sections and tables from structured project data.

### GAP-0024

- Date: `2026-03-07`
- Area: `frontend`
- Status: `TODO`
- Description: Build the risk center, template management center, and export center with the required actions and statuses.
- Acceptance: users can inspect risks, manage templates, and export Word/PDF/package outputs from dedicated operational screens.

### GAP-0025

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Implement the product-layer workflow states, review flow, button confirmation rules, and autosave/version rollback behaviors.
- Acceptance: runtime APIs and persistence support the specified project states, review statuses, confirmation flows, and draft autosave/version history.

### GAP-0026

- Date: `2026-03-07`
- Area: `backend`
- Status: `TODO`
- Description: Formalize permission matrix, data scope control, and governance-layer logs for the tender system.
- Acceptance: menu/page/button/data permissions and mandatory logs are enforceable and auditable per role.

### GAP-0027

- Date: `2026-03-07`
- Area: `backend`
- Status: `TODO`
- Description: Implement standardized exception handling for upload, parse, generate, and export failures with retry and takeover paths.
- Acceptance: major failure classes return structured error codes/messages, write logs, and support retry or manual takeover.
