# Tender 项目级解析到生成桥接设计

## 目标

完成 `GAP-0005` 的最后一段桥接，让项目级解析工作台产生的“主文件 + 澄清 + 附件”统一结果，可以直接在当前项目内生成初稿，而不是退回旧的单文件生成向导。

## 现状

- 项目级解析工作台已经支持多文件上传、ZIP 递归解压、Excel sheet 勾选、字段合并和条款/表格落库。
- 旧生成向导仍然只接受单个 `file`，分析后再新建一个 `bid`。
- 这导致“多文件联合解析”已经存在，但没有接回当前项目的生成主链路。

## 方案对比

### 方案 A：重写旧生成向导，改成多文件上传

- 优点：入口统一，看起来最“彻底”。
- 缺点：会把现有单文件向导、历史 smoke 和前端交互一起打散，改动面太大。

### 方案 B：在项目级解析工作台新增桥接生成接口

- 优点：最小改动，直接复用最新 parse job、现有生成任务结构、现有 draft/version/check/optimize 链路。
- 缺点：短期内会同时存在“旧单文件向导”和“项目级桥接生成”两套入口。

### 方案 C：解析完成时自动触发生成

- 优点：操作最少。
- 缺点：过度耦合，用户没法先核对解析结果，也不利于失败重试和模板选择。

## 结论

采用方案 B。

新增一条项目级桥接链路：

1. 从当前 `bid` 的最新 parse job 读取 `merged_fields / clauses / tables`。
2. 复用现有分析结果结构，生成 `analysis_summary_json`、`requirement_registry`、`clause_registry_v2`。
3. 在 `tender_bid_generate_jobs` 落一条关联当前 `bid` 的生成任务。
4. 基于当前项目直接创建新版本、draft sections、evidence registry 和初稿文档。
5. 前端在解析工作台补最小的模型/模板选择和“从解析结果生成初稿”按钮。

## 数据与接口设计

### 新接口

- `POST /api/tender/bids/:id/generate/from-parse`

请求体：

- `model_id`：可选，沿用 AI 模型选择
- `doc_template_id`：必填，沿用现有模板体系
- `bid_category`：可选；未传时优先取项目已有类型，否则根据 parse result 推断

响应体：

- `job`
- `bid`
- `version`
- `draft`
- `draft_sections`
- `clause_registry_v2`
- `chapter_schema_validation`
- `warnings`

### 行为约束

- 必须存在最新 parse job，且至少有条款或表格。
- 生成对象是“当前项目”，不再新建 `tender_bids`。
- `tender_bid_generate_jobs.created_bid_id` 直接写当前 `bid_id`，保证 draft workspace、check、score-optimize 继续复用已有查询逻辑。

## 后端实现要点

- 抽出一段“基于结构化输入生成分析摘要”的 helper，输入为 parse detail，输出尽量贴近旧 analyze route 的 `analysis_summary_json`。
- 再抽出“基于 analysis summary 在当前项目创建版本”的 helper，避免复制整段旧 create 逻辑。
- requirement registry、draft sections、evidence registry 继续沿用现有 builder。
- 生成文档时仍走现有 chapter schema、route execution、word layout。

## 前端实现要点

- 在项目解析工作台增加：
  - 模型选择
  - 模板选择
  - “从解析结果生成初稿”按钮
- 成功后刷新：
  - 当前项目详情
  - draft workspace
  - generate jobs
  - bootstrap/stats

## 错误处理

- 无 parse job：提示先完成解析。
- parse 结果为空：提示先确认主文件/澄清/附件已成功解析。
- 无模板：提示先选择模板。
- 桥接生成失败：保留现有 parse workspace 状态，不回滚 parse 结果。

## 验证策略

- smoke 用例覆盖：
  - 创建项目
  - 上传 `MAIN`、`CLARIFICATION`、`ATTACHMENT`
  - 执行 parse/start
  - 调用项目级桥接生成
  - 断言生成任务关联当前 `bid`
  - 断言版本、draft sections、chapter schema validation 存在
- 前端至少保证入口可见、请求可发、成功后会刷新工作区。
