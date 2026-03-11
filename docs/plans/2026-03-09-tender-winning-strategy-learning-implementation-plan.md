# Tender 中标经验学习闭环实现计划

## 目标

完成 `GAP-0010`，让 score optimizer 能基于历史中标项目生成策略画像，并把 learned trace 写入优化记录。

## 实施步骤

1. 先补 helper 单测
- 在 `tender/backend/tests/score-optimization.test.js` 新增：
  - profile 聚合测试
  - learned suggestion 应用测试

2. 扩展 `score-optimization.js`
- 新增：
  - `buildWinningStrategyProfiles`
  - `pickWinningStrategyProfile`
  - `applyWinningStrategyToSuggestions`
- 扩展：
  - `normalizeOptimizationResponse`
  - `applyOptimizationToSections`

3. 接入 `/score-optimize`
- 从 `kb_projects` 读取 `WON` 项目
- 加载对应 `kb_score_items` 和 `kb_section_assets`
- 选择最匹配的 strategy profile
- 将 learned strategy 合并进建议正文
- 返回 `strategy_profile / strategy_matched_count`

4. 扩展持久化
- `tender_score_optimization_records` 增加：
  - `strategy_profile_key`
  - `audit_trace_json`
- 写入历史高分要点、章节模式和来源项目 ID

5. 补前端可见性
- `draft-workspace.js` 归一化优化记录里的 learned trace
- `App.jsx` 在评分优化区展示策略画像和来源中标项目

6. 回归
- `tests/score-optimization.test.js`
- 目标 smoke：`should upload sample then analyze and create draft from generate job`
- `tender/frontend/src/draft-workspace.test.js`
- `npm --prefix tender/frontend run build`
- `tender.sh`

## 风险控制

- 只读取 `WON` 项目，不影响未中标素材
- 没有匹配 profile 时自动回退到原有 rule/AI 优化逻辑
- 仅追加 learned directive，不覆盖人工/AI 已生成内容
