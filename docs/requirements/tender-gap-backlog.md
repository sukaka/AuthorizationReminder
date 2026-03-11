# Tender Gap Backlog (v4.0.5)

Last updated: 2026-03-09
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
- Done: 基础解析、章节识别、评分项/风险项提取、结构化输出与条款契约落库已完成；项目级解析工作台已支持招标文件/澄清/附件联合上传、ZIP 递归解压、Excel sheet 勾选解析。
- Not Done: 原文定位精度与稳定性增强、与生成主链路的更深一体化、复杂解析异常治理增强。

### 3.2 条款分类引擎

- Status: `PARTIAL`
- Done: requirement_type + response_mode + route 路由链路可运行；项目级条款分类编辑工作台已接入前后端；原件/复印件、演示/样机、原厂授权/代理授权等细分类已接通并产出 `clause_subtype`。
- Not Done: 更复杂附件组合、行业特化条款和长上下文跨段条款细分类仍待补充。

### 3.3 企业资料匹配器

- Status: `PARTIAL`
- Done: 规则匹配与证据注册链路已完成；项目级资产推荐、确认、替换、忽略工作台已接入前后端；hybrid semantic retrieval 已接通；项目级知识库沉淀已能把历史项目解析结果、章节稿和附件标准化入库并产出统一 chunk/tag；parse workspace 的推荐反馈闭环已接通，`CONFIRMED / REPLACED / IGNORED` 会写回反馈摘要并参与后续推荐重排。
- Not Done: 真实 embedding 服务替换。

### 3.4 章节生成器

- Status: `PARTIAL`
- Done: 固定章节骨架 + AI 起草 + 路由注入 + 模板出稿已完成；SERVICE / PRODUCT 两套章节强 schema 归一化与缺项兜底已接通；章节级质量评分摘要已接通。
- Not Done: 更细粒度小节 schema、风格一致性仍待增强。

### 3.5 偏离表/应答表生成器

- Status: `PARTIAL`
- Done: 满足判定、证据来源、风险级别、人工复核标记已完成；参数键、判定依据、风险等级结构化字段已接通。
- Not Done: 更复杂参数对齐与参数库级自动比对。

### 3.6 评分点优化器

- Status: `PARTIAL`
- Done: 覆盖矩阵、候选提取、优化建议、章节回写、before/after 审计已完成；历史中标项目策略画像、learned directive 和优化审计留痕已接通。
- Not Done: 更长期的自动策略更新、人工反馈反哺和在线学习仍待增强。

### 3.7 风险校验器

- Status: `PARTIAL`
- Done: 完整性/一致性/风险/格式核心规则已实现并入接口；规则库种子与 `/check` 执行摘要已接通；章节质量低分/缺章/高风险章节预警已接入 `/check`。
- Not Done: OCR 级签章识别、跨文档法律性校验、更细粒度规则运营界面。

### 3.8 Word 装配与导出器

- Status: `PARTIAL`
- Done: 模板填充、导出、onlyoffice 编辑链路可用；目录、章节编号、页眉页脚兜底、附录后置的自动精排已接通；基础导出与显式 TOC 占位符模板已支持 Word 原生目录域与 `updateFields` 刷新提示；基础导出和无正文占位符模板追加章节已支持章节级起新页分页；默认 footer 已支持 Word 页码域，封面隐藏页码，目录前置节默认使用 `lowerRoman`，正文节默认从 1 开始重新编号；默认导出与无正文占位符模板已支持奇偶页页眉页脚样式和 `evenAndOddHeaders`；复杂正文占位符模板在安全命中章节标题时已支持按逻辑行拆段，并接回原生 TOC / 分页 / 节样式链路；显式 `TOC_CONTENT` 模板在无文字“目录”标题时，也已支持把 TOC field 识别为分页和节样式边界；正文占位符在未命中 `pageBreakTitles` 时，已支持对 `目录 / 第X章 / 附录X / 附件X` 这类标准章节样式做启发式拆段与标题提升；表格单元格中的正文占位符拆段已改为原位替换，`w:tbl / w:tr / w:tc` 容器结构可保留；`w:txbxContent` 文本框中的正文占位符也已支持 tokenization/restore 后的安全拆段；常见非标准标题样式（`一、 / （一） / 1.1`）也已支持启发式拆段与标题提升。
- Not Done: 更复杂 shape / VML 变体，以及更深层模板分页边界仍待增强。

## New Gaps (from module snapshot)

### GAP-0005

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `DONE`
- Description: Bridge parse workspace multi-file result into the generate pipeline for the current bid.
- Acceptance: parse workspace can combine tender main file + clarification + attachments into one unified project parse result and generate draft directly from that result.

### GAP-0006

- Date: `2026-03-07`
- Area: `rules`
- Status: `DONE`
- Description: Refine clause taxonomy for original/copy requirements, demo/prototype requirements, and authorization variants.
- Acceptance: clause contract exposes deterministic subtype for those scenarios with route coverage tests.

