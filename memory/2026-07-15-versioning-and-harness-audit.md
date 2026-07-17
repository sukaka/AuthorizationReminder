# 2026-07-15 版本自动化与 Harness 复核

## 已完成

- 审计版本注册表、独立 `VERSION` 源、SemVer 大/小/补丁规则、路径归属、同步、漂移检测、回滚、commit-msg/post-commit 钩子和自动推送实现；未发现需要改代码的缺口。
- `npm run test:versioning`：56 passed；`node --test juxin-ai-assistant/apps/desktop/scripts/tests/*.test.mjs`：69 passed。
- `python3 scripts/run_harness_release_gate.py`：247 passed, 9 skipped。
- `python3 scripts/run_staging_preflight.py --mode local --json`：overall=pass，8/8；迁移图单 head `0050_project_task_delivery_activity`，51 revisions。
- `python3 scripts/run_ga_gate_local.py --json`：overall=pass，11/11；Harness release gate 247 passed/9 skipped；Runtime shadow 150/150、0 mismatch。
- 版本目标漂移为 0；根目录 JSON、目标文件 `git diff --check`、`.githooks` 配置和钩子可执行性通过。

## 边界与后续

- 本地证据只证明契约和离线演练可检测，不代表生产稳定。
- staging HTTPS/Bearer、真实数据库双 Worker/双 Runtime 强杀与 fencing、外部副作用回执/对账、固定 50 任务 3 轮真实执行、生产 checkpointer、灰度/回滚、连续 14 天 SLO 仍最后执行。
- 当前工作树有大量本任务外改动；本轮没有改版本号、commit 或 push。任何发布必须先只暂存相关文件，再按版本规则提交并推送。

## 演练入口复核（追加）

- `docs/ops-runbook-6.0-7.0.md` 和 `docs/checkpoint-multi-instance-drill.md` 已提供演练用途、命令、证据格式及本地/真实 staging 边界；未发现需要新增本地 runner 的缺口。
- `python3 scripts/run_staging_preflight.py --mode local --json`：`overall=pass`。
- `python3 scripts/run_ga_gate_local.py --json`：`overall=pass`、`11/11`；Runtime shadow `150/150`、`0 mismatch`。
- `python3 scripts/run_harness_release_gate.py`：`247 passed, 9 skipped`。
- 本次仅更新实施记录，不改业务代码、版本号、提交或远程分支。

## 固定任务误拦截/漏拦截率契约（追加）

- 审计发现固定 50 任务证据只有运行结果，没有独立真值，无法计算 FP/FN；已补 `classification_review` fail-closed 契约。
- `server/app/agent_runtime/core_task_evidence.py` 内层证据 schema 升为 `1.1`，要求独立复核来源、带时区复核时间、复核人和完整 `50×3×2=300` 条 Native/LangGraph 标签；重新计算 TP/TN/FP/FN、FP rate、FN rate。
- `server/tests/test_core_task_evidence.py`：19 passed；`server/tests/test_staging_evidence_gate.py`：29 passed。
- `docs/ops-runbook-6.0-7.0.md` 和实施计划第 63 节已同步公式、覆盖要求、无临时阈值和 fail-closed 边界。
- 这些是本地契约/夹具验证，不是 staging 真实数据；真实独立复核、HTTPS/Bearer、双 Worker 强杀接管、外部回执、生产 checkpointer、灰度/回滚和 14 天 SLO仍留到最后。未改版本号、未 commit、未 push。

## 桌面成果工作台演练闭环（追加）

- 初次桌面端全量演练发现成果工作台 UI 只有静态展示，缺少事实确认、证据检索、审阅定位、版本对比和审批流动作；这是实际功能缺口，不是后端门禁误报。
- `juxin-ai-assistant/apps/desktop/src/pages/ProfessionalDeliverablesPage.tsx` 已补齐最小闭环：所有写操作绑定当前行版本、不可变版本和内容哈希；审批按钮严格受 `allowed_actions` 控制；提交只使用已发布项目审批流版本；退回要求原因并可关联评论。
- 定向 `npm test -- --run tests/professional-deliverable-workbench.test.tsx`：`3/3`；`npm run typecheck`：通过；桌面全量 `npm test`：`36` 文件、`265/265` 通过。Node localstorage 路径和 jsdom 导航警告仍存在，但不影响测试结果。
- 与后端稳定快照、Harness `247 passed/9 skipped`、preflight `8/8`、GA `11/11`、Runtime shadow `150/150` 合并后，本地可检测闭环已收口；真实 staging、生产接管/fencing、外部回执对账、50 任务真实执行、checkpointer、灰度/回滚、14 天 SLO 仍最后执行。
- 本轮未改版本号、未 commit、未 push；工作树仍有大量并发未跟踪改动，任何发布必须先只暂存相关文件。

## 本地门禁再次复核（追加）

- 当前工作树 `run_staging_preflight.py --mode local --json`：`overall=pass`、8/8；迁移图单 head `0050_project_task_delivery_activity`、51 revisions；Runtime 仍为 `shadow`/`runtime_enabled=false`。
- `run_ga_gate_local.py --json`：`overall=pass`、11/11；Harness `247 passed, 9 skipped`，Runtime shadow `150/150`、0 mismatch，checkpoint/接管/混沌/直连对账均通过。
- 桌面成果工作台定向演练 `3/3`，类型检查通过；未发现新的本地实现缺口。
- 该复核只更新记录，不产生真实 staging 证据；HTTPS/Bearer、双 Worker 强杀/fencing、外部回执对账、50 任务真实执行、生产 checkpointer、灰度/回滚和 14 天 SLO 仍待最后授权。未改版本号、未 commit、未 push。

