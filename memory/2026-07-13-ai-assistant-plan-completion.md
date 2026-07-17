# 2026-07-13 AI Assistant 6.0/7.0 补完记录

## 目标

在不包含正式环境部署、压测、多实例演练和真实厂商密钥联调的前提下，继续补齐 `juxin-ai-assistant` 的 6.0/7.0 总体方案代码覆盖。

## 已确认基线

- 方案：`juxin-ai-assistant/docs/plans/2026-07-12-ai-assistant-6.0-7.0-integrated-master-plan-v2.md`。
- 既有实现已经覆盖运行记录、FAQ、成果物版本、学习候选、渠道任务、连接与出站审计等基础能力。
- 审计确认的主要代码缺口：运行步骤预算、成果物模板/独立审核、工作流版本、接入治理持久化、外部身份与消息绑定，以及部分代理治理契约。
- 已完成验证：后端全量 `python3 -m pytest -q` 为 `706 passed, 1 skipped`；前端 `npm run typecheck` 通过，`npm test -- --reporter=dot` 为 `245 passed`。目标测试的 TDD 红绿验证已完成。
- 工作区已有大量用户/前序任务的未提交改动，补完时只能小范围增量修改，不得覆盖或清理既有改动。

## 本轮实现顺序

1. 先为每项行为写失败测试并执行，随后最小化实现。
2. 先补运行步骤预算，再补成果物审核和模板契约。
3. 最后补工作流版本、接入治理、身份和消息绑定的模型/迁移/API。
4. 每一批运行定向测试，完成后运行后端完整测试和前端类型检查。

## 本轮已完成

- 步骤级工具调用、令牌与时延预算及强制校验。
- 成果物模板上下文与 AI/人工独立审核留痕。
- 自定义工作流的版本保存、发布、回滚和仅运行已发布版本。
- Agent 接入的能力/策略/预算持久化，以及外部身份、入站/出站消息与运行的关联。
- 新增 Alembic 迁移 `0032_run_step_budgets`、`0033_artifact_reviews`、`0034_workflow_versions`、`0035_agent_governance_bindings`。

## 范围结论

- 正式环境观测、灰度、真实厂商密钥联调、多实例演练、性能压测和 SLO 验收按用户要求排除，不属于代码未完成项。
- 未提交、不推送、不变更版本号。

## 约束

- 不实现或验收生产环境观察、灰度、真实厂商密钥联调、多实例演练和性能压测。
- 不提交、不推送、不变更版本号，除非用户另行要求。

## 2026-07-13 Agent Loop / Harness 稳定性实施

- 新增 RunState v1（schema version、revision、游标与旧 checkpoint 迁移）及合法状态机；未知版本会拒绝恢复。
- 新增工具调用账本：副作用工具必须带确认和幂等键，成功结果回放，冲突键/失败重试/不可持久化输入均明确拒绝。
- 新增多 worker 租约、fencing token 与落库前续租；旧 worker 在租约移交后不能写入运行状态。
- 新增确定性 `LoopKernel`，统一取消、确认、预算、质量、风险和重试的继续/暂停/完成/失败判定。
- 新增 `harness_spec.json` 与契约测试，作为状态、工具、恢复语义的机器可检验门禁。
- 验证：关键回归 `16 passed`；此前契约集合 `59 passed`；迁移 head 为 `0038_agent_tool_invocation_ledger`，相关模块 `py_compile` 与 `git diff --check` 通过。完整 pytest 的桌面终端回传在 29% 后截断，未取得退出码，不能标记为全量通过。

## 2026-07-13 Agent Loop / Harness 稳定性增量

- 新增 `ProgressDetector`：相同动作指纹连续两次后阻止第三次；连续三次无进展要求重规划；重规划后再连续两次无进展终止。
- 新增 `OutcomeEvaluator`：按成功契约输出 `pass`、`revise`、`blocked` 或 `fail`；Native Runtime 已将质量和结果判定同时作为成功条件，修复了质量失败仍可能落入成功分支的问题。
- `AgentRun.state_revision` 接入 SQLAlchemy 乐观锁；租约获取、续约、释放改为带 revision 自增的条件更新；新增两独立 session 的陈旧写入拒绝测试。
- 新增 `persist_safe_checkpoint`，将运行状态契约、租约校验与 revision 更新收敛到一个持久化入口；Native Runtime 的计划、检索和草稿检查点均已迁移。
- 新增独立 `LeaseHeartbeat`：运行前提交租约，后台每 5 秒用新数据库会话续约（默认 TTL 20 秒），失租后停止当前 worker；失败结果写入同样受租约守卫。
- 新增 `ToolSpec` 与 `PolicyGate`：注册时验证契约；执行时统一校验输入 Schema、权限、scope、确认和持久化上下文；成功输出不符合契约时转为 `reconciliation_required`，禁止盲目重试。
- 新增 `HarnessSpec` 运行时加载校验，并在 FastAPI lifespan 启动时执行；状态版本、租约、工具副作用枚举和发布必测清单不一致会阻止启动。
- 已验证定向测试：70 passed（状态机、恢复、乐观锁、心跳、Native Runtime、Loop、进度、结果、Harness 基础契约）。未运行完整测试集，未宣称已达到生产稳定或 14 天 SLO。
- 新增双进程真实 SIGKILL 租约接管测试：Worker A 获取租约后被强杀，租约到期由 Worker B 接管，旧 fencing token 被拒绝续租/写入。
- `UserFeedbackTool`、`KnowledgeReviewSubmitTool`、`KnowledgeReviewApproveTool`、`KnowledgeReviewRejectTool` 已声明显式 ToolSpec；写入必须携带 run、幂等键和确认令牌，审核升级/驳回标为 non-idempotent write。
- `PersonalMemoryTool`、`LearningLibraryTool` 改为按 action 解析 ToolSpec：查询为只读，保存/停用为 idempotent write；新增回归证明查询不被误拦截、写入在确认前不可执行。
- `WordExportTool`、`PptxExportTool` 已声明为 non-idempotent write：必须具备 run、幂等键与确认；Word 的 Pydantic 导出结果改为 JSON 账本载荷，同键重试只回放结果而不会再次生成文件。
- `scripts/run_ga_gate_local.py` 新增双进程 SIGKILL 租约接管门禁；原 checkpoint 演练明确标注为同库模拟，不能冒充真实多进程演练。
- `evaluate_ga_observe.py` 现只接受以最新采样日结尾的连续自然日观测窗口，并在报告中列出采样范围的缺失日期；零散日期不能凑成 GA 连续观测。
- 最新稳定性回归组合：83 passed；本地 GA 门禁 6/6 通过（含真实双进程 SIGKILL 租约接管）；`git diff --check` 已通过。
- 增加未知副作用恢复保护：账本中仍为 `in_progress` 且超过 ToolSpec 超时的调用，会以条件更新原子转为 `reconciliation_required`；同一幂等键只返回待对账错误，绝不再次调用工具。Ops snapshot 新增运行中和待对账工具调用计数。
- 验证更新：相关测试 8 passed；稳定性回归组合扩展为 87 passed，本地 GA 门禁仍为 6/6 通过，`git diff --check` 通过。
- Ops 新增待对账工具调用查询与管理员结案接口：只能对 `reconciliation_required` 记录条件更新；确认已生效必须提供 JSON 回执，确认未生效会明确要求使用新幂等键重试；结案动作记录操作者、时间与处置结论。
- 新增 `0041_merge_agent_reconciliation_and_external_support` 空合并迁移，收敛工具对账与外部工单两条迁移分支；`python3 -m alembic heads` 现在只有一个 head。最新稳定性回归组合为 89 passed，本地 GA 门禁仍为 6/6 通过。
- GA 连续观测脚本现采集 `/api/ai/ops/snapshot`；评估器强制验证快照关键计数和账本可用性，并按每日累计计数增量判断新增完成 Run 与成功率。无流量、低成功率、待对账积压、计数回退或快照不完整均不会给出通过结论，避免只凭 readiness/HTTP 绿灯宣布稳定。`test_ga_observe_eval.py` 为 8 passed；完整稳定性回归清单为 94 passed（2026-07-13）。尚未取得 staging/生产演练和连续观测证据。
- 补齐联网工具契约：`WebCaptureTool`、`WebResearchTool`、`DeepWebResearchTool` 均声明为 `non_idempotent_write`；分别要求 `web:capture` 或 `web:research` scope、run、确认幂等键与可持久化上下文。网页采集回归证明未确认时不会联网，确认后仅执行一次，同一幂等键只回放账本结果；相关与完整稳定性回归均通过（43 / 94 passed，2026-07-13）。
- 收紧 `run_multi_instance_checkpoint_drill.py` 的恢复判定为 fail-closed：`failed`、`running`、`retrying` 均不能计入恢复成功；必须同时满足 Runtime 与 Run 终态成功、checkpoint 进度不倒退、attempt ≥ 2、`checkpoint-resume-*` 与 `checkpoint-continue-*` 事件存在，并且不得重复已成功的 coordinate/research/write。新增反例测试确保失败终态、重复安全步骤或缺失恢复事件必定失败。严格门禁下本地 3/3 演练通过；稳定性核心回归更新为 96 passed（2026-07-13），`git diff --check` 通过。仍缺 staging 的真实 API/worker 强杀恢复演练与连续观测，不能宣称系统已生产稳定。
- 为 staging 取证脚本补齐显式 Bearer 鉴权：`run_ga_smoke.py`、`run_checkpoint_recovery.py`、`run_ga_observe.py` 新增 `--bearer-token-env`，只读取环境变量名指定的 Token、不打印 Token，传入后不再混用开发测试头；变量缺失立即失败。新增脚本认证测试，文档已提供 staging 命令。脚本/观测测试 11 passed；完整稳定性核心回归为 99 passed（2026-07-13）。
- 首个用户直连副作用入口已收口：新增 `DirectActionInvocation` 与 `DirectActionService`，以 `user_id + action_name + idempotency_key` 唯一约束、请求哈希、持久化结果和安全错误记录保障网页采集预览/确认。重复同键返回原响应，异参同键返回 `409`，超时或进程中断后未知结果转为 `reconciliation_required`，绝不重放。确认保存即使换新幂等键，也只返回已保存的 `knowledge_file_uuid`，不会创建第二个文件。
- 网页采集 API 强制 `Idempotency-Key`；桌面端请求自动携带 UUID。新增迁移 `0042_direct_action_invocation_ledger`，单一迁移 head 更新为该 revision。定向后端回归 `38 passed`、扩展组合 `86 passed`，最终完整核心稳定性回归 `138 passed`，桌面端 `npm run typecheck` 与 `git diff --check` 均通过。尚未获得 staging 的中断后对账演练或连续观测证据，不得宣称生产稳定。
- 第二个高风险直连入口已收口：管理员外部工单回复在企微发送前保留幂等键；同键回放原结果，避免重复写回复或重复外发。企微调用抛错时，事务回滚本地回复记录并将该键标记为 `reconciliation_required`，后续不能自动重发。定向回归 `26 passed`，桌面端类型检查通过；纳入最终完整稳定性回归后为 `142 passed`（2026-07-13）。
- 第三个高风险直连入口已收口：聊天与知识问答 Word 导出均在生成物理文件前预留直连动作账本，浏览器请求必须带 `Idempotency-Key`；同键同参返回原下载元数据、不会生成第二个文件或成果物版本，同键异参仍拒绝。不同键保持既有的“重新导出生成新版本”行为。Word 导出相关、账本和迁移定向回归 `38 passed`，桌面端 `npm run typecheck` 通过；完整核心稳定性回归已为 `158 passed`、`git diff --check` 通过（2026-07-13）。

