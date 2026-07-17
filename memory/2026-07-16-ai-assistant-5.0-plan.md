# 2026-07-16 聚信 AI 助手 5.0 方案审计记忆

## 用户目标

基于附件《聚信 AI 助手 5.0——企业智能中枢版开发方案》检查现有代码，先输出可落地、可检测、以稳定为最终门槛的完整 5.0 适配方案；用户确认前不做大规模重构。

## 仓库状态

- 项目：`/Users/zhanglei/Documents/codex-new/juxin-ai-assistant`
- 当前分支：`codex/ai-assistant-5.0`
- 审计时 HEAD：`150da87e`
- HEAD 精确标签：`ai-assistant-v3.0.0`
- `VERSION`：`3.0.0`
- 工作树存在大量用户的未提交改动，包含 4.0 候选实现及其他工作；本次未清理、覆盖、暂存、提交或推送。
- 4.0 候选检查点记录了本地测试通过结果，但真实数据库迁移、staging 真实授权/密钥/Provider、多 Worker、灰度/回滚和生产监控仍未验证。

## 代码审计结论

- 5.0 企业智能中枢方向适合，但不能原方案一次性落地。
- P0 是统一 `PrincipalContext + EnterpriseAccessScope`，所有 repository 查询在 SQL 层执行范围过滤。
- `deep_retrieve._lexical_search` fallback 目前没有 SQL 级 owner/scope 约束，存在无权文件名、摘要或 UUID 泄露风险，必须在管理问答前修复。
- 当前缺少稳定 organization/department/customer 主数据和项目—客户—合同—服务—任务—成果—整改血缘。
- 项目健康不能用任务完成率推断服务履约；成果指标只能以 3.0 权威 `WorkArtifact/Version`、审核和交付事实为准。
- 5.0 应复用 3.0 Skill/模板/事实/证据/质量/审批/交付能力和 4.0 AgentRun/ToolSpec/WorkflowVersion/checkpoint/lease/fencing/reconciliation，不能再造运行时。
- 现有 `OpsDashboard` 是技术运维页，不等于企业业务总览；首个纵切应新建只读 `IntelligenceOverviewPage` 并连接真实 API。

## 已确定的适配原则

1. 权限范围先于指标、图谱、问答和洞察。
2. 用 canonical reference 连接现有事实，不建泛化实体表复制业务真相。
3. 指标、健康分、图关系、记忆和建议均带版本、证据、范围、截止时间、新鲜度和数据质量。
4. 管理问答只执行白名单语义 QueryPlan，不允许模型生成自由 SQL。
5. AI 关系默认待确认，组织记忆不能自动发布，中高风险动作必须走 4.0 审批和幂等账本。
6. 分 Phase 0、1A、1B、2、3、4 实施，第一里程碑是“真实数据库上的只读企业总览”。
7. staging 可按用户此前决定后置，但真实依赖、灰度、监控、备份恢复和回滚仍是生产稳定硬门。

## 产物

- 完整方案：`/Users/zhanglei/Documents/codex-new/juxin-ai-assistant/docs/plans/2026-07-16-ai-assistant-5.0-enterprise-intelligence-plan.md`
- 方案覆盖现状、权限、主数据、指标、健康度、图谱、组织记忆、主动洞察、管理问答、能力评估、优化审核、数据库、API、前端、阶段、测试和安全风险。

## 开发候选首个纵切（2026-07-16）

- 用户已确认“按照方案开发”，并说明当前版本仍显示 3.0 是因为 4.0 尚未进入正式环境验证；本轮没有把版本号伪升级到 5.0。
- 新增 `server/app/enterprise_intelligence/`：`EnterpriseAccessScope`、只读企业总览 service 和 `/api/ai/intelligence/overview` 路由。
- 修复 `server/app/agent_runtime/deep_retrieve.py` lexical fallback 的 SQL 可见性过滤；默认非管理员只返回本人或明确授权的 official 文档。
- 桌面端新增 `src/api/intelligence.ts`、`src/pages/EnterpriseOverviewPage.tsx`、导航入口、页面 token 样式和 `tests/enterprise-overview.test.tsx`。

## 本轮新增：指标契约与项目健康度（2026-07-16）

