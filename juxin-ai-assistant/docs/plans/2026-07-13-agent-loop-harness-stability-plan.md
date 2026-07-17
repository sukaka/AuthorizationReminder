# 聚信 AI 助手 Agent Loop 与 Harness 稳定化实施方案

> 日期：2026-07-13
> 状态：实施中（本地契约/GA 门禁已通过；正式迁移图双 head fail-closed；staging/生产演练与观测待执行）
> 目标版本：功能优化版本（实施时按真实版本升第二位）

## 1. 最终结论

聚信 AI 助手不需要推倒重写。保留 FastAPI、RAG、记忆、治理、AgentRun/Step/Event、NativeRuntime、现有工具和业务接口；在兼容层内新增 `HarnessRuntime + LoopKernel`，逐步接管运行链路。

当前 `agent_loop` 有边界控制、检索、反思、质量检查和轨迹，但主循环主要是受限 RAG 重试，并非通用的“模型决策—工具执行—观察—评价—继续/停止”循环。当前 checkpoint 能恢复阶段和进度，但还没有版本化 RunState、工具副作用幂等、租约接管和真实多实例恢复的完整语义。

实施采用“小步兼容、双轨验证、故障注入、指标放量”，预计 4～6 周。任何阶段未达到退出门槛，不进入下一阶段。

## 1.1 当前实施状态与上线边界（2026-07-13）

| 能力 | 本地实现/验证状态 | 上线前仍需的证据 |
|---|---|---|
| RunState、状态机、checkpoint 迁移与乐观锁 | 已实现；陈旧并发写入自动拒绝 | 生产 Run/Step/Event 对账看板 |
| 工具账本、ToolSpec、PolicyGate | 已实现；输入/输出 Schema、权限、scope、确认和幂等进入统一入口；反馈、知识审核、个人记忆、学习库及 Word/PPT 导出，以及网页采集、联网调研、深度联网调研均已显式标注副作用；三类联网工具分别限定为 `web:capture` / `web:research`，确认前不会发起联网调用；读写混合工具按 action 解析契约，导出和联网结果可持久化回放；超时且结果未知的调用原子转为 `reconciliation_required`，不会重放副作用；管理员可查询积压并原子确认“已生效”或“未生效”，操作者与时间均留审计；`reference_source_validate` 的删除模式现按输入解析为幂等写入，纯校验模式保持只读；学习库模板 scope 仅允许 `personal/company`，公司模板统一进入 `pending` 审核态，非法 scope fail-closed 且不落库；动态 `resolve_tool_spec` 不能弱化已注册的副作用等级、确认要求或数据作用域；PPTX 文件保存按 `context.user_id` 哈希分区，缺少用户绑定时不会落盘；所有写工具必须声明 `user/resource/external/global` 数据作用域，注册与动态解析均 fail-closed 校验 | 写工具 scope 已纳入机器校验；待对账调用的外部回执查询 SOP |
| 用户直连副作用（网页采集、Word 导出、外部工单回复、知识文件上传） | 已实现；`DirectActionInvocation` 持久化 `user + action + Idempotency-Key`、请求哈希、结果与异常；网页采集预览/确认、Word 导出、企微工单回复和知识文件上传均要求浏览器幂等键，同键回放、异参冲突、未知结果待对账。上传账本只保存文件哈希和元数据，不保存原始内容；存储写入后异常转待对账，不能盲目重传。管理员可列出待对账直连动作，并用可回放 HTTP 状态和结果原子确认已生效，或确认未生效后要求新键重试；操作者、时间和结论持久化。`DIRECT_ACTION_CONTRACTS` 与静态测试覆盖当前全部已登记入口，账本运行时拒绝未登记动作 | 在 staging 演练进程中断后的待对账处理；新入口合入前须更新清单和测试 |
| 进展与结果判定 | 已实现；重复动作、无进展、质量与成功契约可停止运行；核心证据现已输出独立真值复核下的 TP/TN/FP/FN 与误拦截/漏拦截率 | 真实 staging 独立复核标签与最终观察阈值 |
| 独立租约心跳与 fencing | 已实现；独立数据库会话续租、过期接管、旧 worker 拒绝续租和写入均有自动化测试；双进程 SIGKILL 接管测试已通过；新增独立 SQLite + Worker A 强杀 + Worker B 接管 + stale fencing 校验的多轮本地演练，当前 1000/1000 通过 | 测试环境连续 7 天无双 owner |
| HarnessSpec 启动校验、版本注册与发布回归 | 已实现；状态版本、租约、工具副作用和发布测试清单不一致会阻止启动；注册表要求独立审批，激活/回滚均留审计；新 Run 冻结具体版本与内容哈希；本地发布门禁只从 `harness_spec.json` 读取清单并执行；Runtime shadow 已有脱敏比对器、报告脚本、确定性采样和管理员看板，灰度参数有边界校验并写入审计；本地 GA 现在强制比对 50 条固定契约 fixture，并在两份隔离内存库上验证 Native/LangGraph 快路径状态等价；新增 `langgraph_runtime_mode=shadow|real`，真实模式在后端未实现时 fail-closed，避免把 wrapper 误当生产 LangGraph；feature-flags 现在暴露 `dependency_installed`、`implemented`、`production_ready` 和 `reason`；新增只读 `run_staging_preflight.py`，统一检查 HarnessSpec 清单、LangGraph 依赖隔离、Runtime 模式、staging Bearer 配置、HTTPS 和连续观测阈值 | staging 观察、真实双 Runtime 固定核心任务集（含副作用隔离）与连续 SLO 证据；真实 LangGraph 后端需单独依赖/架构评审 |

本轮基线命令：

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/server
AI_LOCAL_DEV_MODE=1 AI_ENCRYPTION_KEY="$(python3 -c 'import base64; print(base64.urlsafe_b64encode(b"x" * 32).decode())')" \
python3 -m pytest \
  tests/test_run_state_contract.py tests/test_agent_state_machine.py \
  tests/test_agent_run_service.py tests/test_checkpoint_resume_runtime.py \
  tests/test_multi_instance_checkpoint_drill.py \
  tests/test_agent_runtime.py tests/test_loop_kernel.py \
  tests/test_progress_detector.py tests/test_outcome_evaluator.py \
  tests/test_agent_run_optimistic_lock.py tests/test_lease_heartbeat.py \
  tests/test_tool_contract_policy.py tests/test_harness_spec.py \
  tests/test_harness_release_gate.py \
  tests/test_native_runtime_knowledge.py tests/test_ga_observe_eval.py \
  tests/test_ops_readiness.py tests/test_staging_script_auth.py \
  tests/test_direct_action_service.py tests/test_direct_action_inventory.py \
  tests/test_web_routes.py tests/test_knowledge_files.py \
  tests/test_knowledge_query_routes.py tests/test_knowledge_file_management_routes.py \
  tests/test_knowledge_upload_routes.py \
  tests/test_knowledge_review_routes.py tests/test_external_support_tickets.py \
  tests/test_chat_word_export.py tests/test_work_artifacts.py \
  tests/test_migrations.py -q
```

当前结果：HarnessSpec 清单、路由、工具/状态契约、恢复语义和版本门禁已覆盖；最新 Harness release gate 为 `261 passed, 9 skipped`（31 个清单模块），本地 GA 聚合门禁 `11/11` 通过，Runtime shadow 固定比对 `150/150` 且 `0 mismatch`，后端全量回归（排除正式迁移模块）最新为 `1048 passed, 10 skipped`，桌面端类型检查及全量回归为 `36` 个文件、`272` 个测试通过。发布证据门禁新增测试 artifact 的 `release_id/base_url` 身份绑定，并要求 release 的 `migration.to_revision` 与 preflight 唯一 `migration_graph.head` 对齐，相关证据/preflight/runbook 回归为 `44 passed`。正式 Alembic 图当前存在两个 head：`0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`，因此本地 preflight 只在 `migration_graph` 项 fail-closed（9 项中 8 项通过）；未擅自修改共享迁移历史。新增候选迁移演练仅在临时目录/临时 SQLite 中验证候选 A（调整 0046 父版本）和候选 B（新增 0052 双父 merge）均可 upgrade/downgrade，当前演练报告 `overall=pass` 且仓库不变；演练现在还要求前后仓库快照一致，否则总结果 fail-closed。以上仍是本地证据，不替代真实 staging 授权、HTTPS、多实例强杀/对账、固定任务集真实执行、生产 checkpointer、灰度回滚和连续 SLO；这些按用户决定最后执行。只有这些外部证据达到门槛，才允许标记为稳定并全量放量。

> 口径说明：后续追加章节按各自记录时间保留当时的原始验证结果；判断当前状态时，以本节和文档末尾最新追加章节为准。

### 本轮验证补充（2026-07-13）

- 新增 `server/scripts/run_langgraph_checkpoint_drill.py` 与 `server/tests/test_langgraph_checkpoint_drill.py`，用文件型 SQLite、独立进程和独立 SQLAlchemy Engine 验证 LangGraph checkpoint 的进程边界恢复。
- 可选 LangGraph 环境定向测试：`2 passed`；3 轮机器可读演练：`recovered=3/3`、`recovery_rate=1.0`，每轮均为 `SIGKILL → cp-1 恢复 → cp-2 提交 → stale write 拒绝`。
- Harness release gate 已纳入该测试模块，最新结果为 `129 passed, 9 skipped`。默认环境缺少可选依赖时安全跳过，不把未测量状态报告为通过。
- 这仍是本地文件数据库证据，不替代 staging 真实数据库、授权、双 Runtime 强杀/对账和连续 SLO；`real` 模式继续 fail-closed。

### 本轮验证补充（ToolSpec 数据 scope）

- `ToolSpec.data_scopes` 已纳入注册与动态解析校验；任何写工具未声明数据作用域会 fail-closed，动态解析不得弱化已注册 scope。
- 反馈、导出、记忆、学习库、引用删除、知识审核、PPTX 以及联网工具均已声明对应的 `user/resource/external` scope；现有测试夹具也已显式声明 scope。
- 定向运行时/工具契约/技能回归为 `58 passed`；最新 Harness release gate 为 `131 passed, 9 skipped`。
- 这只证明本地契约和回归，不替代 staging 外部回执查询 SOP、真实授权、双 Runtime 强杀/对账和连续 SLO；这些仍按用户决定最后处理。

### 本轮验证补充（进程边界恢复 1000 次）

- `server/scripts/run_staging_recovery_rehearsal.py` 不再把 `cases` 静默截断为 20；请求必须为 `1..1000`，并支持 `1..32` 的显式并行度，非法参数 fail-closed。
- 演练回传从 `multiprocessing.Queue` 改为单值 `Pipe`，并在最终 kill/join 后重新读取进程退出码，避免高并发下把已完成收尾的进程误记为失败。
- 真实本地命令：`python3 scripts/run_staging_recovery_rehearsal.py --cases 1000 --parallelism 8 --lease-ttl-seconds 0.05 --timeout 30 --json`；结果为 `total=1000, recovered=1000, failed=0, recovery_rate=1.0, passed=true`。
- 交叉验证：10/10、30/30、100/100、200/200 也均通过；发布回归为 `133 passed, 9 skipped`，`git diff --check` 通过。
- 以上是临时 SQLite、本机进程边界证据；不替代 staging 授权、真实数据库、双 Runtime 对账或连续 7 天无双 owner/SLO 观察。未提交、未推送、未改版本号。

### 当前剩余开发优先级

1. **本地开发已完成**：文件型 SQLite + 独立 Engine 的 LangGraph 进程边界演练已完成 `3/3`；独立 checkpoint 表、事务边界、lease/fencing 和 stale write 拒绝均有机器可读证据。该证据不是生产数据库证明；在 staging 证据完成前，`real` 模式继续 fail-closed，NativeRuntime 仍是唯一生产执行路径。
2. **最后再做**：真实 staging 双 Runtime、授权接入、Worker 强杀/对账恢复与连续 SLO 观察。只读 preflight 已可执行，但它不替代真实凭证、真实 API/worker 和时间窗口证据；没有这些证据不能宣称生产稳定。
3. **暂不需要**：推倒重写底层。现有状态契约、工具契约、租约 fencing、账本和 NativeRuntime 已形成稳定兼容层，后续以替换 LangGraph 执行后端为主。

### LangGraph 本地 pilot（2026-07-13）

- `server/app/agent_runtime/langgraph_graph.py` 提供真实 `StateGraph` builder，固定 `prepare → execute → verify → finish` 四阶段和 `LangGraphState` 字段；业务回调必须显式注入，不能绕过现有租约、工具和授权服务；`langgraph_thread_config` 强制使用 `run_id` 作为唯一 `thread_id`。
- `server/requirements-langgraph-pilot.txt` 锁定 `langgraph==1.2.9` 与 `langgraph-checkpoint-sqlite==3.1.0`。SQLite saver 只作为本地/小规模 pilot，不进入生产主依赖，也不作为多实例生产存储。
- `langgraph_backend_status()` 现在同时报告 graph/checkpointer 依赖和实现状态；依赖安装不等于 `production_ready`，`select_runtime(..., mode=real)` 仍 fail-closed。
- 验证：默认环境 runtime 测试 `15 passed, 8 skipped`；在临时 LangGraph 依赖环境运行真实 graph + checkpoint + AgentRunBinding + Native 业务适配测试 `20 passed`。
- `langgraph_service_binding.py` 已完成本地适配：四个 phase 复用 `AgentRunService` 的 lease/fencing、Run Step、安全 checkpoint，execute 只允许 `ToolRegistry` 的只读工具，verify 统一调用 `OutcomeEvaluator`，finish 才能写入最终成功/失败状态；统一使用 `run_id/thread_id`，租约接管后旧 worker fail-closed。新增重放幂等保护：同一 thread 再次 invoke 时复用已成功步骤和持久化结果，不重复调用工具、不追加步骤，并保留 evidence/outcome 供恢复验证。
- 进一步补齐 finish 阶段的恢复投影：若进程在成功 `langgraph_finish` Step 落库后、Run 转为 `succeeded` 前退出，下一次重放会用安全 checkpoint 中的结果修复 Run 终态，不会出现“图已完成但任务仍 running”。可选依赖环境已验证真实 graph/checkpoint/binding 回归 `15 passed`。
- 新增 `agent_run_checkpoint_saver.py` 与迁移 `0045_agent_langgraph_checkpoints`：LangGraph checkpoint 独立存储在数据库表，按 `run_id + thread_id + checkpoint_id` 唯一约束写入；每次写入在独立 Session 中锁定 AgentRun 并校验 lease/fencing，读写不再依赖外层请求事务。StaticPool 测试复用调用 Session，真实 Engine 使用独立连接；新增跨 Session 外层回滚、旧 fencing token 拒写和迁移约束回归。可选依赖环境 Runtime 聚焦回归 `20 passed`，该证据仍不替代 staging 多实例故障注入，real 模式继续 fail-closed。
- 新增 `runtime_state_contract.py`：统一四阶段顺序、必填状态字段、允许阶段、终态和步骤幂等追加规则；LangGraph graph/binding 共用校验与去重逻辑，并在能力状态中暴露 contract version。默认环境 runtime 聚焦回归 `11 passed, 6 skipped`，可选依赖环境 `17 passed`。该契约只收敛状态语义，不改变 NativeRuntime 生产路径。
- LangGraph state 现在显式复用既有 `RUN_STATE_SCHEMA_VERSION=1.0`；缺失版本兼容旧 pilot 输入，未知版本在 prepare 阶段 fail-closed，并通过能力状态暴露版本，避免形成第二套 RunState 版本号。
- 状态契约进一步要求 `completed_steps` 必须是四阶段的连续前缀，跳阶段或乱序 checkpoint 在恢复入口 fail-closed。
- binding 的每个 phase 入口都复用状态校验，不再只在 prepare 校验；即使从中间 checkpoint 直接恢复，损坏状态也不会触发工具或副作用。
- 新增 `native_langgraph_adapter.py` 与 `NativeRuntime.start_sync_with_executor()`：real pilot 的 LangGraph 四阶段现在可以复用 NativeRuntime 的 FAQ 之后业务链路（检索、写作、审核、成果物、预算和终态），不复制第二套业务规则；Native 默认启动路径保持原样。可选依赖环境已验证真实问答和同一 run 重放不重复追加 Native 步骤。
- `langgraph_backend_status()` 额外暴露 `business_adapter_implemented=true` 与 `production_checkpointer_supported=false`，把“业务适配已完成”和“可多实例生产”明确拆开；real 模式门禁错误会指出剩余的 checkpointer/staging 证据要求。
- 下一步是把该适配放入 staging 双 Runtime/授权/强杀恢复和连续 SLO 观察；完成前继续使用 NativeRuntime 作为唯一生产路径。
- `server/scripts/run_staging_preflight.py` 提供不联网的启动前检查：HarnessSpec 测试清单、LangGraph pilot 依赖是否隔离在可选文件、`real` 模式是否仍 fail-closed、staging 是否强制 HTTPS + 显式 Bearer 环境变量，以及 GA 连续观测阈值是否合法；输出不含 Token。

## 2. 调研转化出的工程原则

1. **状态在系统，不在上下文**：目标、计划、动作、工具结果、审批、验证和恢复位置必须持久化。
2. **动作必须结构化**：模型只能产生受 Schema 约束的动作。
3. **写工具必须防重**：使用幂等键、调用账本和外部回执，实现业务层有效 exactly-once。
4. **验证必须独立**：Generator 不能自行宣布成功；Evaluator 根据成功契约和环境事实判断。
5. **循环必须识别无进展**：重复动作、重复错误、无信息增量必须换策略、暂停或失败。
6. **恢复是状态机语义**：先判断安全点、未决工具、审批和版本，不能简单重跑。
7. **Harness 必须版本化**：工具、权限、预算、上下文、停止条件和评价器形成 `HarnessSpec`。
8. **稳定性由演练证明**：必须做真实 Worker 强杀、重复投递、超时和数据库故障演练。

参考资料：

- OpenAI Harness Engineering：https://openai.com/index/harness-engineering/
- OpenAI Agents SDK Running Agents：https://openai.github.io/openai-agents-python/running_agents/
- Anthropic Effective Harnesses：https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic Long-Running Apps：https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic Agent Evals：https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Natural-Language Agent Harness：https://arxiv.org/abs/2603.25723

## 3. 现状与缺口

### 3.1 可复用资产

| 领域 | 当前资产 | 处理方式 |
|---|---|---|
| 运行记录 | `AgentRun / AgentRunStep / AgentRunEvent` | 保留并扩展，禁止另建平行事实源 |
| Runtime | `AgentRuntime`、NativeRuntime、LangGraph shadow | 扩展协议；Native 先适配，LangGraph 继续 shadow |
| Agent Loop | planner、observer、reflector、checker、verifier | 作为 RAG 策略插件迁入 LoopKernel |
| 工具 | BaseTool、ToolContext、ToolResult、Registry | Agent 工具升级为强类型契约，保留兼容适配器 |
| 用户直连动作 | 网页采集预览/确认等 REST 业务接口 | 采用 HTTP 幂等与业务状态机；不伪造聊天 Run，但同样必须审计、可回放、不可重复写入 |
| 恢复 | checkpoint、retry、恢复脚本 | 升级为版本化状态和真实多实例恢复 |
| 治理 | 权限、外发、成本、审计 | 作为 PolicyGate 接入每次动作 |

### 3.2 缺口及目标

| 缺口 | 风险 | 目标 |
|---|---|---|
| 无统一 RunState Schema | checkpoint JSON 漂移 | 状态带版本，可校验、迁移、拒绝 |
| 工具契约偏弱 | 错误、副作用和重试不可控 | Schema、权限、超时、幂等、审计统一 |
| 直连 REST 入口绕过 Registry | 联网或保存操作无法复用 Agent 账本，重复提交可能重复写入 | 区分 Agent 工具账本与 HTTP 幂等契约；两条链路统一副作用清单、审计字段和恢复规则 |
| 循环主要覆盖检索 | 无法承载通用工具推理 | 通用 LoopKernel，RAG 作为策略 |
| 无进展检测不足 | 重复调用、烧预算 | 指纹、增量分数、策略升级 |
| Verifier 偏关键词 | 格式正确被误判为完成 | 成功契约和环境事实评价 |
| 恢复以跳过步骤为主 | 执行中崩溃可能重复副作用 | 调用账本、租约、幂等、对账 |
| 多实例为单进程模拟 | 不能证明竞态安全 | 真实双 Worker + SIGKILL |

## 4. 目标架构

```text
API / Chat / Workflow / Channel
              │
       ┌──────┴─────────────────┐
       ▼                        ▼