## 后续未完成

- 网页采集预览/确认已采用独立直连动作账本，不创建伪聊天 Run。后续盘点全部用户直连的联网、持久化写入和外发接口，建立副作用入口静态清单与 CI 覆盖率门禁，并在 staging 验证中断后待对账的处理流程。

- 扩展其余写工具的显式 ToolSpec，逐个补齐数据 scope、超时、重试与脱敏策略。
- 在 staging 完成 1000 次恢复演练、连续 7 天双 owner 监测及真实 API/worker kill 记录。
- 将 HarnessSpec 从静态 JSON 升级为可校验注册表，并接入发布门禁、固定评测与回滚证据。

## 2026-07-13 直连副作用账本补充

- 知识库文件上传已接入 `DirectActionService`：客户端必须携带 `Idempotency-Key`，账本请求只保存文件 SHA-256、长度和归一化元数据，不保存文件正文；同键同参返回原上传结果。
- 一旦开始文件/向量存储写入后发生异常，上传记录会进入 `reconciliation_required`，禁止使用同一幂等键盲目重传。
- 新增 `server/app/direct_action_inventory.py` 和 `server/tests/test_direct_action_inventory.py`，静态校验已登记直连动作与各路由的实际账本动作完全一致。
- 验证：直连动作、知识库上传、迁移相关定向回归 `104 passed`；完整核心稳定性回归 `203 passed`，桌面端 `npm run typecheck` 通过，`git diff --check` 通过。尚未执行 staging 中断演练，不应据此宣称生产稳定。

## 2026-07-13 直连动作对账运维闭环

- `DirectActionInvocation` 增加对账结论、管理员、时间审计字段；迁移 head 更新为 `0043_direct_action_reconciliation_audit`。
- 管理员可通过 `/api/ai/ops/direct-actions/reconciliation` 查询结果未知的用户直连副作用。确认已生效必须提交 2xx HTTP 状态和可回放 JSON 响应；确认未生效后同一幂等键保持失败，必须用新键重试。
- `/api/ai/ops/snapshot` 与 GA 连续观测分别统计 Agent 工具和直连动作待对账积压；任一非零、字段缺失或表不可用都会使 GA 评估失败。
- 新增：管理员确认直连操作成功时，结果必须通过原端点 Pydantic 响应模型验证并规范化后才可回放；不合法结果返回 422 且保留待对账状态，避免写入无法重放的伪成功记录。
- 新增：`DirectActionService` 仅接受 `DIRECT_ACTION_CONTRACTS` 中已登记的动作；未登记动作在写入账本前直接拒绝，避免新 REST 入口绕过发布清单。
- 验证：直连动作/清单/运维定向 `11 passed`；完整核心稳定性回归 `208 passed`，`git diff --check` 通过。未连接 staging、未提交、未推送、未改版本号。
- 本地 GA 聚合门禁复跑：`overall=pass pass=6 fail=0`；离线评测 19/20、checkpoint 恢复 15/15、同库恢复演练 5/5、双进程 SIGKILL 租约接管 1/1，Connector dry-run 与安全门禁均通过。

## 2026-07-13 HarnessSpec 可执行发布门禁

- 新增 `server/scripts/run_harness_release_gate.py`：只从 `harness_spec.json` 的 `release_gate.required_test_modules` 读取清单并调用 pytest；空清单、缺失文件、测试目录外路径或非法 JSON 均 fail-closed，绝不退回硬编码命令。
- 本地 GA 聚合脚本已将该门禁作为第一项；因此 HarnessSpec 的声明与实际发布回归使用同一事实源。
- 新增 `server/tests/test_harness_release_gate.py`，覆盖命令生成、目录/文件校验与实际执行入口。尚未执行 staging；未提交、未推送、未改版本号。

## 2026-07-13 HarnessSpec 版本注册与回滚闭环

- 新增 `HarnessSpecVersion`、`HarnessSpecAuditEvent` 与迁移 `0044_harness_spec_registry`；迁移图维持单一 head。既有 Run 新字段以 `legacy`/空值兼容，新 Run 自动冻结已激活 HarnessSpec 的 UUID、语义版本和 SHA-256 内容哈希。
- 新增 `HarnessSpecRegistry`：仓库静态规范首次使用时引导为激活版本；后续版本不可变，必须经历 `draft → pending_approval → approved → active`，创建人与审批人必须不同；激活会退役旧版本，已退役的已审批版本可受控回滚，所有动作留下审计事件。
- 管理员 API：`/api/ai/ops/harness-specs` 可查询、注册、提交、审批、激活和回滚；非管理员被拒绝。发布清单纳入注册表和 API 回归。
- 验证：注册表/契约/运行服务定向 `14 passed`；迁移、注册表和契约 `28 passed`；HTTP 权限与审批 `5 passed`；HarnessSpec 声明发布回归 `98 passed`；本地 GA 聚合门禁 `7/7` 通过（离线评测 19/20、checkpoint 15/15、同库演练 5/5、双进程 SIGKILL 接管通过）。未执行 staging、未提交、未推送、未改版本号；不能宣称生产稳定。

## 2026-07-13 Runtime shadow 与本地灰度开关

- 新增 `server/app/agent_runtime/runtime_shadow.py`：对 Native/LangGraph `RunSnapshot` 做纯内存、无副作用的契约比对；忽略 runtime 实现标记，按状态、阶段、错误、进度、模型调用、结果类型、引用、成果物和答案哈希分类 mismatch。
- Shadow 报告只保留请求哈希和脱敏契约元数据，不保存原始输入、答案、引用正文或安全消息；`run_runtime_shadow_eval.py` 支持 JSON/JSONL 输入、阈值判定和报告输出，空数据与非法数据 fail-closed。
- Feature flags 新增 `runtime_shadow_enabled`、`runtime_shadow_sample_percent`、`runtime_shadow_max_mismatch_percent`；布尔值、百分比、通道和导出格式均做边界校验，管理员更新 `/api/ai/ops/feature-flags` 写入 body-free 审计事件。新增 `/api/ai/ops/runtime-shadow` 管理员脱敏看板。
- `run_ga_gate_local.py` 新增 Runtime shadow 契约门禁；HarnessSpec 发布清单纳入 `tests/test_runtime_shadow.py`。
- `select_runtime` 现在读取已校验的 `langgraph_runtime` 文件开关，用户 Run 与渠道 Run 使用同一选择语义；环境变量仍保留为紧急覆盖。
- 验证：Runtime shadow/feature flags 定向 `9 passed`；HarnessSpec 声明发布回归 `102 passed`；本地 GA 聚合门禁 `8/8` 通过（离线评测 19/20、checkpoint 15/15、同库演练 5/5、双进程 SIGKILL 接管、Connector dry-run、安全和 Runtime shadow 均通过）。仍未执行 staging、连续观测、提交、推送或版本升级。

## 2026-07-13 Runtime shadow 本地覆盖增强

- 新增 `server/app/agent_runtime/runtime_shadow_fixture.py`，生成 50 条稳定、脱敏、无副作用的契约 fixture；本地 GA 门禁不再只检查单条样例，而是强制校验 50 条记录、0 mismatch、报告状态为 pass。
- 新增隔离内存数据库回归：NativeRuntime 与当前 LangGraphRuntime wrapper 对同一无证据快路径产生等价状态；两个 Runtime 使用不同数据库，避免把候选执行写入基线数据。该测试只证明当前 wrapper 的契约兼容，不证明真实 LangGraph 实现或生产双 Runtime 稳定。
- 验证：Runtime shadow 定向 `6 passed`；此前待复跑的 HarnessSpec 发布门禁、本地 GA 门禁和 `git diff --check` 已完成并通过（发布门禁 `105 passed`，本地 GA `8/8`）。仍未执行 staging、连续观测、提交、推送或版本升级。

## 2026-07-13 工具副作用契约补齐

- 发现 `reference_source_validate` 在 `delete_unmentioned=true` 时会删除 `ChatMessageSource`，但原先继承 BaseTool 默认只读契约，绕过了幂等调用账本和确认保护。
- 新增按输入动作解析的 `ToolSpec`：纯校验保持 `read_only`；删除模式标记为 `idempotent_write`、要求确认和持久化任务上下文，并声明输入/输出 Schema。
- 新增策略回归：删除模式缺少 run/idempotency/确认时被 `TOOL_IDEMPOTENCY_KEY_REQUIRED` 拦截，纯校验仍成功；完整 HarnessSpec 发布回归 `105 passed`，本地 GA `8/8` 通过。
- 删除模式的 `message_id` 查询增加 `ChatMessage.sso_user_id == context.user_id` scope，跨用户引用不会被读取或删除；更新后完整 HarnessSpec 发布回归为 `106 passed`，本地 GA 仍为 `8/8`。
- 这只完成了本地已注册工具的一个真实副作用缺口；真实 staging 双 Runtime、API/worker 强杀恢复、连续 SLO 观测及其余潜在写工具审计仍未完成，不能宣称生产稳定。
## 2026-07-13 LangGraph 运行时边界收口

- 仓库当前没有 `langgraph` 依赖，`LangGraphRuntime` 仍是 NativeRuntime 的 shadow wrapper，不应宣称为真实生产 LangGraph。
- 新增 `langgraph_runtime_mode`（`shadow`/`real`），默认 `shadow`；`real` 在后端未实现时 fail-closed，选择错误不会静默降级到 Native。
- LangGraph shadow 暴露 `capabilities`：`production_ready=false`、`delegates_to=native`，并用回归测试锁定这一事实。
- 本地 staging、真实双 Runtime、强杀恢复和连续 SLO 观测仍按用户要求留到最后。

## 2026-07-13 学习库模板范围契约收口
- `LearningLibraryTool` 的模板 `scope` 现在只接受 `personal` 或 `company`，输入会先归一化；非法范围返回 `TEMPLATE_SCOPE_INVALID`，不会写入数据库。
- 公司模板通过 Agent 工具写入时统一为 `review_status=pending`，与模板审核流程一致；列表查询忽略历史非法 scope，继续按当前用户隔离。
- 新增回归覆盖大小写/空格归一化、待审状态和非法 scope 不落库。真实 staging、真实 LangGraph 后端、强杀恢复和连续 SLO 仍未执行。
- 验证：学习库/模板相关 `3 passed`、工具契约 `6 passed`；完整 HarnessSpec 发布门禁 `108 passed`；本地 GA 聚合 `8/8` 通过；`git diff --check` 通过。未提交、未推送、未改版本号。

## 2026-07-13 动态 ToolSpec 降级保护
- `ToolRegistry.execute` 新增契约单调性校验：动态 `resolve_tool_spec` 只能保持或收紧已注册的副作用等级，不能从 `idempotent_write`/`non_idempotent_write` 降为 `read_only`；已注册要求确认时，动态契约也不能关闭确认。
- 新增 `DowngradeTool` 回归测试，验证弱化契约在执行前直接抛错，不会进入 PolicyGate 或产生工具副作用。
- 验证：工具契约 `8 passed`；HarnessSpec 发布门禁 `110 passed`；本地 GA 聚合 `8/8`；`git diff --check` 通过。
- 仍未提交、未推送、未改版本号；真实 LangGraph 后端、staging 强杀/对账演练和连续 SLO 观测继续按用户决定留到最后。

