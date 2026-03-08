# 投标系统运行态表与知识库表映射设计

## 1. 目标

本设计用于回答一个核心问题：

当前系统已经有一套在线运行表，新的数据建设方案是否可以直接塞进现有表结构？

结论：

- 可以整合进系统
- 但不应该直接混表
- 应采用“运行态表 + 知识库表”双层架构

## 2. 两层模型定义

### 2.1 运行态表

运行态表服务于“单次投标任务”的执行过程，特点是：

- 强时效
- 强任务关联
- 强审计
- 强当前版本语义

当前已存在的核心对象：

- `tender_bids`
- `tender_bid_generate_jobs`
- `tender_requirement_registry`
- `tender_evidence_registry`
- `tender_draft_section_registry`
- `tender_draft_check_runs`
- `tender_draft_check_issues`
- `tender_score_coverage_matrix`
- `tender_score_optimization_records`
- `tender_doc_templates`

### 2.2 知识库表

知识库表服务于“长期资料沉淀与复用”，特点是：

- 弱任务耦合
- 强复用
- 强标签
- 强检索
- 强历史语义

建议新建 `kb_*` 表：

- `kb_projects`
- `kb_tender_clauses`
- `kb_score_items`
- `kb_company_qualifications`
- `kb_product_specs`
- `kb_section_assets`
- `kb_project_cases`
- `kb_personnel_assets`
- `kb_document_templates`
- `kb_validation_rules`
- `kb_asset_chunks`
- `kb_ingest_jobs`

## 3. 为什么不能直接混表

### 3.1 `tender_bids` 不等于历史项目库

`tender_bids` 的含义是：

- 当前系统内正在制作或管理的一份投标文件

而历史项目库中的 `projects` 含义是：

- 已发生过的招标项目或投标项目
- 可能中标，也可能未中标
- 可能只是知识来源，不一定是当前投标任务

因此：

- `tender_bids` 不应直接承担历史项目库功能
- 历史项目应该单独进入 `kb_projects`

### 3.2 `tender_requirement_registry` 不等于长期条款库

当前 `tender_requirement_registry` 的作用是：

- 针对一次 analyze 任务保存解析出的 requirement 快照

它适合作为运行快照，不适合作为长期知识库，因为缺少：

- 历史版本
- 长期标签
- 资料来源关系
- 跨项目复用语义

因此：

- 运行态继续保留 `tender_requirement_registry`
- 历史沉淀另建 `kb_tender_clauses`

### 3.3 `tender_evidence_registry` 不等于企业资料主库

当前 `tender_evidence_registry` 保存的是：

- 某次出稿时冻结下来的证据快照

它不适合直接承担企业资料主库能力，因为缺少：

- 有效期管理
- 标签与适用行业
- 原始文件分类
- 复用开关

因此企业长期资料必须单独沉淀为：

- `kb_company_qualifications`
- `kb_product_specs`
- `kb_personnel_assets`
- `kb_project_cases`

## 4. 推荐映射关系

### 4.1 项目层

```text
kb_projects
  -> 可作为历史招标/投标/案例项目主数据

tender_bids
  -> 当前在线制作中的投标项目
```

建议增加桥接关系：

- `tender_bids.source_kb_project_id`
- `tender_bid_generate_jobs.source_kb_project_ids_json`

### 4.2 条款层

```text
kb_tender_clauses
  -> 历史项目条款库

tender_requirement_registry
  -> 当前任务 requirement 快照
```

建议增加桥接字段：

- `tender_requirement_registry.source_kb_clause_id`

### 4.3 评分项层

```text
kb_score_items
  -> 历史评分项知识库

tender_score_coverage_matrix
  -> 当前草稿评分覆盖快照
```

建议增加桥接字段：

- `tender_score_coverage_matrix.source_kb_score_item_id`

### 4.4 素材与证据层

```text
kb_section_assets / kb_project_cases / kb_company_qualifications / kb_product_specs / kb_personnel_assets
  -> 长期素材库

tender_evidence_registry
  -> 某次投标任务的证据冻结快照
```