## 专业审批与交付后端复核（追加）

- 针对旧记录中的审批接口 `405` 风险，当前快照定向运行专业审批、交付、事实/证据、审阅、导出和领域测试，共 `57 passed`。
- 该结果证明当前本地审批/交付契约与桌面工作台可以对接；不替代 staging/生产证据。未修改业务代码、版本号、commit 或 push。

## HarnessSpec 发布测试路径收口（追加）

- 收紧 `server/app/harness_spec.py`：发布测试模块必须是位于 `tests/` 下的唯一相对文件路径，拒绝绝对路径、路径穿越、符号链接逃逸和重复项。
- `server/scripts/run_harness_release_gate.py` 同步拒绝重复模块，启动校验与实际执行门禁保持一致。
- 定向 HarnessSpec/发布门禁/注册审批测试 `20 passed`；完整 Harness release gate `248 passed, 9 skipped`。
- 仅完成本地校验收口；真实 staging 授权、强杀接管/fencing、外部回执对账、固定 50 任务真实执行、生产 checkpointer、灰度/回滚和 14 天 SLO 仍待最后阶段。未改版本号、未 commit、未 push。

## 本地演练请求桩与桌面回归收口（追加）

- Web 模式个人模型保存测试在桌面全量并发时曾偶发超时；根因是 App 默认挂载的 ChatPage 发起 5 个只读请求，而该测试没有声明 MSW 桩。
- `apps/desktop/tests/web-mode.test.tsx` 已补齐项目、会话、长任务、知识库分类和文档类型的空响应桩；`apps/desktop/tests/professional-delivery-api.test.ts` 的 `onEvent` 回调改为显式块体，保持事件收集行为并满足 `void` 契约。
- 证据：Web 模式与专业交付定向测试 `7/7`；桌面全量 `36` 文件、`267/267`；`npm run typecheck` 通过。未再出现未处理请求日志；Node localstorage 路径和 jsdom 导航警告仍是运行器噪声。
- 这些改动只提高本地演练的可重复性，不代表 staging/生产稳定；HTTPS/Bearer、强杀接管/fencing、外部回执对账、固定 50 任务真实执行、生产 checkpointer、灰度/回滚和 14 天 SLO 仍待最后阶段。未改版本号、未 commit、未 push。

## 最后阶段边界与当前快照复核（追加）

- 无 Token 的 staging 预检使用占位 HTTPS 地址执行，结果 `overall=fail` 且唯一失败项为 `authorization`；没有网络请求、没有读取或打印 Token，证明真实环境保持 fail-closed。
- 当前本地 preflight `8/8`，Harness release gate `248 passed, 9 skipped`，local GA `11/11`；GA 细项包括离线评测 `19/20`、checkpoint `15/15`、同库恢复 `5/5`、双进程接管 `1/1`、跨进程恢复 `3/3`、混沌 `7/7`、直连副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 桌面定向回归 `10/10`、类型检查通过，根仓库版本自动化 `56/56`。当前没有发现可在本地安全补齐的新缺口。
- 最后阶段仍必须由授权后的真实 staging/生产执行证明，不能用本地结果替代；未改版本号、未 commit、未 push。

## 运维灰度入口边界修正（追加）

- 运维手册原先把看板快捷阶梯写成 `5% → 20% → 50% → 100%`，但最终发布证据要求严格的 `internal → 1% → 5% → 20% → 50% → 100%`；已明确前者只是操作入口，不能作为最终放行证据。
- 已补充每阶段至少 48 小时、状态 `passed`、完成运行数大于 0、带时区且不重叠，以及总窗口至少覆盖默认 14 天连续观测的说明；新增 runbook 契约测试，`3 passed`。
- 仍未触发真实 staging、授权、版本变更、commit 或 push。

## 文档边界修正后的门禁复核（追加）

- Harness release gate：`249 passed, 9 skipped`；local GA gate：`overall=pass`、11/11，Runtime shadow `150/150`、`0 mismatch`。
- 计数变化来自新增的 runbook 灰度边界契约测试，不代表真实 staging/生产通过；生产连续观测仍是 GA 前置条件。

## HarnessSpec 示例唯一键回归（追加）

- 复核方案第 9 节 YAML 示例时，当前 `stop_rules` 已只有一个定义；没有对不存在的重复文本做改写。
- `server/tests/test_harness_spec.py` 新增回归，锁定示例唯一 `stop_rules` 及 `duplicate_action_limit`、`no_progress_window` 字段。
- 定向测试 `11 passed`；Harness release gate `249 passed, 9 skipped`；local GA `11/11`，Runtime shadow `150/150`、`0 mismatch`。
- 只增加本地契约检测；未触发 staging/授权、未改版本号、未 commit、未 push。生产连续 `evaluate_ga_observe` 仍是 GA 前置条件。

## 后端全量回归收口（追加）

- 从 `juxin-ai-assistant/server/` 执行 `python3 -m pytest -q`：`1053 passed, 10 skipped`。
- 当前本地状态/工具/恢复/证据/运维与业务 API 回归无失败，没有发现新的本地实现缺口。
- 真实 staging/生产证据仍未执行；`real` runtime 保持关闭和 fail-closed。未改版本号、未 commit、未 push。