## 2026-07-13 LangGraph checkpoint 进程边界演练

- 新增 `server/scripts/run_langgraph_checkpoint_drill.py`：文件型 SQLite、每进程独立 SQLAlchemy Engine；Worker A 写入 `cp-1` 后由父进程 `SIGKILL`，租约过期后 Worker B 接管、读取 `cp-1`、写入 `cp-2`，父进程再用旧 fencing token 尝试 stale write。
- 新增 `server/tests/test_langgraph_checkpoint_drill.py` 并加入 `server/harness_spec.json` release gate。缺少可选 LangGraph 依赖时测试安全跳过；`run_drill(cases=0)` 至少执行 1 个可序列化 case。
- 修复演练默认加密 key 必须严格为 32 字节，并保留 `--json` 兼容参数；报告包含 worker exit code、token、恢复 checkpoint、checkpoint 顺序、stale write 结果和错误列表。
- 验证：默认定向 `1 passed, 1 skipped`；可选 LangGraph 环境定向 `2 passed`；3 轮演练 `recovered=3/3`、`recovery_rate=1.0`；Harness release gate `129 passed, 9 skipped`；`git diff --check` 待最终复核。
- 结论：本地进程边界与持久化语义已补齐，但文件 SQLite 不等价于 staging/生产数据库；真实 staging 授权、双 Runtime 强杀/对账和连续 SLO 仍按用户要求最后执行，`real` 模式继续 fail-closed，未提交/推送/升版本。

## 2026-07-13 LangGraph 本地 pilot

- 新增 `server/app/agent_runtime/langgraph_graph.py`：真实 `StateGraph` builder，固定 `prepare → execute → verify → finish` 四阶段、`LangGraphState` 状态契约和显式 checkpointer 要求；phase 业务回调通过注入方式接入，不能绕过现有租约、工具和授权层；`langgraph_thread_config` 强制用 `run_id` 作为唯一 `thread_id`。
- `server/requirements-langgraph-pilot.txt` 锁定 `langgraph==1.2.9`、`langgraph-checkpoint-sqlite==3.1.0`。SQLite saver 仅用于本地/小规模 pilot，不扩大生产主依赖；当前生产仍不切换。
- `langgraph_backend_status()` 新增 graph/checkpointer 可检测字段；依赖安装、图实现和生产就绪分开报告，real 模式继续 fail-closed。
- 验证：默认环境 runtime `10 passed, 2 skipped`；临时依赖环境真实 graph + SQLite checkpoint `12 passed`；HarnessSpec 发布门禁 `116 passed, 2 skipped`；本地 GA `9/9`；`git diff --check` 通过。未提交、未推送、未改版本号。
- 新增 `server/app/agent_runtime/langgraph_service_binding.py`：把四个 phase 接到 AgentRunService lease/fencing、Run Step、安全 checkpoint、只读 ToolRegistry 和 OutcomeEvaluator；finish 才能落最终 Run 状态，旧 fencing token 在 phase 边界 fail-closed，并统一 `run_id/thread_id`。
- 验证：默认 runtime `10 passed, 4 skipped`；临时 LangGraph 依赖环境真实 graph + SQLite checkpoint + binding `14 passed`；HarnessSpec 发布门禁 `116 passed, 2 skipped`；GA `9/9`；`git diff --check` 通过。未提交、未推送、未改版本号。
- 仍待开发：staging 双 Runtime、授权接入、Worker 强杀/对账恢复和连续 SLO 观察；这些完成前生产仍只使用 NativeRuntime。

## 2026-07-13 staging 最终阶段本地预检

- 新增 `server/scripts/run_staging_preflight.py`：只读检查 HarnessSpec 发布清单、LangGraph pilot 依赖隔离、`langgraph_runtime_mode=real` 的 fail-closed 状态、staging Bearer 环境变量、HTTPS 传输和 GA 连续观测阈值；不调用远程 API，也不输出 Token。
- `server/scripts/staging_auth.py` 现在拒绝空用户/角色、非法环境变量名和 CR/LF 注入；Bearer 模式只输出是否存在，不输出值。
- 发布门禁新增 `tests/test_staging_preflight.py`；验证结果：`126 passed, 4 skipped`，本地预检 `overall=pass`，缺 Token/HTTP staging 预检按预期失败。
- 这只是 staging 执行前的本地安全闸门，不能替代真实凭证、真实双 Runtime、Worker 强杀/对账演练和连续 SLO 窗口；生产仍只使用 NativeRuntime。未提交、未推送、未改版本号。

## 2026-07-13 LangGraph thread 重放幂等

- `LangGraphRunBinding` 现在以 AgentRun 的成功步骤和安全 checkpoint 作为幂等权威：同一 `thread_id` 重复 invoke 会复用 execute 结果，不再次执行只读工具；prepare/verify/finish 也不会追加重复成功步骤或重复终态写入。
- execute checkpoint 保存 `evidence_count`，verify checkpoint 保存 `outcome`，恢复后可继续做成功契约校验；失败步骤不会被误判为成功，重试仍会重新验证。
- execute 现在先提交包含结果的安全 checkpoint，再记录成功 Step；即使进程在两次写入之间退出，也不会把“无结果的成功 Step”当作可重放结果。
- 新增 optional LangGraph pilot 重放回归（依赖未安装时跳过）；当前本地聚焦回归 `20 passed, 4 skipped`，完整 HarnessSpec 发布门禁 `126 passed, 4 skipped`，`git diff --check` 通过。仍未执行真实 staging/连续 SLO，未提交、未推送、未改版本号。

## 2026-07-13 LangGraph finish 终态投影恢复

- 发现 finish 阶段存在提交窗口：`langgraph_finish` 成功 Step 已落库，但进程可能在 Run 转为 `succeeded` 前退出；重放若只检查成功 Step 会返回完成，却留下 `running` Run。
- `LangGraphRunBinding.finish` 现在在检测到成功 finish Step 且 Run 尚未成功时，使用已持久化结果补齐最终 Run 投影；新增回归测试模拟该窗口。
- 临时可选依赖环境真实 graph/checkpoint/binding 测试 `15 passed`；默认环境聚焦测试 `10 passed, 5 skipped`。未提交、未推送、未改版本号。

## 2026-07-13 AgentRun durable checkpoint saver

- （历史记录，已被后续迁移替代）早期 saver 曾把最新线性 checkpoint 编码进 `AgentRun.checkpoint_json`；现已迁移到独立 checkpoint 表，见文末“数据库级 LangGraph checkpoint 收口”。
- saver 强制校验 `thread_id == run_id`，写入复用 `AgentRunService` 的 lease/fencing/revision；LangGraph 绑定未传 checkpointer 时默认使用该 saver。
- LangGraph 的 checkpoint 回调可能并发触碰 SQLAlchemy Session，因此 saver 与四个 phase callback 共用执行锁；这是本地单进程 pilot 的串行边界，尚未达到多实例生产 checkpointer 要求。
- 临时 LangGraph 依赖环境验证：`tests/test_runtime_shadow.py` 为 `16 passed`；real 模式仍 fail-closed，NativeRuntime 仍为生产路径。

## 2026-07-13 Runtime state contract 收口

- 新增 `server/app/agent_runtime/runtime_state_contract.py`，统一 `prepare → execute → verify → finish` 四阶段、必填 `run_id/owner_user_id/input_text`、允许阶段、终态和成功步骤幂等追加规则。
- `langgraph_graph.py` 的默认校验、步骤追加和能力状态，以及 `LangGraphRunBinding.prepare` 均复用该契约；重复步骤不会被追加，非法阶段/步骤 fail-closed。
- 验证：默认环境 `tests/test_runtime_shadow.py` 为 `11 passed, 6 skipped`；临时 LangGraph 依赖环境为 `17 passed`。该改动只稳定状态语义，real 模式仍 fail-closed，NativeRuntime 仍为生产路径。
- 其后 Native 恢复/知识/产物回归为 `14 passed`；Harness release gate 为 `127 passed, 6 skipped`；本地 GA 聚合门禁 `9/9` 通过。GA 输出仍明确要求生产连续观测，不能据此宣称生产稳定。
- LangGraph 状态显式复用既有 `RUN_STATE_SCHEMA_VERSION=1.0`；兼容无版本的旧 pilot 输入，但未知版本在 prepare 阶段 fail-closed，避免第二套状态版本语义。
- 版本绑定后的定向回归：默认 `15 passed, 6 skipped`，可选 LangGraph 环境 `17 passed`；完整 Harness release gate 再次为 `127 passed, 6 skipped`。未提交、未推送、未改版本号。
- 状态契约新增连续前缀校验：`completed_steps` 不能跳过或乱序，非法 checkpoint 返回 `INVALID_RUN_STEPS`，确保恢复不会从未完成阶段直接进入后续阶段。
- 最终回归：Harness release gate `127 passed, 6 skipped`；未提交、未推送、未改版本号，real LangGraph 仍 fail-closed。
- binding 的所有 phase 入口现在都先校验状态契约，再校验身份/租约；中间 checkpoint 损坏时不会触发工具执行或副作用。
- 最终 release gate 复跑仍为 `127 passed, 6 skipped`；本轮只改状态契约/恢复边界，未提交、未推送、未改版本号。

## 2026-07-13 本地多轮进程边界恢复演练

- 新增 `server/scripts/run_staging_recovery_rehearsal.py`：每轮使用独立 SQLite 数据库，Worker A 获取租约后由父进程 SIGKILL，等待 TTL 过期，再由 Worker B 接管；父进程验证 fencing token 递增、旧 worker 续租失败、旧 token 写入被拒绝，并输出可机器读取的 JSON 汇总。
- 新增 `server/tests/test_staging_recovery_rehearsal.py`，覆盖单轮成功和非法 case 数量的 fail-closed/可序列化行为；加入 `harness_spec.json` 发布测试清单。
- 本地 GA 门禁新增“多轮跨进程 SIGKILL 恢复演练”，当前 `3/3`、恢复率 `1.0`；HarnessSpec 发布回归 `113 passed`，本地 GA 聚合门禁 `9/9`，`git diff --check` 通过。
- 修复固定测试时间在当天过期后的抖动：`AgentRunService.transition_status` 增加可选 `now` 供 fencing 断言注入，生产调用保持真实 UTC 默认值。
- 以上是本地进程边界证据，不等价于 staging/生产证据；仍未执行 staging 1000 次恢复、连续 7 天双 owner 监测、连续 SLO 观测或真实 LangGraph 后端，未提交、未推送、未改版本号。

## 2026-07-13 LangGraph 可检测性收口

- `langgraph_runtime.py` 新增 `langgraph_backend_status()`，把“依赖是否安装”“真实后端是否实现”“是否生产就绪”分开报告；当前环境无 `langgraph` 依赖，状态为 `dependency_missing`，不会把 shadow wrapper 误报为生产后端。
- `LangGraphRuntime.capabilities` 与 `/api/ai/ops/feature-flags` 均暴露该状态；新增回归锁定未实现时 `implemented=false`、`production_ready=false`，真实模式仍 fail-closed。
- 验证：Runtime shadow/ops 定向 `13 passed`；HarnessSpec 发布门禁 `114 passed`；本地 GA 聚合 `9/9`，`git diff --check` 通过。

