# 6.0/7.0 整合方案实施进度

> 对照：`2026-07-12-ai-assistant-6.0-7.0-integrated-master-plan-v2.md`
> 更新：2026-07-13（代码覆盖补完；正式环境验证不计入本次范围）

## 执行策略（用户确认）

- **目标**：整包方案最终做完（6.0 GA + 7.0）。
- **路径**：先补齐 **6.0 产品工作台**（任务/成果/学习/引用），再继续 7.0 治理与市场。
- **现状**：方案中的代码能力、数据契约和回归已补齐；正式环境验证按本轮范围排除。

## 总览

| 范围 | 状态 |
|---|---|
| 6.0 Phase 0–2 后端 MVP | **完成** |
| 6.0 Phase 3–4 检索/成果 | **代码覆盖完成** |
| 6.0 Phase 5 学习闭环 | **代码覆盖完成** |
| 6.0 Phase 6 运营 | **代码覆盖完成** |
| 6.0 前台：任务中心 | **代码覆盖完成** |
| 6.0 前台：成果中心 | **代码覆盖完成** |
| 7.0 通道 / Agent Hub | **代码覆盖完成** |

## 本轮（代码覆盖补完）

| 能力 | 实现 |
|---|---|
| 步骤级预算 | Run 持久化工具调用、令牌与时延上限；步骤写入时强制校验并返回明确预算错误码 |
| 成果物模板与审核 | 创建成果物保存模板/受众/风格/素材上下文；AI 与人工审核独立留痕、可查询 |
| 工作流版本 | 自定义流程版本化保存、发布、回滚；运行时仅解析已发布版本 |
| 接入治理 | Agent Connection 持久化能力、策略与预算；管理员治理配置 API |
| 渠道可追溯 | 外部身份绑定，以及入站/出站消息与运行记录的关联落库 |
| 数据演进 | Alembic 迁移 `0032`–`0035` 覆盖以上新增字段和表 |

## 本轮新增（6.0 产品面）

| 能力 | 实现 |
|---|---|
| 任务列表 API | `GET /api/ai/runs` |
| Run 契约增强 | `title` / `run_type` / 结果中的 `citations` / `artifact` |
| 任务中心页 | `TasksPage`：发起、列表、详情、步骤、引用、自检、反馈、取消 |
| 侧栏 | 「任务中心」入口 |
| 学习候选 | 用户可读自己的；管理员审核；学习中心「学习候选」Tab |
| Chat ↔ 任务 | prepare 的 `run_id` 写入消息；「查看任务」跳任务中心并打开详情 |
| 成果 ↔ 任务 | 任务详情「打开成果」；任务成果「查看来源任务」；保存成果后进工作成果 |

## 测试

- `test_tasks_center_api` + `test_chat_run_bridge`：**4+ passed**

## 本轮（引用统一预览）

| 能力 | 实现 |
|---|---|
| 统一组件 | `CitationPreviewDrawer` + `CitationList` |
| 任务中心 | 引用列表「预览」打开原文高亮片段 |
| 工作成果 | 聊天成果来源 / 任务成果 quality.citations 可预览 |
| 来源数据 | `source_summary` 增加 `file_uuid` / `chunk_id` 以便预览定位 |

## 本轮（运营 GA 门禁）

| 能力 | 实现 |
|---|---|
| GA 报告 API | `GET /api/ai/ops/ga-report`（主方案 §8.1 九项） |
| 代理计量 | FAQ 零模型率、复杂任务完成率、引用/拒答/成果审计覆盖、满意度等 |
| 运营看板 UI | GA 对照表 + 灰度快捷 5/20/50/100% |

## 本轮（离线评测 + 7.0 出域）

| 能力 | 实现 |
|---|---|
| 离线 GA 套件 | `ga_offline_eval.py` + `POST /api/ai/learning-eval/ga-suite` |
| GA 报告融合 | 引用/拒答优先用离线率 |
| 运营看板 | 「运行离线评测」按钮 |
| 出域分级 | `data_egress.py` L0–L3 策略（方案 §11.10） |
| 出域 API | `POST /api/ai/data-egress/evaluate` |
| 通道出站门禁 | 飞书/企微/outbox 发送前校验，机密拦截、敏感脱敏确认 |

## 本轮（出域审计 / 成本 / 市场）