## 统一契约调用链审计（追加）

- Native 通过 `AgentRunService` 使用 RunState v1、集中状态机、checkpoint、租约/fencing 和工具账本；LangGraph pilot 使用四阶段 `runtime_state_contract`，并通过 `LangGraphServiceBinding` 复用同一持久化、租约、工具和评价器；`NativeLangGraphAdapter` 委托 NativeRuntime 业务链路，未复制业务规则。
- `select_runtime` 对未满足生产就绪条件的 `real` 后端 fail-closed，默认生产仍为 NativeRuntime；未发现新的本地契约旁路，因此不做强行底层重构。
- 定向回归：`tests/test_runtime_shadow.py tests/test_run_state_contract.py tests/test_agent_runtime.py`，`61 passed, 8 skipped`。
- 只完成本地调用链审计与记录；staging/生产授权、强杀接管/fencing、外部副作用对账、生产 checkpointer、50 任务真实执行、灰度/回滚、14 天 SLO 仍待最后阶段。未改版本号、未 commit、未 push。

## 工具契约非对象输入/输出 fail-closed（追加）

- `PolicyGate` 现在对输入和输出的非对象值统一拒绝；`ToolRegistry` 在动态 spec 解析前拒绝非法输入，避免副作用工具执行非法载荷。
- `_summarize_input` 对非对象只记录类型名，错误日志路径不再因 `.items()` 触发二次异常。
- 非对象成功输出继续进入 `TOOL_OUTPUT_SCHEMA_INVALID` → `reconciliation_required`，不允许安全回放。
- PolicyGate 状态按错误语义区分 `forbidden`、`confirmation_required` 和 `error`，schema/持久化错误不再错误地提示确认。
- 工具契约与 Agent Runtime 回归 `53 passed`；Harness release gate `251 passed, 9 skipped`；未访问 staging、未读取 Token、未改版本号、未 commit、未 push。

## 迁移父链授权阻断与本地回归复核

- 修复未跟踪 `0051_professional_delivery` 的 `sa.SchemaItem` 运行时类型引用，使用 `sqlalchemy.schema.SchemaItem`，未改变迁移父链。
- 由于 `0046 -> 0026`、独立 `0045` 和 `0051 -> 0050` 当前形成两个 head，且设计要求先确认共享环境实际迁移历史，本轮不擅自改历史迁移。
- 排除 `tests/test_migrations.py` 的后端回归为 `1031 passed, 10 skipped`；本地 preflight fail-closed，唯一失败为 `migration_graph`，heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`。
- 复核后的 Harness release gate 为 `251 passed, 9 skipped`，local GA 为 `11/11`；两者均不替代迁移父链授权与真实 staging 证据。
- 未访问 staging、未读取 Token、未改版本号、未 commit、未 push。

## 评论级动作契约补齐（追加）

- 成果级 `allowed_actions` 已覆盖生命周期动作；“解决评论”按评论作者/项目复核角色授权，已改为评论响应中的 `allowed_actions`，避免把对象级权限误报成成果级全局能力。
- 服务端 `DeliverableCommentOut` 返回 `resolve_comment`（仅评论作者、个人所有者或项目复核角色且评论仍 open），桌面工作台按该字段显示解决入口。
- 定向专业审批/交付/领域测试 `39 passed`；桌面工作台测试 `3 passed`；桌面 `npm run typecheck` 通过。
- 仍未触发 staging/授权、迁移父链决策、版本升级、commit 或 push。

## 任务详情路由契约冲突修复与全量收口（追加）

- `/api/ai/runs` 的专业路由先注册公共详情路径，普通任务因此被专业查询拦截并 404；已按 `run_type` 分流共享详情入口，并让通用路由优先匹配公共详情、事件和取消路径，专业专属路径保持不变。
- 专业取消分支改走专业路由模块的审计写入函数，保留既有审计失败回滚语义。
- 定向路由回归 `16 passed`；后端排除迁移测试 `1033 passed, 10 skipped`；桌面全量 `36 files / 271 passed`；桌面类型检查通过。`assistant-modes-admin` 以 `15s` 超时单独复跑通过，确认不是业务失败。
- 当前迁移 heads 仍为 `0045_agent_langgraph_checkpoints`、`0051_professional_delivery`，所以迁移门禁保持 fail-closed；未访问 staging、未读取 Token、未改版本号、未 commit、未 push。

## 共享事件入口的专业契约分流（追加）

- 通用路由优先后，专业任务公共 `/events` 也由共享处理器接收；已在该入口按 `run_type` 分流，专业任务先校验 `ProfessionalRunBinding`，再使用 `ProfessionalRunnerService.event_payloads/public_run`，普通任务保持 `AgentRunService` 逻辑。
- 专业/通用相关模块 `13 passed`；后端排除迁移测试 `1034 passed, 10 skipped`；Harness `251 passed, 9 skipped`；桌面类型检查通过。
- 桌面全量为 `36` 文件、`270 passed / 1 failed`，唯一失败是脏工作树已有 `skills-page` 文本断言与当前 DOM 文本节点边界不一致；本轮未改桌面文件，发布前需单独处理该缺口。
- 当前 preflight 仍只因双 migration head fail-closed；local GA `11/11`、Runtime shadow `150/150`、`0 mismatch`。真实 staging/授权、迁移父链、版本、commit/push 继续不动。

## 本轮最终门禁口径校正（追加）

- 当前最终后端口径为 `python3 -m pytest -q tests --ignore=tests/test_migrations.py`：`1034 passed, 10 skipped`；Harness `251 passed, 9 skipped`；local GA `overall=pass`、11/11，Runtime shadow `150/150`、`0 mismatch`。
- local preflight 唯一失败仍为 `migration_graph`，heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`；未擅自改迁移父链。
- 桌面类型检查通过；桌面全量 `36 files / 270 passed / 1 failed`，唯一失败是脏工作树既有 `skills-page` 文本断言与 DOM 文本节点边界不一致，未在本轮掩盖或修改。
- 真实 staging/授权、版本升级、commit/push 仍未执行。