- 在不新增业务表、不执行迁移的前提下，扩展 `enterprise_intelligence.service`：基于现有项目、任务、成果和问题事实表计算只读指标快照与项目健康度。
- 指标快照固定包含 `metric_code`、`definition_version`、范围/范围指纹、`policy_version`、周期、`data_cutoff_at`、`data_version`、分子/分母、值、完整度、新鲜度、抑制状态、排除项和证据引用；当前实现 `active_project_count`、`overdue_task_rate`、`approved_deliverable_rate`。
- 项目健康度输出分数、置信度、`healthy/attention/high_risk/data_incomplete` 状态、规则版本、分项维度和稳定扣分码；缺失截止时间、超期任务和高严重度未关闭问题不会被伪装成健康。
- `/api/ai/intelligence/overview` 现在同时返回原始工作量、`metric_snapshots`、`project_health`、`freshness` 和 `data_quality`；桌面端总览展示口径、截止时间、证据、完整度和健康度解释。
- 目标测试：`server/tests/test_enterprise_intelligence.py` 4 passed；桌面端总览 2 passed。全量后端 1152 passed/10 skipped；桌面端 40 个测试文件、296 passed；typecheck/build 通过。

## Phase 1A：身份主数据和可空范围引用（2026-07-16）

- 先写 RED：`server/tests/test_enterprise_identity_migration.py` 初始失败于缺少 `app.enterprise_intelligence_models`；实现后进入 GREEN。
- 新增 `server/app/enterprise_intelligence_models.py` 六类身份/实体引用模型，并在 `app/models.py` 注册：组织、组织单元、客户、客户身份绑定、统一实体引用、实体别名。
- `Project` 增加可空 organization/owner department/primary customer 引用；`ProjectContract` 增加可空 organization/customer 引用。保留旧文本事实，存量不静默回填。
- 新增 `server/alembic/versions/0057_enterprise_identity_scope.py`，从 0056 单头升级；显式命名外键，支持临时 SQLite 升级/回退演练。
- 更新 `server/tests/test_migrations.py` 的 head、revision 和回退表断言。
- 验证：身份迁移 3 passed；迁移套件 26 passed；项目/合同/任务/智能总览回归 12 passed；`compileall` 与 `git diff --check` 通过。

## 验证结果

- 首个权限/总览纵切目标集：10 passed；本轮指标/健康度专项：4 passed。
- 后端全量：1152 passed, 10 skipped；可选 `tantivy`/LangGraph 依赖缺失导致跳过。
- 桌面端：40 个测试文件、296 passed；专测 2 passed。
- `npm run typecheck`、`npm run build` 通过；构建保留既有大 bundle 提示。
- 本轮涉及已跟踪文件的 `git diff --check` 无空白错误。

## Phase 1A：业务血缘增量（2026-07-16）

- 先写 RED：`server/tests/test_enterprise_business_lineage_migration.py` 初始失败于缺少 `app.enterprise_business_lineage_models`；实现模型和迁移后进入 GREEN。
- 新增 `server/app/enterprise_business_lineage_models.py` 五类关系/履约模型：客户—项目、服务履约实例、问题—资产、整改、整改—证据。既有项目、合同、任务、问题、资产、成果和 4.0 AgentRun/正式 WorkArtifact 仍是事实源。
- `ProjectTask` 增加可空 `service_scope_id`、`execution_rule_id`、`workflow_run_id`；`ProjectDeliverable` 增加可空且唯一的 `work_artifact_id`、`work_artifact_version_id`，用于逐步回填权威成果引用。
- 新增单头迁移 `server/alembic/versions/0058_enterprise_business_lineage.py`，从 0057 升级并支持回退；只在临时 SQLite 演练，没有对共享/真实数据库执行迁移。
- 更新 `server/tests/test_migrations.py` 将 Alembic head 锁定到 0058，并断言 0058 业务血缘表存在及回归可回退。
- 验证：业务血缘迁移 2 passed；迁移套件（更新至 0058）26 passed。

## 本轮未执行

- 仅在临时 SQLite 数据库中做迁移升降级演练；未运行共享/真实数据库迁移，也未启动生产依赖。
- 未修改版本号。
- 未暂存、提交或推送 Git。
- 这些本地测试不构成 4.0 正式环境或 5.0 生产稳定通过证明。

## 后续下一步

## Phase 1A：范围数据质量报告（2026-07-16）

