# 聚信 AI 助手 6.0 / 7.0 发布说明

> 版本范围：6.0 任务工作台 GA 能力 + 7.0 Agent Hub 地基
> 更新日期：2026-07-13

## 一句话

**6.0** 把「聊天」升级为可追踪的 **任务 / 步骤 / 成果 / 学习**；
**7.0** 在统一安全门禁下接入 **通道、外部 Agent、智能路由与工作流**。

---

## 6.0 用户可见能力

| 能力 | 入口 | 说明 |
|---|---|---|
| 任务中心 | 侧栏「任务中心」 | 发起、列表、步骤、引用、反馈、取消、重试 |
| 工作成果 | 侧栏「工作成果」 | 多格式导出、来源任务跳转、引用预览 |
| 引用预览 | 任务 / 成果 | 原文高亮片段 |
| 学习候选 | 学习中心 | 用户可见自己的候选；管理员审核后发布 |
| 复杂报告 | 任务运行 | 多角色检索→写作→自检；支持 Word 等导出 |

### 管理员 / 运营

- 运营看板：GA 门禁、就绪检查、安全审计、成本、灰度百分比
- 离线评测套件与 readiness 一键检查
- 学习禁止自动发布（硬门禁）

---

## 7.0 用户可见能力

| 能力 | 入口 | 说明 |
|---|---|---|
| Agent 市场 | 侧栏「Agent 市场」 | 本地/外部 Agent、健康与熔断、试调 |
| 工作流 | 侧栏「工作流」 | 预置串行/并行/条件；拖拽简易编排 |
| 厂商连接器 | Hub | `kimi.chat`、`jimeng.image`（无密钥 dry-run） |
| 出域分级 | 调用外部时 | L0–L3；机密拦截；敏感需确认 |
| 通道地基 | API | 飞书 / 企微消息入站与出站门禁 |

### 预置工作流示例

- `simple_route_invoke` — 智能路由并调用
- `parallel_dual` — 并行摘要+回声
- `vendor_kimi_jimeng` — Kimi 分析 + 即梦封面
- `condition_route_demo` — 长文走 Kimi

---

## 运维要点

```bash
# 就绪 / 安全 / GA
GET /api/ai/ops/readiness
GET /api/ai/ops/security-audit
GET /api/ai/ops/ga-report

# 每日观测 + 双周评估
python scripts/run_ga_observe.py --base-url $BASE --out ../docs/plans/ga-observe.jsonl
python scripts/evaluate_ga_observe.py --in ../docs/plans/ga-observe.jsonl --min-days 14

# Checkpoint 恢复
python scripts/run_checkpoint_recovery.py --local --cases 20
python scripts/run_multi_instance_checkpoint_drill.py --cases 10
```

灰度建议：管理员 → 5% → 20% → 50% → 100%。
出现高危出域 / 越权 / 错发：立即 `rollout_percent=0` 并停用相关 Agent。

---

## 已知边界

1. 真实 Kimi / 即梦需配置 API Key；默认 dry-run 便于 CI。
2. 工作流画布为轻量节点预览，非专业 React Flow 编辑器。
3. 连续两周生产观测仍需在目标环境执行，才能正式宣布 GA。
4. 多实例 checkpoint 演练脚本为同库双 Worker 模拟，生产需按 drill 文档补真实 kill 演练记录。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/ops-runbook-6.0-7.0.md` | 运维手册 |
| `docs/connector-sdk.md` | Connector 发布规范 |
| `docs/vendor-integration-checklist.md` | 厂商联调 |
| `docs/checkpoint-multi-instance-drill.md` | 恢复演练 |
| `docs/plans/2026-07-12-ga-observation-checklist.md` | GA 观测清单 |
| `docs/plans/2026-07-12-implementation-status.md` | 实施进度 |