| 能力 | 实现 |
|---|---|
| 迁移 0031 | providers / connections / call_logs / egress_audit |
| 出域审计落库 | `record_egress_audit`；evaluate 默认 persist；`GET /audits` |
| Agent 调用账本 | `record_agent_call` + 成本 µ；invoke 强制出域门禁 |
| 成本 API | `GET /api/ai/ops/cost-summary` |
| Agent 市场 | `GET /api/ai/agent-hub/market` + 状态切换 |
| 运营看板 | 成本卡 + 市场列表 |

## 本轮（智能路由 + 工作流骨架）

| 能力 | 实现 |
|---|---|
| 智能路由 | `agent_router.py`：出域过滤 → 指定优先 → 能力/成本/延迟/成功率评分 |
| 路由 API | `POST /api/ai/workflows/route` |
| 工作流引擎 | 串行 / 并行 / 条件 / 人工审核 / 路由+调用 |
| 预置流程 | simple_route_invoke、serial_summary_echo、parallel_dual、human_review_gate |
| 工作流 API | `GET/POST /api/ai/workflows*` |

## 本轮（工作流 UI + 路由审计）

| 能力 | 实现 |
|---|---|
| 工作流页 | 侧栏「工作流」：列表、路由试算、运行、步骤展示 |
| 路由 → 任务 | `create_run_audit` 写 `AgentRun`（任务中心可见） |
| 工作流 → 任务 | 运行结果带 `agent_run_id`，含 workflow 步骤快照 |
| 调用账本 | 路由写入 `AgentCallLog` |

## 本轮（编排互跳 + 简易自定义流程）

| 能力 | 实现 |
|---|---|
| 任务 → 工作流 | 任务详情识别 workflow，按钮「打开工作流」 |
| 工作流 → 任务 | 路由/运行后「打开任务 / 在任务中心打开」 |
| 简易编排 | 步骤增删排序、保存自定义流程（文件存储） |
| API | `POST /api/ai/workflows/custom`、`DELETE .../custom/{id}` |

## 本轮（Connector SDK + 安全审计 + 拖拽画布）

| 能力 | 实现 |
|---|---|
| Connector SDK | `server/app/connector_sdk/`：能力契约、限流、熔断、重试、凭证 vault、HttpConnector |
| Hub 适配 | `HttpExternalAgent` 走 SDK；`GET /api/ai/agent-hub/health` |
| 安全审计 | `ops_security_audit.py` + `GET /api/ai/ops/security-audit`；readiness 内嵌摘要 |
| 运营看板 | 安全审计卡 + Agent Hub 健康 |
| 拖拽编排 | `WorkflowsPage`：HTML5 拖拽排序 + 步骤画布预览 |
| 文档 | `docs/connector-sdk.md`、`docs/ops-runbook-6.0-7.0.md` |
| 连续观测 | `scripts/run_ga_observe.py`（JSONL 双周门禁）；smoke 含 security/hub |

## 本轮（Kimi/即梦 + Checkpoint 恢复）

| 能力 | 实现 |
|---|---|
| Kimi 连接器 | `connector_sdk/vendors/kimi.py`；Hub `kimi.chat`；无密钥 dry-run |
| 即梦连接器 | `connector_sdk/vendors/jimeng.py`；Hub `jimeng.image`；品牌屏蔽 + 审核标记 |
| 市场 Provider | moonshot / jimeng 默认厂商；成本默认值 |
| Checkpoint 恢复 | `checkpoint_recovery.py`；`retry` 恢复 stage/progress |
| 恢复套件 API | `POST /api/ai/ops/checkpoint-suite` |
| GA 计量 | `checkpoint_recovery_rate` 接入离线套件（嵌套事务回滚） |
| 脚本 | `scripts/run_checkpoint_recovery.py`（`--local` / API） |

## 本轮（Checkpoint 续跑 + Agent 市场页 + 分支画布）

| 能力 | 实现 |
|---|---|
| Runtime 续跑 | `NativeRuntime` 跳过已成功 coordinate/research/write，复用草稿 |
| Agent 市场页 | 侧栏「Agent 市场」：列表、健康、试调、管理员授权/停用 |
| 工作流预置 | `vendor_kimi_jimeng`、`condition_route_demo` |
| 条件步骤 | `condition` 支持 `input_text_len_gt` + then/else agent |
| 画布 | 并行/条件节点着色与分支摘要 |
| 联调文档 | `docs/vendor-integration-checklist.md` |
| 多实例演练 | `docs/checkpoint-multi-instance-drill.md` + `run_multi_instance_checkpoint_drill.py` |