- 先写 RED：在 `server/tests/test_enterprise_intelligence.py` 增加范围隔离、未解析问题码、人工复核标记和路由契约测试；实现前因缺少 `build_enterprise_data_quality_report` 与 `/data-quality` 路由而失败。
- 实现 `server/app/enterprise_intelligence/service.py` 的 `_visible_projects` 共享范围查询和只读 `build_enterprise_data_quality_report`；项目、合同、服务范围、成果都只扫描当前主体可见项目。
- 实现 `server/app/enterprise_intelligence/routes.py` 的 `GET /api/ai/intelligence/data-quality`，使用严格 Pydantic 响应模型输出 `status/as_of/scope_fingerprint/summary/issues`。
- 规则覆盖项目组织/部门/主客户缺失、合同组织/客户解析/人工确认缺失、确认服务范围没有履约发生记录、成果没有映射正式 WorkArtifact/Version；所有问题标记 `resolution=manual_review`，不自动合并或写回主数据。
- 验证：智能总览/数据质量及相关项目路由和迁移回归共 45 passed；`compileall`、`git diff --check` 通过。

## 当前未完成和下一步

数据质量报告仍是实时只读计算；下一步需要把问题持久化为可审核 unresolved 队列，并把 0058 关系写入项目/服务/问题/整改服务。随后新增 0059 持久化不可变指标/健康快照，再实现白名单 QueryPlan、图谱、组织记忆、主动洞察和审批动作。生产稳定仍需真实数据库、真实授权/密钥/Provider、多 Worker、灰度、监控、备份恢复和回滚演练。

## Phase 1B：指标与项目健康不可变快照（2026-07-16）

- 新增 `server/app/enterprise_metrics_models.py`：指标定义、指标快照、项目健康快照和数据质量问题表。指标/健康快照使用范围指纹、口径/规则版本、周期、截止时间、数据版本和来源哈希；自然键保证相同输入幂等，服务不更新既有快照。
- 新增迁移 `server/alembic/versions/0059_enterprise_metrics_health.py`，从 0058 单头升级；临时 SQLite 已验证升级、索引和回退时四张表被移除。
- `build_enterprise_overview` 增加可选固定 `cutoff`；新增 `persist_enterprise_overview_snapshots`，按当前 `EnterpriseAccessScope` 复用项目可见范围，持久化三项指标和项目健康结果。
- 新增快照迁移/服务专测 3 passed；包含快照重复执行为 0、新数据变化不覆盖旧截止时间值；更新至 0059 的企业智能目标回归 48 passed。
- 本阶段已补上数据质量 unresolved 审核队列写入；仍未实现定时计算 Worker、管理 QueryPlan、图谱、组织记忆、主动洞察、审批动作和生产发布门。

## 当前未完成和下一步（更新）

已完成范围内数据质量问题的可审核 unresolved 队列写入，并补上迁移演练/发布门对当前 0059 head 的断言；下一步补齐 0058 业务关系的安全写服务，再继续 QueryPlan 白名单、轻量关系图、组织记忆版本审核、主动洞察和审批动作。`VERSION` 仍为 `3.0.0`，不执行真实迁移/staging/生产发布。

## Phase 1B：数据质量 unresolved 队列与迁移门禁修复（2026-07-16）

- `persist_enterprise_data_quality_issues` 复用 `EnterpriseAccessScope` 和实时质量报告，将问题以 `scope_fingerprint + code + entity + project + source_version` 的 SHA-256 指纹写入 `ai_enterprise_data_quality_issues`。
- 重复扫描只返回 `issues_scanned`，不重复插入；服务从不更新已有行，因此人工设置的 `resolved` 状态不会被下一次扫描覆盖。规则版本提升到新的 `source_version` 后，允许形成新一代可审计问题。
- 新增 `server/tests/test_enterprise_data_quality_queue.py`，覆盖 6 条缺口首次入队、重复扫描、人工解决保留和规则版本变化；专项与智能总览/快照回归共 8 passed。
- 修正本地迁移候选演练的当前 head 为 `0059_enterprise_metrics_health`，并让临时合并候选挂在当前 head；修正 4.0 工作流发布门将“0056 兼容性字段”与“当前 0059 单 head”混用的问题。迁移候选与发布门专项共 8 passed。
- 合并目标回归 57 passed；后端全量回归 `1189 passed, 10 skipped`，10 个跳过项均为环境缺少 `tantivy`/LangGraph 可选依赖；`compileall` 与 `git diff --check` 通过。