## 2026-07-13 Native 业务适配 LangGraph pilot

- 新增 `server/app/agent_runtime/native_langgraph_adapter.py`，把 NativeRuntime 的既有业务链路作为 LangGraph 四阶段回调使用；不复制检索、写作、审核、成果物、预算和终态规则。
- `NativeRuntime.start_sync_with_executor()` 复用原有租约、heartbeat、FAQ、retry、cancel、预算和 LeaseLostError 生命周期；默认 `NativeRuntime.start_sync()` 行为不变。
- `LangGraphRuntime(mode="real")` 已可在可选 LangGraph/checkpointer 依赖环境运行真实 StateGraph，并支持同一 run 重放；重放不会重复追加 Native 的 coordinate/research/write/review 步骤。
- 可选依赖回归 `18 passed`；默认环境回归 `15 passed, 7 skipped`。real 仍未通过 `select_runtime` 的生产就绪门禁；该条为迁移前历史结果。
- 仍未提交、未推送、未改版本号；真实 LangGraph 图及持久化 checkpointer 仍需单独依赖/架构评审，staging 强杀与连续生产 SLO 按用户决定最后执行。

## 2026-07-13 本轮最终验证

- `server/tests/test_runtime_shadow.py` 默认环境：`15 passed, 8 skipped`。
- `server/tests/test_agent_run_service.py`、`test_runtime_shadow.py`、`test_checkpoint_resume_runtime.py`：本轮相关回归 `49 passed, 8 skipped`；新增跨 Session 外层回滚后安全点仍可读取的持久化回归。
- 可选 LangGraph 环境：`19 passed`，覆盖真实 StateGraph、AgentRun checkpoint、Native 业务适配、同一 run 重放幂等和 durable saver。
- Harness release gate：`128 passed, 8 skipped`；`git diff --check` 通过。
- `persist_safe_checkpoint(durable=True)` 已接入 Native 与 LangGraph 阶段边界；默认值仍为 `False`，其他事务调用不改变原有提交策略。
- 当前仍不宣称生产稳定：`business_adapter_implemented=true`，但 `production_checkpointer_supported=false`；真实 staging 授权、双 Runtime 强杀/对账和连续 SLO 观察尚未执行。

## 2026-07-13 数据库级 LangGraph checkpoint 收口

- 新增 `server/app/models.py` 的 `AgentRunLangGraphCheckpoint` 与迁移 `server/alembic/versions/0045_agent_langgraph_checkpoints.py`；唯一约束为 `run_id + thread_id + checkpoint_id`，并保存 checkpoint、metadata、pending writes、new versions、writer/fencing token。
- `AgentRunCheckpointSaver` 已切换到独立 checkpoint 表：真实 Engine 使用独立 Session/连接，在事务内锁定 AgentRun 并校验 lease/fencing 后提交；StaticPool 测试环境复用调用 Session，避免共享 SQLite 连接互相回滚。
- 新增迁移约束回归和文件 SQLite 双 Session 接管测试：旧 fencing token 写入被 `LeaseLostError` 拒绝，旧 worker 已提交的 `cp-1` 仍可由新 Session 读取。
- 目标测试：默认环境 `49 passed, 8 skipped`；可选 LangGraph 环境当前 runtime `20 passed`（连同迁移回归为 `45 passed`）；`git diff --check` 已通过。
- 生产门禁仍保持关闭：`production_checkpointer_supported=false`，真实 staging 授权、HTTPS、双 Runtime 强杀/对账和连续 SLO 观察仍最后执行；未提交、未推送、未改版本号。

## 2026-07-13 PPTX 导出用户 scope 收口
- `PptxExportTool` 现在必须使用 `context.user_id`，缺少用户绑定时在渲染/落盘前失败关闭。
- `ExportFileManager.save_pptx` 新增必填 `owner_user_id`，文件写入 `pptx/<用户哈希>/` 分区；路径仍限制在导出根目录内，避免共享目录和路径穿越。
- 新增回归：验证用户分区文件可打开，且缺少用户绑定不会产生任何 PPTX 文件。
- 验证：PPTX/工具契约定向 `10 passed`；HarnessSpec 发布门禁 `111 passed`；本地 GA 聚合 `8/8`；`git diff --check` 通过。首次门禁失败仅因传入了错误长度的临时测试密钥，使用有效 32 字节临时值后通过。
- 仍未提交、未推送、未改版本号；真实 LangGraph 后端、staging 强杀/对账演练和连续 SLO 观测继续按用户决定留到最后。

## 2026-07-13 ToolSpec 数据 scope 收口

- 为 `ToolSpec` 增加 `data_scopes`（`user/resource/external/global`）；写工具未声明 scope 时在注册阶段 fail-closed。
- 动态 `resolve_tool_spec` 不得弱化已注册的数据作用域；反馈、导出、记忆、学习库、引用删除、知识审核、PPTX 和联网工具均已逐个声明 scope。
- 先用未声明写工具验证 RED，再完成实现；定向运行时/工具契约/技能回归 `58 passed`，Harness release gate `131 passed, 9 skipped`。
- 这只证明本地契约和回归；staging、真实授权、双 Runtime 强杀/对账、外部回执查询 SOP 与连续 SLO 仍按用户决定最后处理。未提交、未推送、未改版本号。

## 2026-07-13 进程边界恢复演练 1000 次收口

- `server/scripts/run_staging_recovery_rehearsal.py` 的 `cases` 现在显式限制为 `1..1000`，并行度限制为 `1..32`；不再把大请求静默截断为 20，非法参数 fail-closed。
- 单值回传改用 multiprocessing Pipe，最终 kill/join 后重新读取退出码，修复高并发下进程收尾被误记为失败的问题。
- 真实本地命令：`python3 scripts/run_staging_recovery_rehearsal.py --cases 1000 --parallelism 8 --lease-ttl-seconds 0.05 --timeout 30 --json`；结果 `total=1000, recovered=1000, failed=0, recovery_rate=1.0, passed=true`。
- 交叉验证 10/10、30/30、100/100、200/200 均通过；Harness release gate `133 passed, 9 skipped`；`git diff --check` 通过。
- 证据只覆盖临时 SQLite 的本地进程边界，不替代 staging 授权、真实数据库、双 Runtime 对账、连续 7 天无双 owner 或 SLO 观察。未提交、未推送、未改版本号。

## 2026-07-13 外部回执查询/对账 SOP 收口

- 扩展 `docs/ops-runbook-6.0-7.0.md`：明确先查 `/api/ai/ops/snapshot` 与两个 reconciliation 列表，再用厂商官方控制台/API 查询权威回执；不能唯一确认时保持 `reconciliation_required`，结果未知时禁止重发。
- 明确工具调用和直连动作的 `confirm_succeeded` / `confirm_not_applied` 请求体；直连成功必须提供可回放的 `response_status` + `response_payload`，未生效后重试必须使用新的 `Idempotency-Key`。
- 新增 `server/tests/test_reconciliation_runbook.py` 并加入 `server/harness_spec.json` release gate，锁定接口、字段、禁止盲重试和对账后快照归零检查。
- 验证：对账相关 `18 passed`；完整 Harness release gate `135 passed, 9 skipped`；`git diff --check` 通过。
- 本轮仍未调用 staging/生产或真实授权；未提交、未推送、未改版本号。剩余硬证据仍是 staging 双 worker 强杀/对账、连续 7 天无双 owner、连续 SLO 观察和真实生产 checkpointer。

## 2026-07-13 本地 Run/Step/Event 对账看板收口

- `server/app/ops_routes.py` 新增只读管理员接口 `GET /api/ai/ops/run-reconciliation`，扫描最近 1–200 个 Run，批量读取 Step/Event。
- 对账规则覆盖未知状态、三类实体的序列缺口、终态时间戳、终态 Run 与完成/失败/取消事件匹配；返回稳定 issue code、明细与计数。
- 新增 `server/tests/test_run_reconciliation.py`，并加入 `server/harness_spec.json` release gate。
- `apps/desktop/src/api/client.ts` 与 `apps/desktop/src/pages/admin/OpsDashboardPage.tsx` 已接入对账接口和看板卡片，显示状态、计数及最多 20 条问题。
- 验证：定向后端 12 passed；完整后端 release gate `137 passed, 9 skipped`；桌面端全量 `247 passed`；typecheck/build 通过（仅 bundle chunk >500 kB 警告）。
- 结论：本地只读对账能力已补齐；staging/生产双 worker、真实授权、持续 SLO、真实 checkpointer、14 天 canary 等仍未执行，因此不能宣称最终生产稳定。未执行版本升级、commit、push。

## 2026-07-13 连续观测接入 Run/Step/Event 对账

- `/api/ai/ops/snapshot` 现在带有 Run/Step/Event 对账摘要（状态、扫描数、问题数、issue code 计数）；对账异常时 fail-closed 为 `unavailable` 并记录 notes。
- `evaluate_ga_observe.py` 已把摘要纳入连续观测门禁：缺字段、不可用、非 pass 或问题非零都会失败。
- 桌面端 Ops 看板同时显示人工 reconciliation 接口与连续观测快照，避免人工接口有结果但自动观察漏检。
- 验证：定向后端 `21 passed`；完整 Harness release gate `140 passed, 9 skipped`；桌面端 `31 files / 247 tests passed`；typecheck/build 通过（仅 bundle chunk >500 kB 警告）。
- 仍未执行 staging/真实授权/生产 HTTPS、双 Worker 强杀对账、连续 7/14 天 SLO、真实生产 checkpointer；未改版本号、未 commit、未 push。

## 2026-07-14 本地实施复核

- 只读本地 preflight 通过：HarnessSpec 21 个发布测试模块、依赖隔离、shadow 默认模式和观测阈值均通过；`real` 模式仍在生产就绪证据不足时 fail-closed。
- 本地 GA 聚合门禁 9/9 通过；Harness release gate 为 `140 passed, 9 skipped`，离线评测 19/20、checkpoint 恢复 15/15、跨进程恢复 3/3、Runtime shadow fixture 50/50。
- 没有新的本地实现缺口，未扩大代码改动；真实 staging/授权/生产数据库、外部回执、连续 SLO 和生产 checkpointer 仍按用户决定最后处理，不能据此宣称最终稳定。

## 2026-07-14 本地混沌演练套件

- 新增 `server/scripts/run_agent_chaos_suite.py`：临时内存 SQLite、无网络、机器可读 JSON、单 case 异常即 fail-closed。
- 七个 case 全部通过：Loop 收敛/阻断、取消与模型预算、模型失败分类、外部工具未知结果对账阻断、工具超时统一分类为 `TOOL_TIMEOUT`、旧租约 fencing、数据库短暂不可用后的 fail-closed/恢复。
- `server/tests/test_agent_chaos_suite.py` 已加入 HarnessSpec；测试覆盖正常通过、注入失败和 repeat 参数边界。
- 验证：Harness release gate `154 passed, 9 skipped`；本地 GA `10/10`；混沌演练 `7/7`。该证据仅代表本地可检测性，不替代 staging/真实授权/生产数据库和连续 SLO。