HarnessRuntime（Agent 动作）  DirectActionGuard（用户直连动作）
       │                        ├── Idempotency-Key
       │                        ├── 业务状态机
       │                        └── 审计 / 回放结果
       ▼
       ├── HarnessSpecRegistry
       ├── RunStateStore
       ├── ContextBuilder
       ├── LoopKernel
       │   ├── ActionParser
       │   ├── PolicyGate
       │   ├── ToolExecutor
       │   ├── ProgressDetector
       │   └── OutcomeEvaluator
       ├── LeaseManager
       └── TraceRecorder
              │
       ┌──────┴─────────┐
       ▼                ▼
 Native adapter    LangGraph shadow adapter
```

标准循环：

```text
加载并校验状态 → 获取租约 → 构建受限上下文
→ 模型返回结构化动作 → Schema/权限/预算检查
→ 预登记工具调用 → 执行或对账 → 持久化观察
→ 检测进展 → 评价结果
→ 继续 / 完成 / 等待审批 / 暂停 / 失败
```

停止条件包括：成功契约通过、用户取消、等待外部事件、预算耗尽、重复动作超限、连续无进展、同类错误熔断、策略拒绝和状态版本不兼容。

## 5. 统一状态契约

### 5.1 RunState v1

数据库继续使用现有 Run/Step/Event 表，新增 Pydantic 契约：

```json
{
  "schema_version": "1.0",
  "run_id": "...",
  "harness_id": "...",
  "harness_version": "1.0.0",
  "status": "running",
  "revision": 12,
  "attempt": 2,
  "goal": {},
  "plan": {},
  "cursor": {"next_sequence": 8, "strategy": "rag"},
  "budgets": {},
  "pending_action": null,
  "pending_tool_call_id": null,
  "pending_approval_id": null,
  "progress": {},
  "artifacts": [],
  "last_safe_checkpoint": {},
  "lease": {}
}
```

约束：

- 更新使用 `revision` 乐观锁。
- checkpoint 必须包含版本、安全点类型和已确认副作用集合。
- 状态迁移只通过集中状态机，业务代码不能任意写 `status/stage`。
- 旧 checkpoint 通过 `v0_to_v1` 迁移；不能迁移则 `suspended`，不得静默重跑。
- Event 是追加式审计，Run 是当前快照，Step 是动作、工具或评价记录。

状态机：

```text
queued → running → succeeded
             ├── waiting_approval → running
             ├── suspended → running
             ├── failed → retrying → running
             └── cancelled
```

禁止 `succeeded → running`、`cancelled → running`。取消后重做必须创建新 attempt 或 run lineage。

## 6. 统一工具契约

### 6.1 ToolSpec v1

每个工具必须声明：名称、版本、输入/输出 Schema、权限、数据作用域、副作用等级、超时、最大重试、可重试错误、审批要求、并发规则和脱敏规则。

副作用等级：`read_only | idempotent_write | non_idempotent_write`。

```json
{
  "call_id": "...",
  "idempotency_key": "...",
  "status": "reserved|running|succeeded|failed|unknown",
  "output": {},
  "output_summary": {},
  "error": {"class": "timeout|validation|permission|transient|permanent|unknown"}
}
```

### 6.2 副作用保护

- 只读工具可以安全重试，但仍记录调用指纹。
- 幂等写工具以 `run_id + sequence + tool + normalized_args_hash` 生成幂等键。
- 非幂等写工具执行前持久化 `reserved`，执行后写外部回执。
- 崩溃后状态为 `unknown` 时必须先对账，不能直接重发。
- 所有 Agent 工具调用经过 PolicyGate，Runtime 不得绕过权限和外发检查。

### 6.3 用户直连动作契约（网页采集、Word 导出、外部工单回复、知识文件上传已落地）

网页采集预览、确认保存、导出确认、渠道发送等由用户直接点击的 REST 接口，不创建伪 `AgentRun`，因为它们不是可恢复的 Agent 计划步骤；但也不能绕过副作用保护。

- 所有会联网、持久化写入或外发的接口必须要求浏览器生成的 `Idempotency-Key` 请求头；缺失时拒绝执行。网页采集预览/确认、Word 导出、外部工单回复和知识文件上传已按此执行，桌面端在每次动作请求生成键；上传契约仅记录内容 SHA-256、长度和归一化元数据，绝不记录文件原文；企微发送或上传存储写入后异常会撤销本地成功记录并转待对账，不能自动重发。其余入口先发布前端键生成，再开启后端强制校验，不能以服务端事后生成的键冒充防重。
- 幂等记录以 `user_id + route/action + idempotency_key` 唯一；同键同请求回放原结果，同键不同请求返回 `409`，执行中或结果未知返回“处理中/待对账”，绝不二次执行。
- 业务对象状态迁移集中定义。例如网页采集仅允许 `previewed → saved|cancelled`，确认保存成功后重复确认只返回已有 `knowledge_file_uuid`；不得再次创建文件。
- 直连动作记录 `request_hash`、安全输出摘要、开始/结束时间、关联业务对象和错误类别；进入 `reconciliation_required` 后只能由管理员在 `/api/ai/ops/direct-actions/reconciliation` 查询，并通过 `POST /api/ai/ops/direct-actions/{uuid}/reconcile` 原子结案。确认已生效必须提交 2xx `response_status` 和可回放 JSON 结果；无法提供回放结果时只能确认未生效，并要求用户使用新键重试。结论、操作者和时间会持久化；日志脱敏规则与 `ToolRegistry` 一致。
- “用户点击确认”是此类接口的确认语义；接口本身仍需权限、scope 和输入校验。Agent 代表用户执行时，必须走 `ToolRegistry`，不能调用 REST handler 或业务函数绕过账本。
- `server/app/direct_action_inventory.py` 维护已登记直连动作；`test_direct_action_inventory.py` 校验清单和路由中实际声明的账本动作完全一致。新增或删除当前已覆盖路由的直连动作而未同步清单，会使 CI 测试失败。后续再把所有文件/知识库写入和消息发送纳入该清单或 `agent_tool` 清单。

## 7. 恢复语义

### 7.1 安全点

仅以下位置可恢复：动作已持久化且工具未开始；工具完成且回执已持久化；Evaluator 已持久化；审批请求已持久化；最终结果已提交。

“工具正在执行但结果未知”不能标记为安全点。

### 7.2 Worker 租约

- 同一 run 只有一个有效 owner。
- Worker 每 5 秒 heartbeat，租约默认 20 秒，可配置。
- 接管通过数据库条件更新获得租约，不依赖进程内锁。
- 原 Worker 恢复后发现 fencing token 过期，立即停止写入。
- 每次写入校验 `lease_owner + fencing_token + revision`。

### 7.3 恢复决策

| 崩溃位置 | 恢复动作 |
|---|---|
| 模型调用前 | 从持久化上下文重调 |
| 模型返回、动作未落库 | 重调模型，旧返回不可信 |
| 动作已落库、工具未执行 | 使用同一 call_id 执行 |
| 工具执行中、结果未知 | 查询回执/对账，禁止盲目重试 |
| 工具成功、观察未落库 | 复用账本结果生成 observation |
| 等待审批 | 恢复等待，消费唯一审批决定 |
| 结果已写、完成事件未写 | 幂等补写完成事件 |

## 8. ProgressDetector 与 OutcomeEvaluator

动作指纹为：`hash(action_type + tool_name + normalized_args + relevant_revision)`。

进展信号包括新证据、新 artifact、环境变化、未完成项减少、Evaluator 未满足项减少和错误得到解决。

默认策略：

- 同一指纹连续 2 次，禁止无条件第三次调用。
- 连续 3 步低进展，触发重新规划。
- 重规划后仍连续 2 步无进展，暂停或失败。
- 永久错误立即停止；瞬时错误按退避策略重试。
- 每次策略切换记录理由和前后状态。

每类任务定义 `SuccessContract`：必需输出、证据要求、允许副作用、环境断言、质量阈值和确定性检查。Evaluator 输出 `pass | revise | blocked | fail`。能由 Schema、数据库、文件或业务 API 证明的内容必须确定性验证，模型评价仅作为补充。

## 9. HarnessSpec v1

```yaml
id: knowledge-assistant
version: 1.0.0
role: enterprise_knowledge_assistant
tools: [knowledge.search@1, memory.read@1]
permissions: [knowledge:read]
budgets:
  max_steps: 12
  max_model_calls: 6
  max_duration_seconds: 120
stop_rules:
  duplicate_action_limit: 2
  no_progress_window: 3
context_policy:
  max_tokens: 16000
  retain: [goal, current_plan, unresolved_failures, evidence]