下一步：把已完成的血缘写服务接入前端/Worker 使用场景，再实现定时快照 Worker、QueryPlan 白名单、图谱、组织记忆、主动洞察和审批动作；仍不执行真实数据库迁移、staging、生产授权、版本升级或 Git 提交推送。

## Phase 1C：0058 业务血缘安全写服务（2026-07-16）

- 新增 `server/app/enterprise_intelligence/lineage_service.py`：`link_project_customer`、`create_service_occurrence`、`link_issue_asset`、`create_project_remediation`、`link_remediation_evidence`。
- 写服务强制 `intelligence:manage`，项目必须 active、可见并已绑定组织；客户必须 active 且同组织。
- 服务发生记录校验周期、source_version，以及合同、服务范围、任务、交付物、工作产物的同项目关系和服务范围—合同匹配；问题、资产、整改和证据也拒绝跨项目引用。
- 自然键/整改 UUID 重复请求直接返回既有记录，不覆盖来源、确认人、状态或版本；不自动修改项目、合同、交付物事实源。
- `server/app/enterprise_intelligence/routes.py` 新增五个严格 POST 接口，要求 `Idempotency-Key`，错误统一映射，证据响应不复制 project_id 到证据表。
- `server/app/enterprise_intelligence/__init__.py` 导出五项写服务；写服务/API 测试共 11 passed；compileall 与 diff check 通过。

下一步：实现固定截止时间的快照 Worker（租约、重入和失败可恢复），并建立白名单 QueryPlan 编译器；仍不执行真实数据库迁移、staging、生产授权、版本升级或 Git 提交推送。

## Phase 1D：管理 QueryPlan 与固定截止时间快照 Worker（2026-07-16）

- 新增 `server/app/enterprise_intelligence/query_plan.py`：严格 Pydantic QueryPlan、指标/维度/过滤白名单、范围编译与只读执行。计划保存范围/策略指纹，执行再次校验，拒绝自由 SQL、未知指标、越权项目和未授权个人字段。
- `server/app/enterprise_intelligence/routes.py` 新增管理 QueryPlan 编译和执行接口；响应包含证据引用，接口要求 `intelligence:view`。
- 新增 `server/app/enterprise_intelligence/snapshot_worker.py`：固定 cutoff 的快照事务单元，写入指标/健康快照及数据质量 unresolved 队列；重复运行幂等、不同 cutoff 追加、类本身不 commit。调度租约仍需由 WorkflowControlWorker/调度层接入，不能据此宣称多 Worker 生产稳定。
- QueryPlan/快照 Worker/指标快照专项验证共 8 passed，`compileall` 和 `git diff --check` 通过。

下一步：新增组织图谱和证据边、组织记忆版本审核/候选去重，再实现主动洞察、推荐动作和审批闭环；继续保持只改本地候选代码，不执行真实迁移、staging、生产授权或 Git 发布。

## Phase 2：组织图谱与长期记忆候选（2026-07-16）

- 新增 `server/app/enterprise_graph_memory_models.py`：组织图谱节点、关系、证据边、组织记忆、记忆版本和审核记录；审核记录对记忆版本唯一，版本保留来源/数据版本/策略版本。
- 新增 `server/alembic/versions/0060_enterprise_graph_memory.py`，从 0059 单头升级，临时 SQLite 升降级通过。
- 新增 `server/app/enterprise_intelligence/graph_memory_service.py`：节点/关系/证据边幂等写入，记忆候选提交、审核和已审核读取；强制组织隔离和 capability 检查。
- 图谱/记忆迁移与服务目标回归：`30 passed`。尚未接真实目录同步、向量 Provider 或生产多 Worker。

## Phase 3：主动洞察、建议动作与审批边界（2026-07-16）