## 技能页输出格式 DOM 契约收口（追加）

- `SkillsPage` 输出格式保留“可生成：”文案，但把前缀和 `markdown、docx` 拆成独立元素，解决文本节点边界导致的定位失败；未修改测试断言来掩盖问题。
- 技能页定向 `3 passed`，桌面类型检查通过，全量 `36 files / 271 passed`。
- Node localstorage 路径和 jsdom 导航仍有警告但不影响退出码；真实 staging、迁移父链、版本、commit/push 继续不动。

## 版本自动化门禁复核（追加）

- 聚信 AI 助手 `VERSION` 为 `2.4.0`；桌面 `package.json`、Tauri 配置和 Rust 包版本一致。
- `.githooks/commit-msg` 与 `.githooks/post-commit` 已启用：按 major/minor/patch 提交前缀同步版本、amend 当前提交并推送当前分支，不切换版本分支。
- 根仓库 `npm run test:versioning`：`56 passed`；桌面 `node --test apps/desktop/scripts/tests/agent-version.test.mjs`：`6 passed`。
- 仅完成只读审计和测试，没有升级版本、commit、push 或访问 staging/授权环境。

## 迁移双 head 的可执行决策门禁（追加）

- 当前本地迁移 heads 为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`；工作树 `0046_project_workspace_foundation` 指向 `0026_agent_run_contracts`，而未跟踪 `0045` 链未接入 `0046`。
- `tests/test_migrations.py tests/test_staging_preflight.py` 实测 `3 failed, 29 passed`，失败集中在 Alembic `upgrade(..., "head")` 的多 head 选择；local preflight 唯一失败为 `migration_graph`，因此保持 fail-closed。
- 处理只能在确认共享数据库迁移历史后选择：A，恢复 `0046 -> 0045` 并将测试期望更新到 `0051`；或 B，新增双父 merge revision。两者均属于迁移历史变更，本轮不擅自执行。
- 授权后的验收命令固定为：`alembic heads`、`python3 -m pytest -q tests/test_migrations.py tests/test_staging_preflight.py`、`python3 scripts/run_staging_preflight.py --mode local --json`。未访问数据库/Token，未改版本、commit 或 push。

## 迁移回滚演练与 priority 索引修复（追加）

- 在临时迁移副本中分别演练当前双 head、候选 A（恢复 `0046 -> 0045`）和候选 B（新增双父 merge revision）；不连接正式数据库、不改正式迁移图。
- 当前双 head 在 `upgrade head` 处 fail-closed；候选 A、B 均可完成 `upgrade head` 与 `downgrade base`。回放发现 `0017_learning_loop` 回滚在删除 `priority` 列前未删除索引，SQLite 批量重建表时报 `no such column: priority`。
- 已在 `0017_learning_loop` 回滚中先删除 `ix_ai_user_memories_priority`，并新增回归测试；定向迁移/专业交付测试 `3 passed`，临时副本 A/B 回放均 `PASS`。
- 该修复独立于父链选择；正式 preflight 仍仅因双 head 失败。未访问 staging/生产、未读取 Token、未改版本号、未 commit、未 push。

## 回滚修复后的最终迁移门禁证据（追加）

- 迁移/staging/专业交付测试实测 `3 failed, 61 passed`；失败只来自双 head（revision graph 与两个 `upgrade head` 场景），`priority` 回滚错误已消失。
- `run_staging_preflight.py --mode local --json` 仍为 `overall=fail`，唯一失败为 `migration_graph`，heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`；其余本地检查通过。
- 临时副本候选 A/B 的 `upgrade head` + `downgrade base` 均通过；正式选择 A/B 仍需共享数据库迁移历史确认和明确授权。

## 可重复迁移候选回放入口（追加）

