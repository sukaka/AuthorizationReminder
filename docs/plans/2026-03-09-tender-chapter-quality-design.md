# Tender Chapter Quality Design

## 背景

当前 tender 生成链路已经具备固定章节 schema、AI 起草、规则兜底、路由注入和模板出稿能力，但“章节生成器”在 backlog snapshot 中仍缺“章节级质量评分”。现状只能知道 `chapter_schema_validation` 是否命中固定骨架，无法快速判断每章内容是否过短、是否主要依赖 fallback、哪些章节需要优先人工复核。

## 目标

在不改数据库结构的前提下，为“生成初稿”链路补一个轻量的章节质量摘要：

- 后端对最终章节生成 `overall_score + grade + chapter_scores`
- 评分结果随 create 接口返回，并写入 `analysis_summary_json.stage_outputs`
- generate job 详情接口可读到该结果
- 前端在生成任务详情中展示总分、等级、重点预警和逐章分数

## 约束

- 不新增表，不引入新外部依赖
- 评分只做“内容质量可观察性”，不阻断生成
- 尽量复用现有 `draft-schema` / `analysis_summary_json` / `stage_outputs`
- 评分逻辑可解释，避免黑盒

## 备选方案

### 方案 A：只给整份文档一个总分

优点：实现最快。  
缺点：定位价值弱，用户仍不知道具体哪一章有问题。

### 方案 B：给每章打分，并汇总总分

优点：可解释性强，能直接服务人工复核；复用现有 schema 信息即可。  
缺点：需要补一个质量 summary helper，并在前端多一块展示。

### 方案 C：把质量评分做成独立风险校验规则

优点：体系更统一。  
缺点：要穿过 `/check` 链路，改动面更大，不适合当前连续收口。

## 结论

采用方案 B。

## 评分模型

输入：

- 固定 schema 定义
- `chapter_schema_validation`
- 归一化后的章节数组

输出：

- `overall_score`
- `grade`
- `high_risk_count`
- `chapter_scores[]`
- `summary_lines[]`

每章评分参考项：

- 是否命中固定 schema
- 是否来自 AI 章节还是 fallback 章节
- 是否为空
- 行数是否过少
- 字数是否过短
- 是否属于 required chapter

建议规则：

- required 且缺失：0 分
- 有内容的 required 章节：基础分较高
- fallback 章节扣分，但不判失败
- 行数/字数过短扣分
- extra AI 章节单独评分，不计为 required 缺失

## 数据落点

- `tender/backend/src/draft-schema.js`
  - 新增质量评分 helper
- `tender/backend/src/index.js`
  - 在 create 阶段生成 `chapter_quality_summary`
  - 写入 `analysis_summary_json.stage_outputs.chapter_quality_summary`
  - create 接口与 generate job 详情接口返回该字段
- `tender/frontend/src/App.jsx`
  - 在生成任务详情页展示章节质量卡

## 风险控制

- 评分只做提示，不参与阻断逻辑
- 所有字段都允许缺省，接口返回空对象时前端降级
- smoke 只验证字段存在和结构正确，不把分数绑定得过死

## 验证

- `tender/backend/tests/draft-schema.test.js`
  - 覆盖 required/fallback/extra/empty chapter 的质量评分
- `tender/backend/tests/smoke.e2e.test.js`
  - 覆盖生成结果存在 `chapter_quality_summary`
- `npm --prefix tender/frontend run build`
  - 确认前端展示未破坏构建