- 新增 `server/app/enterprise_insight_models.py` 和迁移 `0061_enterprise_insights_recommendations.py`：规则/规则版本、洞察、证据、建议和建议动作六类表；自然键和幂等键防重复。
- 新增 `server/app/enterprise_intelligence/insight_service.py`：确定性逾期任务洞察检测、证据绑定、范围过滤、洞察确认/驳回、建议动作提案、风险分级审批、结果回写和 reconciliation_required。
- 新增洞察与建议 API：列表、检测、确认、驳回、建议、审批、结果回写；中高风险动作审批前不产生外部副作用。
- 审批重试返回既有 approved 记录，不重复生成审批 token；终态结果相同重试返回既有记录，不修改执行时间/版本；不同结果重试明确冲突。
- 新增迁移/服务/路由测试；目标回归、`compileall` 和 `git diff --check` 均通过（全量回归将在本轮最后执行）。

## 当前 5.0 候选边界

已具备统一企业范围、身份与业务血缘、不可变指标/健康快照、数据质量审核队列、白名单 QueryPlan、固定 cutoff 快照事务单元、组织图谱/记忆审核、主动洞察与建议动作审批边界。

下一步是把已审批动作接入 4.0 Workflow Ledger/Worker（租约、fencing、重试、超时、对账），再增加洞察调度/通知和管理端界面；真实数据库迁移、授权/Provider、恢复、灰度/回滚、多 Worker、监控门禁完成前，`VERSION` 保持 `3.0.0`，不做版本升级、提交或推送。

## Phase 4：建议动作到 4.0 Workflow Ledger/Worker 的持久化桥接（2026-07-16）

- `queue_recommendation_workflow_event` 只把已审批建议写入 `WorkflowTriggerInbox`；事件使用 `recommendation:{uuid}` 自然键，重复请求重放，换幂等键或不同载荷明确冲突。
- `bind_recommendation_workflow_run` 只在工作流运行已经创建/恢复后写入建议 `workflow_run_id`，同一 run 重试幂等，尝试覆盖其他 run 会拒绝；不会调用 Provider 或写业务事实。
- `WorkflowControlWorker` 与 `/api/ai/workflows/events/{event_uuid}/dispatch` 共用该绑定边界，随后才以 lease/fencing token 标记事件 processed。
- 新增企业建议 dispatch API；服务、路由和 Worker 回归覆盖 41 个目标测试，`compileall`/`git diff --check` 待全量结束后再次确认。

当前候选边界更新：5.0 的建议动作已可进入 4.0 持久化控制平面，但定时洞察、通知策略、管理端界面、真实 Provider、真实库迁移、staging、恢复/灰度/回滚、多 Worker 和生产监控仍未完成。`VERSION` 仍为 `3.0.0`，不执行版本升级、提交或推送。

## Phase 4：主动洞察扫描与 4.0 通知 Outbox 桥接（2026-07-16）

- 新增 `server/app/enterprise_intelligence/insight_scan.py`：固定 cutoff 扫描逾期洞察，只处理开放且带任务证据的发现；通知以组织、任务、收件人和策略版本生成稳定运行 ID，写入 4.0 `WorkflowNotificationOutbox`，不同 cutoff 会重放而不重复通知。
- 新增 `POST /api/ai/intelligence/organizations/{organization_id}/insights/scan-overdue`，要求 `intelligence:manage` 与 `Idempotency-Key`，返回检测、入队、重放和通知 UUID。
- 洞察服务/路由/Worker/控制平面目标回归 `43 passed`；`compileall`/`git diff --check` 已通过。

当前候选边界更新：主动洞察扫描已可被显式调用并进入 4.0 Outbox，但尚未周期调度；通知仍为本地可替换适配器，未接入真实邮件/IM/Provider。下一步补管理端“今日关注/洞察审核”界面、用户通知读取接口和可租约的周期调度，再做真实库、授权、恢复、灰度、回滚、多 Worker、监控门禁。`VERSION` 保持 `3.0.0`。

## 本轮最新增量（2026-07-16）

- 能力评估闭环：新增 `enterprise_capability_models.py`、迁移 `0062_enterprise_capability_evaluation.py`、`capability_service.py` 及对应路由。评估、观测、优化建议和事件均保留策略/范围指纹、来源版本、请求哈希和幂等键；同键不同请求哈希拒绝，优化建议只能人工审核，不能自动发布。
- 今日关注人工动作：桌面端 `EnterpriseOverviewPage` 对开放洞察提供“确认关注/忽略洞察”，带反馈、请求中禁用、失败可见错误和列表状态更新；专测 3 passed，桌面端 typecheck 通过。
- 洞察周期调度：`create_insight_scan_schedule` 冻结组织、用户、角色、部门范围、策略版本和范围指纹到计划元数据；`WorkflowControlWorker` 重建并校验冻结范围，篡改时拒绝，不降级为通用工作流；通过后以固定 `scheduled_fire_at` 调用扫描事务。新增计划路由和 worker/路由回归。
- 最新验证：后端全量 `1218 passed, 10 skipped`（跳过项仅为环境缺少 `tantivy`/LangGraph 可选依赖）；能力/洞察/调度/Worker 专项 25 passed；`PYTHONPATH=. python3 -m compileall -q app tests` 与 `git diff --check` 通过。