- 新增 `server/scripts/run_migration_candidate_rehearsal.py`：在临时复制的迁移目录和 SQLite 数据库中回放 current、candidate A、candidate B；current 双 head 必须 fail-closed，A/B 必须 `upgrade head` 与 `downgrade base` 均通过。
- JSON 证据包含 `repository_unchanged=true`、`staging_or_network_used=false`，不输出密钥；脚本要求 `AUTH_DEV_BYPASS=true` 和环境变量 `AI_LOCAL_BINDING_SECRET`（至少 32 字符），缺失即 fail-closed。
- 实测命令：`AI_LOCAL_BINDING_SECRET='<本地临时值>' AUTH_DEV_BYPASS=true python3 scripts/run_migration_candidate_rehearsal.py --json`，`overall=pass`；current 预期阻断、A/B round-trip 通过。新增测试 `tests/test_migration_candidate_rehearsal.py` 为 `2 passed`，结合迁移/专业交付定向测试共 `4 passed`。
- 这个 pass 仅表示候选演练契约成立，不改变正式迁移父链选择；正式 preflight 仍因双 head fail-closed，A/B 仍需共享数据库历史确认和明确授权。
- `harness_spec.json` 已纳入 `tests/test_migration_candidate_rehearsal.py`；Harness release gate `253 passed, 9 skipped`。local preflight 仍唯一因 migration graph fail-closed，heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`，未被演练脚本掩盖。

## 本地全量回归与 GA 门禁最终复核（追加）

- 当前工作树排除 `tests/test_migrations.py` 后端回归：`1039 passed, 10 skipped`，退出码 0；跳过项仅为本地可选 Tantivy/LangGraph 依赖未安装。
- local GA：`overall=pass`、`11/11`；Harness `253 passed, 9 skipped`，checkpoint `15/15`，同库恢复 `5/5`，双进程接管通过，多轮跨进程恢复 `3/3`，混沌 `7/7`，副作用对账 `5/5`，Runtime shadow `150/150`、`0 mismatch`。
- local preflight 仍唯一因正式迁移图双 head fail-closed；真实 staging/生产授权、共享迁移历史确认、连续观测与灰度回滚仍未执行。未改版本、commit 或 push，版本仍为 `2.4.0`。

## 迁移候选演练异常路径 fail-closed（追加）

- 候选回放脚本现在将临时复制、Alembic 图解析等内部异常转成候选级机器可读 `fail`，不会直接崩溃；错误详情脱敏并截断。
- 缺少本地配置的失败报告固定输出 `repository_unchanged=true`、`staging_or_network_used=false` 和空候选列表。
- 定向回归 `tests/test_migration_candidate_rehearsal.py`：`3 passed`；正常 current/A/B 回放仍 `overall=pass`。Harness release gate：`254 passed, 9 skipped`。
- 未改正式迁移父链、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 当前状态口径（追加）

- 方案顶部已更新为最新状态：本地契约/GA 门禁通过；正式迁移图双 head fail-closed；staging/生产演练与观测仍待用户最后授权。
- 当前最新证据：Harness release gate `255 passed, 9 skipped`；后端回归（排除正式迁移模块）`1039 passed, 10 skipped`；local GA `11/11`；Runtime shadow `150/150` 且 `0 mismatch`。
- 正式 Alembic heads 为 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery`。候选 A/B 只在临时迁移副本和 SQLite 中完成 upgrade/downgrade 回放，仓库未改变；没有共享数据库历史确认前不选择父链、不生成正式 merge migration。

## 迁移候选演练顶层异常 fail-closed（追加）

- runner 现在把仓库快照、临时目录创建/清理等顶层异常也转换为稳定 JSON `overall=fail`；无法证明仓库未变更时明确返回 `repository_unchanged=false`，不会把未知状态报告为通过。
- 定向回归 `tests/test_migration_candidate_rehearsal.py`：`4 passed`；正常候选 CLI 回放 `overall=pass`；Harness release gate 最新为 `255 passed, 9 skipped`。
- 正式迁移图仍为双 head，未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 本地 GA 聚合门禁最终复核（追加）

- `run_ga_gate_local.py --json` 最新结果为 `overall=pass`、`11/11`：checkpoint `15/15`、同库恢复 `5/5`、多轮跨进程恢复 `3/3`、混沌 `7/7`、副作用对账 `5/5`、Runtime shadow `150/150` 且 `0 mismatch`。
- 真实 staging/生产证据仍未执行，正式迁移双 head 仍保持 fail-closed；未改版本、未 commit、未 push。

## 文档当前口径修正（追加）

- 重新执行迁移演练、preflight/HarnessSpec 定向回归和脚本编译：`20 passed`、`git diff --check` 通过。
- 重新执行 Harness release gate：`255 passed, 9 skipped`；local GA：`overall=pass`、`11/11`。
- 实施方案顶部的当前结果已从旧的 `254` 修正为 `255`，并注明历史章节保留原始时间点；正式迁移双 head 和 staging/生产证据边界没有变化。

## 本地门禁与版本自动化再次复核（追加）

- 只读 local preflight 最新结果：`overall=fail`，9 项检查中 8 项通过，唯一失败仍为 `migration_graph`；heads=`0045_agent_langgraph_checkpoints`,`0051_professional_delivery`，revision_count=`52`。
- Harness release gate 为 `255 passed, 9 skipped`；local GA 为 `overall=pass`、`11/11`；`npm run test:versioning` 为 `56 passed`。
- 版本仍为 `2.4.0`；未访问 staging/生产、未读取真实授权、未修改正式迁移父链、未执行版本升级、commit 或 push。

## 迁移演练仓库完整性 fail-closed（追加）

- 修复迁移演练：候选均通过但前后仓库快照不一致时，`overall` 强制为 `fail`；新增回归覆盖该安全边界。
- 定向测试 `tests/test_migration_candidate_rehearsal.py`：`5 passed`；正常 CLI `overall=pass`、`repository_unchanged=true`；Harness release gate `256 passed, 9 skipped`。
- 正式迁移双 head、staging/生产授权和版本发布边界不变，未改版本、commit 或 push。

## 后端全量回归再次复核（追加）