evaluator: knowledge_answer_v1
handoff_policy: explicit_only
```

HarnessSpec 必须 Schema 校验；运行绑定具体版本，中途禁止静默切换；权限增加和停止规则放宽必须审批；每个版本附带 eval case 和回滚版本。

## 10. 稳定性 SLO

| 指标 | 灰度门槛 | GA 门槛 |
|---|---:|---:|
| 副作用重复执行率 | 0 | 0 |
| 安全 checkpoint 恢复成功率 | ≥99% | ≥99.9% |
| 审批恢复成功率 | ≥99% | ≥99.9% |
| 状态机非法迁移率 | 0 | 0 |
| Run/Step/Event 对账一致率 | ≥99.9% | ≥99.99% |
| 重复循环自动阻断率 | ≥95% | ≥99% |
| 失控超预算率 | 0 | 0 |
| 工具审计覆盖率 | 100% | 100% |
| 终态 Run 残留有效租约 | 0 | 0 |
| 核心任务成功率 | 不低于基线 | 不低于旧 Runtime |

必备指标：run 总量和耗时、loop steps、无进展检测、重复动作阻断、tool status/error、unknown outcome、resume、lease takeover、state conflict、evaluator result、Token、成本和首个有效动作时间。

日志只记录摘要、哈希和安全错误，禁止记录凭据、完整隐私内容和未脱敏工具输出。

## 11. 可检测测试矩阵

### 契约与循环

- RunState v0→v1、未知版本拒绝、非法状态迁移。
- Tool Schema、权限、超时、错误分类和 HarnessSpec 校验。
- Native 与 LangGraph adapter 对同一 fixture 产生等价状态。
- 相同工具调用在阈值内停止；空结果换策略后停止。
- Evaluator 返回 revise 后只修订未满足项。
- 步数、模型调用、费用、时间预算正确终止。
- cancel 在模型、工具、审批阶段均能收敛。

### 恢复与混沌

- 工具执行前 SIGKILL。
- 工具成功但结果落库前 SIGKILL。
- checkpoint 后、事件前 SIGKILL。
- heartbeat 停止后另一 Worker 接管。
- 原 Worker 复活后 fencing token 阻止旧写入。
- 同一消息重复投递 10 次。
- 数据库短暂不可用、死锁、事务超时。
- 模型 429/5xx/超时、工具超时、外部回执延迟。
- 审批重复、乱序、过期。

多实例演练必须启动至少两个独立 Worker 进程，不能以同进程对象模拟代替。

### 回放评测

- 固定 50 个核心任务，覆盖知识问答、文件、写操作、审批和长任务。
- 随机性任务至少运行 3 次，报告成功率分布。
- 新旧 Runtime shadow；新 Runtime 的副作用使用隔离环境。
- 对比成功率、成本、步数、延迟、重复动作和人工介入率。

## 12. 分阶段实施

### 阶段 0：基线与冻结（2～3 天）

交付状态字典、工具清单、副作用分类、50 个 eval case 和旧 Runtime 基线。退出条件：基线可重复，写工具已分类，关键链路已有 trace。

### 阶段 1：状态契约（1 周）

交付 RunState v1、状态机、乐观锁、对账检查、旧 checkpoint 迁移。退出条件：契约测试全通过；非法迁移为 0；旧记录可读取；可回滚。

### 阶段 2：工具契约（1 周）

交付 ToolSpec v1、调用账本、HTTP 直连动作幂等记录、错误分类和 2～3 个核心工具适配。退出条件：重复投递无重复副作用；unknown 会暂停或待对账；Agent 与直连入口的权限审计均为 100%。

### 阶段 3：恢复语义（1 周）

交付租约、heartbeat、fencing token、审批恢复和真实双 Worker kill 演练。退出条件：1000 次恢复演练 ≥99%；测试环境连续 7 天无双 owner；无重复副作用。

### 阶段 4：通用 LoopKernel（1～2 周）

交付 LoopAction、ProgressDetector、OutcomeEvaluator、预算和停止规则、RAG adapter。退出条件：重复循环阻断 ≥99%；无预算越界；核心任务不低于旧 Runtime。

### 阶段 5：HarnessSpec 与灰度（至少 1 周观察）

交付 Registry、版本绑定、shadow 报告、开关、看板和回滚手册。放量：内部账号 → 1% → 5% → 20% → 50% → 100%，每级至少观察 48 小时，红线触发立即回退。

## 13. 预计文件

```text
server/app/agent_runtime/state_contracts.py
server/app/agent_runtime/state_machine.py
server/app/agent_runtime/harness_runtime.py
server/app/agent_runtime/loop_kernel.py
server/app/agent_runtime/progress_detector.py
server/app/agent_runtime/outcome_evaluator.py
server/app/agent_runtime/harness_spec.py
server/app/agent_runtime/tool_executor.py
server/app/agent_runtime/protocol.py
server/app/agent_runtime/tool_base.py
server/app/direct_action_service.py
server/app/web_routes.py
server/app/agent_runtime/native_runtime.py
server/app/models.py
server/app/agent_run_service.py
server/app/checkpoint_recovery.py
server/alembic/versions/00xx_agent_harness_runtime_v1.py
server/tests/test_run_state_contract.py
server/tests/test_agent_state_machine.py
server/tests/test_tool_execution_contract.py
server/tests/test_direct_action_idempotency.py
server/tests/test_side_effect_entrypoint_coverage.py
server/tests/test_loop_kernel.py
server/tests/test_progress_detector.py
server/tests/test_outcome_evaluator.py
server/tests/test_real_multi_worker_recovery.py
server/scripts/run_agent_chaos_suite.py
server/scripts/run_runtime_shadow_eval.py
docs/agent-runtime-recovery-runbook.md
docs/agent-harness-spec.md
```

实施前必须再次搜索真实文件，避免与当前未提交开发内容冲突。

## 14. 发布和回滚

这是功能优化，完成后按约定升第二位，例如 `6.0.0 → 6.1.0`，具体以实施时真实版本为准。

提交按状态契约、工具契约、恢复、LoopKernel、HarnessSpec/灰度、版本与 GA 证据拆分。数据库迁移采用 expand/contract：先新增和双写，再切读，稳定后才删除旧字段。回滚只关闭新 Runtime feature flag，不反向删除新数据字段。

## 15. Go / No-Go 红线

出现以下任一情况，禁止放量：重复副作用；两个 Worker 同时有效写入；恢复率低于 99%；Run/Step/Event 无法对账；状态版本被忽略；成功率显著低于基线；审计缺失或泄密；无法在 15 分钟内回退旧 Runtime。

## 16. 稳定完成定义

只有同时满足以下条件才能宣布稳定：

1. 连续 14 天灰度无 P0/P1 事故。
2. 真实多 Worker 恢复成功率 ≥99.9%。
3. 所有副作用工具重复执行为 0。
4. 核心任务多次 trial 成功率不低于旧 Runtime。
5. 终态、租约、工具账本和事件可自动对账。
6. 预算、权限、取消和审批在异常情况下仍可收敛。
7. 运维可按 run_id 查看、暂停、恢复、对账和回滚。
8. 发布具备迁移记录、测试报告、灰度数据和回滚演练证据。
9. 所有登记的直连副作用入口均有请求幂等、状态迁移和审计覆盖；重复确认不产生第二个业务对象。

## 17. 首批执行任务

1. 导出现有状态、阶段、checkpoint 字段和工具清单。
2. 编写 RunState v1、ToolSpec v1、HarnessSpec v1 Schema 及兼容测试。
3. 选知识检索、文件只读、一个可控写工具首批适配。
4. 建立 ToolCall ledger 与直连动作幂等记录，完成重复投递、重复确认和 unknown 结果测试。
5. NativeRuntime 接入状态机，但保持业务行为不变。
6. 完成两个真实 Worker 的 SIGKILL 接管演练。
7. 再实现 LoopKernel、ProgressDetector、OutcomeEvaluator。
8. 达标后进入 shadow 和小流量灰度。

首个实施 PR 只包含状态契约、状态机、迁移和测试，不同时加入 LoopKernel，保证可审查、可回滚。直连动作收口作为独立 PR，先覆盖网页采集预览/确认，再按副作用清单逐项迁移。

## 18. 本轮对账 SOP 收口（2026-07-13）

- 扩展 `docs/ops-runbook-6.0-7.0.md`，把 Agent 工具调用和直连动作的外部回执查询、`confirm_succeeded` / `confirm_not_applied` 请求体、未知结果禁止重发、审计核对和积压归零关闭条件写成可执行 SOP。
- 新增 `server/tests/test_reconciliation_runbook.py`，锁定四个 reconciliation 接口、可回放结果字段、新幂等键规则、未知结果保护和“对账后再次查询快照”步骤；并加入 `server/harness_spec.json` 发布门禁清单。
- 对账相关定向回归：`18 passed`；完整 Harness release gate：`135 passed, 9 skipped`；`git diff --check` 通过。
- 外部回执查询仍依赖对应厂商的官方控制台/API 和真实授权；本轮只完成本地 SOP 与可检测契约，没有调用 staging/生产，也没有宣称连续 SLO 或最终稳定。

## 19. 本地 Run/Step/Event 对账看板收口（2026-07-13）

- 新增只读管理员接口 `GET /api/ai/ops/run-reconciliation`，限制扫描最近 1–200 个 Run，并批量读取关联 Step/Event，避免逐条查询。
- 对账检查覆盖：未知状态、Run/Step/Event 序列缺口、终态时间戳一致性、终态 Run 是否存在匹配的完成/失败/取消事件，并返回稳定的 issue code 与计数。
- 新增后端回归 `server/tests/test_run_reconciliation.py`，并纳入 `server/harness_spec.json` 的 release gate。
- 桌面端新增对账 API 类型与 Ops 看板卡片，展示 pass/fail、扫描数、问题数及最多 20 条问题详情。
- 验证证据：定向后端 12 passed；完整后端 release gate `137 passed, 9 skipped`；桌面端全量 `247 passed`；typecheck 与 build 通过。构建仅提示 bundle chunk 超过 500 kB。
- 本轮完成本地 Run/Step/Event 可观测对账交付；不等同于 staging/生产双 worker、真实授权、持续 SLO、真实 checkpointer 或最终稳定性证明。未执行版本升级、commit、push。

## 20. 连续观测接入 Run/Step/Event 对账（2026-07-13）

- `GET /api/ai/ops/snapshot` 现在返回 Run/Step/Event 对账摘要：整体状态、扫描 Run 数、问题总数和按 issue code 聚合的计数；对账组件异常时返回 `unavailable` 并写入快照 notes。
- `server/scripts/evaluate_ga_observe.py` 将该摘要纳入连续观测门禁：字段缺失、对账不可用、状态非 pass 或问题数非零都会使观测项失败，避免只看成功率而漏掉状态账本不一致。
- 桌面端 Ops 看板在 Run/Step/Event 卡片中同时展示连续观测快照状态，人工对账和自动观测使用同一份摘要。
- 验证证据：定向后端 `21 passed`；完整 Harness release gate `140 passed, 9 skipped`；桌面端全量 `247 passed`；typecheck/build 通过（构建仅提示 bundle chunk 超过 500 kB）。
- 本轮补齐本地“可观测结果进入门禁”的缺口；仍未执行 staging/真实授权/生产 HTTPS、双 Worker 强杀对账、连续 7/14 天 SLO、真实生产 checkpointer，因此不宣称最终稳定。未执行版本升级、commit、push。

## 21. 本地实施复核（2026-07-14）

- 只读运行 `python3 scripts/run_staging_preflight.py --mode local --json`：`overall=pass`；HarnessSpec 21 个发布测试模块、LangGraph pilot 依赖隔离、shadow 默认模式、观测阈值均通过。运行模式仍明确禁止在生产就绪证据不足时切换 `real`。
- 运行 `CONTENT_ENCRYPTION_KEY=<临时本地测试值> python3 scripts/run_ga_gate_local.py --json`：9/9 门禁通过；Harness release gate `140 passed, 9 skipped`，离线评测 19/20、checkpoint 恢复 15/15、跨进程恢复 3/3、Runtime shadow fixture 50/50。
- 本次没有发现新的本地实现缺口，因此不扩大改动范围；桌面端、快照对账和连续观测 evaluator 继续共用 Run/Step/Event 对账摘要。
- 仍未执行且不能用本地结果替代：真实 staging HTTPS/Bearer 授权、真实数据库双 Runtime 强杀与外部回执对账、连续 7/14 天无双 owner 与 SLO、生产 checkpointer 评审。完成这些证据前不得宣称最终稳定或启用 `real`。

## 22. 本地混沌演练套件收口（2026-07-14）

- 新增 `server/scripts/run_agent_chaos_suite.py`，只使用临时内存 SQLite、模拟工具和本地状态 reducer，不访问网络或真实授权；输出 `schema_version=1.0` 的机器可读 JSON，并对每个 case fail-closed。
- 当前覆盖七类组合风险：Loop 取消/确认/重复动作/预算/质量阻断；Run 取消与模型调用预算越界；模型超时、限流、鉴权和上游 5xx 的稳定错误分类；外部工具结果未知时转 `reconciliation_required` 且禁止重执行；工具 `TimeoutError` 统一为 `TOOL_TIMEOUT` 并可安全回放；旧 fencing token 写入拒绝；数据库短暂不可用时 fail-closed 并可恢复。
- 新增 `server/tests/test_agent_chaos_suite.py`，覆盖全套通过、注入失败后的 fail-closed、重复轮数边界；新增 `server/tests/test_server_model_client.py` 覆盖模型错误分类；两者均纳入 `server/harness_spec.json` release gate。
- 本地 GA 门禁由 9 项增至 10 项：`agent_chaos_suite` 通过 `7/7`；Harness release gate `154 passed, 9 skipped`；完整本地 GA `10/10` 通过。
- 该套件明确是本地前置检测，不替代真实 staging HTTPS/Bearer 授权、真实数据库双 Worker 强杀与外部回执对账、连续 7/14 天 SLO/无双 owner、生产 checkpointer 评审；在这些证据完成前仍不得宣称最终稳定或启用 `real`。未改版本号、未提交、未推送。

## 23. 持久化 SLO 审计与连续观测收口（2026-07-14）

- 新增 `server/app/ops_slo.py`，从现有 AgentRun、AgentRunStep、AgentToolInvocation 和 DirectActionInvocation 账本计算可重复的不变量：Run/Step/Event 对账、终态租约、预算超限、工具幂等身份重复、副作用审计字段完整性及待对账积压。
- `GET /api/ai/ops/snapshot` 新增 `slo_audit`；`run_readiness_probe` 新增 Agent Loop SLO 检查。恢复率需要受控崩溃样本时明确返回 `not_observed`，整体显示 `pass_with_gaps`，不能伪装成通过。
- `evaluate_ga_observe.py` 新增 `agent_loop_slo` 连续观测项：审计缺失或硬性违规为 fail，恢复样本未观测为 insufficient，只有完整 SLO 证据才可进入连续窗口通过。
- 新增 `server/tests/test_ops_slo.py`，并纳入 HarnessSpec release gate；定向审计、运维、观测和 HarnessSpec 测试 `32 passed`；完整本地 GA `10/10`，HarnessSpec 回归 `159 passed, 9 skipped`。
- 该改动仍是本地可检测能力，不替代 staging/真实授权/双 Worker 强杀和 7/14 天恢复率证据；因此不升级版本号、不 commit、不 push，也不宣称最终稳定。

## 24. 桌面运维看板接入 Agent Loop SLO（2026-07-14）

- `apps/desktop/src/api/client.ts` 增加 `OpsSloAuditPayload` 与检查项类型，并把快照中的工具调用积压和 SLO 审计字段纳入 API 契约。
- `OpsDashboardPage` 展示审计整体状态、硬失败数、未观测数和逐项检查结果，区分 `通过`、`未通过`、`有未观测项`、`未观测` 与 `不可用`，避免把缺少 staging 恢复样本误显示为成功。
- 补充运维看板回归断言，覆盖 `pass_with_gaps` 和 `not_observed` 的用户可见文案。
- 验证证据：看板定向测试 1 passed；桌面端全量 31 个测试文件/247 个测试通过；`npm run typecheck` 与 `npm run build` 通过（仅保留既有 bundle chunk 大小提示）；`git diff --check` 通过。
- 仍未执行 staging/真实授权、真实数据库双 Worker 强杀与外部回执、连续 7/14 天 SLO、生产 checkpointer；未改版本号、未 commit、未 push，不能据此宣称最终生产稳定。

## 25. SLO 证据解释性补齐（2026-07-14）

- `OpsDashboardPage` 的 Agent Loop SLO 卡片现在显示每项检查的实际值与阈值；空值统一显示为 `—`，避免把 `not_observed` 误读为零或通过。
- 同一张卡片展示后端审计 notes，运维人员可直接看到“需要 staging/混沌演练结果文件”等证据缺口，无需再查原始 API。
- 回归测试覆盖 `pass_with_gaps`、空实际值、阈值和 staging 证据提示；目标测试 1 passed，桌面端 typecheck/build 通过，`git diff --check` 通过。
- 这是本地运维可观测性补齐，不替代 staging/真实授权、双 Worker 强杀与外部回执、连续 7/14 天 SLO、生产 checkpointer；未改版本号、未 commit、未 push。

## 26. 版本自动化与本地总门禁复核（2026-07-14）

- 修正 `tests/versioning-automation.test.js` 的过时断言：系统版本不再统一硬编码为 `1.0.0`，而是校验每个系统的运行时目标与其 VERSION 源一致；根仓库版本仍明确校验为 `1.0.0`。
- 版本自动化回归 `56 passed`；本地 GA 聚合门禁 `10/10`，其中 HarnessSpec `159 passed, 9 skipped`、恢复 `15/15`、多轮跨进程恢复 `3/3`、本地混沌 `7/7`、Runtime shadow `50/50`。
- 门禁仍明确建议先完成生产连续观测再宣布 GA；staging 授权、真实数据库/HTTPS、双 Runtime 强杀与外部回执、连续 7/14 天 SLO、生产 checkpointer 仍未执行。未改版本号、未 commit、未 push。

## 27. staging 观测传输安全收口（2026-07-14）

- `server/scripts/staging_auth.py` 新增统一 `validate_bearer_transport`：未使用 Bearer 时保留本地 HTTP/test-header 兼容；一旦指定 Bearer 环境变量，目标必须是 HTTPS origin，且禁止 URL user-info。
- `run_ga_observe.py`、`run_ga_smoke.py`、`run_checkpoint_recovery.py` 复用同一校验，避免不同演练入口出现授权策略漂移；token 仍只从指定环境变量读取，不打印到日志。
- 新增传输边界回归；定向测试 `25 passed`，脚本编译/帮助入口通过；本地 GA `10/10`，Harness release gate `162 passed, 9 skipped`，`git diff --check` 通过。
- 该修复只提高 staging 执行入口的 fail-closed 安全性，不产生 staging 证据；真实 HTTPS/Bearer、真实数据库双 Worker 强杀与外部回执、连续 7/14 天 SLO 和生产 checkpointer 仍需最后执行，不能据此宣称最终稳定。未改版本号、未 commit、未 push。

## 28. 连续观测默认门槛统一（2026-07-14）

- 稳定完成定义要求连续 14 天，但三个入口此前默认 10 天；新增 `server/scripts/observation_policy.py`，集中 14 天窗口、成功率 `0.9` 和最少完成 Run `1` 的默认值。
- `run_staging_preflight.py` 与 `evaluate_ga_observe.py` 现在共享同一策略常量；观测清单命令也明确传入 `--min-days 14`。显式传参仍可用于短周期本地测试，但不能替代最终两周证据。
- 新增默认策略回归；定向观测/preflight/auth 测试 `27 passed`，本地 GA `10/10`，Harness release gate `164 passed, 9 skipped`。
- 这只是消除默认配置漂移，不产生连续 staging SLO 证据；真实授权、双 Worker 强杀与外部回执、连续 14 天窗口、生产 checkpointer 仍待执行。未改版本号、未 commit、未 push。

## 29. 本地 HTTP 全链路演练与 smoke 语义门禁（2026-07-14）

- 首次用临时 SQLite 启动真实 FastAPI 服务时发现：数据库未迁移到 head 会导致 channel job worker 报表不存在，`/ops/ga-report`、工作流和成本路径返回 500；按正式顺序执行 `python3 -m alembic upgrade head` 后问题消失。运维手册现已明确“迁移失败或无法确认 head，不得启动新版本服务”。
- `run_ga_smoke.py` 不再只看 HTTP 2xx：readiness 必须为 `ready|ready_with_warnings`，安全审计必须为 `pass|pass_with_warnings`，GA 报告失败数必须为 0，checkpoint suite 必须 `passed=true`，Agent Hub 必须全健康；普通业务路径仍按 HTTP 状态码检查。
- 新增 `server/tests/test_ga_smoke.py` 并纳入 HarnessSpec，覆盖 warning/partial 的允许范围和 `not_ready`、审计失败、GA 失败、checkpoint 失败、Agent Hub 部分不健康等拒绝条件。
- 真实本地 HTTP 证据：迁移到 `0045_agent_langgraph_checkpoints` 后 smoke `13/13`、轻载 `0/4` 错误；observe 写入 6 个 probe，`readiness=ready_with_warnings`、`security=pass`、`ga=partial`（`failed=0`，unknown 由空样本导致）。定向测试 `30 passed`，随后完成 `git diff --check`。
- 该演练只证明本地服务启动、迁移顺序和 HTTP 观测语义；未产生 staging Bearer/HTTPS、真实双 Worker/外部回执、连续 14 天 SLO 或生产 checkpointer 证据，仍不得宣称最终稳定或切换 `real`。未改版本号、未 commit、未 push。

## 30. 最终本地聚合门禁复核（2026-07-14）

- 本地 preflight `overall=pass`，6/6 检查通过：HarnessSpec 25 个模块、LangGraph pilot 依赖隔离、shadow 默认模式、本地授权边界、传输策略和统一 14 天观测门槛。
- 本地 GA 聚合 `10/10` 通过：Harness release gate `167 passed, 9 skipped`；离线评测 19/20（0.95）；checkpoint 恢复 15/15；同库多实例恢复 5/5；多轮跨进程 SIGKILL 恢复 3/3；Connector dry-run、安全纯逻辑、混沌 7/7、Runtime shadow 50/50 均通过。
- 本地 HTTP 全链路已在 Alembic head（`0045_agent_langgraph_checkpoints`）上验证：smoke `13/13`，轻载错误 `0/4`；观测写入 6 个 probe，readiness=`ready_with_warnings`、security=`pass`、GA=`partial` 且 `failed=0`。smoke 现在按响应语义而非仅 HTTP 2xx 判定。
- 结论：本地实现和可检测门禁已收口；仍不能宣布最终稳定或切换 `real`。待用户最后授权后，必须在真实 staging 完成 HTTPS/Bearer、真实数据库双 Worker 强杀/外部回执对账和连续 14 天 SLO，再评审生产 checkpointer 与版本发布。未改版本号、未 commit、未 push。

## 31. Smoke 与连续观测共享语义契约（2026-07-14）

- 新增 `server/scripts/ops_probe_semantics.py`，把 health、Agent Hub、readiness、安全审计、GA 报告和 checkpoint suite 的成功条件集中为一份 fail-closed 规则；查询参数不会影响路由匹配，畸形/负数/缺失计数不会被当成成功。
- `run_ga_smoke.py` 与 `run_ga_observe.py` 复用同一规则。连续观测现在同时记录每个 probe 的 `semantic_ok` 和 `semantic_failures`；HTTP 2xx 但 `not_ready`、部分不健康、GA `failed>0` 或 checkpoint 未通过，都会使观测命令返回失败，避免“假绿”进入 14 天窗口。
- 新增回归覆盖 warning/partial 的允许范围、语义失败、HTTP 失败和畸形计数；定向测试 `32 passed`，脚本编译/帮助入口与 `git diff --check` 通过；随后本地 preflight `6/6`、GA `10/10`，Harness release gate `169 passed, 9 skipped`。
- 该改动强化本地检测契约，不产生 staging/生产运行证据；真实 HTTPS/Bearer、双 Worker 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和最终版本发布仍待用户最后授权。未改版本号、未 commit、未 push。

## 32. 连续观测 evaluator 接入语义契约（2026-07-14）

- `server/scripts/evaluate_ga_observe.py` 现在消费观测 JSONL 中每个 probe 的 `semantic_ok`；显式为 false、类型畸形、HTTP 状态畸形或探针结构异常都会 fail-closed，并新增独立 `probe_semantics` 检查，避免 HTTP 200 的语义失败进入 14 天窗口。
- 对缺少新字段的旧通用探针保留兼容；若旧记录包含响应 body，则按共享 `ops_probe_semantics.py` 重新推导，减少历史数据迁移压力而不放松当前格式门禁。
- 新增评估器回归覆盖语义失败、畸形状态/语义字段和旧格式兼容；定向测试 `35 passed`，脚本编译与 `git diff --check` 通过；本地 GA `10/10`，Harness release gate `172 passed, 9 skipped`。
- 该改动只补齐本地连续观测的消费端契约，不产生 staging/生产运行证据；真实 HTTPS/Bearer、双 Worker 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和最终版本发布仍待用户最后授权。未改版本号、未 commit、未 push。

## 33. Runtime shadow 固定任务重复轮次门禁（2026-07-14）

- `runtime_shadow_fixture.py` 保留默认 50 条兼容 fixture，并新增带轮次标识的 `build_contract_trials()`；每轮使用独立 case ID，避免重复运行时把同一记录误当成覆盖率。
- 本地 GA 的 Runtime shadow 门禁固定执行 `50 条 × 3 轮 = 150` 条脱敏契约记录，要求总数、每轮唯一 ID、0 mismatch 和报告状态同时满足；这检测本地比较/聚合流程的重复运行稳定性，不把 fixture 当成真实任务成功率。
- 新增 `test_local_contract_fixture_repeats_three_independent_trials`；定向 shadow/observe/smoke 回归 `34 passed, 8 skipped`，脚本编译与 `git diff --check` 通过。
- 本地 GA 最新结果：`10/10`；Harness release gate `173 passed, 9 skipped`；Runtime shadow `150/150`、0 mismatch；离线评测 19/20、checkpoint 15/15、同库恢复 5/5、跨进程恢复 3/3、混沌 7/7。
- 该门禁仍是本地契约检测，不替代真实 staging 固定任务集、双 Runtime 强杀/外部回执、连续 14 天 SLO、生产 checkpointer 或最终版本发布；未改版本号、未 commit、未 push。

## 34. Runtime 状态阶段与步骤 fail-closed 收口（2026-07-14）

- `server/app/agent_runtime/runtime_state_contract.py` 现在把非失败阶段与 `completed_steps` 前缀长度绑定：`accepted/prepared/executed/verified/completed` 分别只能对应 0/1/2/3/4 个连续步骤；`failed` 只允许保留合法前缀。步骤列表先做字符串和顺序校验，畸形对象不会再在去重时抛未分类异常。
- `append_completed_step` 改为 fail-closed：只接受合法连续前缀，只允许追加当前下一步，重复追加保持幂等；跳步、乱序、损坏前缀统一拒绝。
- `langgraph_graph.py` 为 prepare/execute/verify/finish 增加节点前置契约和回调结果校验；执行失败直接进入 finish，不再调用 verify；失败收尾不追加虚构的 `finish`，只保留已经完成的合法前缀。自定义回调的部分状态更新也由图统一补齐并复核。
- 新增/更新 Runtime 回归，覆盖阶段—步骤不一致、跳步/损坏前缀、不可哈希步骤和失败分支；Runtime 定向 `15 passed, 8 skipped`，相关 shadow/observe/smoke `36 passed, 8 skipped`。
- 证据：Harness release gate `175 passed, 9 skipped`；本地 GA `10/10`（Runtime shadow `150/150`、0 mismatch）；本地 preflight `6/6`。当前仍是 `shadow` 且 `runtime_enabled=false`，不产生 staging/生产证据。
- 仍需用户最后授权后在真实 staging 完成 HTTPS/Bearer、真实数据库双 Worker 强杀/外部回执对账、连续 14 天 SLO 和生产 checkpointer 评审；未改版本号、未 commit、未 push。

## 35. 直连副作用账本对账演练纳入本地 GA（2026-07-14）

- 新增 `server/scripts/run_direct_action_reconciliation_drill.py`，每个 case 使用全新内存 SQLite，不访问网络、不读取真实凭据；报告固定为 `schema_version=1.0`、`scope=local_in_memory_only`，单 case 异常即 fail-closed。
- 五个 case 覆盖直连副作用的关键恢复语义：成功结果只允许单次副作用并可安全回放；同一幂等键不同请求体返回冲突；结果未知进入 `reconciliation_required` 并禁止重执行；过期 `in_progress` 自动转对账；明确失败后必须更换幂等键。
- 新增 `server/tests/test_direct_action_reconciliation_drill.py`，覆盖全量通过和注入 `succeed` 异常后的失败报告；演练已纳入 `server/harness_spec.json` 与 `run_ga_gate_local.py`。
- 验证证据：直连账本定向 `5 passed`，相关回归 `7 passed`；Harness release gate `177 passed, 9 skipped`；本地 GA `11/11`，新增演练 `5/5`，Runtime shadow `150/150`、0 mismatch；本地 preflight `6/6`（HarnessSpec 26 个模块）。
- 该演练只补齐本地可检测性，仍不替代真实 staging HTTPS/Bearer、真实数据库双 Worker 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和最终版本发布；未改版本号、未 commit、未 push。

## 36. LangGraph checkpoint 历史读取契约补齐（2026-07-14）

- 修复 `AgentRunCheckpointSaver.list()` 只返回最新 checkpoint 的本地缺口；新增独立 payload 历史读取，按数据库自增提交序列返回 newest-first，避免依赖 checkpoint ID 的字典序。
- `before` 现在以同一线程/namespace 的已提交 checkpoint 为边界；未知边界直接返回空结果，避免恢复代码误读无关历史。`filter` 与 `limit` 对完整历史生效；迁移前旧单条 payload 仍可读取。
- 新增两个不依赖可选 LangGraph 包的回归，分别覆盖 list 契约和真实 SQLAlchemy 多记录读取。先以旧实现得到预期失败，再以修复后 `2 passed`；Runtime/演练/preflight 组合 `22 passed, 9 skipped`。
- 这只增强本地持久化恢复与审计的可检测性，不启用 `real` runtime，不产生 staging/生产证据；真实 HTTPS/Bearer、双 Worker 强杀/外部回执、连续 14 天 SLO、生产 checkpointer 与最终版本发布仍待最后授权。未改版本号、未 commit、未 push。

## 37. checkpoint 历史契约最终本地回归（2026-07-14）

- 增加未知 `before.checkpoint_id` 的 fail-closed 断言；checkpoint 历史定向测试 `2 passed`，Runtime/跨进程演练/staging preflight 组合 `31 passed, 9 skipped`。
- Harness release gate `179 passed, 9 skipped`；本地 GA `11/11`，checkpoint 恢复 `15/15`、同库多实例 `5/5`、双进程接管与跨进程 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 0 mismatch。
- 本地 preflight `6/6` 通过，当前仍明确为 `shadow`、`runtime_enabled=false`；staging HTTPS/Bearer、真实数据库双 Worker 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和版本发布仍未执行。未改版本号、未 commit、未 push。

## 38. 本地兼容性与全栈回归最终收口（2026-07-14）

- 修复 `KnowledgeFile` 旧调用方未传 `key_version` 时的默认值：模型构造和数据库列默认统一为 `v1`，避免旧代码路径在加密文件写入时产生空版本；先新增回归得到 RED，再修复后相关后端测试 `36 passed`。
- 将 health 测试改为校验运行时 `app.version`，并同步迁移图断言到当前 head `0050_project_task_delivery_activity` 及四张项目交付表，避免测试硬编码落后于现有迁移链；项目任务路由单独重复 5 次共 `10/10` 通过，未复现全量中的一次性 `405`。
- 后端最终全量：`python3 -m pytest tests -q` 得到 `904 passed, 10 skipped`；桌面端 `npm run typecheck`、`npm run build` 通过；桌面端串行全量 `31 files / 248 tests passed`。默认并发曾出现 1 个 5 秒超时，单例复现通过且单 worker 全量通过，判定为测试资源竞争，不改业务逻辑或放宽超时。
- 仍未执行且不能由本地结果替代：真实 staging HTTPS/Bearer 授权、真实数据库双 Runtime 强杀与外部回执对账、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布；当前仍为 `shadow`、`runtime_enabled=false`，因此不得宣称生产最终稳定或启用 `real`。未改版本号、未 commit、未 push。

## 39. 本地实施方案门禁复核（2026-07-14）

- 只读 preflight：`python3 scripts/run_staging_preflight.py --mode local --json` 返回 `overall=pass`，HarnessSpec、可选依赖隔离、Runtime 模式、授权边界、传输策略和 14 天观测参数均通过；当前 `langgraph_runtime_mode=shadow` 且 `runtime_enabled=false`。
- 本地 GA 聚合：`python3 scripts/run_ga_gate_local.py --json` 返回 `overall=pass`、`11/11` 门禁通过；Harness release gate `179 passed, 9 skipped`，离线评测 `19/20`（0.95），checkpoint `15/15`，同库恢复 `5/5`，双进程接管 `1/1`，跨进程恢复 `3/3`，Agent Loop 混沌 `7/7`，直连副作用对账 `5/5`，Runtime shadow `150/150` 且 `0 mismatch`。
- 因此本地开发和可检测门禁已完成，没有新增必须在本地实现的功能；仍不能由本地结果替代的只有真实 staging HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀与外部回执对账、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布。未改版本号、未 commit、未 push。

## 40. staging preflight 迁移图门禁（2026-07-14）

- 发现 preflight 之前只检查 HarnessSpec、依赖隔离、运行时开关、授权、传输和观测阈值，没有验证 Alembic 配置与 revision graph；这可能让迁移缺失、损坏或多 head 的版本进入演练。
- 新增 `server/scripts/run_staging_preflight.py::_migration_graph_status`：只读解析 `alembic.ini` 和 `alembic/versions`，要求 Alembic 可解析、至少有一个 revision 且只有一个 head；不执行 upgrade/downgrade、不连接数据库、不输出凭据。解析失败、缺配置、缺版本目录和多 head 均 fail-closed。
- 新增 `server/tests/test_staging_preflight.py::test_migration_graph_rejects_multiple_heads`；先验证旧实现 RED，再验证修复后 preflight/migrations 定向回归 `30 passed`。
- 当前真实仓库 preflight `overall=pass`，迁移图 head=`0050_project_task_delivery_activity`、revision_count=`51`；本地 GA 聚合 `11/11`，Harness release gate `180 passed, 9 skipped`，其余恢复、混沌、直连副作用和 Runtime shadow 证据保持通过。
- 该门禁只证明迁移图静态完整，不能证明目标数据库已经升级到 head；真实 staging 仍必须在启动前执行/确认迁移并完成 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执对账、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布。未改版本号、未 commit、未 push。

## 41. staging 证据包汇总门禁（2026-07-14）

- 新增 `server/scripts/evaluate_staging_evidence.py`，只读汇总三类证据：`run_staging_preflight.py --mode staging --json`、真实部署平台生成的双 Runtime Worker 恢复报告、`run_ga_observe.py` 产生的 HTTPS JSONL。脚本不联网、不读取 Token、不修改数据库。
- 恢复报告固定要求 `schema_version=1.0`、`environment=staging`、`scope=dual_runtime_process_boundary`、至少 1000 次且恢复率 ≥99.9%，并明确记录 Worker A `SIGKILL`、Worker B 接管、旧 worker fencing 拒绝、`dual_owner_incidents=0` 和 `duplicate_side_effects=0`；本地 `local_process_boundary_rehearsal` 报告会被 fail-closed 拒绝。
- 观测汇总复用 `evaluate_ga_observe.py` 的 Run/Step/Event、工具/直连对账、SLO、语义探针和连续窗口规则，并额外要求每条记录为 HTTPS origin；preflight、recovery、observation 任一缺失或失败，整体结果即为 `fail`。
- 新增 `server/tests/test_staging_evidence_gate.py`，覆盖完整证据包通过、本地报告拒绝、强杀/fencing/重复副作用缺失、HTTPS/连续窗口不足和畸形 JSON；测试 `9 passed`，并已加入 HarnessSpec 发布清单。
- 该门禁让“最后再做”的真实 staging 证据具备可执行的收口标准，但不生成任何 staging 证据；在真实授权、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审完成前，仍不得宣称最终稳定或启用 `real`。未改版本号、未 commit、未 push。

## 42. staging preflight 与 Bearer 传输契约统一（2026-07-14）

- 发现 `run_staging_preflight.py` 之前只用 `https://` 前缀判断目标，和实际 `run_ga_observe.py` 使用的 `validate_bearer_transport` 规则不一致；带 URL user-info、缺少 host 或异常 scheme 的地址可能在启动前检查中被误判为通过。
- preflight 现在复用统一 Bearer 传输校验；staging 即使尚未填写环境变量，也先校验 HTTPS origin，local 无 Bearer 的 HTTP 开发路径保持兼容。报告只返回固定错误类别和 scheme，不回显 URL user-info、Token 或环境变量值。
- 新增 URL user-info、无 host、异常 scheme 的回归；staging/preflight/auth/证据包/恢复/观测/Harness 相关测试 `54 passed`，本地 GA `11/11`，Harness release gate `186 passed, 9 skipped`，本地 preflight `overall=pass`。
- 该修复只统一 staging 启动前安全门禁，不产生 staging 运行证据；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布仍待最后执行。未改版本号、未 commit、未 push。