## 当前可交付边界

5.0 开发候选已具备：统一企业范围、身份/业务血缘、不可变指标健康快照、数据质量审核队列、白名单 QueryPlan、图谱/组织记忆审核、主动洞察、今日关注人工审核、建议动作进入 4.0 Workflow Ledger/Worker、Outbox 通知桥接、能力评估和优化建议人工门禁。

仍不能称生产稳定：0057—0062 尚未在真实数据库迁移/回填；真实登录授权、密钥和 Provider 未接入；多 Worker、恢复、备份恢复、灰度/回滚、监控和压测未验证；计划管理/能力评估管理 UI、计划创建幂等回放及真实通知消费仍待补齐。`VERSION` 继续保持 `3.0.0`，不执行真实迁移、版本升级、提交或推送。

## 本轮最新增量：运营总览与计划幂等（2026-07-16）

- 后端新增 `build_enterprise_operation_summary` 和 `GET /api/ai/intelligence/operation-summary`，沿用 `EnterpriseAccessScope` 汇总合同、服务履约、任务、交付成果、问题/整改和自动流程，并输出带证据、项目和截止时间的关注项。自动流程统计对非管理员采用本人运行的隐私兜底。
- 桌面端企业总览新增“运营执行情况”面板，展示六类执行卡片、统计口径和前五条待处理事项；运营接口异常不会阻断原总览加载。相关 API、页面、样式和专测已加入工作树。
- 洞察周期计划路由现在强制 `Idempotency-Key`；服务保存请求哈希，同键同载荷重放原计划，同键换载荷返回 `idempotency_key_conflict`，缺键返回明确的 `400` 错误。新增路由断言覆盖缺键、重放和冲突。
- 本轮专项验证：运营汇总及计划幂等后端 `20 passed`；桌面端企业总览 `3 passed`；`npm run typecheck` 通过。后续仍需管理员计划/能力评估 UI、真实库/授权/Provider、通知消费以及多 Worker/恢复/备份/灰度/回滚/监控门禁。

边界未变：当前分支仍是 `codex/ai-assistant-5.0` 上的 5.0 开发候选，`VERSION=3.0.0`；不执行真实数据库迁移，不提交、不推送、不发布。

## 本轮最新增量：企业智能管理工作台（2026-07-16）

- 新增组织安全选择器服务 `list_enterprise_organizations` 与 `GET /api/ai/intelligence/organizations`：管理员可见 active 组织及 active 项目计数，普通管理角色按项目成员范围过滤；员工和外部用户不能调用管理接口。
- 新增洞察计划列表接口，读取时校验组织、固定工作流 ID、冻结的策略版本和范围指纹，避免把被篡改或跨组织的计划展示到管理端。
- 新增桌面端 `EnterpriseManagementPage`：不用手工填写组织 ID，可选择后端返回的组织，创建/查看洞察扫描计划，录入能力评估，创建优化提案，并执行送审、批准、驳回、发布、回滚；写请求自动生成 `Idempotency-Key`。
- `App.tsx` 仅向管理角色显示入口，样式沿用现有深色/蓝色系统令牌；后端继续执行最终鉴权。
- 验证：后端企业智能路由/服务 `11 passed`；桌面管理页专测 `1 passed`；`npm run typecheck`、`npm run build`、Python `compileall`、`git diff --check` 通过。

边界未变：这只是 5.0 开发候选的管理纵切，不代表真实数据库、生产授权/Provider、多 Worker、恢复、灰度/回滚、监控和容量门禁已完成。`VERSION=3.0.0`，不提交、不推送、不发布。

## 本轮最新增量：企业审计查询与发布 Runbook（2026-07-16）