### GAP-0007

- Date: `2026-03-07`
- Area: `model`
- Status: `DONE`
- Description: Introduce embeddings-based semantic retrieval for cases and solution fragments.
- Acceptance: enterprise material matcher supports semantic recall + score output + manual review gate.

### GAP-0008

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Enforce structured section generation schema for all major draft chapters.
- Acceptance: chapter generator output validates fixed JSON schema for required chapters before assemble.

### GAP-0009

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `DONE`
- Description: Strengthen parameter mapping and strict satisfy/not-satisfy decision rules in deviation/response generation.
- Acceptance: every deviation row links parameter key, satisfy decision basis, evidence source, and risk grade.

### GAP-0010

- Date: `2026-03-07`
- Area: `model`
- Status: `DONE`
- Description: Add learning loop from winning bids to optimization strategy selection.
- Acceptance: score optimizer supports strategy profiles derived from historical winning records with audit trace.

### GAP-0011

- Date: `2026-03-07`
- Area: `rules`
- Status: `DONE`
- Description: Expand risk checker with signature/seal slot, cross-table conflict, and advanced contradiction rules.
- Acceptance: check API returns those new issue types with regression tests.

### GAP-0012

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Improve Word assembly auto-layout for TOC/numbering/header-footer/appendix ordering.
- Acceptance: generated doc has deterministic TOC, numbering, header-footer, and appendix index alignment.

### GAP-0013

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `DONE`
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
- Status: `DONE`
- Description: Standardize asset tagging and chunking rules for historical bids, enterprise materials, product specs, and reusable sections.
- Acceptance: all ingested assets produce normalized tags, chunk types, quality grades, and reusable flags under one standard.

### GAP-0016

- Date: `2026-03-07`
- Area: `model`
- Status: `DONE`
- Description: Add semantic retrieval on top of knowledge-base chunks for cases, solution fragments, and evidence candidates.
- Acceptance: material match flow can return hybrid recall results from rule-based filters plus chunk-level semantic search.

### GAP-0017

- Date: `2026-03-07`
- Area: `docs`
- Status: `DONE`
- Description: Formalize the staged AI task contract for parse, match, generate, validate, and export APIs with structured JSON outputs.
- Acceptance: each task has an approved request/response schema and prompt contract documented for implementation.

### GAP-0018

- Date: `2026-03-07`
- Area: `rules`
- Status: `DONE`
- Description: Build a reusable validation rule library from historical tender failures, qualification checks, attachment checks, and deviation rules.
- Acceptance: at least 100 normalized rule records can be maintained and executed by the validation layer.

### GAP-0019

- Date: `2026-03-07`
- Area: `pipeline`
- Status: `DONE`
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
- Status: `DONE`
- Description: Complete the project lifecycle management page with create/edit/delete/archive, member assignment, and state transitions.
- Acceptance: project management supports the full lifecycle states defined in the product spec and records assignment/audit actions.

### GAP-0022

- Date: `2026-03-07`
- Area: `frontend`
- Status: `DONE`
- Description: Build the upload-and-parse workspace, clause classification page, and asset matching workspace defined in the product spec, with project-scoped backend persistence and parse APIs.
- Acceptance: users can upload tender/clarification/attachments under an existing project, inspect parsed outputs, classify clauses, and confirm recommended assets in dedicated workspace panels.

### GAP-0023

- Date: `2026-03-07`
- Area: `frontend`
- Status: `DONE`
- Description: Build the AI chapter editor, deviation/response table editor, and score coverage analysis views.
- Acceptance: users can generate, edit, compare, review, and optimize draft sections and tables from structured project data.

### GAP-0024

- Date: `2026-03-07`
- Area: `frontend`
- Status: `DONE`
- Description: Build the risk center, template management center, and export center with dedicated frontend pages, backend export APIs, and export record persistence.
- Acceptance: users can inspect project risks, manage template fields/snippets/bundles and docx templates, and export Word/PDF/package outputs from dedicated operational screens with downloadable records.

### GAP-0025

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Implement the product-layer workflow states, review flow, button confirmation rules, and autosave/version rollback behaviors.
- Acceptance: runtime APIs and persistence support the specified project states, review statuses, confirmation flows, and draft autosave/version history.

### GAP-0026

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Formalize permission matrix, data scope control, and governance-layer logs for the tender system.
- Acceptance: menu/page/button/data permissions and mandatory logs are enforceable and auditable per role.

### GAP-0027

- Date: `2026-03-07`
- Area: `backend`
- Status: `DONE`
- Description: Implement standardized exception handling for upload, parse, generate, and export failures with retry and takeover paths.
- Acceptance: major failure classes return structured error codes/messages, write logs, and support retry or manual takeover.