模型调用分类在非流式和流式路径统一：401/403 → `SERVER_MODEL_AUTH_FAILED`，408/传输超时 → `SERVER_MODEL_TIMEOUT`，429 → `SERVER_MODEL_RATE_LIMITED`，5xx → `SERVER_MODEL_UPSTREAM_UNAVAILABLE`，未知 HTTP/解析错误保持 `SERVER_MODEL_FAILED`。长任务错误文案同步按分类给出可操作提示。

## 2026-07-14 持久化 SLO 审计与连续观测收口

- 新增 `server/app/ops_slo.py`，基于现有 Run/Step/Event、租约、预算、工具幂等账本和对账状态做持久化不变量审计；不新增数据库表，也不调用外部网络。
- `/api/ai/ops/snapshot` 输出 `slo_audit`；`ops_readiness.py` 增加 Agent Loop 持久化不变量检查；`evaluate_ga_observe.py` 增加 `agent_loop_slo` 连续观测门禁。未观测到真实恢复率时明确为 `pass_with_gaps`/`insufficient_data`，不会伪报成功；畸形计数 fail-closed。
- 新增 `server/tests/test_ops_slo.py` 和 SLO 评估器回归；本轮定向测试 `32 passed`，完整本地 GA 门禁 `10/10`，HarnessSpec 回归 `159 passed, 9 skipped`，`git diff --check` 通过。
- 本地审计仍会对 checkpoint 恢复率、审批恢复率标记未观测；staging 授权、真实数据库/HTTPS、双 Runtime 强杀与外部回执、连续 7/14 天 SLO、生产 checkpointer 仍未执行，不能据此宣称最终生产稳定。未改版本号、未 commit、未 push。

## 2026-07-14 桌面运维看板接入 Agent Loop SLO

- `apps/desktop/src/api/client.ts` 增加 `OpsSloAuditPayload`/检查项类型，并纳入工具调用积压与 SLO 审计快照字段。
- `apps/desktop/src/pages/admin/OpsDashboardPage.tsx` 展示 SLO 审计整体状态、硬失败数、未观测数和逐项检查结果，明确区分通过、失败、未观测和不可用。
- 运维看板回归覆盖 `pass_with_gaps` 与 `not_observed` 文案；定向测试 1 passed，桌面端全量 31 个测试文件/247 个测试通过，typecheck/build 通过。
- 仍未执行 staging/真实授权、真实数据库双 Worker 强杀与外部回执、连续 7/14 天 SLO、生产 checkpointer；未改版本号、未 commit、未 push，不能宣称最终生产稳定。

## 2026-07-14 SLO 证据解释性补齐

- SLO 卡片现在逐项显示实际值/阈值，空实际值显示 `—`；同时显示后端 notes，直接解释 `pass_with_gaps` 的 staging/混沌演练证据缺口。
- 回归：`npx vitest run tests/ops-checkpoint-button.test.tsx` 1 passed；`npm run typecheck`、`npm run build`、`git diff --check` 通过。构建仅提示既有 bundle chunk 大小。
- 该改动只增强本地运维可观测性，仍不代表 staging/生产稳定；未改版本号、未 commit、未 push。

## 2026-07-14 版本自动化与本地总门禁复核

- 修正 `tests/versioning-automation.test.js`：按各系统 VERSION 源校验运行时目标，不再假设所有系统都是 `1.0.0`；根仓库版本仍固定校验 `1.0.0`。
- 版本自动化 `56 passed`；本地 GA `10/10`；HarnessSpec `159 passed, 9 skipped`；恢复 15/15、跨进程 3/3、混沌 7/7、shadow 50/50。
- 仍未执行 staging/授权、真实数据库/HTTPS、双 Runtime 强杀/外部回执、连续 7/14 天 SLO 和生产 checkpointer；不能宣称最终生产稳定。未改版本号、未 commit、未 push。

## 2026-07-14 staging 观测传输安全收口

- `server/scripts/staging_auth.py` 新增 `validate_bearer_transport`：无 Bearer 时保留本地 HTTP/test-header 兼容；指定 Bearer 时必须使用 HTTPS origin，禁止 URL user-info。
- `run_ga_observe.py`、`run_ga_smoke.py`、`run_checkpoint_recovery.py` 统一复用该校验，Bearer 仍只从命名环境变量读取且不打印。
- 定向授权/观测/preflight 测试 `25 passed`；脚本编译与帮助入口通过；本地 GA `10/10`；Harness release gate `162 passed, 9 skipped`；`git diff --check` 通过。
- 这只是 staging 执行入口安全加固，不是 staging 运行证据。真实 HTTPS/Bearer、真实数据库双 Worker 强杀/外部回执、连续 7/14 天 SLO、生产 checkpointer 仍未执行；未改版本号、未 commit、未 push。

## 2026-07-14 连续观测默认门槛统一

- 稳定定义是连续 14 天，但观测入口此前默认 10 天；新增 `server/scripts/observation_policy.py`，统一默认观测天数 14、成功率 0.9、最少完成 Run 1。
- `run_staging_preflight.py` 与 `evaluate_ga_observe.py` 共用常量，观测清单示例改为 `--min-days 14`；短窗口只允许显式用于本地测试。
- 新增默认策略回归；定向观测/preflight/auth 测试 27 passed，本地 GA 10/10，Harness release gate 164 passed、9 skipped。该改动只消除配置漂移，不产生 staging/生产连续 SLO 证据；未改版本号、未 commit、未 push。

## 2026-07-14 本地 HTTP 全链路演练与 smoke 语义门禁

- 临时 SQLite 首次启动真实 FastAPI 服务时确认：未执行 Alembic head 迁移会使 channel job worker 报表不存在，并让 GA 报告、工作流、成本路径返回 500；执行 `python3 -m alembic upgrade head` 到 `0045_agent_langgraph_checkpoints` 后恢复。
- 运维手册新增迁移前置命令和 fail-closed 规则；`run_ga_smoke.py` 增加 readiness、安全、GA、checkpoint、Agent Hub 的响应语义断言，不再把 `not_ready` 或部分不健康视为 HTTP 成功。
- 新增 `server/tests/test_ga_smoke.py`，登记到 HarnessSpec；覆盖 warning/partial 允许和关键失败拒绝。
- 证据：定向测试 30 passed；真实本地 HTTP smoke `13/13`、轻载 errors `0/4`；observe 6 个 probe 写入 `/tmp/ga-observe-http.jsonl`，readiness `ready_with_warnings`、security `pass`、GA `partial` 且 `failed=0`。
- 该证据只覆盖本地迁移顺序和 HTTP 观测，不替代 staging HTTPS/Bearer、真实双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer；未改版本号、未 commit、未 push。

## 2026-07-14 最终本地聚合门禁复核

- 本地 preflight `overall=pass`，6/6 检查通过：HarnessSpec 25 个模块、依赖隔离、shadow 默认模式、本地授权边界、传输策略和统一 14 天观测门槛。
- 本地 GA `10/10`：Harness release gate `167 passed, 9 skipped`；离线评测 19/20（0.95）；checkpoint 15/15；同库多实例 5/5；多轮跨进程 SIGKILL 3/3；Connector、安全、混沌 7/7、Runtime shadow 50/50 均通过。
- 本地 HTTP 全链路在 Alembic head `0045_agent_langgraph_checkpoints` 上 smoke `13/13`、轻载 errors `0/4`；observe 6 probes，readiness=`ready_with_warnings`、security=`pass`、GA=`partial` 且 `failed=0`。smoke 已按响应语义门禁。
- 结论：本地实现和检测门禁收口，但真实 staging HTTPS/Bearer、数据库双 Worker 强杀/外部回执、连续 14 天 SLO、生产 checkpointer 和最终版本发布仍未做；未改版本号、未 commit、未 push。

## 2026-07-14 Smoke 与连续观测共享语义契约

- 新增 `server/scripts/ops_probe_semantics.py`，统一 health、Agent Hub、readiness、安全、GA、checkpoint 的 fail-closed 成功规则；畸形/负数/缺失计数不再被视为成功。
- `run_ga_smoke.py` 与 `run_ga_observe.py` 共享契约；observe JSONL 每个 probe 写入 `semantic_ok`，快照写入 `semantic_failures`，HTTP 2xx 但语义失败会让观测命令失败。
- 回归测试 `32 passed`；脚本编译、帮助入口、`git diff --check` 通过；本地 preflight `6/6`，GA `10/10`，Harness release gate `169 passed, 9 skipped`。
- 仍无 staging/生产证据，未改版本号、未 commit、未 push。

## 2026-07-14 连续观测 evaluator 接入语义契约

- `server/scripts/evaluate_ga_observe.py` 已消费 observe JSONL 的 `probe.semantic_ok`，并新增 `probe_semantics` 门禁；显式 false、畸形 HTTP/语义字段、畸形探针结构均 fail-closed，HTTP 200 不再自动等于探针成功。
- 旧格式通用探针（缺少 `semantic_ok` 且无 body）保持兼容；旧记录带 body 时按共享 `ops_probe_semantics.py` 推导语义结果。
- 验证：评估器/烟测/preflight/auth 定向测试 `35 passed`；脚本编译与 `git diff --check` 通过；本地 GA `10/10`，Harness release gate `172 passed, 9 skipped`。
- 仍无 staging/生产运行证据；真实 HTTPS/Bearer、双 Worker 强杀/外部回执、连续 14 天 SLO、生产 checkpointer、版本升级/commit/push 均未执行。

## 2026-07-14 Runtime shadow 固定任务重复轮次门禁

- `runtime_shadow_fixture.py` 保留默认 50 条接口，新增 `build_contract_trials()` 和独立轮次 case ID；本地 GA 固定执行 3 轮、共 150 条脱敏契约记录。
- 新增重复轮次唯一性与 0 mismatch 回归；定向 shadow/observe/smoke `34 passed, 8 skipped`，本地 GA `10/10`，Harness release gate `173 passed, 9 skipped`，Runtime shadow `150/150`。
- 这是本地比较/聚合流程稳定性证据，不是真实任务成功率或生产稳定证据；staging HTTPS/Bearer、真实双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和版本发布仍未做，未改版本号、未 commit、未 push。

## 2026-07-14 Runtime 状态阶段与步骤 fail-closed 收口

- `runtime_state_contract.py` 将非失败阶段与连续完成步骤长度绑定：accepted/prepared/executed/verified/completed 对应 0/1/2/3/4 步；failed 允许保留合法前缀。步骤类型先验避免畸形对象在去重时抛未分类异常。
- `append_completed_step` 只允许合法前缀追加下一步，跳步、乱序、损坏前缀 fail-closed；重复追加仍幂等。
- `langgraph_graph.py` 在 prepare/execute/verify/finish 前后统一校验 checkpoint 和回调部分更新；执行失败路由到 finish，不再执行 verify；失败收尾不追加虚构 finish，避免产生 `['prepare', 'finish']` 这类跳阶段状态。
- 验证：Runtime `15 passed, 8 skipped`；相关 shadow/observe/smoke `36 passed, 8 skipped`；Harness release gate `175 passed, 9 skipped`；本地 GA `10/10`（shadow `150/150`、0 mismatch）；本地 preflight `6/6`。
- 当前仍是 shadow、本地证据，不代表 staging/生产稳定；真实 HTTPS/Bearer、双 Worker 强杀/外部回执、连续 14 天 SLO、生产 checkpointer 和版本发布仍待授权，未改版本号、未 commit、未 push。