- 当前工作树排除正式迁移模块执行后端全量回归：`1043 passed, 10 skipped`，退出码为 0。
- 跳过项仍仅为本地未安装的 Tantivy/LangGraph 可选依赖；未发现新的本地业务或 Harness 缺口。
- 方案顶部当前结果已同步为 `1043 passed, 10 skipped`，历史章节继续保留各自时间点。

## 正式迁移测试边界复核（追加）

- 单独执行 `python3 -m pytest -q tests/test_migrations.py tests/test_professional_delivery_migration.py tests/test_staging_preflight.py -ra`：`3 failed, 32 passed`。
- 3 个失败均为已知 Alembic `Multiple heads`（线性 head 断言和两个 `upgrade("head")` 场景）；专业交付迁移回滚及 staging preflight 其余检查通过。
- 正式迁移图仍不具备发布条件；临时候选回放的 pass 只证明候选可回滚，不替代共享数据库历史确认和迁移授权。
- 未改正式迁移文件、未访问 staging/生产、未读取 Token、未改版本、未 commit 或 push。

## 本地完整性复核（追加）

- 后端 `python3 -m compileall -q app scripts tests` 通过；桌面 `npm run typecheck` 通过。
- 根仓库 `npm run test:versioning`：`56 passed`；当前分支仍为 `codex/ai-assistant-3.0`，版本仍为 `2.4.0`。
- 版本测试中的临时仓库分支操作未影响当前工作树；本轮未执行版本升级、commit、push、正式迁移或 staging/生产访问。

## 运维手册迁移启动边界修正（追加）

- `docs/ops-runbook-6.0-7.0.md` 现在要求启动前先运行 `python3 -m alembic heads`，且必须只有一个 revision；随后才能运行 `alembic upgrade head`。
- 多 head、图解析失败或 upgrade 失败均不得启动服务，也不得通过指定任一 head 绕过门禁；当前双 head 为 `0045_agent_langgraph_checkpoints`、`0051_professional_delivery`，仍需共享历史确认和明确授权。
- 新增运维手册契约测试覆盖该边界；没有正式迁移、staging/生产访问、Token、版本升级、commit 或 push。

## 最后一轮本地缺口扫描与迁移回放（追加）

- 只读扫描 Harness、Loop、恢复、工具注册和发布脚本后，未发现新的可执行 `TODO`/`FIXME` 或非抽象 `NotImplementedError`。
- Harness release gate 实测 `257 passed, 9 skipped`；`harness_spec.json` 可解析，迁移候选脚本帮助明确为本地临时回放。
- 候选回放最新 JSON：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`；current 双 head 按预期 fail-closed，candidate A/B 均 upgrade/downgrade round-trip 通过。
- 当前无新增授权范围内的本地开发项；剩余仅是共享数据库迁移历史确认、真实 staging/生产授权、生产 Runtime/checkpointer、连续观测与灰度回滚证据。未改正式迁移、未访问 staging/生产、未读 Token、未改版本、未 commit 或 push。

## 发布测试证据身份绑定（追加）

- 发布证据校验器此前没有把 `tests` artifact 绑定到当前 release 的 `release_id/base_url`；现已在 `evaluate_staging_evidence.py` 中增加同一身份、HTTPS 地址和非空校验，缺失/混用均 fail-closed。
- 运维手册测试示例已补齐 `tests.release_id` 与 `tests.base_url`；新增两个混用反向测试。
- 定向证据/preflight/runbook 测试：`43 passed`；Harness release gate：`259 passed, 9 skipped`。
- 仍未访问 staging/生产、读取 Token、修改正式迁移父链、升级版本、commit 或 push；正式双 head 和真实环境证据仍是剩余门槛。

## 发布迁移 head 交叉校验（追加）

- 发布 bundle 现在额外要求 preflight 的 `migration_graph.detail.heads` 为单元素列表，且唯一 `head` 必须等于 release `migration.to_revision`；否则 `evidence_coherence` fail-closed。
- 新增迁移版本不一致反向测试；证据/preflight/runbook 定向回归 `44 passed`；Harness release gate `260 passed, 9 skipped`。
- 真实工作树仍是双 head，未修改正式迁移父链或访问 staging/生产；未读取 Token、未升级版本、未 commit、未 push。

## 发布证据契约版本升级（追加）

- 因 `tests.release_id/base_url` 和迁移唯一 head 交叉校验成为必填，发布证据外层 schema 从 `1.3` 升为 `1.4`；旧版 `1.0/1.1/1.2/1.3` 继续 fail-closed。
- 解析器、测试 fixture、运维手册示例已同步；恢复报告与核心评测内层 schema 保持不变。
- 证据/preflight/runbook 回归 `44 passed`；Harness release gate `260 passed, 9 skipped`；本地 GA `11/11`。
- 仍未执行正式迁移、staging/生产访问、版本升级、commit 或 push。

## 桌面端与后端全量回归再次复核（追加）

- 桌面端执行 `npm run typecheck && npm test -- --reporter=dot`：类型检查通过，`36` 个测试文件、`272` 个测试全部通过；MSW 未处理请求和 Node localStorage 警告不构成失败。
- 后端执行 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：`1047 passed, 10 skipped`，退出码为 0；跳过项仅是本地未安装的可选 Tantivy/LangGraph 依赖。
- 本轮只更新验证记录；正式迁移仍双 head fail-closed，未访问 staging/生产、未读取 Token、未升级版本、未 commit 或 push。

## 项目级 Harness 运行边界持久化（追加）

- 新增项目根目录 `AGENTS.md`，固定项目结构、本地验证命令、统一状态/工具/租约契约、迁移双 head fail-closed，以及 staging/生产和版本发布禁区。
- 新增 `tests/test_project_harness_instructions.py` 并纳入 `server/harness_spec.json` 发布清单，定向回归 `17 passed`；Harness release gate `261 passed, 9 skipped`；HarnessSpec JSON 解析通过。
- 未修改正式迁移父链、未访问 staging/生产、未读取 Token、未切换 `real` Runtime、未升级版本、未 commit 或 push。

## 验证命令执行目录说明（追加）

- README 的开发与验收命令已明确从父工作区 `/Users/zhanglei/Documents/codex-new` 执行，避免相对路径误用；进入项目目录后按注释切换子目录。
- 改动后定向契约回归 `17 passed`，HarnessSpec JSON 解析与 `git diff --check` 通过，根仓库版本自动化 `56 passed`。
- 未访问 staging/生产、未读 Token、未改正式迁移父链、未切换 real Runtime、未升级版本、未 commit 或 push。

## 最终本地门禁复核（追加）

- Harness release gate：`261 passed, 9 skipped`，退出码为 0；清单当前 31 个测试模块。
- 迁移候选演练：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`；current 双 head 预期 fail-closed，candidate A/B upgrade/downgrade 通过。
- local preflight：`overall=fail`，9 项中 8 项通过，唯一失败为正式迁移双 head；未用候选演练结果绕过正式迁移门禁。