## 43. staging 证据包 preflight 完整性收口（2026-07-14）

- 发现 `evaluate_staging_evidence.py` 之前只要求 preflight 证据包含 5 个检查，遗漏 `langgraph_dependency_isolation` 与 `observation_policy`；不完整或被篡改的 JSON 可能因此被误判为通过。
- 证据汇总现在要求完整 7 项安全检查，拒绝非对象/非法状态/重复或非字符串 ID，并核对 `failed_checks`、各检查状态和 `overall` 三者一致；畸形 artifact 返回失败而不会让 evaluator 异常退出；仍不读取 Token、不联网、不修改数据库。
- 新增缺失检查、重复 ID 和未报告失败的回归；证据包/观测/preflight/授权/smoke 相关定向测试 `44 passed`，Harness release gate `188 passed, 9 skipped`，本地 GA `11/11`，脚本编译通过。
- 该修复只强化最后 staging 证据的完整性，不生成 staging 证据；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布仍待最后执行。未改版本号、未 commit、未 push。

## 44. staging 观测 JSONL 畸形行 fail-closed（2026-07-14）

- 发现 `evaluate_ga_observe.py::load_rows` 默认会跳过非法 JSON 和非对象行；如果观测文件包含损坏行但剩余记录仍满足连续窗口，最终 staging 证据可能把不完整 artifact 当成完整窗口。
- 新增 `load_rows(..., strict=True)`：严格模式遇到非法 JSON 或非对象行抛出不含原文的 `ValueError`；普通评估保持兼容旧格式。`evaluate_staging_evidence.py` 通过 `load_observation_rows` 强制使用严格模式，畸形观测 artifact 直接退出失败，不会静默缩短样本。
- 新增 malformed JSONL 与非对象行回归；定向观测/证据/preflight/auth/smoke 测试 `46 passed`；Harness release gate `190 passed, 9 skipped`；本地 GA `11/11`，本地 preflight `overall=pass`（7 项检查），脚本编译和 `git diff --check` 通过。
- 该修复只强化证据文件完整性，不联网、不读 Token、不改数据库，也不生成 staging 证据；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审和最终发布仍待最后执行。未改版本号、未 commit、未 push。

## 45. staging 恢复 case 身份唯一性 fail-closed（2026-07-14）

- 发现恢复证据此前只校验 `cases` 数量和 `passed` 布尔值；复制同一条成功记录 1000 次也可能满足恢复率门禁，无法证明实际执行了足量独立演练。
- `evaluate_staging_evidence.py` 现在要求每条 case 有非空身份：优先使用 `case_id`，兼容已有报告的 `case`；拒绝缺失、空字符串、布尔值和重复身份，并将结构/唯一性结果写入 recovery check detail。
- 新增重复、缺失和畸形 case 回归；先验证旧实现 RED，再修复后证据包/观测/preflight/auth/smoke 定向 `48 passed`。脚本 compileall 通过；Harness release gate `192 passed, 9 skipped`；本地 GA `11/11`；本地 preflight `overall=pass`（7 项检查）。
- 恢复统计对非对象 case 采用安全计数，畸形输入返回结构化 recovery fail，不再抛 `AttributeError`。
- 该修复只强化恢复证据的样本独立性，不联网、不读 Token、不改数据库，也不生成 staging 证据；真实 HTTPS/Bearer、真实双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审和最终发布仍待执行。未改版本号、未 commit、未 push。

## 46. staging 恢复报告时间线与 worker 身份契约（2026-07-14）

- 发现恢复门禁虽然要求强杀、接管和 fencing 布尔标志，但没有要求 `run_id`、两个 worker 身份、强杀时间、接管事件和最终状态；不同平台可能用不完整或无法审计的报告满足门禁。
- `evaluate_staging_evidence.py` 现在要求 `run_id`、不同的 `worker_a_id/worker_b_id`、带时区 ISO-8601 的 `worker_a_sigkill_at`，以及 `type=lease_takeover`、同一 run、指向 Worker B 且时间不早于强杀时间的 `takeover_event`；同时要求 `final_status=succeeded`。缺字段、无时区、时间线矛盾统一 fail-closed。
- 运维手册新增平台无关 JSON 字段示例；新增时间线缺失、重复 worker、畸形时间、错误接管对象和未完成终态回归。RED→GREEN 后定向 staging/观测/preflight/auth/smoke `53 passed`；Harness release gate `193 passed, 9 skipped`；本地 GA `11/11`；preflight `overall=pass`（7 项），脚本 compileall 通过。
- 该修复只增强 staging 证据可审计性，不生成 staging 证据、不联网、不读 Token、不改数据库；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布仍待授权执行。未改版本号、未 commit、未 push。

## 47. staging 观测行结构与时间戳契约（2026-07-14）

- 审计发现 `evaluate_ga_observe.py` 对非对象观测行会抛 `AttributeError`，并会接受无时区时间戳；这会让连续窗口的样本边界和失败原因不可审计。
- 现在观测 evaluator 对每一行执行 fail-closed 校验：非对象行、缺失/非法时间戳和无时区 ISO-8601 时间戳都会进入 `observation_rows` 失败检查；staging 证据汇总也会返回结构化失败而不抛异常。空观测仍保持 `insufficient_data`，不被误判为通过。
- 先以旧实现验证 RED（4 个新增回归失败），修复后定向契约测试 `4 passed`；观测/证据/preflight/auth/smoke 相关回归 `53 passed`；Harness release gate `197 passed, 9 skipped`；本地 GA `11/11`，本地 preflight `overall=pass`；脚本 compileall、目标文件 `git diff --check` 和后端全量 `923 passed, 10 skipped` 均通过。
- 运维手册同步记录 JSONL 行结构和时区要求。该修复只增强本地证据完整性，不联网、不读 Token、不改数据库，也不生成 staging 证据；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布仍待最后执行。未改版本号、未 commit、未 push。

## 48. 当前工作树实施状态复核（2026-07-14）

- 基于当前工作树重新执行 `python3 scripts/run_staging_preflight.py --mode local --json`，结果 `overall=pass`；`python3 scripts/run_ga_gate_local.py --json` 结果 `overall=pass`、`11/11`，并继续提示必须完成生产连续观测后才能宣布 GA。
- 重新执行 `python3 scripts/run_harness_release_gate.py`，结果 `197 passed, 9 skipped`；此前后端全量回归仍为 `923 passed, 10 skipped`。当前本地状态契约、工具契约、恢复、对账、观测和发布清单均有机器化回归。
- 复核结论：没有新增可在本地安全完成的实现缺口；`real` runtime 继续保持 `runtime_enabled=false`/fail-closed。最终完成定义仍缺真实 staging HTTPS/Bearer、真实双 Worker 强杀接管与 fencing/外部副作用对账、连续 14 天 SLO、生产 checkpointer 评审和灰度/回滚证据。
- 本轮只做复核和记录，不生成伪造 staging 证据，不读取或保存 Token，不改版本号，不 commit，不 push。

## 49. 版本自动化与发布边界复核（2026-07-14）

- 父仓库已有统一版本注册表和 `post-commit` 自动化：按提交类型映射 major/minor/patch，按受影响系统同步 `VERSION`、package/lock、JSON、TOML、Cargo.lock 和声明式部署字段，随后 amend 版本前缀并推送当前分支；无 upstream 时自动建立 upstream。桌面端 `agent:version` 继续作为六处版本文件的原子同步工具。
- 父仓库 `npm run test:versioning` 通过 `56/56`，覆盖多系统升版、共享路径 scope、版本漂移、amend、stash 恢复、失败回滚、upstream/push 以及 post-commit 事务；桌面端 `node --test scripts/tests/*.test.mjs` 通过 `69/69`，覆盖 SemVer、原子版本同步、构建模式、Tauri/Cargo/npm 一致性、更新策略、产物清单、架构校验和发布配置安全边界。
- 因此本地没有新增“版本号—提交—推送”实现缺口；本轮没有调用 `agent:version` 改版本，没有触发 post-commit，没有 commit/push。版本自动化只会在明确的业务提交和已安装 hook 的仓库流程中运行，真实发布仍需单独授权、审核和灰度/回滚证据。
- 版本审计不改变稳定完成定义：真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing/外部副作用对账、连续 14 天 SLO、生产 checkpointer 评审以及灰度/回滚证据仍未执行；`real` runtime 继续保持 `runtime_enabled=false`/fail-closed。

## 50. 按 run_id 的运维控制闭环（2026-07-14）

- 重新按稳定完成定义审计后，发现本地仍有一个可安全落地的缺口：已有全局看板、用户取消/重试和 reconciliation，但缺少管理员按 `run_id` 的查看、暂停、恢复、内部回滚闭环。
- 新增 `GET /api/ai/ops/runs/{run_id}`：返回单个 Run 的 Run/Step/Event 链路、结果和范围化 reconciliation；新增 `POST .../pause`、`POST .../resume`、`POST .../rollback`，全部要求管理员授权并写入 request audit。
- 暂停是持久化状态门且重复调用幂等；恢复只在 `paused → running` 时启动 runtime，运行态重复恢复只返回快照；native runtime 在 `paused` 状态 fail-closed，不会自行继续推进。
- 回滚选取最新安全 checkpoint，恢复内部 stage/progress 并标记 `resume_source=ops_rollback`；响应显式 `side_effects_reversed=false`，不把外部副作用撤销冒充为成功。缺少安全 checkpoint 返回 `409`。
- 先补红灯再实现：运维控制测试 `6 passed`；受影响服务、checkpoint、runtime、ops 回归 `81 passed`；后端全量 `929 passed, 10 skipped`。
- 本地 Harness release gate `197 passed, 9 skipped`；本地 GA `11/11`，checkpoint `15/15`、同库恢复 `5/5`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 仍未执行且不能由本地结果替代：真实 staging HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀接管与 fencing/外部回执对账、连续 14 天 SLO、生产 checkpointer 评审、灰度与回滚证据。当前 `real` runtime 仍保持 `runtime_enabled=false`/fail-closed；未改版本号、未 commit、未 push。