建议桥接方式：

- `tender_evidence_registry.library_record_id`
- `tender_evidence_registry.source_json.source_table`
- `tender_evidence_registry.source_json.source_kb_id`

### 4.5 模板层

```text
kb_document_templates
  -> 结构化模板主库

tender_doc_templates
  -> 当前在线可选 Word 模板
```

建议策略：

- 保留 `tender_doc_templates` 作为运行态模板上传与启用表
- 新增 `kb_document_templates` 管理模板分类、版本和适用场景
- 两者通过 `kb_template_id` 建桥

## 5. 推荐新增对象

为了让数据层真正可用，建议在你原有表设计基础上再补 2 类对象。

### 5.1 Chunk 表 `kb_asset_chunks`

作用：

- 为 embeddings 检索服务
- 控制最小复用粒度
- 允许按小节、参数块、评分项应答块精准召回

字段建议：

- `id`
- `asset_type`
- `source_table`
- `source_id`
- `project_id`
- `section_name`
- `sub_section_name`
- `chunk_type`
- `chunk_text`
- `tags_json`
- `embedding_status`
- `embedding_model`
- `embedding_vector_ref`
- `quality_score`
- `reusable_flag`

### 5.2 入库任务表 `kb_ingest_jobs`

作用：

- 跟踪“历史资料导入、拆分、打标签、抽取”的过程
- 防止知识库建设无审计

字段建议：

- `id`
- `job_type`
- `source_file`
- `status`
- `input_payload`
- `output_summary`
- `error_message`
- `operator`
- `created_at`
- `updated_at`

## 6. API 映射建议

你给的接口思路可以直接纳入现有系统，但建议区分：

### 6.1 运行态接口

保留现有风格：

- `/api/tender/bids/generate/analyze`
- `/api/tender/bids/generate/jobs/:id/create`
- `/api/tender/bids/:id/check`
- `/api/tender/bids/:id/score-optimize`

### 6.2 知识库接口

新增独立接口域更清晰：

- `POST /api/tender/kb/ingest`
- `POST /api/tender/kb/parse`
- `POST /api/tender/kb/materials/match`
- `POST /api/tender/kb/section/generate`
- `POST /api/tender/kb/validate/check`
- `POST /api/tender/kb/export/word`

原则：

- 不把知识库建设接口塞进当前投标运行接口
- 不让运行态 API 直接承担历史资料治理职责

## 7. 分阶段整合策略

### 第 1 阶段：不动运行态表主结构

只做：

- 新增 `kb_*` 表
- 通过外键或 `source_json` 建立映射
- 运行态继续复用现有表

优点：

- 风险最小
- 不影响当前已跑通链路

### 第 2 阶段：建立“知识库 -> 运行快照”复制逻辑

流程：

- 从 `kb_*` 召回素材
- 映射到 `tender_evidence_registry`
- 映射到 `tender_requirement_registry`
- 生成当前版本的章节与评分优化数据

### 第 3 阶段：建立评测与学习闭环

流程：

- `kb_projects` 标记是否中标
- `kb_section_assets` 标记质量分与复用效果
- `kb_score_items` 标记命中率与得分表现
- 后续支持 embeddings 检索与策略学习

## 8. 不建议的做法

以下做法不建议采用：

- 用 `tender_bids` 直接充当历史项目台账
- 用 `tender_evidence_registry` 直接充当企业资料总库
- 用 `tender_requirement_registry` 直接做长期条款知识库
- 用一个接口同时承担“资料治理 + 在线生成”
- 用整篇文档做 embeddings，不做 chunk

## 9. 最终建议

这份数据建设方案应整合进当前系统，但整合方式应为：

```text
现有在线生成引擎
  + 新增知识库层
  + 新增资料治理层
  + 新增评测层
```

即：

- 保留现有运行态表，继续服务当前投标任务
- 新增 `kb_*` 表，服务历史资料沉淀、规则、检索、评测
- 通过快照机制把知识库内容映射到当前投标任务

这才是可扩展、可审计、可维护的落地方式。