## 微信 H5 与桌面生产构建复核（追加）

- 微信 H5：`npm run typecheck && npm test -- --reporter=dot && npm run build` 全部通过；`1` 个测试文件、`1` 个测试，Vite `31` 个模块。
- 桌面端：`npm run build` 通过，Vite `1472` 个模块；只有 chunk 大于 `500 kB` 的体积 warning。
- 该验证只覆盖本地前端构建，不等同于 staging/生产发布；正式迁移双 head 和真实环境证据边界不变。

## 当前工作树后端与 GA 再复核（追加）

- 后端排除正式迁移模块回归：`1048 passed, 10 skipped`；跳过项仅为本地缺少的 Tantivy/LangGraph 可选依赖。
- Harness release gate：`261 passed, 9 skipped`；local GA：`overall=pass`、`11/11`，Runtime shadow `150/150` 且 `0 mismatch`。
- 该结果只证明本地代码和离线门禁；正式迁移双 head、staging/生产授权、真实 Runtime/checkpointer、连续观测和回滚仍待最后阶段，未改版本、未 commit、未 push。

## 正式迁移历史决策包（追加）

- 新增 `docs/plans/2026-07-15-migration-history-decision-packet.md`，把迁移双 head 的事实、候选 A/B、选择规则、只读核对、go/no-go 和回滚边界写成可执行文档。
- 当前关系：`0045_agent_langgraph_checkpoints` 是 checkpoint 分支；`0046`~`0051` 从 `0026_agent_run_contracts` 延伸，是项目/专业交付分支。候选 A/B 只在临时副本通过，不能替代共享数据库历史确认。
- 推荐在历史未知时采用正式双父 merge migration（候选 B）；若任何库在 `0046`~`0051` 且没有 `0045`，禁止候选 A。没有只读 revision、备份和回滚授权时继续 fail-closed。
- 本轮仅增加决策包文档，未改正式迁移父链、未访问 staging/生产、未读 Token、未改版本、未 commit 或 push。

## 交接文档与定向复核（追加）

- 更新 `docs/plans/2026-07-12-implementation-status.md` 和 `docs/plans/2026-07-12-ga-observation-checklist.md`，同步当前本地证据，并强调授权、双 head、连续观测和灰度回滚门槛。
- 定向迁移/证据/运维/Harness 回归：`50 passed`；`git diff --check` 通过。
- 迁移候选演练再次：`overall=pass`、仓库未变、未访问 staging/网络；current 双 head fail-closed，candidate A/B upgrade/downgrade 通过。
- 正式迁移、staging/生产、real Runtime、版本升级、commit/push 仍未执行。

## 发布就绪证据矩阵（追加）

- 新增 `docs/plans/2026-07-15-release-readiness-evidence-matrix.md`，按要求列出本地证据、外部证据、禁止放行项和正式发布顺序。
- 矩阵把迁移双 head、staging 授权、真实双 Runtime、连续观测与回滚单列为待外部证据；本地 Harness/GA/迁移演练通过不改变这些状态。
- 仅做文档和本地验证，未改正式迁移、未访问 staging/生产、未读 Token、未改版本、未 commit 或 push。

## 当前工作树最终回归与桌面测试确定性（追加）

- 后端全量（排除正式迁移模块）：`1048 passed, 10 skipped`；本地 GA：`overall=pass`、`11/11`；Harness release gate：`261 passed, 9 skipped`；根仓库版本门禁：`56 passed`。
- 桌面端并行全量曾出现 4 个默认 5 秒超时；受影响文件逐文件/单 worker 复跑 `18/18` 通过。已在 `apps/desktop/vite.config.ts` 固定 Vitest `fileParallelism: false`、`maxWorkers: 1`，随后全量 `npm run typecheck && npm test -- --reporter=dot` 为 `36` 个测试文件、`272` 个测试全部通过。
- MSW 未处理请求和 Node localStorage warning 仍输出 stderr，但本次退出码为 0；后续可单独治理测试夹具。该配置只改善本地回归确定性，不改变产品运行时并发。
- 正式迁移双 head、共享数据库历史、staging/生产授权、真实 Runtime/checkpointer、连续观测和灰度回滚仍未执行；未升级版本、未 commit、未 push。