## 2026-07-14 直连副作用账本对账演练纳入本地 GA

- 新增 `server/scripts/run_direct_action_reconciliation_drill.py`：每 case 使用全新内存 SQLite，无网络/真实凭据，输出机器可读报告并 fail-closed。
- 覆盖成功回放单副作用、幂等键请求冲突、未知结果禁止重试、过期 `in_progress` 转对账、失败结果必须换新键五类语义；新增 `server/tests/test_direct_action_reconciliation_drill.py` 并纳入 HarnessSpec 与本地 GA。
- 验证：定向直连账本/相关测试 `7 passed`；Harness release gate `177 passed, 9 skipped`；本地 GA `11/11`，直连演练 `5/5`，Runtime shadow `150/150` 且 0 mismatch；本地 preflight `6/6`（HarnessSpec 26 个模块）。
- 这仍只是本地可检测性证据，不代表 staging/生产稳定；真实 HTTPS/Bearer、真实数据库双 Worker 强杀/外部回执、连续 14 天 SLO、生产 checkpointer、版本升级/commit/push 仍未执行。

## 2026-07-14 LangGraph checkpoint 历史读取契约补齐

- 发现 `server/app/agent_runtime/agent_run_checkpoint_saver.py` 的 `list()` 只读取最新 checkpoint，导致恢复/审计查询无法遍历历史；这属于本地实现缺口，不涉及 staging 或真实授权。
- 新增 `_langgraph_payloads()`，按独立 checkpoint 表的自增 `id` 以最新到最旧读取全部记录；`list()` 对整段历史实现 `before`、metadata `filter` 和 `limit`，未知 before 边界 fail-closed；保留旧迁移前单条 payload 兼容回退。
- 新增 Runtime 回归：无可选 LangGraph 依赖也能验证历史顺序、筛选、边界与限制，并用真实 SQLAlchemy 表验证多条提交记录读取。
- 先验证 RED（旧实现失败），再验证 GREEN：checkpoint 历史定向 `2 passed`；Runtime/跨进程演练/staging preflight `22 passed, 9 skipped`。
- 本轮仍不升级版本、不 commit、不 push；staging HTTPS/Bearer、真实数据库双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 评审仍留在最后阶段。

## 2026-07-14 checkpoint 历史契约最终本地回归

- 增加未知 `before.checkpoint_id` 的 fail-closed 断言；定向 checkpoint 历史 `2 passed`，相关 Runtime/跨进程演练/preflight `31 passed, 9 skipped`。
- Harness release gate `179 passed, 9 skipped`；本地 GA `11/11`，checkpoint `15/15`、同库恢复 `5/5`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用 `5/5`、Runtime shadow `150/150` 且 0 mismatch；本地 preflight `6/6`。
- 当前仍是本地 `shadow` 证据，staging HTTPS/Bearer、真实数据库双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和版本发布尚未执行；不升级版本、不 commit、不 push。

## 2026-07-14 本地兼容性与全栈回归最终收口

- `KnowledgeFile` 模型构造和列默认统一为 `key_version='v1'`，兼容未传字段的旧调用方；RED→GREEN 后相关后端回归 `36 passed`。
- health 测试改用运行时 `app.version`；迁移测试同步到当前 head `0050_project_task_delivery_activity` 和项目交付表集合。项目任务路由重复 5 次共 `10/10` 通过，未复现全量偶发 405。
- 后端最终全量 `904 passed, 10 skipped`；桌面 `npm run typecheck`、`npm run build` 通过；串行桌面全量 `31 files / 248 tests passed`。默认并发单次超时经单例和单 worker 回归排除为资源竞争，未改业务代码。
- 边界保持不变：仍无真实 staging HTTPS/Bearer、双 Runtime 强杀/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布证据；当前 `shadow`、`runtime_enabled=false`，不升级版本、不 commit、不 push。

## 2026-07-14 本地实施方案门禁复核

- 只读 preflight `python3 scripts/run_staging_preflight.py --mode local --json` 返回 `overall=pass`；HarnessSpec、可选依赖隔离、Runtime 模式、授权、传输和统一 14 天观测参数均通过，当前 `langgraph_runtime_mode=shadow`、`runtime_enabled=false`。
- 本地 GA `python3 scripts/run_ga_gate_local.py --json` 返回 `overall=pass`、`11/11` 通过；Harness release gate `179 passed, 9 skipped`，离线评测 `19/20`（0.95），checkpoint `15/15`，同库恢复 `5/5`，双进程接管 `1/1`，跨进程恢复 `3/3`，混沌 `7/7`，直连副作用对账 `5/5`，Runtime shadow `150/150` 且 0 mismatch。
- 本地开发和可检测门禁没有新增缺口；真实 staging HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀和外部回执对账、连续 14 天 SLO、生产 checkpointer 评审和最终版本发布仍未执行；不升级版本、不 commit、不 push。

## 2026-07-14 staging preflight 迁移图门禁

- `server/scripts/run_staging_preflight.py` 新增只读 `_migration_graph_status`：检查 `alembic.ini`、版本目录、Alembic 可解析性、revision 数量和单一 head；缺失/损坏/多 head 统一 fail-closed，不执行迁移或连接数据库。
- `server/tests/test_staging_preflight.py` 增加多 head 回归；旧实现先 RED，修复后 preflight 与 migrations 定向 `30 passed`。
- 真实仓库 preflight `overall=pass`，head=`0050_project_task_delivery_activity`、revision_count=`51`；本地 GA `11/11`，Harness release gate `180 passed, 9 skipped`。
- 静态迁移图检查不等于目标数据库已升级到 head；真实 staging 迁移确认、HTTPS/Bearer、双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布仍待执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging 证据包汇总门禁

- 新增 `server/scripts/evaluate_staging_evidence.py`，只读汇总 preflight JSON、真实 staging 双 Runtime Worker 恢复报告和 HTTPS 观测 JSONL；不联网、不读 Token、不改数据库。
- 恢复证据要求 schema `1.0`、`environment=staging`、`scope=dual_runtime_process_boundary`、至少 1000 次、恢复率 ≥99.9%，且必须有 Worker A 强杀、Worker B 接管、旧 fencing 拒绝、`dual_owner_incidents=0`、`duplicate_side_effects=0`；本地报告明确拒绝进入 staging 门禁。
- 观测复用 `evaluate_ga_observe` 的语义、SLO、对账和连续窗口规则，并额外要求每条 `base_url` 为 HTTPS；preflight/recovery/observation 任一失败即整体 fail。
- 新增 `server/tests/test_staging_evidence_gate.py`，RED→GREEN 后 `9 passed`；恢复报告补充 `schema_version/scope/environment`，测试加入 HarnessSpec；运维手册和主方案追加执行命令与证据字段。
- 这只把最后阶段的证据收口标准机器化，不产生 staging 证据；真实授权、双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布仍未执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging preflight 与 Bearer 传输契约统一

- 发现 `run_staging_preflight.py` 只检查 `https://` 前缀，未与 `run_ga_observe.py` 的 Bearer origin 校验共享规则；URL user-info、缺少 host 或异常 scheme 可能被错误放行。
- preflight 现在复用 `staging_auth.validate_bearer_transport`；staging 在缺少 Token 环境变量时也先校验 HTTPS origin，local 无 Bearer 的 HTTP 路径保持兼容。输出仅含固定错误类别和 scheme，不泄露 URL 凭据、Token 或环境变量值。
- 新增三类不安全 origin 回归；staging/preflight/auth/证据包/恢复/观测/Harness 相关测试 `54 passed`，本地 GA `11/11`，Harness release gate `186 passed, 9 skipped`，本地 preflight `overall=pass`。
- 这是本地安全门禁修复，不产生 staging 证据；真实 HTTPS/Bearer、双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布仍未执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging 证据包 preflight 完整性收口

- 发现 `evaluate_staging_evidence.py` 只要求 5 个 preflight 检查，漏掉 `langgraph_dependency_isolation` 和 `observation_policy`，不完整 artifact 可能假通过。
- 现在要求完整 7 项检查，拒绝非法结构/重复或非字符串 ID，并验证 `failed_checks`、状态和 `overall` 一致；畸形 artifact 返回 fail-closed，不会让 evaluator 抛异常；没有网络、Token 或数据库副作用。
- RED→GREEN 后，证据包/观测/preflight/auth/smoke 定向 `44 passed`；Harness release gate `188 passed, 9 skipped`；本地 GA `11/11`；脚本 compileall 通过。
- 仍未产生 staging 证据；真实 HTTPS/Bearer、双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布待授权执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging 观测 JSONL 畸形行 fail-closed

- 发现 `evaluate_ga_observe.py::load_rows` 会静默跳过非法 JSON 或非对象行，损坏的观测 artifact 可能被缩短后仍满足连续窗口。
- 新增 `load_rows(..., strict=True)`；最终 `evaluate_staging_evidence.py` 通过 `load_observation_rows` 强制严格读取，非法 JSON/非对象行直接失败且不回显原文；普通 evaluator 读取保持兼容。
- RED→GREEN 后定向观测/证据/preflight/auth/smoke `46 passed`；Harness release gate `190 passed, 9 skipped`；本地 GA `11/11`，preflight `overall=pass`（7 项检查），compileall 与 `git diff --check` 通过。
- 仍未生成 staging 证据；真实 HTTPS/Bearer、双 Worker/外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布待授权执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging 恢复 case 身份唯一性 fail-closed

- 发现恢复 artifact 只校验 `cases` 数量和 `passed`，复制同一成功记录也可能假装完成 1000 次独立演练。
- `evaluate_staging_evidence.py` 现在要求每条 case 有非空唯一身份：优先 `case_id`，兼容 `case`；缺失、空字符串、布尔值、重复身份均 fail-closed，并输出结构/唯一性 detail。
- RED→GREEN 后定向证据/观测/preflight/auth/smoke `48 passed`；Harness release gate `192 passed, 9 skipped`；本地 GA `11/11`；preflight `overall=pass`（7 项检查）；脚本 compileall 通过。
- 恢复统计对非对象 case 使用安全计数，畸形 case 返回结构化 recovery fail，不再抛 `AttributeError`。
- 仍未生成 staging 证据；真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer 和最终发布待授权执行。未改版本号、未 commit、未 push。

## 2026-07-14 staging 恢复报告时间线与 worker 身份契约

- 发现恢复门禁只看强杀/接管/fencing 布尔值，未验证 `run_id`、两个 worker 身份、强杀时间、接管事件和最终终态，无法阻止不可审计的报告通过。
- `evaluate_staging_evidence.py` 现在要求不同的 `worker_a_id/worker_b_id`、非空 `run_id`、带时区 ISO-8601 的 `worker_a_sigkill_at`、指向同一 run 和 Worker B 的 `lease_takeover` 事件（事件时间不得早于强杀时间），以及 `final_status=succeeded`；缺失或矛盾统一 fail-closed。
- 运维手册同步固定 JSON 示例；新增时间线完整性回归。RED→GREEN 后定向 staging/观测/preflight/auth/smoke `53 passed`；Harness release gate `193 passed, 9 skipped`；本地 GA `11/11`；preflight `overall=pass`（7 项）；compileall 通过。
- 仍无真实 staging 证据；HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer、版本升级/commit/push 未执行。