- 新增 `server/app/enterprise_intelligence/audit_service.py`：企业审计投影强制 `enterprise.*` 前缀；非管理员只看本人写入，管理员可看企业范围全部记录；支持实体、时间过滤和分页，并复用 metadata 脱敏契约。
- 新增 `GET /api/ai/intelligence/audit-logs`，仅企业智能管理权限可访问；管理页新增最近企业操作审计只读面板，MSW 测试同步补齐。
- 目标验证：后端企业智能测试 `13 passed`；桌面管理专测 `1 passed`；`npm run typecheck`、`npm run build`、`compileall`、`git diff --check` 通过。
- 新增发布清单 `docs/runbooks/enterprise-intelligence-5.0-release.md`，包含候选冻结、真实 DB 升降级、SSO/Provider、双 Worker/fencing、恢复/备份、灰度/回滚、监控和版本升级命令。清单未执行，不代表生产门禁通过。

当前边界：`VERSION=3.0.0`，分支为 5.0 开发候选；不提交、不推送、不发布。真实数据库、授权/密钥/Provider、多 Worker、备份恢复、灰度回滚、监控和容量门禁仍需在目标环境验证。

## 本轮最新增量：通知收件箱读取闭环（2026-07-16）

- `WorkflowNotificationOutbox` 增加 `read_at`、`read_by_user_id`，迁移为 `0063_enterprise_notification_read_state`；投递状态与用户已读状态分离。
- 新增 `notification_service.py` 与两个企业智能接口：通知列表按当前用户、`in_app`、`enterprise_insight` 过滤；已读操作要求幂等键，重复请求安全返回 `replayed=true` 并写企业审计。
- 桌面企业总览新增通知收件箱、未读数量、标记已读和错误态；接口失败不会拖垮总览。
- 周期洞察扫描已确认复用现有 `WorkflowControlWorker` 的冻结 scope、租约与 fencing，不新增重复调度器。
- 验证：通知/迁移目标 `29 passed`；企业智能/快照/Worker 目标 `33 passed`；桌面总览 `4 passed`；`tsc --noEmit` 通过。系统 Python 可运行 pytest，工作区 bundled Python 未装 pytest。

当前仍未完成：真实数据库执行 0063、真实登录授权/密钥/Provider、外部通知渠道消费、多 Worker/恢复、备份恢复、灰度/回滚、监控和容量门禁。`VERSION=3.0.0`，不提交、不推送、不发布。

## 企业智能运行就绪门禁（2026-07-16）

- 新增 `server/app/enterprise_intelligence/readiness.py`：检查企业 5.0 核心表、Alembic 单一 head `0063_enterprise_notification_read_state`、`workflow_control_worker` 开关和通知 Provider 契约。
- `server/app/ops_readiness.py` 将其汇总为 `enterprise_5_0` 检查，现有 Ops readiness API/页面可直接看到缺口；开发测试库无 `alembic_version`、Worker 未开启、真实 Provider 未绑定时会显示 warning，不会误报生产就绪。
- 新增 readiness 回归覆盖完整 schema、缺表、迁移版本错误；目标测试 `15 passed`。

本轮只增加可检测性，不执行真实生产迁移、授权/密钥接入或发布；`VERSION=3.0.0` 保持不变。

## 最终校正（2026-07-16）

- 通知已读迁移后当前单一 Alembic head 为 `0063_enterprise_notification_read_state`；迁移候选演练和 Workflow 发布门禁脚本的 head 断言已同步更新。
- 后端全量 `1227 passed, 10 skipped`；迁移/发布门禁专项 `8 passed`；桌面端全量 `41 files / 299 tests passed`；`vite build`、`tsc --noEmit`、Python `compileall`、`git diff --check` 全部通过。
- 周期洞察扫描复用现有 `WorkflowControlWorker` 的冻结 scope、租约和 fencing；没有新增重复调度器。
- 仍不能称生产发布：真实数据库 0063、授权/密钥/Provider、外部通知渠道、多 Worker/恢复、备份、灰度/回滚、监控和容量门禁均需目标环境证据。`VERSION=3.0.0`，不提交、不推送、不发布。

## 基线漂移修正（2026-07-16）