## 51. 运维控制发布门禁与桌面入口闭环（2026-07-14）

- 继续按稳定完成定义审计后发现两个本地缺口：`server/tests/test_ops_run_control.py` 已验证后端运维控制，但未注册到 HarnessSpec 发布门禁；桌面运维看板只有全局 reconciliation，没有管理员按 `run_id` 查询和控制的操作入口。
- `server/harness_spec.json` 现已把 `tests/test_ops_run_control.py` 纳入发布清单；`server/tests/test_harness_release_gate.py` 新增门禁自检，防止后续移除运维控制契约测试而不被发现。旧配置先出现预期 RED，修复后发布门禁定向测试 `7 passed`。
- `apps/desktop/src/api/client.ts` 新增单 Run 详情以及 `pause`、`resume`、`rollback` 客户端契约；`apps/desktop/src/pages/admin/OpsDashboardPage.tsx` 新增“按 Run ID 控制”区域，展示状态、阶段、进度、范围化 reconciliation、步骤和事件，并在操作后重新读取服务端状态。
- 桌面入口明确显示：rollback 只恢复内部 checkpoint，`side_effects_reversed=false`，不会撤销外部副作用；管理员必须先 reconciliation，不能把内部回滚当成外部消息、扣费或其他副作用已回退。组件测试先 RED，再验证查询、暂停、恢复、回滚和警告文案，结果 `2 passed`。
- 相关后端契约回归 `20 passed`；桌面全量测试 `33 files / 256 tests passed`，TypeScript typecheck 和 Vite production build 通过；Harness release gate `204 passed, 9 skipped`，执行清单中已包含 `test_ops_run_control.py`。HarnessSpec JSON、后端 compileall 和目标文件 `git diff --check` 均通过；构建仅保留既有的大 chunk 非阻断警告。
- 本地 Run/Step/Event 运维闭环现在同时具备后端契约、发布门禁和桌面入口。仍未执行且不能由这些结果替代：真实 staging HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀接管、旧 Worker fencing、外部回执/副作用对账、连续 14 天 SLO、生产 checkpointer 评审以及灰度/回滚证据；`real` runtime 继续保持关闭和 fail-closed。未改版本号、未 commit、未 push。

## 52. staging 发布证据第四工件门禁（2026-07-14）

- 最终证据门禁复核发现一个 fail-open 缺口：`evaluate_staging_evidence.py` 之前只消费 preflight、恢复和连续观测三份 artifact，缺少迁移记录、完整测试报告、灰度数据、回滚演练和生产 checkpointer 评审时仍可能整体通过。
- 汇总器现在强制接收第四份 `release` artifact；命令行 `--release` 为必填。该工件必须同时包含 `migration`、`tests`、`canary`、`rollback_drill` 和 `production_checkpointer_review` 五段真实证据，任一段缺失、环境不一致、时间无时区、计数/比率使用字符串或证据时间晚于汇总时间都会 fail-closed。
- 发布契约要求：迁移成功且单一 head、expand/contract 已确认；测试失败数为 0 且 Harness release gate 通过；候选成功率不低于基线且 P0/P1、重复副作用、双 owner 均为 0；内部回滚成功且不超过 900 秒；生产 checkpointer 必须经责任人批准，并证明持久化、多实例、fencing 和恢复报告齐全。灰度阶段的完整时序和样本契约已在下一节收紧。
- 运维手册已增加第四份证据工件的机器可读 JSON 契约和执行命令，并明确示例不能作为真实放行证明；脚本仍为只读，不联网、不读取 Token、不修改数据库。
- TDD 证据：新增契约初始 RED 为 `14 failed, 2 passed`；严格 JSON 数字类型补测再次得到 `1 failed, 16 passed`；修复后证据门禁定向 `17 passed`，相关 staging/preflight/auth/observe/smoke/Harness 回归 `64 passed`，Harness release gate `208 passed, 9 skipped`，后端全量 `934 passed, 10 skipped`；脚本 compileall 和 `--help` 入口通过。
- 该改动只保证最终放行证据不可缺项或伪装，不生成真实 staging 证据。真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与外部回执、连续 14 天 SLO、生产 checkpointer 评审、灰度和回滚演练仍按用户决定留到最后；`real` runtime 保持关闭。未改版本号、未 commit、未 push。

## 53. 灰度阶段证据与 48 小时门禁对齐（2026-07-14）

- 继续对照第 12 节发布路径复核后发现，第四工件门禁仍接受旧的 `5/20/50/100` 百分比数组，也没有验证单阶段时长、样本量、阶段顺序和时间边界；短至 1 小时或缺少内部账号、1% 阶段的记录仍可能被当成完整灰度证据。
- `release` 工件现升级为 schema `1.1`，灰度记录必须严格依次包含 `internal(0%) → 1_percent(1%) → 5_percent(5%) → 20_percent(20%) → 50_percent(50%) → 100_percent(100%)`。每阶段必须提供带时区的开始/结束时间、持续至少 48 小时、`finished_runs` 为严格 JSON 正整数且 `status=passed`；缺阶段、错序、百分比不符、阶段重叠、零样本、字符串冒充数字或首尾时间不匹配 canary 总窗口均 fail-closed。旧 schema `1.0` 和旧 `rollout_percentages` 数组不再被接受。
- 运维手册的机器可读示例已同步为完整六阶段、连续 12 天的结构，并明确每阶段样本和时序约束；证据汇总器仍然只读，不联网、不读取 Token、不修改数据库。
- TDD 证据：新契约在旧实现上先得到 `3 failed, 16 passed`；修正测试工件版本后中间结果为 `1 failed, 18 passed`；最终定向门禁 `19 passed`，相关 staging/preflight/auth/recovery/observe/smoke/Harness 回归 `70 passed`，Harness release gate `210 passed, 9 skipped`，后端全量 `936 passed, 10 skipped`；脚本 compileall 和运维手册 JSON 示例解析通过。
- 该改动只收紧发布证据，不生成真实 staging 或生产数据。真实 HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀接管、旧 Worker fencing、外部回执/副作用对账、生产 checkpointer 评审、完整灰度/回滚演练和连续 14 天 SLO 仍按用户决定留到最后；`real` runtime 保持关闭。未改版本号、未 commit、未 push。

## 54. staging 证据同源与恢复语义最终门禁（2026-07-14）

- 最终证据复核发现，四份单独合法的 artifact 仍可能来自不同发布批次或不同 staging 地址；12 天灰度也可能借用 14 天 observation 拼成“通过”，发布事件时间也未强制按迁移、测试、灰度和评审顺序排列。
- `staging_auth.py` 新增稳定 `release_id` 的规范化和 fail-closed 校验；preflight 与 Bearer 观测入口要求显式发布身份，并输出规范化 `base_url`、带时区 `generated_at`。恢复证据升级为 schema `1.1`，发布证据升级为 schema `1.2`。
- 汇总器新增第五项 `evidence_coherence`：preflight、恢复、每条观测和 release 工件必须使用同一个 `release_id` 与同一个 HTTPS staging origin；preflight 必须早于灰度，恢复演练和所有观测必须位于 canary 窗口内，canary 总时长必须达到默认 14 天。迁移完成、测试完成、灰度开始、灰度完成、回滚/评审和工件生成时间必须有序。
- 非对象顶层 preflight/recovery/release artifact 现在统一 fail-closed，不再抛 `AttributeError`；运维手册与脚本帮助已同步完整字段、执行命令和旧 schema 拒绝规则。
- TDD 证据：同源契约初始 `7 failed, 18 passed`，采集端还出现缺少 `normalize_release_id` 的预期收集失败；实现后四组定向回归 `71 passed`，相关 staging/GA/Harness 回归 `87 passed`，Harness release gate `227 passed, 9 skipped`。全量测试期间曾有另一项工作并发更新未跟踪的专业交付模块；文件稳定后该模块当前 `13 passed`，并以运行前后相同的源文件聚合 SHA-256 验证后端全量 `984 passed, 10 skipped`。
- 本节完成的是本地状态/工具/恢复证据的机器化同源门禁，仍不生成真实 staging 证明。真实 HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀接管、旧 Worker fencing、外部回执/副作用对账、完整灰度/回滚、生产 checkpointer 评审和连续 14 天 SLO 仍按用户决定留到最后；`real` runtime 保持关闭。未改版本号、未 commit、未 push。

## 55. 本地 GA 恢复密钥契约修复（2026-07-14，演练修复已收口）

- 本地 preflight `8/8` 通过后，GA 聚合首次暴露 Harness 顺序/环境缺陷：`test_ops_pause_is_idempotent_and_resume_continues_run` 在恢复时返回 422，导致本地 GA 为 `10 passed / 1 failed`；其余离线评测、checkpoint、多实例/跨进程恢复、混沌、副作用对账和 Runtime shadow 均通过。
- 根因不是生产恢复路由，而是测试夹具绕过配置契约：GA 使用独立环境测试密钥，`test_ops_run_control.py::_service()` 却硬编码另一把密钥；直接全量测试时 `conftest.py` 的默认值恰好相同，因而掩盖问题。以 GA 密钥显式运行旧夹具稳定复现 `1 failed`，形成 RED。
- 最小修复只让测试服务与 API 共同复用 `get_settings().content_encryption_key`，不修改生产恢复语义。GREEN 证据：显式 GA 密钥单用例 `1 passed`、运维控制模块 `6 passed`、Harness release gate `227 passed, 9 skipped`、本地 GA `11/11`；Runtime shadow `150/150` 且 0 mismatch。
- 一次后端全量得到 `987 passed, 10 skipped`，但运行期间本任务范围外的未跟踪专业交付文件继续被其他工作更新，源文件摘要从 `9e77a77b...` 变为 `7a8d36d0...`，该结果已判为无效且不计入放行证据。本任务未覆盖这些并发文件；文件稳定后以新进程重跑专业交付/评审定向测试为 `22 passed`，后端全量为 `993 passed, 10 skipped in 242.18s`。全量执行前后以及最终 GA 后，`app/tests/scripts/alembic` 中 Python、JSON、INI 文件的聚合 SHA-256 均为 `b48acea43b8fd958d7f602480c1479cecc09af99ca4fe85f463822f19417b893`，当前本地快照证据有效。
- 当前快照再次验证 local preflight `8/8`、local GA `11/11`；其中 Harness release gate `227 passed, 9 skipped`，checkpoint `15/15`、同库多实例恢复 `5/5`、双进程接管 `1/1`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 上述全量与 GA 对摘要为 `b48acea...` 的稳定快照有效。证据收口后，本任务范围外又新增专业审批测试和模型，当前摘要已变为 `cec0528c...`；新进程定向结果为既有专业交付/评审 `22 passed`、新增审批 `5 failed`，失败均为尚未注册审批接口导致的 405。该并发功能仍在开发，本任务不覆盖其文件，因此不把旧全量结果表述为当前工作树已通过，也不在接口未落地时重复运行后端全量。
- 本节未访问 staging、网络、Token 或外部数据库，未改版本号，未 commit/push；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执/副作用对账、完整灰度/回滚、生产 checkpointer 和连续 14 天 SLO 仍按用户决定留到最后。

## 56. 固定 50 核心任务真实执行证据契约（2026-07-14）

- 复核发现 Runtime shadow 的 `150/150` 来自本地合成 fixture，只能验证候选与基线的确定性对照，不能证明计划要求的固定 50 个核心任务已在 staging 上各真实执行至少 3 次。为避免把演练误当成放行证据，本轮新增独立、fail-closed 的真实执行证据契约。
- 新增版本化 `core_task_catalog.json`：固定 50 个任务，严格分为知识问答、文件处理、写作生成、审批流和长任务 5 类，每类 10 个；目录摘要绑定证据，任务缺失、重复、类别漂移或目录被改写均不能通过。
- 新增 `core_task_evidence.py`：要求 `source=staging_runtime_execution`、`synthetic=false`、每任务至少 3 次、完整覆盖 150 个 task/trial 对、全局唯一 run ID、可追溯执行记录、完成时间线、隔离标志、零重复副作用，并重新计算基线/候选成功率；候选低于基线时 fail-closed。
- staging 发布工件 schema 升为 `1.3`，`core_task_evaluation` 成为必填段；汇总器同时校验 release ID、HTTPS base URL 和 `migration ≤ tests ≤ core task evaluation ≤ canary` 的时间线。HarnessSpec 已注册证据契约测试，发布门禁测试会阻止该契约被静默移除；运维手册同步了字段与执行要求。
- TDD 证据：新模块初始 `ModuleNotFoundError`，实现后核心契约 `10 passed`；补时间线回归时旧汇总器得到 `1 failed, 17 passed`，修复后 staging 门禁 `18 passed`。最终核心/汇总/HarnessSpec/发布门禁定向 `48 passed`，compileall 与 JSON 解析通过；当前本地 Harness release gate 为 `238 passed, 9 skipped`，local preflight `8/8`，local GA `11/11`。
- 上述结果只证明“真实证据应长什么样以及如何拒绝伪证据”，没有生成 staging 执行数据。当前工作树中的专业导出功能仍由另一项工作并发修改，最近定向结果为 `53 passed, 2 failed`，两项失败均是下载请求被开发代理返回 502；本任务未修改该范围，因此不把历史全量结果表述为当前工作树全量已通过。
- 留到最后的真实执行项不变：HTTPS/Bearer staging、生产级数据库双 Worker/双 Runtime 强杀接管、旧 owner fencing、外部副作用回执与对账、固定 50 任务至少 150 次真实执行、生产 checkpointer 评审、完整灰度/回滚和连续 14 天 SLO。未改版本号，未 commit，未 push。

## 57. 核心任务局部回归与运行指标可检测闭环（2026-07-14）

- 继续对照第 11 节回放评测要求复核后发现，核心任务证据只比较总体成功率；候选可以在某一任务上退化、同时在另一任务上改善，以相同总体成功率通过门禁。成本、步数、延迟和人工介入字段也只校验存在，没有形成可直接审阅的汇总对比。
- `core_task_evidence.py` 现在按固定目录顺序重新计算 50 个任务和 5 个类别的基线/候选成功率分布；任一任务候选成功率低于 Native 即 fail-closed，类别对比同时输出用于定位。总体成功率门禁继续保留，避免改变原完成定义。
- 校验结果新增成本、步数、延迟、平均人工介入次数及人工介入 case 比例的基线均值、候选均值和差值。方案未规定这些指标的统一放行阈值，因此本轮只保证可检测、可比较，不擅自制造阈值；预算、超时和重复副作用仍由已有硬门禁独立约束。
- TDD 先得到缺少局部回归字段的 `2 failed, 10 passed`，人工介入率补测再得到预期 `KeyError`；实现后核心证据与 staging 汇总集成回归 `41 passed`。Harness release gate `240 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`；目标模块 compileall、核心目录和 HarnessSpec JSON 解析、目标文件 `git diff --check` 均通过。
- 本节只增强本地证据判定，不生成真实 staging 数据，不联网、不读取 Token、不修改数据库或 Runtime 开关。固定 50 任务至少 150 次真实执行、双 Worker/双 Runtime 强杀接管、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍按约定留到最后；未改版本号，未 commit，未 push。

## 58. 核心任务 trace 防复用门禁（2026-07-14）

- 继续审计真实执行证据后发现，旧校验只要求每条 case 的 `evidence_ref` 非空；同一条 trace 可以复制到多个 task/trial case，仍被错误视为 150 次可追溯执行。
- `core_task_evidence.py` 现在规范化收集全部 `evidence_ref`，要求其数量与 case 数一致且全局唯一；新增机器可读结果 `evidence_trace_unique_ok`，重复任一 trace 都会使核心评测和外层 release 证据同时 fail-closed。当时该变更未改变输入形状，暂保留 core evidence schema `1.0` 与 release schema `1.3`；现行核心证据契约已在第 63 节升为 `1.1`。
- TDD 首先用两个 case 复用同一 trace，旧实现得到 `2 failed, 40 passed`，其中 release 聚合错误返回 `pass`；最小实现后定向核心与 staging 证据测试 `42 passed`。Harness release gate `241 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 本节只阻止证据复用，不验证 trace 后端内容，也不生成真实 staging 数据。最终仍必须由受控 staging 导出每条唯一 trace，并完成 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执、固定 50 任务至少 150 次真实执行、生产 checkpointer、灰度/回滚和连续 14 天 SLO。未联网、未读 Token、未改数据库或 Runtime 开关，未改版本号，未 commit，未 push。

## 59. 副作用任务隔离域防复用门禁（2026-07-14）

- 继续审计固定 50 任务证据发现，旧校验只要求同一 case 的 Native/LangGraph `isolation_id` 不同；30 个副作用任务的不同任务和不同轮次仍可反复使用同一对隔离域，跨 case 状态污染后也会被误判为独立执行。
- `core_task_evidence.py` 新增 `side_effect_isolation_unique_ok`：按固定目录和 `trial_count` 计算应有的副作用执行数，要求 30 个副作用任务 × 3 轮 × 2 个 Runtime 共 180 个规范化隔离 ID 数量完整且全局唯一。非副作用任务不参与该唯一性门禁，现有逐 case 跨 Runtime 隔离和零重复动作门禁继续保留。
- TDD 在旧实现上得到 `3 failed, 40 passed`，其中隔离域复用仍让核心证据和 staging release 错误通过；最小实现后定向核心/汇总测试 `43 passed`。Harness release gate `242 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 本节没有新增输入字段，core evidence 当时保持 schema `1.0`、release 保持 schema `1.3`；只收紧真实证据的失败关闭语义。现行核心证据契约已在第 63 节升为 `1.1`。仍未访问 staging、网络、Token 或外部数据库，未切换 `real` runtime，未改版本号，未 commit/push。真实隔离域的创建/清理、150 次执行、双 Worker/双 Runtime 强杀与 fencing、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 继续留到最后。

## 60. 核心任务证据执行窗口同源门禁（2026-07-14）

- 继续审计发布时间线发现，外层 release 只校验 `tests.completed_at ≤ core_task_evaluation.completed_at`，核心证据只校验 `case.executed_at ≤ core_task_evaluation.completed_at`；因此旧发布的 150 条 case 可以被包装成当前发布的新报告并错误通过。
- `validate_core_task_evidence` 新增可选、带时区的 `execution_not_before` 下界，并输出机器可读的 `execution_window_ok`；staging 汇总器将本次 `tests.completed_at` 作为下界，要求每条 case 都落在 `[tests.completed_at, core_task_evaluation.completed_at]` 内。非法或无时区下界 fail-closed；当时输入工件字段不变，core evidence 暂保持 `1.0`、release 保持 `1.3`，现行核心证据契约已在第 63 节升为 `1.1`。
- TDD RED 精确得到 `2 failed, 43 passed`：一个失败证明校验器没有窗口下界，另一个证明旧 case 仍让 release 返回 `pass`。最小实现后针对性测试 `45 passed`；复核机器字段的窗口上界语义时又先得到 `1 failed`，补齐回归后针对性测试最终为 `46 passed`。Harness release gate `245 passed, 9 skipped`，local preflight `8/8`，local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 本节只阻止跨发布复用核心任务执行记录，不生成或伪造 staging 数据。真实 HTTPS/Bearer、固定 50 任务至少 150 次真实执行、双 Worker/双 Runtime 强杀与 fencing、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍按约定留到最后；未联网、未读 Token、未改数据库或 Runtime 开关，未改版本号，未 commit/push。

