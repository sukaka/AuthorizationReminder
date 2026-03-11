# Tender 中标经验学习闭环设计

## 背景

当前 score optimizer 已具备：

- 评分覆盖矩阵
- 规则候选提取
- AI 改写
- 章节回写
- before/after 审计

但 `GAP-0010` 仍未完成，因为优化建议还主要基于当前项目的缺口判断，尚未利用历史中标项目沉淀出的高分应答模式。

## 目标

在现有 KB 基础上，为 `/score-optimize` 增加一层“中标经验学习”：

1. 从 `kb_projects` 中筛选已中标项目
2. 从 `kb_score_items` 和 `kb_section_assets` 抽取可复用的高分策略画像
3. 按当前项目类型/行业选择最匹配的策略 profile
4. 在评分优化建议中附加“历史中标策略”
5. 保留可追溯 audit trace

## 非目标

- 不做在线强化学习
- 不做自动改写模型微调
- 不做复杂反馈打分闭环
- 不改变现有 KB 入库结构

## 方案

### 策略画像来源

- `kb_projects.result_status = WON`
- `kb_score_items.recommended_response_points`
- `kb_section_assets.section_name / applicable_scene / source_score_item_id`

### 策略画像维度

按以下 key 聚合：

- `project_type | industry_type`
- `project_type | ALL`
- `ALL | ALL`

### 策略画像内容

每个 profile 输出：

- `profile_key`
- `won_project_count`
- `source_project_ids`
- `item_profiles`

每个 `item_profile` 输出：

- `item_name`
- `learned_points`
- `learned_sections`
- `source_project_ids`
- `source_score_item_ids`

### 运行时选择

当前项目优先匹配：

1. `project_type + industry_type`
2. `project_type + ALL`
3. `ALL + ALL`

### 运行时应用

在 rule/AI 生成的 `suggestion_text` 后追加：

- 历史中标策略
- 学到的高分要点
- 建议落位章节

并写入：

- `strategy_profile_key`
- `audit_trace_json`

## 审计留痕

### 接口返回

`/api/tender/bids/:id/score-optimize` 新增：

- `strategy_profile`
- `strategy_matched_count`

### 持久化

`tender_score_optimization_records` 新增：

- `strategy_profile_key`
- `audit_trace_json`

### 前端展示

项目级初稿工作台显示：

- 来源类型 `RULE / AI / RULE_LEARNED / AI_LEARNED`
- 策略画像 key
- 历史高分要点
- 来源中标项目 ID

## 验收

- helper 单测覆盖 profile 构建与 suggestion 应用
- `/score-optimize` 主链路不回退
- 优化记录可见 learned trace
