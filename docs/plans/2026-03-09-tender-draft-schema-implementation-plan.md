# Tender 章节生成强 Schema 实现计划

## 目标

完成 `GAP-0008`，让章节生成先过固定骨架校验，再进入路由与装配。

## 实施步骤

1. 先补 helper 单测
- 新增 `tender/backend/tests/draft-schema.test.js`
- 覆盖：
  - SERVICE schema 归一化
  - PRODUCT schema 缺项校验

2. 新增 helper
- 新增 `tender/backend/src/draft-schema.js`
- 输出：
  - `buildDraftChapterSchema`
  - `normalizeDraftChaptersToSchema`

3. 接入生成链路
- 在 `BID_COMPOSE_DRAFT` 前保留 baseline chapters
- 将 `draft_schema` 作为输入透传给 AI
- AI 返回后执行 schema normalization
- 缺失 required chapter 时自动回退 baseline

4. 返回显式验证结果
- `POST /api/tender/bids/generate/jobs/:id/create`
- 响应新增 `chapter_schema_validation`
- operation log 也保留同名字段

5. 回归
- `tests/draft-schema.test.js`
- 目标 smoke：`should upload sample then analyze and create draft from generate job`
- `tender.sh`

## 风险控制

- schema helper 只约束 required chapters，不吞掉 AI extra chapters
- AI 不命中标题时仍可用 alias 映射
- baseline 继续作为最终兜底，避免 create 链路被 AI 波动拖死