## 61. 版本自动化与本地发布门禁复核（2026-07-15）

- 复核版本注册表、独立系统 `VERSION` 源、严格 SemVer 规则、路径归属、共享根目录范围、同步/漂移检查、失败回滚、提交钩子和推送路径；当前实现与 `docs/versioning.md` 约定一致，未发现需要改代码的缺口。
- 版本回归 `npm run test:versioning`：`56 passed, 0 failed`；桌面脚本全量 `node --test apps/desktop/scripts/tests/*.test.mjs`：`69 passed, 0 failed`。根目录 package JSON 解析、版本目标 `git diff --check`、`core.hooksPath=.githooks` 与提交钩子可执行性均通过。
- 当前工作树版本源漂移为 0，注册表校验通过；本轮未改任何 `VERSION`，未产生版本提交。由于工作树存在大量本任务外改动，且用户尚未授权本轮发布，未自动 commit 或 push，避免把无关文件带入版本提交。
- Harness release gate：`245 passed, 9 skipped`；local preflight：`8/8`；local GA：`11/11`，其中 Runtime shadow `150/150`、`0 mismatch`。这些是本地/离线证据，不等价于生产稳定。
- 真实 staging HTTPS/Bearer、生产数据库双 Worker/双 Runtime 强杀接管与 fencing、外部副作用回执/对账、固定 50 任务至少 150 次真实执行、生产 checkpointer 评审、完整灰度/回滚和连续 14 天 SLO 仍按用户约定留到最后；`real` runtime 继续保持关闭和 fail-closed。

## 62. 演练入口与本地收口复核（2026-07-15）

- 复查 `docs/ops-runbook-6.0-7.0.md` 与 `docs/checkpoint-multi-instance-drill.md`：演练入口、证据格式、失败关闭规则和“本地模拟不能替代 staging”的边界均已有文档与脚本，没有发现必须新增的本地 runner 或接口。
- 本地 preflight：`python3 scripts/run_staging_preflight.py --mode local --json`，`overall=pass`。
- 本地 GA：`python3 scripts/run_ga_gate_local.py --json`，`overall=pass`、`11/11`；Runtime shadow `150/150`、`0 mismatch`。
- Harness release gate：`python3 scripts/run_harness_release_gate.py`，`245 passed, 9 skipped`。
- 因此本地实施项继续保持收口状态；真实 staging HTTPS/Bearer、生产数据库双 Worker/双 Runtime 强杀接管与 fencing、外部副作用回执/对账、固定 50 任务至少 150 次真实执行、生产 checkpointer 评审、完整灰度/回滚和连续 14 天 SLO 仍留到最后。未改版本号、未 commit、未 push。

## 63. 固定任务误拦截/漏拦截率证据契约（2026-07-15）

- 对照第 11 节回放评测复核发现，核心任务证据此前只有 `passed` 成功结果，没有独立真值标签，因此无法区分“任务确实失败”与“评估器误判失败”，也无法计算误拦截率（FP rate）和漏拦截率（FN rate）。这项缺口已按 fail-closed 方式补齐。
- `core_task_evidence.py` 的内层证据 schema 升为 `1.1`，要求 `classification_review` 使用 `source=independent_human_review`、带时区的 `reviewed_at`、非空 `reviewed_by`，并覆盖固定目录的全部 `50 × 3 × 2 = 300` 个 Native/LangGraph 运行结果。每个标签包含 `task_id`、`trial`、`runtime` 和独立 `expected_passed` 真值；缺失、重复、越界、单一真值类别或无法计算分母都会失败关闭。
- 校验器重新计算每个 Runtime 的 TP/TN/FP/FN、`false_positive_rate=FP/(FP+TN)` 和 `false_negative_rate=FN/(FN+TP)`，输出 `classification_metrics_ok` 与机器可读汇总。该指标当前用于发现和比较，不擅自增加方案未定义的放行阈值；候选成功率、逐任务非回归、零重复副作用等原有硬门禁保持不变。
- TDD 先加入缺少独立复核的 RED 用例，再实现校验和混淆矩阵；核心证据回归 `19 passed`，staging 汇总回归 `29 passed`。本地夹具仅验证契约和拒绝逻辑，没有伪造真实 staging 结果。
- 收口门禁：Harness release gate `247 passed, 9 skipped`，local preflight `8/8`，local GA `11/11`；Runtime shadow `150/150` 且 `0 mismatch`。这些结果仍是本地/离线证据，不等价于生产稳定。
- 运维手册已同步内层 schema `1.1`、300 条真值覆盖、FP/FN 公式和 fail-closed 规则。真实 staging 仍需最后由独立复核人导出标签；HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀接管与 fencing、外部回执/对账、生产 checkpointer、完整灰度/回滚和连续 14 天 SLO 仍留到最后。未改版本号、未 commit、未 push。

## 64. 桌面成果工作台演练闭环（2026-07-15）

- 桌面端全量演练先暴露 3 个失败：成果工作台只渲染事实/评论/版本的静态骨架，没有接入事实确认、证据检索、审阅问题定位、版本对比和审批动作；后端门禁通过不能代表用户界面可操作。
- `ProfessionalDeliverablesPage` 已接入对应 API，并严格以 `allowed_actions` 控制按钮：事实确认更新 `row_version`，证据查询绑定当前 `version_uuid`，审阅问题定位正文，版本对比绑定不可变版本，审批提交绑定已发布项目审批流版本，批准/退回均携带当前版本内容哈希和行版本；评论退回要求原因并可勾选关联评论。
- 定向演练 `npm test -- --run tests/professional-deliverable-workbench.test.tsx`：`3/3`；桌面端类型检查 `npm run typecheck` 通过；桌面端全量 `npm test`：`36` 个测试文件、`265/265` 通过。Vitest 仍输出 Node `--localstorage-file` 无效路径和 jsdom 导航未实现警告，但不影响退出码和断言结果，属于测试运行器噪声。
- 后端稳定快照此前已验证 `1044 passed, 10 skipped`；本地 Harness release gate `247 passed, 9 skipped`、preflight `8/8`、GA `11/11`、Runtime shadow `150/150` 且 `0 mismatch`。本节没有启用真实 runtime 或 staging，不把本地演练冒充生产稳定。
- 真实 staging HTTPS/Bearer、生产数据库双 Worker/双 Runtime 强杀接管与 fencing、外部回执/副作用对账、固定 50 任务 3 轮真实执行、生产 checkpointer、完整灰度/回滚和连续 14 天 SLO 仍留到最后；未改版本号、未 commit、未 push。

## 65. 本地门禁再次复核（2026-07-15）

- 基于当前工作树重新执行 `python3 scripts/run_staging_preflight.py --mode local --json`：`overall=pass`，8/8；迁移图仍为单 head `0050_project_task_delivery_activity`，共 51 个 revision；Runtime 仍为 `shadow` 且 `runtime_enabled=false`。
- `python3 scripts/run_ga_gate_local.py --json`：`overall=pass`、11/11；Harness release gate `247 passed, 9 skipped`，checkpoint `15/15`、同库多实例 `5/5`、双进程接管 `1/1`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 桌面成果工作台定向回归 `3/3`，类型检查通过；本轮未发现新的本地状态、工具、恢复、证据或界面闭环缺口。
- 本轮只更新实施记录，不生成 staging/生产 artifact，不访问外部授权、Token 或数据库，不改版本号、不 commit、不 push。真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀与 fencing、外部副作用回执/对账、固定 50 任务 3 轮真实执行、生产 checkpointer、完整灰度/回滚和连续 14 天 SLO 仍留到最后。

## 66. 专业审批与交付后端回归复核（2026-07-15）

- 针对历史并发开发中曾出现的审批接口 `405` 风险，重新运行交付域定向回归：`tests/test_professional_approval_api.py`、`test_professional_deliverables_api.py`、`test_professional_reviews_api.py`、`test_professional_facts_evidence_api.py`、`test_professional_exports_api.py`、`test_professional_delivery_domain.py` 共 `57 passed`。
- 当前审批流、事实/证据、审阅、导出和交付领域后端契约已能与桌面成果工作台闭环对接；该结果只针对当前工作树快照，不代表真实 staging 或生产证据。
- 本轮未修改业务代码、版本号或发布状态，也未 commit/push；真实 staging 授权、强杀接管、外部回执、生产 checkpointer、灰度/回滚和连续 SLO 仍留到最后。

## 67. HarnessSpec 发布测试路径收口（2026-07-15）

- 审计发现启动校验器只检查 `base_dir / required_test_module` 是否存在，未拒绝绝对路径、路径穿越或重复测试项；发布脚本虽已有目录约束，但两处语义不一致。
- `harness_spec.py` 现在要求每个发布测试模块是唯一的相对路径，解析后必须位于 HarnessSpec 所属 `tests/` 目录且为文件；符号链接解析后逃逸 `tests/` 也会 fail-closed。`run_harness_release_gate.py` 同步拒绝重复模块，避免重复执行掩盖覆盖缺口。
- 新增合法路径、路径穿越、绝对路径、重复项回归；HarnessSpec/发布门禁/注册审批定向测试 `20 passed`。完整 Harness release gate 当前 `248 passed, 9 skipped`。
- 本轮只收紧本地契约校验，不访问 staging、网络、Token 或外部数据库，不切换 Runtime，不改版本号、commit 或 push。真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执/对账、固定 50 任务 3 轮真实执行、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍留到最后。

## 68. 本地演练请求桩与桌面回归收口（2026-07-15）

- 全量桌面演练曾出现 Web 模式个人模型保存测试偶发超时；复核确认 App 默认挂载的 ChatPage 发起了项目、会话、长任务、知识库分类和文档类型 5 个只读请求，但该测试文件未声明对应 MSW 桩。
- `apps/desktop/tests/web-mode.test.tsx` 现在补齐与 ChatPage 既有测试一致的空列表响应，只收敛测试环境边界，不改变业务 API 或运行时行为；同时将专业交付事件测试的 `onEvent` 回调改为显式 `void` 块体，消除 TypeScript 返回值漂移。
- 证据：Web 模式与专业交付定向测试 `7/7`，桌面端全量 `36` 个测试文件、`267/267`，`npm run typecheck` 通过；未再出现该测试的超时或未处理请求日志（运行器仍有 localstorage 路径和 jsdom 导航警告）。
- 本轮只完善本地演练可重复性，不生成 staging/生产 artifact，不访问外部授权、Token 或数据库，不切换 Runtime，不改版本号、commit 或 push。真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执/对账、固定 50 任务 3 轮真实执行、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍留到最后。

## 69. 最后阶段边界与当前快照复核（2026-07-15）

- 对无 Token 的真实 staging 预检执行：`python3 scripts/run_staging_preflight.py --mode staging --release-id audit-20260715 --base-url https://staging.example.invalid --bearer-token-env JUXIN_STAGING_BEARER --json`，结果按设计 `overall=fail`，唯一失败项为 `authorization`；未发起网络请求，也未读取或输出 Token。该结果证明真实环境仍保持 fail-closed，而不是证明 staging 已通过。
- 本地 preflight `overall=pass`、8/8；Harness release gate `248 passed, 9 skipped`；本地 GA `overall=pass`、11/11，其中离线评测 `19/20`、checkpoint `15/15`、同库恢复 `5/5`、双进程 SIGKILL 接管 `1/1`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 桌面 Web/专业交付定向回归 `10/10`，`npm run typecheck` 通过；根仓库版本自动化 `npm run test:versioning` 为 `56/56`。这些检查覆盖当前可在本地安全完成的实现，没有发现新的状态、工具、恢复、证据、运维入口或版本自动化缺口。
- 因此本地实施项维持收口；最终稳定性仍不能宣称完成。待用户授权后才执行：真实 staging HTTPS/Bearer、生产数据库双 Worker/双 Runtime 强杀接管与旧 owner fencing、外部副作用回执/对账、固定 50 任务 3 轮真实执行及独立 FP/FN 复核、生产 checkpointer 评审、完整灰度/回滚和连续 14 天 SLO。未改版本号、未 commit、未 push。

## 70. 运维灰度入口边界修正（2026-07-15）

- 复核发现运维手册的看板快捷阶梯仍写成 `5% → 20% → 50% → 100%`，而最终发布证据契约要求 `internal(0%) → 1%(1%) → 5%(5%) → 20%(20%) → 50%(50%) → 100%(100%)`；两者未区分会让执行人员误把快捷操作当作完整放行证据。
- 运维手册现明确：快捷阶梯只是日常操作入口，不构成最终发布证据；最终 canary 必须包含内部和 1% 阶段，每阶段至少 48 小时、有完成运行数且状态为 `passed`，总窗口至少覆盖默认 14 天连续观测。
- `server/tests/test_reconciliation_runbook.py` 增加文档契约回归，当前 `3 passed`，`git diff --check` 通过。未改业务代码、版本号、commit 或 push；真实 staging 仍需授权后执行。

## 71. 文档边界修正后的门禁复核（2026-07-15）

- `python3 scripts/run_harness_release_gate.py`（工作目录 `server/`）：`249 passed, 9 skipped`。
- `python3 scripts/run_ga_gate_local.py --json`：`overall=pass`、11/11；Runtime shadow `150/150`、`0 mismatch`，建议仍明确要求生产连续观测后才能宣布 GA。
- 本次只增加运维文档边界及其契约测试；未访问 staging、未读取 Token、未切换 Runtime、未改版本号、未 commit、未 push。

## 72. HarnessSpec 示例唯一键回归（2026-07-15）

- 复核方案第 9 节的 YAML 示例，当前 `stop_rules` 已只有一个定义；未对不存在的重复文本做无效改写。
- `server/tests/test_harness_spec.py` 新增文档契约回归，要求 HarnessSpec 示例恰有一个 `stop_rules` 键，并锁定 `duplicate_action_limit` 与 `no_progress_window` 字段，防止后续复制示例时出现重复键或字段漂移。
- 定向测试：`tests/test_harness_spec.py tests/test_reconciliation_runbook.py` 为 `11 passed`；Harness release gate 为 `249 passed, 9 skipped`；local GA 为 `overall=pass`、`11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 本轮只增加本地文档契约检测；未访问 staging、未读取 Token、未切换 Runtime、未改版本号、未 commit、未 push。生产连续 `evaluate_ga_observe`、真实 staging 授权、双 Worker/双 Runtime 强杀接管与 fencing、外部回执/对账、完整灰度/回滚和连续 14 天 SLO 仍留到最后。

## 73. 后端全量回归收口（2026-07-15）

- 基于当前工作树从 `server/` 执行 `python3 -m pytest -q`，结果为 `1053 passed, 10 skipped`，未出现失败或错误。
- 该结果覆盖当前后端状态契约、工具账本、恢复/租约/fencing、证据门禁、运维入口及业务 API 回归；没有发现新的可在本地安全补齐的实现缺口。
- 这是本地代码回归证据，不替代真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管、外部副作用回执对账、生产 checkpointer 评审、灰度/回滚和连续 14 天 SLO。`real` runtime 继续保持关闭和 fail-closed；未改版本号、未 commit、未 push。

## 74. 统一契约调用链审计（2026-07-15）

- 逐条核对 Native、LangGraph pilot、恢复入口和 Runtime 选择：Native 通过 `AgentRunService` 使用 RunState v1 迁移、集中状态机、checkpoint、租约/fencing 与工具账本；LangGraph graph/binding 使用四阶段 `runtime_state_contract`，并由 `LangGraphServiceBinding` 复用同一持久化、租约、工具和评价器；`NativeLangGraphAdapter` 将业务执行委托给 NativeRuntime，避免复制检索/写作/审核/成果物规则。
- `select_runtime` 在 `real` 后端未满足生产就绪条件时 fail-closed；默认生产路径仍是 NativeRuntime。没有发现新的绕过统一状态、工具或恢复语义的本地调用链，因此不做强行重构。
- 定向回归 `tests/test_runtime_shadow.py tests/test_run_state_contract.py tests/test_agent_runtime.py`：`61 passed, 8 skipped`。该证据证明调用链契约和隔离 pilot 的本地行为一致，不等价于 staging/生产多实例稳定。
- 本节只记录审计结论；真实 staging 授权、双 Worker/双 Runtime 强杀接管与旧 fencing、外部副作用回执/对账、生产 checkpointer、固定 50 任务三轮真实执行、灰度/回滚和连续 14 天 SLO 仍留到最后。未改版本号、未 commit、未 push。

## 75. 工具契约非对象输入/输出 fail-closed（2026-07-15）

- 工具 schema 已明确拒绝非对象输入；拒绝发生在动态 spec 解析之前，避免自定义工具先处理非法输入或抛出未捕获异常。
- 工具输出 schema 对非对象成功结果统一判定为 `TOOL_OUTPUT_SCHEMA_INVALID`，并沿用 `reconciliation_required`，不允许把不可回放结果标记为成功。
- 审计日志摘要对非对象输入只记录类型名，不读取 `.items()`，保证错误路径本身稳定且不泄露原始值。
- PolicyGate 拒绝结果按语义映射为 `forbidden`、`confirmation_required` 或 `error`；schema 错误和持久化上下文缺失不会误导为“只需确认”。
- 回归：工具契约与 Agent Runtime `53 passed`；Harness release gate `251 passed, 9 skipped`；`git diff --check` 通过。真实 staging/生产证据、版本升级、commit/push 仍未执行。

## 评论级动作契约补齐（2026-07-15）

- 成果级 `allowed_actions` 已覆盖生命周期动作；“解决评论”依赖评论作者与项目复核角色，不能作为成果级全局动作返回，否则会把对象级 403 暴露成错误的可操作按钮。
- `DeliverableCommentOut` 现在返回评论级 `allowed_actions`；仅开放评论仍为 `open` 且当前用户是评论作者、个人成果所有者或项目复核角色时的 `resolve_comment`。桌面工作台改为按该字段显示解决入口，保持 UI 与服务端授权一致。
- 增加个人评论、项目复核者与只读成员的契约断言；专业审批/交付/领域定向回归 `39 passed`，桌面工作台定向回归 `3 passed`，`npm run typecheck` 通过。
- 本地实现已补齐；真实 staging 授权、迁移父链确认、双 Worker/Runtime 强杀接管与 fencing、外部回执对账、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍留到最后。未改版本号、未 commit、未 push。

## 迁移父链授权阻断与本地回归复核（追加）

- 发现未跟踪的 `0051_professional_delivery` 在 SQLAlchemy 运行时使用了不存在的 `sa.SchemaItem`；已做最小兼容修复，改为从 `sqlalchemy.schema` 导入 `SchemaItem`，不改变迁移结构。
- 当前工作树的 `0046 -> 0026` 与独立 `0045`、`0051 -> 0050` 形成两个 head。设计规格明确要求先确认共享环境是否应用过未跟踪 `0027`—`0045`，不能仅为通过测试擅自重写历史父链；本轮 staging/授权按用户决定继续暂缓，因此保留 fail-closed。
- 排除迁移测试后后端全量回归 `1031 passed, 10 skipped`；迁移相关失败集中在多 head 导致的 `upgrade head` 无法确定，未发现新的业务逻辑失败。
- 本地 preflight 当前正确返回 `overall=fail`，唯一失败项为 `migration_graph`，heads 为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`；未连接数据库、未读取 Token、未改版本号、未 commit/push。
- 复核后的 Harness release gate 为 `251 passed, 9 skipped`，local GA 为 `11/11`；这些门禁不绕过迁移图失败，也不替代真实 staging 连续观测。