- 当前工作树已有未提交迁移 `0064_knowledge_external_download_control`，向下连接 `0063_enterprise_notification_read_state`；本轮没有修改或回滚该用户改动，但已将迁移候选演练和 Workflow 发布门禁的当前 head 断言同步到 0064。
- 企业智能 readiness 改为校验单一 Alembic 版本是否沿迁移链包含 0063 基线，允许合法后继迁移，同时继续拒绝 0062、空版本和多 head。
- readiness/Ops readiness 专测共 `16 passed`；真实数据库、授权/Provider 和生产门禁仍未执行，`VERSION=3.0.0` 不变。

## 全量回归边界（2026-07-16）

- readiness、Ops readiness、迁移图、迁移候选演练和 Workflow 发布门禁专项合计 `44 passed`；覆盖本轮新增门禁及现有工作树 `0064` 后继迁移。
- 后端全量 `1231 passed, 10 skipped, 2 failed`。两个失败是既有 `tests/test_web_sources.py` 的联网搜索测试：受限环境无法稳定解析/通过 `example.com` 的 DNS/安全校验，导致候选过滤及缓存断言失败；本轮未修改联网搜索代码。
- 桌面端全量 `41 files / 300 tests passed`；`npm run typecheck`、`npm run build`、Python `compileall`、`git diff --check` 通过，构建仅有既有 bundle 体积提示。

## 管理问答受控导出闭环（2026-07-16）

- 新增 `POST /api/ai/intelligence/management/export`，沿用严格 `QueryPlanIn`、`EnterpriseAccessScope` 和 `compile_query_plan → execute_query_plan`，不提供自由 SQL 或绕过权限的导出路径。
- 导出固定为带 BOM 的 CSV；列表/字典使用确定性 JSON，公式前缀字符转义；响应禁止缓存并提供下载文件名。
- 导出成功写入 `enterprise.management.export` 审计事件，只保留事件名、行数、媒体类型和文件大小，不落查询正文；后端测试已断言审计元数据脱敏。
- 桌面企业总览管理问答结果增加“导出当前结果”按钮、请求中状态和权限/失败反馈；复用既有下载工具与设计令牌。
- 受控导出定向后端 `6 passed`；桌面总览导出交互纳入 `5 passed` 定向集。此前桌面全量 `41 files / 301 tests passed`、类型检查和构建均通过；构建仅有既有 bundle 体积提示。

当前 5.0 开发候选已覆盖“查询—证据—导出—审计”最小闭环。真实数据库迁移/回填、真实授权/密钥/Provider、外部通知消费、多 Worker/恢复、备份恢复、灰度/回滚、监控告警、容量压测和两个受限环境联网基线仍需目标环境证据；`VERSION=3.0.0`，不提交、不推送、不发布。
- `0064_knowledge_external_download_control` 是当前工作树已有未提交迁移，向下连接 0063；readiness 按迁移链包含 0063 判定，候选演练与 Workflow 发布门禁按当前 head 0064 判定。
- 两项后端失败归类为环境/基线问题，不通过改测试或放宽安全校验掩盖。真实数据库迁移、真实授权/密钥/Provider、外部通知消费、多 Worker/恢复、备份、灰度/回滚、监控和容量门禁仍未执行；`VERSION=3.0.0`，不提交、不推送、不发布。

## 白名单管理问答入口（2026-07-16）

- 桌面端企业总览新增只读“管理问答”面板，提供项目健康度、逾期任务率、成果通过率、活跃项目数四个白名单快捷查询；不接受自由文本或自由 SQL。
- `apps/desktop/src/api/intelligence.ts` 增加 QueryPlan/QueryResult 类型与 `runEnterpriseManagementQuery`；结果展示周期、计划、范围指纹、策略版本和证据数量，403/失败有明确提示。
- `apps/desktop/tests/enterprise-overview.test.tsx` 覆盖快捷查询请求和证据结果；桌面端全量 `41 files / 301 tests passed`，`npm run typecheck`、`npm run build` 通过（仅既有 bundle 体积提示）。
- 深度检索 lexical fallback 已按 SQL 可见性条件复用 AccessScope，并有不可见知识不返回的回归测试；本轮未重复改动检索逻辑。

当前仍是 5.0 开发候选：真实数据库迁移/回填、真实登录授权/密钥/Provider、外部通知消费、多 Worker/恢复、备份恢复、灰度/回滚、监控与容量门禁未执行；后端全量的两个联网搜索基线失败需在有网络策略的环境复核。`VERSION=3.0.0`，不提交、不推送、不发布。
