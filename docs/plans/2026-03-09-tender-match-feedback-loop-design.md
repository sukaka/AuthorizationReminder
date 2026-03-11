# Tender Match Feedback Loop Design

**Date:** 2026-03-09

## Goal

推进 `3.3 企业资料匹配器` 的“召回反馈闭环”，让 parse workspace 里的人工确认/替换/忽略结果可以反哺下一次资产推荐排序。

## Why This Scope

当前 `POST /api/tender/bids/:id/parse/matches/recommend` 已具备：

- 项目资产 + 知识库切块混合召回
- 规则分 / 语义分 / 重排分
- 推荐结果持久化到 `tender_bid_parse_matches`

但目前仍有一个明显断点：

- 用户在 parse workspace 里做了 `CONFIRMED / REPLACED / IGNORED`
- 下一次重新推荐时，这些人工结果不会被利用

这会导致系统反复推荐同类低价值结果，也无法优先抬升被多次确认过的资料。

## Recommendation

本轮只做反馈闭环，不硬接外部 embedding 服务。

原因：

- 仓库里已经有 `kb_asset_chunks.embedding_*` 字段，但没有现成的 embedding provider / job / vector store contract
- 在没有稳定契约的前提下补“真实 embedding 服务”容易制造不可验证接口
- 反馈闭环能直接提升推荐质量，且不改现有前后端调用方式

## Scope

本轮包括：

- 从历史 `tender_bid_parse_matches` 聚合 chunk/asset 级反馈先验
- 在 `semantic-retrieval` 重排时引入反馈分
- 在 bulk 保存匹配结果时，将反馈摘要写回 `payload_json`
- 在推荐结果 payload 中暴露反馈分与反馈摘要

本轮不包括：

- 外部 embedding 服务对接
- 异步向量生成任务
- 新增数据库表
- 前端新增独立反馈运营页

## Data Model

继续复用 `tender_bid_parse_matches.payload_json`，新增两类元数据。

### 1. 单条反馈摘要

写入每条人工保存的 match payload：

- `feedback_status`
- `feedback_updated_at`
- `feedback_actor`

说明：

- `feedback_status` 使用保存后的最终 `match_status`
- `feedback_actor` 只保留 `id / username`

### 2. 推荐时的反馈先验

推荐结果 payload 追加：

- `feedback_score`
- `feedback_summary`

`feedback_summary` 建议结构：

- `positive_count`
- `negative_count`
- `confirmed_count`
- `replaced_count`
- `ignored_count`
- `last_feedback_status`

## Feedback Aggregation

聚合维度按优先级分两层：

1. `chunk_id`
2. `asset_id`

原因：

- 知识库 chunk 往往没有 `asset_id`
- 项目资产推荐更适合按 `asset_id` 累积经验

聚合来源：

- `tender_bid_parse_matches`
- 仅统计有明确人工结论的状态：`CONFIRMED / REPLACED / IGNORED`

计分原则：

- `CONFIRMED`: 正向
- `REPLACED`: 弱正向，表示该条款确实需要资料，但原推荐可能不够准
- `IGNORED`: 负向

## Ranking Changes

当前重排主轴保留：

- `semantic_score`
- `rule_score`
- `quality_score`
- `freshness_score`

新增：

- `feedback_score`

推荐公式只做小幅偏置，不让历史反馈压倒当前语义相关性。目标是：

- 多次确认过的 chunk/asset 更容易进入前列
- 多次忽略过的 chunk/asset 会被适度下调
- 没有历史反馈的候选保持现有行为

## API Contract

### `POST /api/tender/bids/:id/parse/matches/recommend`

响应 contract 不变，只在 `payload` 内新增：

- `feedback_score`
- `feedback_summary`

### `PUT /api/tender/bids/:id/parse/matches/bulk`

请求 contract 不变。

服务端在保存时自动补充：

- `payload.feedback_status`
- `payload.feedback_updated_at`
- `payload.feedback_actor`

## Testing

至少覆盖：

1. 同等语义条件下，带正向反馈的候选排序更高
2. 被忽略过的候选会被压低
3. bulk 保存时会写入反馈摘要
4. 推荐结果会返回 `feedback_score / feedback_summary`

## Success Criteria

- 用户无需改操作方式
- 手工确认/忽略能够影响下一次推荐顺序
- 所有改动保持接口兼容
- 单测和 smoke 回归通过