## 本轮（E2E/组件测试 + GA 评估 + 发布说明）

| 能力 | 实现 |
|---|---|
| 前端单测 | `agent-hub-page.test.tsx`、`workflows-page.test.tsx` |
| E2E | `e2e/agent-hub-workflows.spec.ts`（市场试调 + 工作流→任务） |
| GA 评估 | `scripts/evaluate_ga_observe.py` 解析 JSONL 双周门禁 |
| 工作流门禁 | egress `blocked` / invoke error → 流程 `failed` 中止 |
| 发布说明 | `docs/release-notes-6.0-7.0.md` |

## 本轮（运营操作入口 + 本地门禁 + 手册）

| 能力 | 实现 |
|---|---|
| 运营看板 | 「Checkpoint 恢复套件」按钮 + 结果摘要 |
| 本地 GA 门禁 | `scripts/run_ga_gate_local.py`（离线评测/恢复/连接器/安全） |
| 用户手册 | `docs/user-guide-6.0-7.0.md` |
| README | 6.0/7.0 文档索引与门禁命令 |

## 排除项（不作为代码未完成项）

- 正式环境连续观测、灰度和 GA 宣布。
- 真实厂商密钥配置与正式联调。
- 多实例演练记录、性能压测和生产 SLO 验收。

> **结论**：按“只看代码覆盖、不考虑正式环境测试”的范围，主方案列出的能力已具备对应代码、迁移、接口与自动化回归；以上正式环境事项不计入未完成项。

## 2026-07-15 渠道出站对账入口补齐

- 新增管理员只读列表和原子处置接口：`GET /api/ai/ops/channel-outbound/reconciliation`、`POST /api/ai/ops/channel-outbound/{uuid}/reconcile`。
- 成功处置必须保存外部平台回执（JSON 不超过 100KB）；未生效处置转为 `not_applied`，保留“必须使用新幂等键”的重试边界；两条路径都不自动重发。
- 复用 `ChannelMessageBinding.metadata_json`，没有数据库结构变更；状态检查和行锁保证重复管理员处置返回 409。
- 回归证据：`tests/test_ops_readiness.py tests/test_channel_run_and_hub.py tests/test_ops_slo.py` 为 `23 passed`；后端非迁移全量为 `1053 passed, 10 skipped`。
- 仍待最后阶段：真实 provider 回执查询与授权、staging/生产双 worker 演练、连续观测/告警、正式迁移双 head 决策；本轮未升级版本、未 commit、未 push。
- Harness 发布门禁复跑为 `264 passed, 9 skipped`；`git diff --check` 通过。

## 2026-07-15 本地稳定性复核

本节覆盖本轮 Agent Loop/Harness 稳定性方案的最新本地证据：

- 后端回归（排除正式迁移模块）：`1048 passed, 10 skipped`；跳过项仅为本地未安装的可选 Tantivy/LangGraph 依赖。
- Harness release gate：`261 passed, 9 skipped`；本地 GA 聚合门禁 `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 桌面端类型检查、测试和生产构建通过；微信 H5 类型检查、测试和构建通过。
- 迁移候选临时演练通过：当前双 head 按预期 fail-closed，候选 A/B 在临时副本均可 upgrade/downgrade，`repository_unchanged=true`、`staging_or_network_used=false`。

### 微信 H5 版本边界复核（2026-07-15）

- 微信 H5 的本地类型检查、单测和构建均通过，但其 `package.json/package-lock.json` 当前仍是独立版本 `1.1.1`；聚信 AI 助手主版本源 `juxin-ai-assistant/VERSION` 及桌面/服务端声明为 `3.0.0`。
- H5 目前未加入根仓库 `ai-assistant` 版本注册表，因此版本钩子不会隐式修改它。这是待产品确认的发布边界，不判定为代码缺陷。
- 在确认 H5 与桌面/后端共用发布生命周期前，保持现状；确认共版后再一次性更新注册表、package/lock、测试 fixture 和发布文档，避免产生半套版本语义。

正式发布仍有明确门槛：当前 Alembic 图为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery` 双 head；共享数据库历史、备份/回滚窗口、staging 双 Runtime、生产 checkpointer、连续观测和灰度回滚证据尚未提供。不得用本地候选演练或离线 GA 结果替代这些证据。迁移方案选择和授权流程见 `docs/plans/2026-07-15-migration-history-decision-packet.md`。