## 2026-07-14 staging 观测行结构与时间戳契约

- 发现 `evaluate_ga_observe.py` 对非对象观测行会抛异常，并接受无时区时间戳；这会破坏连续窗口的可审计性。
- evaluator 现在对非对象行、缺失/非法时间戳、无时区 ISO-8601 时间戳 fail-closed；staging 汇总返回结构化失败，空观测保持 `insufficient_data`。运维手册同步该契约。
- RED→GREEN：新增契约定向 `4 passed`；相关观测/证据/preflight/auth/smoke `53 passed`；Harness release gate `197 passed, 9 skipped`；本地 GA `11/11`；preflight `overall=pass`；后端全量 `923 passed, 10 skipped`；compileall 与目标文件 `git diff --check` 通过。
- 仍未生成真实 staging 证据；HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer、版本升级/commit/push 仍未执行。

## 2026-07-14 当前工作树实施状态复核

- 当前工作树重新验证：local preflight `overall=pass`；local GA `overall=pass`、`11/11`；Harness release gate `197 passed, 9 skipped`；后端全量仍为 `923 passed, 10 skipped`。
- 没有新增本地实现缺口；`real` runtime 继续 `runtime_enabled=false`/fail-closed。最终稳定仍需真实 staging HTTPS/Bearer、双 Worker 强杀接管与 fencing/外部副作用对账、连续 14 天 SLO、生产 checkpointer 和灰度/回滚证据。
- 本轮没有生成 staging 证据、没有读取 Token、没有改版本号、没有 commit/push。

## 2026-07-14 版本自动化与发布边界复核

- 父仓库已有统一版本自动化：按提交类型升 major/minor/patch，按受影响系统同步版本源和声明目标，post-commit 自动 amend 版本前缀并推送当前分支；桌面 `agent:version` 对六处版本文件做原子同步。
- `npm run test:versioning`：`56/56` 通过；桌面脚本 `node --test scripts/tests/*.test.mjs`：`69/69` 通过，覆盖版本同步、回滚、push/upstream、产物和发布安全契约。
- 本轮没有调用版本升级、没有 commit/push；真实发布必须单独授权并提供灰度/回滚证据。真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管、外部副作用对账、连续 14 天 SLO、生产 checkpointer 评审仍未完成；`real` 继续关闭。

## 2026-07-14 按 run_id 的运维控制闭环

- 本轮审计发现一个本地可实现缺口：缺少管理员按 `run_id` 的查看、暂停、恢复和内部 checkpoint 回滚闭环。
- 已实现详情、暂停、恢复、回滚接口；全部管理员保护并写 request audit。暂停幂等，运行态重复恢复不再重新启动 runtime；native runtime 对 paused 状态持久化阻断。
- 回滚只恢复内部安全 checkpoint，返回 `resume_source=ops_rollback` 和 `side_effects_reversed=false`；无安全 checkpoint 返回 409，不声称撤销外部副作用。
- `server/tests/test_ops_run_control.py` 当前 `6 passed`；相关服务/checkpoint/runtime/ops 回归 `81 passed`；后端全量 `929 passed, 10 skipped`。
- Harness release gate `197 passed, 9 skipped`；本地 GA `11/11`，恢复/混沌/Runtime shadow 等本地门禁均通过，shadow `150/150` 且 0 mismatch。
- 真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀与外部回执、连续 14 天 SLO、生产 checkpointer、灰度/回滚证据仍未执行；不读取 Token、不改版本号、不 commit、不 push。

## 2026-07-14 运维控制发布门禁与桌面入口闭环

- 复核发现 `test_ops_run_control.py` 没有进入 HarnessSpec 发布清单，桌面 OpsDashboard 也缺少按 `run_id` 的实际操作入口；两处均属于可在本地完成的稳定性收口缺口。
- `server/harness_spec.json` 已注册运维控制测试，并新增发布门禁自检；旧配置先 RED，修复后门禁定向 `7 passed`。Harness release gate 最终为 `204 passed, 9 skipped`，执行清单明确包含运维控制契约。
- 桌面客户端和 OpsDashboard 已支持查询单 Run，并执行 pause/resume/rollback；界面展示状态、阶段、进度、范围化 reconciliation、步骤/事件，并在控制操作后读取服务端真实状态。
- 界面与测试明确 `side_effects_reversed=false`：rollback 只恢复内部 checkpoint，不能当成外部消息、扣费等副作用已撤销；应先 reconciliation，不能盲目重发。组件 RED→GREEN 后 `2 passed`。
- 相关后端回归 `20 passed`；桌面全量 `33 files / 256 tests passed`，typecheck 和 production build 通过；HarnessSpec JSON、后端 compileall、目标文件 `git diff --check` 通过。构建只有既有的大 chunk 非阻断警告。
- 真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管、旧 Worker fencing、外部回执/副作用对账、连续 14 天 SLO、生产 checkpointer、灰度/回滚证据仍未执行；`real` runtime 保持关闭，不改版本号、不 commit、不 push。

## 2026-07-14 staging 发布证据第四工件门禁

- 审计发现 `evaluate_staging_evidence.py` 原先只汇总 preflight、恢复和连续观测三份 artifact；没有迁移记录、测试报告、灰度数据、回滚演练或生产 checkpointer 评审时仍可能假通过。
- 现已强制增加 `--release` 第四份 artifact，并要求同时提供 `migration`、`tests`、`canary`、`rollback_drill`、`production_checkpointer_review` 五段证据。缺段、环境/时间矛盾、字符串冒充数字、迁移非单 head、测试有失败、灰度回退、P0/P1/重复副作用/双 owner 非零、回滚超过 900 秒或 checkpointer 不支持持久化/多实例/fencing，均 fail-closed。
- 运维手册已同步机器可读 JSON 契约，明确示例不是真实放行证明；汇总器只读，不联网、不读 Token、不改数据库。
- TDD：初始 RED `14 failed, 2 passed`，严格数字类型补测 RED `1 failed, 16 passed`；最终证据门禁 `17 passed`，相关回归 `64 passed`，Harness release gate `208 passed, 9 skipped`，后端全量 `934 passed, 10 skipped`，compileall 和帮助入口通过。
- 仍无真实 staging/生产证据；HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与外部回执、连续 14 天 SLO、生产 checkpointer 评审、灰度/回滚演练继续留到最后。`real` runtime 保持关闭，未改版本号、未 commit、未 push。

## 2026-07-14 灰度阶段证据与 48 小时门禁对齐

- 对照主方案复核发现，发布门禁仍接受旧的 `5/20/50/100` 数组，没有证明内部账号、1% 阶段、每阶段至少 48 小时、有效样本和连续时序，存在不完整证据假通过的风险。
- `release` 工件已升级为 schema `1.1`，强制 `internal(0%) → 1% → 5% → 20% → 50% → 100%` 六阶段严格顺序；每阶段必须有带时区起止时间、至少 48 小时、`finished_runs` 为 JSON 正整数且状态通过。缺项、错序、错比例、重叠、零样本、字符串数字、canary 首尾不一致以及旧 schema/旧百分比数组均 fail-closed。
- 运维手册示例已同步。TDD 从 `3 failed, 16 passed` 开始；修正测试工件版本后为 `1 failed, 18 passed`；最终定向 `19 passed`、相关回归 `70 passed`、Harness release gate `210 passed, 9 skipped`、后端全量 `936 passed, 10 skipped`，compileall 与示例 JSON 解析通过。
- 本轮只增强证据门禁，不联网、不读 Token、不改数据库。真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing/外部回执、生产 checkpointer、完整灰度/回滚和连续 14 天 SLO 仍待最后执行；`real` runtime 保持关闭，未改版本号、未 commit、未 push。

## 2026-07-14 staging 证据同源与恢复语义门禁（进行中）

- 复核发现四份独立合法的 artifact 可以来自不同发布批次或不同 staging 地址，并且 release 工件只覆盖 12 天也可能借用 14 天 observation 假通过；发布事件时间也未强制按迁移、测试、灰度开始、灰度完成、回滚/评审的顺序排列。
- 已为 preflight、恢复报告、观测 JSONL 和 release 工件统一增加 `release_id` 与规范化 `base_url`；staging preflight 和 Bearer 观测采集要求显式发布身份。恢复 schema 升为 `1.1`，release schema 升为 `1.2`。
- 证据汇总新增第五项 `evidence_coherence`：四份工件必须同一发布、同一 HTTPS 环境；preflight 必须早于灰度，恢复演练和每条观测必须落在灰度窗口内，灰度总时长必须达到连续观测要求；发布时间线必须有序。
- TDD 初始为 `7 failed, 18 passed`，采集侧契约补测还因缺少 `normalize_release_id` 在收集阶段失败；最小实现后 staging 证据/preflight/auth/观测定向回归为 `68 passed`。
- 本节仍在收尾：待补非法顶层 artifact 的 fail-closed 边界、同步运维手册/脚本帮助、运行相关门禁和后端全量回归，再把最终结果追加到主方案和本记忆文件。没有联网、读取 Token、修改数据库、版本号、commit 或 push；真实 staging 证据仍留到最后授权执行。

## 2026-07-14 staging 证据同源门禁回归与顺序污染排查（进行中）

- 非对象顶层 preflight/recovery/release artifact 已补 fail-closed 回归，RED 时 3 个 `AttributeError`，最小修复后定向 `3 passed`；证据同源、preflight、认证和观测四组最终 `71 passed`。
- 运维手册与脚本帮助已同步 release schema `1.2`、recovery schema `1.1`、统一 `release_id/base_url`、14 天窗口和有序发布时间线；release 示例通过 JSON 解析，四个脚本 compileall 通过。
- 相关 staging/GA/Harness 测试 `87 passed`；Harness release gate `227 passed, 9 skipped`。
- 后端全量回归得到 `7 failed, 971 passed, 10 skipped`，7 个失败全部位于 `test_professional_deliverables_api.py`；该模块单独运行 `7 passed`，且本轮未修改该业务子系统，初步判断为前序测试遗留全局状态导致的顺序依赖。
- 下一步只用最小测试组合定位污染源；在复现与根因确认前不修改专业交付业务代码。没有联网、读取 Token、修改数据库、版本号、commit 或 push；真实 staging 仍待最后授权。

## 2026-07-14 全量回归并发写入校正（进行中）

- 二分测试最初看似能由任一前序模块触发专业交付失败，但随后发现这不是稳定的测试顺序污染：`server/app/professional_delivery/routes.py`、`service.py`、`schemas.py` 和对应测试在 pytest 运行期间被另一项工作连续更新。
- 时间证据为路由 `21:14:17`、服务 `21:13:53`、Schema `21:12:35`、测试 `21:10:51`；测试数量由 7 个增长到 11 个。旧 pytest 进程导入了更新前路由，因此看不到随后加入的 `from_version/to_version` 审计字段。
- 当前路由源文件已经包含 `deliverable_version_created` 的 `from_version`、`to_version` 和 `status`。本任务不修改这些未跟踪的专业交付文件，避免覆盖或混入外部工作。
- 下一步在文件稳定后用全新 pytest 进程先验证该模块，再运行后端全量；只有新的完整回归结果可作为证据。真实 staging、Token、数据库、版本号、commit 和 push 均未触碰。