## 任务详情路由契约冲突修复与全量收口（2026-07-15）

- 发现共享前缀 `/api/ai/runs` 下的专业任务路由先于通用任务路由注册，导致普通任务访问 `GET /{id}`、`/events` 或 `/cancel` 时被误判为专业任务并返回 404。该问题会直接破坏恢复、取消和任务中心的状态读取契约。
- 采用最小修复：共享详情入口先读取 `run_type`，专业任务转入专业详情结构，普通任务继续返回通用 `RunDetailOut`；路由注册顺序调整为通用路由优先匹配公共路径，专业专属的 `/input`、`/resume`、`/steps` 仍由专业路由提供。取消分支统一使用专业路由模块的审计写入函数，保留既有回滚语义。
- 证据：普通/专业详情、事件、取消与权限隔离定向回归 `16 passed`；后端排除迁移图测试后 `1033 passed, 10 skipped`；桌面全量 `36 files / 271 passed`；桌面类型检查通过。`assistant-modes-admin` 单测以 `15s` 超时单独复跑通过，未修改业务代码以掩盖全量运行器竞争。
- 当前迁移图仍为两个 head：`0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`。迁移测试继续 fail-closed，未擅自改历史父链；staging/授权尚未执行。未改版本号、未 commit、未 push。

## 共享事件入口的专业契约分流（2026-07-15）

- 继续审计发现，通用路由优先后，专业任务的公共 `/api/ai/runs/{id}/events` 也会进入通用处理器；两者底层事件字段相近，但专业入口额外校验 `ProfessionalRunBinding` 所有权，不能让共享入口绕过该边界。
- 最小修复保留通用路由优先顺序，在共享事件处理器按 `run_type` 分流：专业任务先通过 `ProfessionalRunnerService.public_run` 校验绑定，再使用 `event_payloads` 和专业终态读取；普通任务继续使用 `AgentRunService` 原有事件列表和状态判断。没有复制状态机、租约或副作用逻辑。
- 回归证据：专业/通用任务相关模块 `13 passed`，其中新增共享入口专业事件契约回归；后端排除迁移图测试 `1034 passed, 10 skipped`；Harness release gate `251 passed, 9 skipped`；桌面 `npm run typecheck` 通过。
- 桌面全量当前为 `36` 个文件、`270 passed / 1 failed`。唯一失败位于已修改的 `tests/skills-page.test.tsx`：断言寻找独立文本 `markdown、docx`，当前 DOM 将其作为“可生成：markdown、docx”的子文本；本轮未改桌面代码或该测试，不能把该结果记为全量通过，需在发布前由桌面范围单独决定修复 UI 还是断言。
- 当前 preflight 的唯一失败仍是迁移图：`0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery` 两个 head；local GA 仍为 `11/11`，Runtime shadow `150/150`、`0 mismatch`。迁移父链确认、真实 staging HTTPS/Bearer、双 Worker/Runtime 强杀接管与 fencing、外部回执/副作用对账、固定 50 任务 3 轮真实执行、生产 checkpointer、灰度/回滚和连续 14 天 SLO 继续留到最后。未改版本号、未 commit、未 push。

## 本轮最终门禁口径校正（追加，2026-07-15）

- 以本轮实际命令结果为准：`python3 -m pytest -q tests --ignore=tests/test_migrations.py` 为 `1034 passed, 10 skipped`；`python3 scripts/run_harness_release_gate.py` 为 `251 passed, 9 skipped`；`python3 scripts/run_ga_gate_local.py --json` 为 `overall=pass`、11/11，Runtime shadow `150/150`、`0 mismatch`。
- `python3 scripts/run_staging_preflight.py --mode local --json` 仍为 `overall=fail`，且唯一失败项为 `migration_graph`，heads 为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`；这不是业务回归失败，不能用本地门禁结果覆盖。
- 桌面 `npm run typecheck` 通过；桌面全量仍为 `36 files / 270 passed / 1 failed`，唯一失败为已修改工作树中的 `skills-page` 文本断言与当前 DOM 文本节点边界不一致。本轮未修改桌面代码或该测试。
- 以上证据不替代真实 staging 授权、迁移父链决策、生产连续观测和发布流程；未改版本号、未 commit、未 push。

## 技能页输出格式 DOM 契约收口（追加，2026-07-15）

- 桌面全量唯一失败来自 `SkillsPage`：页面显示“可生成：markdown、docx”，但输出值与前缀共用一个文本节点，既有测试无法按独立输出格式定位。
- 保留用户可见文案，仅将前缀和格式值拆为独立元素；没有放宽断言、改变 API 或改变运行行为。
- 证据：`tests/skills-page.test.tsx` 为 `3 passed`，`npm run typecheck` 通过，桌面全量 `36 files / 271 passed`。运行器仍有既有 Node `--localstorage-file` 和 jsdom 导航警告，但退出码为 0。
- 这是本地 UI 契约收口；迁移双 head、真实 staging HTTPS/Bearer、生产多实例恢复、外部副作用回执和连续 14 天观测仍未执行。未改版本号、未 commit、未 push。

## 版本自动化门禁复核（追加，2026-07-15）

- 聚信 AI 助手当前版本源为 `juxin-ai-assistant/VERSION`，值为 `2.4.0`；桌面 `package.json`、Tauri `tauri.conf.json` 与 Rust `Cargo.toml` 均与该版本一致。
- 根仓库已安装 `.githooks`：`commit-msg` 校验版本提交范围，`post-commit` 按提交前缀自动计算 major/minor/patch、同步声明的运行时版本、amend 版本化提交并推送当前分支；不会切换版本分支。`CODEX_VERSIONING_BYPASS=1` 仅用于版本维护场景。
- `npm run test:versioning` 为 `56 passed`；桌面版本同步测试 `node --test apps/desktop/scripts/tests/agent-version.test.mjs` 为 `6 passed`。版本规则与提交/推送自动化没有发现本地缺口。
- 本轮不触发实际版本升级、commit 或 push；最终发布仍需在迁移图、staging/授权、生产多实例接管、外部回执对账和连续 SLO 门禁通过后执行。

## 迁移双 head 的可执行决策门禁（追加，2026-07-15）

- 当前本地迁移图不是单链：`0046_project_workspace_foundation` 的工作树父链为 `0026_agent_run_contracts`，同时存在未跟踪的 `0045_agent_langgraph_checkpoints`，后续 `0051_professional_delivery` 从 `0050_project_task_delivery_activity` 继续，因此 heads 为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`。
- 可复现实证：`python3 -m pytest -q tests/test_migrations.py tests/test_staging_preflight.py` 为 `3 failed, 29 passed`；3 个失败均在 `upgrade(..., "head")` 无法选择多 head，未观察到业务表结构断言失败。`python3 scripts/run_staging_preflight.py --mode local --json` 也只因 `migration_graph` fail-closed。
- 候选 A（仅在共享数据库确认已采用 `0045` 链后）：将 `0046` 父链恢复为 `0045_agent_langgraph_checkpoints`，同步迁移图测试预期到 `0051_professional_delivery`，再执行完整迁移往返回归。该路径保留现有线性历史，但可能与已落地数据库 revision 不一致，未获确认前禁止执行。
- 候选 B（仅在确认两条分支都已被外部环境采用后）：新增带双父 revision 的 merge migration，再把 head 和迁移测试更新到 merge revision。该路径不重写历史，但会引入新的发布迁移，必须先完成 schema diff、upgrade/downgrade 演练和回滚评审，未获确认前禁止执行。
- 授权后的最小验收顺序：`alembic heads` → `python3 -m pytest -q tests/test_migrations.py tests/test_staging_preflight.py` → `python3 scripts/run_staging_preflight.py --mode local --json`；三者全部通过后，才可讨论 staging HTTPS/Bearer 和版本发布。当前不访问数据库或 Token，不改版本号、commit 或 push。

## 迁移回滚演练与 priority 索引修复（追加，2026-07-15）

- 在临时迁移副本中分别模拟当前双 head、候选 A（恢复 `0046 -> 0045`）和候选 B（新增双父 merge revision），不连接正式数据库、不改仓库迁移图。
- 当前双 head 在 `upgrade head` 处按预期 fail-closed；候选 A、B 均完成 `upgrade head` + `downgrade base`。两种方案均先暴露 `0017_learning_loop` 回滚缺陷：删除 `ai_user_memories.priority` 前未删除 `ix_ai_user_memories_priority`，SQLite 批量重建表时报 `no such column: priority`。
- `0017_learning_loop` 现在在回滚列之前显式删除该索引，并增加回归测试验证列和索引均被移除。此修复不改变迁移父链，也不选择 A/B。
- 定向迁移、专业交付迁移与新回归共 `3 passed`；临时副本 A/B 回放均 `PASS`。正式 local preflight 仍只因双 head 失败；迁移父链确认后再执行正式图变更。
- 本轮未访问 staging/生产、未读取 Token、未改版本号、未 commit、未 push。

## 回滚修复后的最终迁移门禁证据（追加，2026-07-15）

- `tests/test_migrations.py tests/test_staging_preflight.py tests/test_staging_evidence_gate.py tests/test_professional_delivery_migration.py`：`3 failed, 61 passed`；失败仍只来自双 head（revision graph、`upgrade head` 两处），未再出现 `priority` 回滚错误。
- `python3 scripts/run_staging_preflight.py --mode local --json`：`overall=fail`，唯一失败项为 `migration_graph`，heads 仍是 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`；其余本地检查通过。
- 临时副本候选 A/B 的 `upgrade head` + `downgrade base` 均通过。正式选择 A 或 B 仍需共享数据库迁移历史确认和明确授权。

## 可重复迁移候选回放入口（追加，2026-07-15）

- 新增 `server/scripts/run_migration_candidate_rehearsal.py`，把本次演练固化为本地临时副本门禁：`current` 必须在双 head 处 fail-closed，候选 A（临时改 `0046 -> 0045`）与候选 B（临时添加双父 merge revision）必须分别通过 `upgrade head` 和 `downgrade base`。
- 脚本只复制 `alembic.ini` 与 `alembic/` 到临时目录，候选修改不会写回正式迁移文件；使用 SQLite 临时数据库，不访问 staging/生产、网络或 Token。JSON 报告显式标记 `repository_unchanged=true`、`staging_or_network_used=false`，且不输出本地密钥。
- 本地入口要求 `AUTH_DEV_BYPASS=true` 和通过环境变量提供的至少 32 字符 `AI_LOCAL_BINDING_SECRET`，缺少配置直接 fail-closed；不自动生成或记录授权值。
- 运行 `AI_LOCAL_BINDING_SECRET='<本地临时值>' AUTH_DEV_BYPASS=true python3 scripts/run_migration_candidate_rehearsal.py --json`：`overall=pass`；current 预期阻断、candidate A/B 均 round-trip 通过。新增回归 `tests/test_migration_candidate_rehearsal.py`：`2 passed`，另有迁移/专业交付定向测试合计 `4 passed`。
- 该入口的 `overall=pass` 只表示“当前图按预期阻断且候选回放可回滚”，不表示正式迁移图已通过；正式 local preflight 仍因双 head fail-closed。A/B 最终选择继续等待共享数据库历史确认和明确授权。
- `harness_spec.json` 已将 `tests/test_migration_candidate_rehearsal.py` 纳入发布测试清单；Harness release gate 实测 `253 passed, 9 skipped`。同一时点 local preflight 仍为 `overall=fail`，唯一失败是 migration graph（heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`），没有被回放脚本掩盖。

## 本地全量回归与 GA 门禁最终复核（追加，2026-07-15）

- 当前工作树执行 `AI_LOCAL_BINDING_SECRET='<本地临时值>' AUTH_DEV_BYPASS=true python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1039 passed, 10 skipped`，退出码为 0；跳过项仅为本地未安装的可选 Tantivy/LangGraph 依赖。
- `AI_LOCAL_BINDING_SECRET='<本地临时值>' AUTH_DEV_BYPASS=true python3 scripts/run_ga_gate_local.py --json`：`overall=pass`、`11/11`；Harness `253 passed, 9 skipped`，离线评测 `19/20`（0.95），checkpoint `15/15`，同库恢复 `5/5`，双进程接管通过，多轮跨进程恢复 `3/3`，混沌 `7/7`，副作用对账 `5/5`，Runtime shadow `150/150` 且 `0 mismatch`。
- 本轮没有发现新的本地业务或 Harness 缺口。local preflight 仍唯一因正式迁移图双 head fail-closed；生产连续 `evaluate_ga_observe`、共享数据库迁移历史确认、真实 staging/生产授权和灰度回滚证据仍是宣布 GA 前置条件。
- 未访问 staging/生产、未读取 Token、未改版本号、未执行 commit 或 push；版本仍保持 `2.4.0`。

## 迁移候选演练异常路径 fail-closed（追加，2026-07-15）

- `run_migration_candidate_rehearsal.py` 现在把临时副本复制失败、迁移图解析异常等演练内部错误转换为单个候选的机器可读 `fail` 结果，不再让 runner 直接崩溃；错误详情仍会脱敏和截断。
- 缺少本地配置时报告也固定包含 `repository_unchanged=true`、`staging_or_network_used=false` 和空候选列表，调用方可以稳定按 schema 处理失败。
- 新增异常路径回归；定向测试 `tests/test_migration_candidate_rehearsal.py`：`3 passed`。正常 CLI 回放仍为 `overall=pass`，current 双 head 预期阻断，candidate A/B 均 upgrade/downgrade round-trip 通过。
- Harness release gate 更新为 `254 passed, 9 skipped`。本轮不改正式迁移父链，不访问 staging/生产，不读取 Token，不改版本号、commit 或 push。

## 迁移候选演练顶层异常 fail-closed（追加，2026-07-15）

- 演练 runner 现在同时覆盖候选级和顶层异常：迁移文件复制、Alembic 图解析、临时目录创建/清理、仓库快照失败都会返回稳定 JSON `overall=fail`，不会直接崩溃；错误详情继续脱敏并截断。
- 顶层异常无法证明仓库未变更时，`repository_unchanged` 明确返回 `false`；配置缺失仍按本地安全边界返回 `true`，且始终声明 `staging_or_network_used=false`。
- 定向回归 `tests/test_migration_candidate_rehearsal.py`：`4 passed`；正常 CLI 回放：current 双 head 预期阻断，candidate A/B 均 upgrade/downgrade round-trip 通过，仓库保持不变。
- Harness release gate 最新实测：`255 passed, 9 skipped`。未改正式迁移父链、未访问 staging/生产、未读取 Token、未改版本号、未 commit 或 push。

## 本地 GA 聚合门禁最终复核（追加，2026-07-15）

- `python3 scripts/run_ga_gate_local.py --json`：`overall=pass`、`11/11`；Harness `255 passed, 9 skipped`，离线评测 `19/20`（0.95），checkpoint 恢复 `15/15`，同库恢复 `5/5`，双进程租约接管通过，多轮跨进程恢复 `3/3`，本地混沌 `7/7`，直连副作用对账 `5/5`，Runtime shadow `150/150` 且 `0 mismatch`。
- 该结果只证明本地契约、恢复和离线门禁通过；正式迁移图双 head、真实 staging/生产授权、外部副作用回执、固定核心任务真实执行、生产 checkpointer、灰度/回滚和连续 SLO 仍未执行。
- 未改版本号、未 commit、未 push。

## 本地门禁与版本自动化再次复核（追加，2026-07-15）

- 只读 `run_staging_preflight.py --mode local --json` 最新结果为 `overall=fail`：9 项检查中 8 项通过，唯一失败仍为 `migration_graph`；当前 heads 为 `0045_agent_langgraph_checkpoints`、`0051_professional_delivery`，revision_count=`52`。
- preflight 其余检查继续通过：HarnessSpec 清单、LangGraph 依赖隔离、Runtime shadow/real fail-closed、local auth、HTTPS 约束、release identity 和观测策略。
- `npm run test:versioning` 最新结果为 `56 passed`；版本仍为 `2.4.0`，没有执行版本升级、commit 或 push。
- 本轮仍未访问 staging/生产、读取真实授权或修改正式迁移父链；候选迁移演练继续只在临时副本中运行。

## 迁移演练仓库完整性 fail-closed（追加，2026-07-15）

- 修复演练 runner 的安全边界：候选全部通过但仓库前后快照不一致时，`overall` 现在强制为 `fail`，不会把潜在仓库变更报告为成功。
- 新增快照变化回归；迁移候选演练定向测试 `5 passed`，正常 CLI 回放仍为 `overall=pass`、`repository_unchanged=true`、current 双 head 预期阻断、candidate A/B round-trip 通过。
- Harness release gate 最新实测为 `256 passed, 9 skipped`；未改正式迁移父链、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 后端全量回归再次复核（追加，2026-07-15）

- 当前工作树执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1043 passed, 10 skipped`，退出码为 0。
- 跳过项仍仅为本地未安装的可选 Tantivy/LangGraph 依赖；本轮没有新增业务或 Harness 缺口。
- 该结果仍是本地回归，不替代正式迁移历史确认、staging/生产授权、生产 checkpointer、灰度回滚和连续 SLO。

## 正式迁移测试边界复核（追加，2026-07-15）

- 单独执行 `python3 -m pytest -q tests/test_migrations.py tests/test_professional_delivery_migration.py tests/test_staging_preflight.py -ra`：`3 failed, 32 passed`。
- 3 个失败均是已知的 Alembic `Multiple heads`：线性 head 断言，以及两个执行 `upgrade("head")` 的场景；专业交付迁移回滚与 staging preflight 其他检查均通过。
- 该结果证明正式迁移图仍未满足发布条件，不能用临时候选回放的通过结果替代；继续等待共享数据库历史确认和明确授权后再选择父链或 merge migration。
- 本轮未改正式迁移文件、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 本地完整性复核（追加，2026-07-15）

- 后端 `python3 -m compileall -q app scripts tests` 通过；桌面 `npm run typecheck` 通过。
- 根仓库 `npm run test:versioning`：`56 passed`；当前分支仍为 `codex/ai-assistant-3.0`，版本仍为 `2.4.0`，测试临时仓库的分支操作未影响工作树。
- 本轮仍未执行版本升级、commit、push、正式迁移或 staging/生产访问；这些动作继续受迁移图和授权门禁保护。

## 运维手册迁移启动边界修正（追加，2026-07-15）

- 修正 `docs/ops-runbook-6.0-7.0.md` 的启动步骤：先执行 `python3 -m alembic heads`，要求只能得到一个 revision，再执行 `alembic upgrade head`。
- 明确多个 head、迁移图解析失败或 `upgrade head` 失败时不得启动新版本，也不得指定任一 head 绕过门禁；当前 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery` 双 head 继续保持 fail-closed。
- 新增 `tests/test_reconciliation_runbook.py` 契约断言，确保该安全边界不会从运维手册中回归；未改正式迁移父链、未访问 staging/生产、未读取 Token、未改版本或执行 commit/push。