### 最终回归补充（2026-07-15）

- 后端当前结果为 `1048 passed, 10 skipped`；本地 GA 为 `11/11`；Harness release gate 为 `261 passed, 9 skipped`；根仓库版本门禁为 `56 passed`。
- 桌面端 Vitest 已固定为文件串行、单 worker，避免并行资源竞争触发默认 5 秒 UI 测试超时；`npm run typecheck && npm test -- --reporter=dot` 当前为 `36` 个文件、`272` 个测试全部通过。
- 该设置只影响本地测试确定性，不改变产品运行时并发；正式迁移双 head、真实 staging/生产证据和连续观测门槛保持不变。

### 渠道重复投递修复（2026-07-15）

- 修复 `process_channel_message` 在复用既有 Run 时“先发送、后检查绑定”的顺序缺陷；现在发送前检查出站 `ChannelMessageBinding`，重复 webhook/job 不再重复调用 sender。
- Feishu/WeCom/渠道 worker 相关回归 `25 passed`；Harness release gate `261 passed, 9 skipped`、版本自动化 `56 passed`、HarnessSpec JSON 与 `git diff --check` 均通过。
- 该修复不新增迁移结构；共享数据库跨进程抢占仍需结合唯一约束/发布 outbox 语义在 staging 授权后演练，当前正式迁移双 head 和外部环境门槛不变。

### 跨进程出站预约与对账（2026-07-15）

- 出站绑定现在在 sender 前以 `state=sending` 持久化预约，使用既有唯一约束处理并发竞争；成功为 `sent`，异常为 `reconciliation_required`，重复重放不再盲目调用 sender。
- `tests/test_channel_run_and_hub.py` 覆盖发送成功、重复投递、失败对账和过期预约保护；渠道相关回归 `27 passed`。
- 这是本地数据库语义与可检测恢复状态的补强，不代表真实 provider 的 exactly-once；共享数据库锁等待、provider 幂等支持、staging 双 worker kill/recovery 仍待最后授权阶段。

### 后端全量回归复核（2026-07-15）

- 非迁移测试全量为 `1049 passed, 10 skipped`；10 个跳过项仍是本地缺失的可选 Tantivy/LangGraph 依赖。
- 该结果包含渠道预约/对账新增回归；迁移双 head、staging/生产授权、真实 Runtime/checkpointer 和连续观测仍未执行。

### 出站预约超时 fail-closed（2026-07-15）

- `state=sending` 超过 300 秒后自动转为 `reconciliation_required`，进程崩溃留下的预约不会被重放路径重新发送。
- 渠道回归 `27 passed`；该超时只定义本地安全默认，不替代真实 provider 对账 SLA 或 staging kill/recovery 证据。

### 渠道对账进入运营 SLO（2026-07-15）

- 运营快照新增 `channel_outbound_reconciliation_required`，并将其加入 `reconciliation_backlog`；渠道 sender 的未知结果会使 SLO 明确 fail-closed。
- 运营 SLO 与渠道定向回归 `38 passed`；正式环境告警、处理人和 SLA 仍未配置或执行。

### 当前版本事实校正（2026-07-15）

- 权威版本源 `juxin-ai-assistant/VERSION` 当前为 `3.0.0`；文档中早期记录的 `2.4.0` 属于历史快照。
- 根仓库版本自动化当前为 `56 passed, 0 failed`；未执行版本升级、commit 或 push。

### 最新后端全量回归（2026-07-15）

- 非迁移测试全量为 `1050 passed, 10 skipped`，退出码为 0；跳过项仍仅为本地未安装的可选 Tantivy/LangGraph 依赖。
- 正式迁移测试仍单独保持双 head fail-closed；本地回归不等价于 staging/生产放行。

### 本地恢复演练与 staging 证据校验复核（追加，2026-07-15）

- staging 证据校验、preflight 和恢复演练定向回归：`44 passed`。
- 本地进程边界恢复演练 `--cases 3 --lease-ttl-seconds 1`：`3/3` 成功；每例首 worker 被 `SIGKILL (-9)`，第二 worker 接管，fencing token `1 → 2`，旧 worker 被隔离，恢复率 `1.0`。
- 该结果只证明本地恢复契约；不替代 staging/生产授权、真实 provider exactly-once、正式迁移和连续观测证据。
