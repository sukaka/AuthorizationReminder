# 聚信 AI 助手 4.0 候选 checkpoint

> 本文件用于锁定本地 4.0 候选的基线、测试结果和发布边界。它不是生产发布声明。

## 基线

- 记录时间：2026-07-16（Asia/Shanghai）
- 候选分支：`codex/ai-assistant-4.0`
- Git 基线提交：`150da87e347a6a56f97ba48442bbe3b7e51ba3de`
- 基线标签：`ai-assistant-v3.0.0`
- 目标版本：`4.0.0`（生产门禁通过前不改写版本号）
- 当前工作树：存在约 360 项未提交改动；这些改动包含候选实现、文档、测试以及历史/生成文件，未进行全量提交或清理。

## 已验证结果

- 后端全量（排除正式迁移执行）：`1147 passed, 10 skipped`
- 迁移、候选演练和发布门禁：`34 passed`
- 桌面端全量：39 个测试文件、`294 tests passed`
- Office/文档编辑定向回归：`16 passed`
- 事件签名、模板和 DOCX 复杂特性报告定向回归：`28 passed`
- `npm run typecheck`：通过
- `npm run build`：通过（仅有既有大 chunk 体积提示）
- 本地 release gate：`overall=pass`、`mode=local_temp_only`、`staging_or_network_used=false`、`repository_unchanged=true`

## 4.0 候选边界

已包含：统一状态/工具/恢复语义，工作流调度、事件、Outbox、等待和子流程，类型化节点、审批、Worker lease/fencing、审计与恢复，在线结构化块编辑（段落/表格/图片）、拖拽和键盘移动，DOCX 导入导出支持/降级/拒绝报告，多租户受控事件签名。

仍未达到生产发布条件：共享数据库正式迁移，staging 真实环境，真实登录授权、密钥和第三方 provider，多 Worker 灰度/回滚/连续生产监控，以及复杂 Word 浮动排版、批注、域和宏的无损往返。

## Git 操作说明

本 checkpoint 记录了 4.0 候选的可追溯基线和测试证据；由于工作树混有未确认归属的改动，不把全部文件强行提交为 4.0 发布提交，也不创建 4.0.0 生产标签。后续应先按功能范围筛选提交，再执行 4.0.0 release commit/tag。