## 最后一轮本地缺口扫描与迁移回放（追加，2026-07-15）

- 只读扫描 Harness、Loop、恢复、工具注册和发布脚本后，未发现新的可执行 `TODO`/`FIXME` 或非抽象 `NotImplementedError`；现有抽象方法属于预期扩展点。
- 实际执行 `python3 scripts/run_harness_release_gate.py`：`257 passed, 9 skipped`；`harness_spec.json` 通过 JSON 解析，迁移候选脚本帮助明确声明只做本地临时回放。
- 实际执行迁移候选回放：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`；current 的 `0045_agent_langgraph_checkpoints` + `0051_professional_delivery` 双 head 按预期阻断，candidate A/B 均 `upgrade` 与 `downgrade` 通过。
- 因此当前没有新增授权范围内的本地开发项；剩余工作仅为共享数据库迁移历史确认、真实 staging/生产授权、生产 Runtime/checkpointer 与连续观测/灰度回滚证据。未改正式迁移父链、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 发布测试证据身份绑定（追加，2026-07-15）

- 发现 staging 发布证据校验器此前只验证 `tests` artifact 的通过计数和 Harness 门禁标记，没有验证它是否属于当前 `release_id/base_url`；这会留下跨版本拼接测试报告的风险。
- `evaluate_staging_evidence.py` 现在要求测试报告携带有效的 `release_id` 与 HTTPS `base_url`，并与 release 顶层身份完全一致；缺失或混用都会使 `release` check fail-closed。运维手册示例已同步字段要求。
- 新增跨 release ID 与跨 staging URL 两个反向回归；证据门禁、preflight、运维手册契约测试合计 `43 passed`；Harness release gate 实测 `259 passed, 9 skipped`。
- 该修复只强化本地证据解析，不生成或伪造 staging 数据；正式迁移双 head、真实 staging/生产授权、连续观测与灰度回滚仍未执行。未改版本、未 commit、未 push。

## 发布迁移 head 交叉校验（追加，2026-07-15）

- 进一步发现 release artifact 的 `migration.to_revision` 之前没有和 preflight `migration_graph.detail.head` 交叉校验；现在要求 preflight 明确报告唯一 `heads=[head]`，且该 head 必须等于 release 的 `to_revision`。
- 新增迁移版本不一致反向回归；证据/preflight/runbook 测试合计 `44 passed`，Harness release gate 实测 `260 passed, 9 skipped`。
- 当前仓库真实 preflight 仍因 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery` 双 head fail-closed；该增强不会选择或改写正式迁移父链，也不访问 staging/生产、读取 Token、升级版本、commit 或 push。

## 发布证据契约版本升级（追加，2026-07-15）

- 由于本轮将 `tests.release_id/base_url` 与迁移唯一 head 交叉校验设为必填，发布证据外层 `RELEASE_SCHEMA_VERSION` 从 `1.3` 升为 `1.4`；旧版 `1.0/1.1/1.2/1.3` 继续 fail-closed，避免把缺少身份绑定的旧工件当作当前发布证明。
- 运维手册示例、测试 fixture 和解析器已同步到 `schema_version=1.4`；恢复报告和核心评测内层 schema 不变。
- 聚焦证据/preflight/runbook 回归 `44 passed`；Harness release gate `260 passed, 9 skipped`；本地 GA `11/11`。本次仍未生成 staging 工件、未执行正式迁移、未访问 staging/生产、未升级产品版本、未 commit 或 push。

## 桌面端与后端全量回归再次复核（追加，2026-07-15）

- 桌面端执行 `npm run typecheck && npm test -- --reporter=dot`：类型检查通过，`36` 个测试文件、`272` 个测试全部通过；MSW 未处理请求和 Node localStorage 警告不构成失败。
- 后端执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1047 passed, 10 skipped`，退出码为 0；跳过项仍仅是本地未安装的可选 Tantivy/LangGraph 依赖。
- 本轮只更新验证记录；正式迁移测试仍按双 head 单独 fail-closed，未访问 staging/生产、未读取 Token、未升级版本、未 commit 或 push。

## 项目级 Harness 运行边界持久化（追加，2026-07-15）

- 新增项目根目录 `AGENTS.md`，持久化项目结构、本地验证命令、统一状态/工具/租约契约、迁移双 head fail-closed、staging/生产和版本发布禁区，避免后续会话只依赖聊天上下文。
- 新增 `tests/test_project_harness_instructions.py`，要求关键安全与验证边界存在；并将该测试纳入 `server/harness_spec.json` 的发布清单。
- 定向契约回归：`17 passed`；Harness release gate：`261 passed, 9 skipped`；`harness_spec.json` JSON 解析通过。
- 本轮仍未修改正式迁移父链、未访问 staging/生产、未读取 Token、未切换 `real` Runtime、未升级版本、未 commit 或 push。

## 验证命令执行目录说明（追加，2026-07-15）

- README 的开发命令现在明确要求从父工作区 `/Users/zhanglei/Documents/codex-new` 执行，避免把 `juxin-ai-assistant/server` 等相对路径误解释为项目内的嵌套目录；进入项目目录后按注释切换到对应子目录即可。
- 文档改动后的契约回归为 `17 passed`，`harness_spec.json` JSON 解析和 `git diff --check` 通过；根仓库版本自动化为 `56 passed`。
- 该改动只改善本地可检测性，不改变迁移、Runtime、授权或发布边界；正式迁移双 head、staging/生产授权和连续观测仍待最后阶段。

## 最终本地门禁复核（追加，2026-07-15）

- `python3 scripts/run_harness_release_gate.py`：`261 passed, 9 skipped`，包含新增项目级 Harness 边界测试，退出码为 0。
- `python3 scripts/run_migration_candidate_rehearsal.py --json`：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`；current 双 head 按预期 fail-closed，candidate A/B 均 upgrade/downgrade 通过。
- `python3 scripts/run_staging_preflight.py --mode local --json`：`overall=fail`，9 项中 8 项通过，唯一失败为 `migration_graph`；heads 为 `0045_agent_langgraph_checkpoints`、`0051_professional_delivery`。该 fail-closed 结果是预期安全边界，不通过候选演练绕过。

## 微信 H5 与桌面生产构建复核（追加，2026-07-15）

- 微信 H5 执行 `npm run typecheck && npm test -- --reporter=dot && npm run build`：类型检查、`1` 个测试文件/`1` 个测试、Vite `31` 个模块构建均通过。
- 桌面端执行 `npm run build`：Vite `1472` 个模块构建通过；仅有压缩后 chunk 大于 `500 kB` 的体积提示，没有构建失败。
- 这些结果补齐了本地前端交付检查，但不代表 staging/生产可发布；正式迁移双 head、真实授权、生产 Runtime/checkpointer、连续观测和回滚证据仍待最后阶段。

## 当前工作树后端与 GA 再复核（追加，2026-07-15）

- 后端执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1048 passed, 10 skipped`，退出码为 0；跳过项仍仅为本地未安装的 Tantivy/LangGraph 可选依赖。
- Harness release gate：`261 passed, 9 skipped`；本地 GA：`overall=pass`、`11/11`，离线评测 `19/20`，checkpoint `15/15`，同库恢复 `5/5`，多进程租约接管、多轮恢复、混沌、直连副作用对账和 Runtime shadow 均通过。
- 该复核仍是本地证据；正式迁移双 head、staging/生产授权、真实 Runtime/checkpointer、连续观测和回滚未执行，未改版本、未 commit、未 push。

## 正式迁移历史决策包（追加，2026-07-15）

- 新增 `docs/plans/2026-07-15-migration-history-decision-packet.md`，记录真实迁移图、候选 A（线性化 `0046` 父版本）和候选 B（双父版本 merge migration）的影响、选择规则、只读核对命令、go/no-go 门槛及回滚语义。
- 基于当前仓库历史，`0045` 是 checkpoint 分支，`0046`~`0051` 是项目/专业交付分支；候选演练证明 A/B 在临时副本可回放，但不能证明共享数据库历史。
- 在数据库负责人提供各目标环境 `alembic current/heads/history`、版本表、备份和回滚窗口证据前，推荐暂不改正式迁移父链；若发现已有库处于 `0046`~`0051` 且没有 `0045`，优先候选 B。
- 本轮仅增加决策文档，未新增正式迁移、未连接 staging/生产、未读取 Token、未改版本、未 commit 或 push；当前双 head 继续 fail-closed。

## 交接文档与定向复核（追加，2026-07-15）

- 更新 `docs/plans/2026-07-12-implementation-status.md`，补入后端 `1048 passed, 10 skipped`、Harness `261 passed, 9 skipped`、本地 GA `11/11`、桌面/H5 构建和迁移候选演练的最新证据，并明确本地证据不等于正式 GA。
- 更新 `docs/plans/2026-07-12-ga-observation-checklist.md`，在发布前命令前增加授权边界和双 head 禁止绕过说明。
- 定向回归 `tests/test_migration_candidate_rehearsal.py tests/test_staging_preflight.py tests/test_staging_evidence_gate.py tests/test_reconciliation_runbook.py tests/test_project_harness_instructions.py`：`50 passed`；`git diff --check` 通过。
- 再次执行迁移候选演练：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`；当前图按预期 fail-closed，候选 A/B 均 round-trip 通过。
- 本轮仍未改正式迁移父链、未访问 staging/生产、未读取 Token、未切换 real Runtime、未改版本、未 commit 或 push。

## 发布就绪证据矩阵（追加，2026-07-15）

- 新增 `docs/plans/2026-07-15-release-readiness-evidence-matrix.md`，将状态/工具/恢复、Runtime shadow、前端构建、发布证据、迁移 head、staging 授权、连续观测和版本自动化逐项映射到证明命令、当前状态和放行条件。
- 矩阵明确区分“已证实（本地）”“待外部证据”和“禁止放行”，并给出正式发布顺序，避免用离线 GA 或临时 SQLite 代替真实环境证据。
- 文档校验：`git diff --check` 通过；未改正式迁移、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 当前工作树最终回归与桌面测试确定性（追加，2026-07-15）

- 后端再次执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1048 passed, 10 skipped`，退出码为 0；跳过项仍仅为本地未安装的可选 Tantivy/LangGraph 依赖。
- 本地 GA 聚合门禁再次为 `overall=pass`、`11/11`；Harness release gate 为 `261 passed, 9 skipped`；根仓库版本门禁为 `56 passed`。
- 桌面端首次并行全量回归出现 4 个 5 秒超时；逐文件/单 worker 复跑全部通过（18/18），因此在 `apps/desktop/vite.config.ts` 将 Vitest 设置为 `fileParallelism: false`、`maxWorkers: 1`。随后执行 `npm run typecheck && npm test -- --reporter=dot`：`36` 个测试文件、`272` 个测试全部通过。
- 本轮仍未执行正式迁移、未访问 staging/生产、未读取 Token、未切换 real Runtime、未升级版本、未 commit 或 push；MSW 未处理请求和 Node localStorage 警告仍需后续测试夹具治理，但不影响本次退出码为 0 的回归结论。

## 65. 微信 H5 版本归属复核（2026-07-15）

- 本地审计确认微信 H5 已能独立构建，但 `apps/wechat-h5/package.json/package-lock.json` 仍为 `1.1.1`，且该目录未加入 `ai-assistant` 版本注册表；主系统 `juxin-ai-assistant/VERSION` 当前为 `3.0.0`。
- 这不是可凭代码推断的修复项，而是发布生命周期决策：若 H5 与桌面/后端共版，需同步注册表、package/lock、测试 fixture 和文档；若独立发布，则保留独立版本并建立单独发布门禁。
- 在得到明确的共版/独立发布决定前，本轮不改 H5 版本、不改注册表、不触发版本钩子；本地版本门禁仍为 `56 passed`。

## 66. 渠道重复投递出站副作用收口（2026-07-15）

- 发现渠道 webhook/job 重试路径的真实缺口：复用既有 `AgentRun` 时，会先再次调用 sender，再由 `_bind_channel_message` 事后忽略重复绑定；因此重复投递仍可能产生重复出站消息。
- 在 `server/app/channel_run_bridge.py` 增加 `_send_outbound_once`，以 `channel + inbound_message_id + ":outbound"` 的既有 `ChannelMessageBinding` 作为发送前幂等标记；已绑定时跳过 sender，首次发送仍沿用原 outbox/HTTP sender 和审计绑定流程。
- 回归测试将同一 Feishu 消息的 outbox 行数固定为 `1`；渠道相关测试合计 `25 passed`，证明首次发送保留、重复调用不重复外发、绑定仍完整。
- 这次只修复本地桥接层，不新增数据库结构，不改正式迁移父链，不访问 staging/生产，不读取 Token，不切换 real Runtime，不升级版本、commit 或 push。跨进程并发发送仍需在共享数据库/唯一约束与 staging 演练阶段继续验证。

## 67. 跨进程出站预约与恢复语义（2026-07-15）

- 将出站绑定从“发送后记录”提升为“发送前预约”：复用既有 `(channel, external_message_id, direction)` 唯一约束，在 sender 调用前提交 `state=sending` 与稳定 `idempotency_key`。并发 worker 竞争唯一键失败后只读取已有绑定，不再调用 sender。
- sender 成功后将绑定更新为 `state=sent`，同时记录 `outbound_mode`/`outbound_ok`；sender 抛出异常时写入 `state=reconciliation_required`，后续重放只返回去重结果，不会在未知外部结果下盲重试。
- 新增失败对账、过期预约和重放保护回归；渠道相关测试为 `27 passed`。该语义证明本地持久化预约和顺序重放行为，但共享数据库锁等待、真实 provider 幂等键和 staging 双进程演练仍是最后阶段证据。
- 本轮不新增迁移、不改正式迁移父链、不访问 staging/生产、不读取 Token、不切换 real Runtime、不升级版本、不 commit 或 push。

## 68. 后端全量回归复核（2026-07-15）

- 非正式迁移测试全量执行：`1049 passed, 10 skipped`，退出码为 0；新增的 1 个测试覆盖出站 sender 失败后的 `reconciliation_required` 与重放保护。
- 跳过项仍仅为本地未安装的 Tantivy/LangGraph 可选依赖；正式迁移测试仍单独执行双 head fail-closed。
- 本轮验证只覆盖本地代码和临时数据库，不代表 staging/生产授权、真实 provider exactly-once 或正式迁移已放行。

## 69. 出站预约超时 fail-closed（2026-07-15）

- 对进程在预约提交后被杀的窗口增加 `300s` 超时判断：旧 `state=sending` 不会重新发送，而是转为 `reconciliation_required`，等待人工/运营对账。
- 新增过期预约回归；渠道相关测试 `27 passed`。这补齐了“正常异常”和“无机会执行清理”的两条恢复路径。
- 超时值只是本地契约默认值，真实 provider 的查询/撤销能力、对账 SLA 和 staging kill/recovery 仍需最后阶段授权与观测证据。

## 70. 渠道对账纳入运营 SLO（2026-07-15）

- `ops_slo.build_slo_audit` 现在读取出站绑定中的 `state=reconciliation_required`，输出 `channel_outbound_reconciliation_required`，并纳入统一 `reconciliation_backlog` fail-closed 门禁。
- 新增运营 SLO 回归覆盖渠道对账计数；`test_ops_slo.py` 与渠道回归合计 `38` 个测试通过（11 + 27）。
- 这样 sender 异常不会只停留在数据库 metadata，而会在运营快照中可见；真实告警阈值、对账处理人和 staging/生产观测仍待最后授权阶段。

## 当前版本事实校正（追加，2026-07-15）

- 以仓库权威源 `juxin-ai-assistant/VERSION` 为准，当前版本是 `3.0.0`；此前较早的实施记录中出现的 `2.4.0` 只是历史快照，不再代表当前状态。
- 根仓库 `npm run test:versioning` 当前实测为 `56 passed, 0 failed`，版本自动化验证仍通过；本轮没有执行版本升级、commit 或 push。

## 最新后端全量回归（追加，2026-07-15）

- 当前工作树执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1050 passed, 10 skipped`，退出码为 0。
- 10 个跳过项仍仅是本地未安装的可选 Tantivy/LangGraph 依赖；正式迁移测试仍保持单独的双 head fail-closed 门禁。
- 本次结果只证明本地非迁移代码回归通过，不替代共享数据库历史确认、staging/生产授权、真实 Runtime/checkpointer、连续观测或灰度回滚证据。

## 本地恢复演练与 staging 证据校验复核（追加，2026-07-15）

- staging 证据校验、preflight 和恢复演练定向回归：`44 passed`。
- 本地进程边界恢复演练 `--cases 3 --lease-ttl-seconds 1`：`3/3` 成功；每例首 worker 为 `SIGKILL (-9)`，第二 worker 成功接管，fencing token 从 `1` 递增到 `2`，旧 worker 写入被拒绝，恢复率 `1.0`。
- 该演练验证的是“租约失效 → 新 worker 接管 → 旧 token 失效”的恢复语义，不是 staging/生产授权、真实 provider exactly-once 或正式迁移放行证据；正式环境仍保持 fail-closed。

## 71. 渠道出站对账运维闭环（追加，2026-07-15）

- 在 `server/app/ops_routes.py` 增加管理员专用 `GET /api/ai/ops/channel-outbound/reconciliation` 与 `POST /api/ai/ops/channel-outbound/{uuid}/reconcile`；列表只暴露 `state=reconciliation_required` 的出站绑定，避免把原始 metadata/敏感内容全部返回。
- `confirm_succeeded` 强制提交可持久化且不超过 100KB 的外部平台回执，并记录 `reconciliation_resolution`、操作人、时间和 `evidence_ref`；`confirm_not_applied` 标记 `not_applied`、禁止沿用旧幂等键盲重试。
- 复用现有 `ChannelMessageBinding.metadata_json`，用 `with_for_update` 和状态检查防止两个管理员重复处置；不新增字段、不新增迁移、不调用 provider sender。
- `tests/test_ops_readiness.py` 覆盖管理员鉴权、列表、成功回执、未生效处置、重复处置 409 和超大回执 422；渠道/运营定向回归 `23 passed`，后端非迁移全量 `1053 passed, 10 skipped`。
- 该闭环仍是本地代码与临时数据库证据；真实 provider 回执查询、staging 双 worker 恢复、告警处理人/SLA、正式迁移和生产授权仍保持最后阶段 fail-closed。

## 最新 Harness 门禁复核（追加，2026-07-15）

- `python3 scripts/run_harness_release_gate.py`：`264 passed, 9 skipped`，退出码为 0；新增渠道对账测试已随 `tests/test_ops_readiness.py` 纳入发布清单。
- `git diff --check` 通过；本轮未改版本、未改正式迁移父链、未访问 staging/生产、未读取 Token、未 commit 或 push。