## 2026-07-14 staging 证据同源门禁本地收口

- 专业交付模块在外部工作继续扩展后最终稳定为 13 个测试；全新进程 `13 passed`，运行前后四个目标文件 SHA-256 不变。
- 以当前稳定快照重新运行后端全量，得到 `984 passed, 10 skipped in 188.84s`；`app/tests/scripts/alembic` 中 Python、JSON、INI 源文件的运行前后聚合 SHA-256 均为 `3ff8d30beb5ec2304389c6c3864bc5b9a8be9da7d5e47339d305b7e4ef0d469e`，排除了测试期间再次并发改写。
- staging 证据同源实现已完成本地收口：统一 `release_id/base_url/generated_at`，recovery schema `1.1`、release schema `1.2`，第五项 `evidence_coherence`，14 天 canary 和有序发布时间线；非法顶层 artifact fail-closed。定向 `71 passed`，相关回归 `87 passed`，Harness release gate `227 passed, 9 skipped`。
- 主方案已追加第 54 节。真实 staging HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执/副作用对账、完整灰度/回滚、生产 checkpointer 和连续 14 天 SLO 仍按用户决定留到最后。未联网、未读 Token、未改数据库、未改版本号、未 commit、未 push。
## 2026-07-14 本地 GA 暴露恢复密钥顺序依赖（演练修复已收口）

- 本地 preflight：8/8 通过；HarnessSpec 共 28 个模块，迁移头为 `0050_project_task_delivery_activity`，revision 数 51，运行模式为 `shadow`，`runtime_enabled=false`，本地授权与发布标识检查符合预期，最短观察期 14 天。
- `python3 scripts/run_ga_gate_local.py --json`：10 个 gate 通过、1 个 gate 失败。离线评测 19/20、checkpoint 15/15、多实例 5/5、双进程 1/1、进程恢复 3/3、connector/security/chaos/direct-action/shadow 均通过。
- 失败 gate 为 `harness_release_spec`：`1 failed, 226 passed, 9 skipped`。失败用例 `tests/test_ops_run_control.py::test_ops_pause_is_idempotent_and_resume_continues_run`，恢复接口返回 422：`任务请求无法解密，不能恢复`。
- 当前主要假设：测试辅助服务使用硬编码 `base64(k*32)` 加密请求，而 ops API 使用应用设置中的 `content_encryption_key` 解密；某些测试顺序或设置缓存使两者不一致，暴露恢复语义的顺序依赖。
- 下一步：检查 `tests/conftest.py`、配置缓存、`app/ops_routes.py` 与前置 Harness 测试的密钥修改；先以单用例和最小前缀复现，再决定是修测试夹具还是生产配置读取。尚未修改业务代码，也未访问 staging、网络、令牌或数据库外部环境。
- 根因已确认：`run_ga_gate_local.py` 为演练进程设置独立测试密钥并由 Harness 子进程继承，而 `test_ops_run_control.py::_service()` 固定使用另一把测试密钥；直接全量测试时 `conftest.py` 的默认值恰好与硬编码一致，掩盖了环境契约错误。生产路由始终通过 `Settings` 依赖读取同一配置，未发现生产解密路径错误。
- TDD：以 GA 测试密钥显式运行单用例，旧夹具稳定得到 422（`1 failed`）；最小修复仅让测试服务复用 `get_settings().content_encryption_key`。修复后同条件单用例 `1 passed`、运维控制模块 `6 passed`、Harness release gate `227 passed, 9 skipped`，本地 GA `11/11` 全部通过。
- 随后的后端全量曾得到 `987 passed, 10 skipped`，但运行前后源文件聚合 SHA-256 从 `9e77a77b...` 变为 `7a8d36d0...`，因此该结果已主动判为无效，不作为最终稳定证据。
- 并发变化来自本任务范围外的未跟踪专业交付开发；本任务没有修改或覆盖这些文件。文件稳定后用新进程重跑专业交付/评审定向测试为 `22 passed`；以同一稳定快照重跑后端全量为 `993 passed, 10 skipped in 242.18s`。全量前后及最终 GA 后，`app/tests/scripts/alembic` 中 Python、JSON、INI 文件的聚合 SHA-256 均为 `b48acea43b8fd958d7f602480c1479cecc09af99ca4fe85f463822f19417b893`，因此最新全量证据有效。
- 最新快照 local preflight `8/8`、local GA `11/11`；Harness release gate `227 passed, 9 skipped`，checkpoint `15/15`、同库多实例恢复 `5/5`、双进程接管 `1/1`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 上述全量与 GA 对摘要为 `b48acea...` 的稳定快照有效。随后范围外的专业审批功能又新增测试和模型，当前摘要变为 `cec0528c...`；定向测试显示既有专业交付/评审 `22 passed`，新增审批 `5 failed`，均为接口尚未注册导致的 405。当前工作树仍在被并发功能修改，不能把旧全量结果冒充为当前全量已通过；本任务不修改这些范围外文件，也不在它们未闭环时重复执行全量。
- 尚未访问 staging、网络、令牌或外部数据库，未改版本号，未 commit/push；真实 staging 与 14 天观测仍留到最后。

## 2026-07-14 固定 50 核心任务真实证据契约收口

- 已确认现有 Runtime shadow `150/150` 是本地合成对照，不可作为 staging 真实执行证明。新增 `server/app/agent_runtime/core_task_catalog.json`，固定 50 个任务、5 类各 10 个，并以 SHA-256 绑定证据。
- 新增 `server/app/agent_runtime/core_task_evidence.py` 和 `server/tests/test_core_task_evidence.py`：只接受 `staging_runtime_execution`、`synthetic=false`、每任务至少 3 次、150 个完整 task/trial 对、唯一 run ID、真实 trace、完成时间线、隔离、零重复副作用，并要求候选成功率不低于基线。
- `server/scripts/evaluate_staging_evidence.py` 的 release schema 已升为 `1.3`，强制 `core_task_evaluation`，校验同一 release/base URL 以及 `migration ≤ tests ≤ core tasks ≤ canary`；HarnessSpec 和 release gate 已注册该契约，运维手册已同步。
- RED→GREEN：初始缺模块；时间线补测曾为 `1 failed, 17 passed`；最终核心/证据汇总/HarnessSpec/发布门禁定向 `48 passed`，compileall 与 JSON 解析通过。当前 Harness release gate `238 passed, 9 skipped`，local preflight `8/8`，local GA `11/11`。
- 这仍只是本地证据验证器和固定目录，未生成真实 staging 数据。真实 HTTPS/Bearer、双 Worker/双 Runtime 强杀接管与 fencing、外部回执、固定 50 任务至少 150 次真实执行、生产 checkpointer、完整灰度/回滚和连续 14 天 SLO 留到最后。
- 当前范围外的专业导出代码仍在并发变化；最近定向 `53 passed, 2 failed`，剩余为下载请求经开发代理返回 502。因此不声明当前工作树全量稳定，本任务不覆盖或修改该模块。未改版本号，未 commit，未 push。

## 2026-07-14 核心任务局部回归与指标对比门禁

- 复核发现真实核心任务证据只比较 150 个 case 的总体成功率，任务 A 的改善可能掩盖任务 B 的退化；成本、步数、延迟和人工介入也没有形成汇总结果。
- `server/app/agent_runtime/core_task_evidence.py` 已按 50 个任务和 5 个类别重新计算成功率分布，任一任务候选成功率低于 Native 即 fail-closed；同时输出成本、步数、延迟、平均人工介入次数和人工介入 case 比例的基线/候选均值及差值。
- 未给成本等指标擅自新增阈值；它们用于可检测对比，已有预算、超时、重复副作用和成功率硬门禁保持独立。
- TDD 初始为 `2 failed, 10 passed`，人工介入率补测也得到预期 RED；核心与 staging 集成 `41 passed`。Harness release gate `240 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`；compileall、两个 JSON 解析和目标文件 `git diff --check` 均通过。
- 未访问 staging、网络、Token 或外部数据库，未切换 Runtime，未改版本号，未 commit/push。真实 150 次执行、双 Worker/双 Runtime 故障演练、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 继续留到最后。

## 2026-07-14 核心任务 trace 防复用门禁

- 审计发现 `core_task_evidence.py` 只校验 `evidence_ref` 非空，同一条 trace 可复制到多个 case，无法证明 150 个 task/trial case 分别有可追溯执行证据。
- 新增 `evidence_trace_unique_ok`，要求规范化后的 trace 引用数量与 case 数一致且全局唯一；重复 trace 会同时阻断核心评测和 staging release 聚合。没有新增输入字段，schema 维持 core evidence `1.0`、release `1.3`。
- TDD 旧实现为 `2 failed, 40 passed`，修复后核心与 staging 证据测试 `42 passed`；Harness release gate `241 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 仍未访问 staging、网络、Token 或外部数据库，未切换 `real` runtime，未改版本号，未 commit/push。真实唯一 trace 内容、150 次执行、双 Worker/双 Runtime 强杀与 fencing、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 继续留到最后。

## 2026-07-14 副作用任务隔离域防复用门禁

- 审计发现固定 50 任务证据仅阻止同一 case 的 Native/LangGraph 共用 `isolation_id`，30 个副作用任务仍可跨任务、跨轮次复用同一隔离域，无法证明 180 次副作用 Runtime 执行彼此独立。
- `server/app/agent_runtime/core_task_evidence.py` 新增 `side_effect_isolation_unique_ok`，要求副作用任务数 × `trial_count` × 2 个 Runtime 的隔离 ID 数量完整且全局唯一；非副作用任务不参与该唯一性门禁。
- 测试夹具已改为每个 task/trial/runtime 独立隔离 ID；旧实现 RED 为 `3 failed, 40 passed`，实现后核心与 staging 证据测试 `43 passed`。Harness release gate `242 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 没有新增输入字段，schema 保持 core evidence `1.0`、release `1.3`。未访问 staging、网络、Token 或外部数据库，未切换 Runtime，未改版本号，未 commit/push；真实隔离域生命周期、固定 50 任务 150 次真实执行、强杀/fencing、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 继续按约定留到最后。

## 2026-07-14 核心任务证据执行窗口同源门禁

- 审计发现 release 只约束核心评测报告的完成时间，未约束 150 条 case 必须在本次测试批次后执行；旧发布执行记录可被重新包装并误放行。
- `server/app/agent_runtime/core_task_evidence.py` 新增 `execution_not_before` 与机器结果 `execution_window_ok`；`server/scripts/evaluate_staging_evidence.py` 传入当前 `tests.completed_at`，将每条 case 限定在 `[tests.completed_at, core_task_evaluation.completed_at]`。
- TDD 旧实现为 `2 failed, 43 passed`，最小修复后核心与 staging 证据测试 `45 passed`；复核机器字段的窗口上界语义时又先得到 `1 failed`，补齐回归后最终为 `46 passed`。Harness release gate `245 passed, 9 skipped`，local preflight `8/8`、local GA `11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 输入 schema 不变，core evidence 保持 `1.0`、release 保持 `1.3`。未访问 staging、网络、Token 或外部数据库，未切换真实 Runtime，未改版本号，未 commit/push；真实 150 次执行、故障演练、外部回执、生产 checkpointer、灰度/回滚和连续 14 天 SLO 仍留到最后。