## 微信 H5 版本边界审计（追加）

- 微信 H5 的 `typecheck/test/build` 本地验证通过，但其 `package.json/package-lock.json` 仍为独立版本 `1.1.1`；聚信 AI 助手主版本源、桌面端和服务端声明均为 `3.0.0`。
- H5 未加入根仓库 `ai-assistant` 版本注册表，版本钩子不会自动修改它。是否共版属于产品发布生命周期决策，不能在没有确认的情况下把 `1.1.1` 改成 `3.0.0`。
- 本轮仅记录边界并保留本地门禁通过；未改版本、未访问 staging/生产、未读取 Token、未 commit 或 push。

## 渠道重复投递出站幂等修复（追加）

- `server/app/channel_run_bridge.py` 新增 `_send_outbound_once`：发送前查询出站 `ChannelMessageBinding`，已有绑定则跳过 sender；避免 webhook/job 重试在复用 Run 时重复外发。
- `tests/test_channel_run_and_hub.py` 新增 outbox 行数断言；渠道相关回归 `25 passed`。
- 仍需在共享数据库的唯一约束/并发场景和 staging/生产授权后验证跨进程竞态；本轮未改迁移、版本、外部环境、commit 或 push。

## 跨进程出站预约与恢复语义（追加）

- 出站发送前提交 `ChannelMessageBinding(state=sending, idempotency_key=...)`，利用既有唯一约束让并发 worker 只有一个发送者；竞争失败者跳过 sender。
- 成功状态为 `sent`；sender 异常状态为 `reconciliation_required`，重放只读已有绑定，不盲重试未知外部副作用。
- 渠道回归 `27 passed`。这只证明本地持久化与顺序重放；共享数据库并发、真实 provider 幂等和 staging 演练仍未执行。

### 出站预约超时（追加）

- 旧 `state=sending` 超过 300 秒时 fail-closed 转为 `reconciliation_required`，覆盖进程在预约提交后被杀的窗口。
- 新增过期预约测试；真实 provider 对账查询和 staging kill/recovery 仍未执行。

### 渠道对账纳入 SLO（追加）

- `ops_slo` 现在统计 `channel_outbound_reconciliation_required` 并加入统一 `reconciliation_backlog`，运营快照可发现渠道未知副作用。
- 运营 SLO + 渠道定向回归 `38 passed`；正式告警和 staging/生产观测仍待授权。

## 后端全量回归复核（追加）

- 非迁移测试全量 `1049 passed, 10 skipped`，退出码 0；新增出站预约/失败对账测试已纳入。
- 跳过项仍仅为本地未安装的 Tantivy/LangGraph 可选依赖；正式迁移双 head 和外部环境门槛未改变。

## 当前版本事实校正

- 权威版本源 `juxin-ai-assistant/VERSION` 当前为 `3.0.0`；本文件较早段落中的 `2.4.0` 是历史快照，不代表当前状态。
- 根仓库 `npm run test:versioning` 实测 `56 passed, 0 failed`；未执行版本升级、commit 或 push。

## 最新后端全量回归

- 非迁移测试全量 `1050 passed, 10 skipped`，退出码 0；跳过项仍仅为本地未安装的 Tantivy/LangGraph 可选依赖。
- 正式迁移双 head、staging/生产授权、真实 Runtime/checkpointer、连续观测和灰度回滚仍未执行。

## 本地恢复演练与 staging 证据校验复核（追加）

- `test_staging_evidence_gate.py`、`test_staging_preflight.py`、`test_staging_recovery_rehearsal.py` 定向回归：`44 passed`。
- `run_staging_recovery_rehearsal.py --cases 3 --lease-ttl-seconds 1 --json`：`3/3` 成功；首 worker `SIGKILL (-9)`，第二 worker 接管，token `1 → 2`，旧 token 被 fencing，恢复率 `1.0`。
- 这是本地租约/恢复语义演练，不是 staging/生产放行证据；正式迁移、授权、真实 provider exactly-once、连续观测和灰度回滚仍保持 fail-closed。

## 渠道出站对账运维闭环（追加）

- `server/app/ops_routes.py` 新增管理员专用渠道出站对账列表/处置接口；成功必须提供不超过 100KB 的外部回执，未生效转 `not_applied` 并明确后续重试必须使用新幂等键。
- 复用 `ChannelMessageBinding.metadata_json`，不新增迁移；处置前使用行锁和 `reconciliation_required` 状态检查，重复处置返回 409，接口从不调用 sender。
- `tests/test_ops_readiness.py tests/test_channel_run_and_hub.py tests/test_ops_slo.py`：`23 passed`；后端非迁移全量：`1053 passed, 10 skipped`。
- 真实 provider 查询、staging/生产授权、正式迁移双 head 和连续观测仍未执行；未升级版本、未 commit、未 push。

## 最新 Harness 门禁复核（追加）

- `python3 scripts/run_harness_release_gate.py`：`264 passed, 9 skipped`，退出码 0；渠道出站对账回归随 `test_ops_readiness.py` 纳入发布门禁。
- `git diff --check` 通过；未改版本、未改正式迁移父链、未访问 staging/生产、未读取 Token、未 commit 或 push。
