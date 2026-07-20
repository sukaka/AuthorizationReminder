# 发布就绪证据矩阵

日期：2026-07-15
用途：把 Agent Loop/Harness 稳定化方案从“代码已实现”推进到“可逐项验收”。

## 状态定义

- **已证实**：当前工作树有可重复命令和机器可读结果。
- **待外部证据**：代码和本地演练已准备，但必须在授权环境取得真实证据。
- **禁止放行**：存在 fail-closed 门禁或证据缺失，不能通过改命令、指定分支或伪造工件绕过。

## 矩阵

| 要求 | 当前证据 | 状态 | 放行条件 |
| --- | --- | --- | --- |
| RunState、状态机和版本契约统一 | `tests/test_run_state_contract.py`、`tests/test_agent_state_machine.py`；Harness gate | 已证实 | 发布包使用同一 `RUN_STATE_SCHEMA_VERSION`，未知版本继续 fail-closed |
| 工具输入/输出、权限、scope、确认和幂等统一 | `tests/test_tool_contract_policy.py`、`tests/test_direct_action_inventory.py`、`tests/test_direct_action_reconciliation_drill.py` | 已证实 | 新工具先更新注册清单与契约测试；禁止旁路副作用 |
| 恢复、租约 fencing 和多进程接管 | `run_ga_gate_local.py --json`；checkpoint/chaos/lease 测试 | 已证实（本地） | staging 强杀后无双 owner、旧 fencing 写入被拒绝、待对账可闭环 |
| Native 与 LangGraph 状态语义一致 | Runtime shadow `150/150`、`0 mismatch`；LangGraph pilot 定向测试 | 已证实（本地） | staging 固定任务集双 Runtime 结果/副作用对账一致；生产 checkpointer 通过评审 |
| 前端任务、工作流、成果、运维入口可构建和回归 | desktop typecheck/test/build；微信 H5 typecheck/test/build | 已证实（本地） | staging 真实 API smoke 通过，关键入口无鉴权或路由回归 |
| Harness 清单和发布证据身份一致 | Harness `266 passed, 9 skipped`；课程/RAG 定向回归 `53 passed`；schema `1.4` | 已证实（本地） | staging artifact 的 `release_id`、HTTPS `base_url`、迁移 head 和测试报告完全一致 |
| Alembic 迁移图唯一 head | `python3 scripts/run_staging_preflight.py --mode local --json` 当前为唯一 head `0065_chat_generated_files`，共 66 个 revision | 已证实（本地） | 目标 staging/生产库仍需由数据库负责人提供 `alembic current/heads/history`、备份和回滚窗口证据 |
| staging 授权与 HTTPS 传输 | `run_staging_preflight.py --mode local` 只验证配置形状 | 待外部证据 | 授权 Bearer 仅通过环境变量注入；HTTPS、最小权限、过期和撤销路径均有证据 |
| 真实固定任务集和连续观测 | `run_ga_gate_local.py` 只覆盖离线/本地演练；观测 evaluator 已有 | 待外部证据 | staging/生产连续观测达到方案阈值；缺失日期、双 owner、待对账、P0 均阻断放量 |
| 版本、提交和推送自动化 | 根仓库 `npm run test:versioning`：`56 passed` | 已证实（未执行发布） | 用户明确授权后按 major/minor/patch 规则 bump、commit、push；未授权前保持版本不变 |

桌面测试确定性补充：`apps/desktop/vite.config.ts` 的 Vitest 已设置 `fileParallelism: false`、`maxWorkers: 1`。当前 `npm run typecheck && npm test -- --reporter=dot` 为 `41` 个测试文件、`325` 个测试全部通过；这只约束本地测试调度，不改变产品运行时并发。

## 2026-07-19 当前工作树复核

- Harness release gate：`266 passed, 9 skipped`；GA local：`11/11` 子门禁通过。
- 后端全量回归（忽略迁移测试）：`1259 passed, 10 skipped`；静态审计新增测试已纳入全量套件。
- staging preflight local：`overall=pass`，唯一迁移 head 为 `0065_chat_generated_files`，共 66 个 revision；未连接 staging。
- 课程对齐门禁：`23/23 checks passed`；课程/RAG 定向回归：`53 passed`。
- 管理路由权限审计：静态审计与认证回归 `16 passed`；权限相关路由回归 `92 passed`；四类平台管理员角色别名统一通过 helper 判断。
- 以上均为本地、临时副本或离线证据；真实 staging/生产授权、目标库备份/回滚、连续观测和正式发布仍未执行。

### 最终复核补充（2026-07-19）

- 课程对齐脚本 `run_course_alignment_gate.py --json`：`23/23` 通过；管理员权限专项 `82 passed`；根仓库版本自动化 `56 passed`。
- 后端非迁移全量：`1259 passed, 10 skipped`；桌面端：`41 files / 325 tests passed`、typecheck/build 通过；微信 H5 typecheck/test/build 通过。
- 以上数字均来自本轮重新执行，不表示已经获得真实 staging/生产的授权或观测窗口。

### 迁移与发布演练补充（2026-07-19）

- 正式迁移测试单独执行：`26 passed`；唯一 Alembic head 仍为 `0065_chat_generated_files`。
- 在进程级临时环境注入 `AUTH_DEV_BYPASS=true` 与一次性本地绑定密钥后，迁移候选演练和工作流发布门禁均为 `overall=pass`，且 `repository_unchanged=true`、`staging_or_network_used=false`。
- 本地进程边界恢复演练为 `3/3`、恢复率 `1.0`；这只证明临时副本的 fencing/接管闭环，不替代真实 staging 双 Worker 证据。

### 可选依赖覆盖复核（2026-07-19）

- `/tmp/juxin-rag-optional-venv` 隔离安装 Tantivy/LangGraph 依赖后，关键词索引与 checkpoint 定向测试 `4 passed`，Runtime shadow `25 passed`。
- 注入隔离依赖路径后的后端非迁移全量为 `1270 passed, 0 skipped`，覆盖默认环境因可选依赖缺失而跳过的测试。
- 覆盖测试发现并修复 LangGraph 非法初始状态 fail-closed 分支的 `completed_steps` 丢失；修复后 execute/verify 仍不会被调用。
- 该环境只用于本地证据，不代表生产可切换 LangGraph，也不替代 staging/生产的目标环境授权与连续观测。

### Harness/GA 当前复核（2026-07-19）

- 在同一隔离可选依赖路径下，Harness release gate 为 `275 passed`，GA local gate 为 `11/11`，退出码均为 0。
- GA 结果继续包含离线问答 `19/20`、引用准确率 `1.0`、无证据拒答率 `1.0`、Runtime shadow `150/150` 且 `0 mismatch`。
- 该结果仍是本地/离线证据；`evaluate_ga_observe` 的真实连续窗口、目标库证据和发布授权尚未取得。

### 正式发布交接输入契约（2026-07-19）

要把“本地整改完成”闭环为“正式发布完成”，发布负责人需要通过受控环境提供以下输入；值本身不得写入仓库、日志或记忆文件：

| 输入 | 最小证据 | 使用位置 |
| --- | --- | --- |
| staging HTTPS 地址 | 可访问的 `https://...` base URL、证书/域名归属 | `run_staging_preflight.py --mode staging`、真实 smoke |
| staging 授权 | 仅通过环境变量注入的短期 Bearer token；过期/撤销记录 | `JUXIN_STAGING_GA_TOKEN` 或等价受控变量 |
| 发布身份 | 唯一 `release_id`，与测试、迁移、观测工件一致 | preflight、灰度和回滚记录 |
| 目标数据库证据 | `alembic current/heads/history`、`alembic_version`、备份位置、回滚窗口 | 迁移候选与发布门禁 |
| 运行时证据 | 双 Worker 强杀接管、fencing、直连副作用对账、Native/LangGraph shadow | staging recovery / GA observe |
| 连续观测 | 固定任务集、独立复核、SLO/异常窗口 JSONL；缺失日期和 P0 自动阻断 | `evaluate_ga_observe`、灰度放量 |
| 发布授权 | 明确允许按版本规则 bump、commit、push 的书面确认 | 根仓库 versioning automation |

当前工作树未发现上述 staging/生产变量、Docker 服务或目标数据库连接；因此本契约是待执行的外部交接项，不是可用本地配置的替代物。

## 当前可重复本地命令

从项目的 `server/` 目录执行：

```bash
AI_LOCAL_BINDING_SECRET='local-release-readiness-secret-32-bytes!!' \
AUTH_DEV_BYPASS=true \
python3 scripts/run_harness_release_gate.py

AI_LOCAL_BINDING_SECRET='local-release-readiness-secret-32-bytes!!' \
AUTH_DEV_BYPASS=true \
python3 scripts/run_ga_gate_local.py --json

AI_LOCAL_BINDING_SECRET='local-release-readiness-secret-32-bytes!!' \
AUTH_DEV_BYPASS=true \
python3 scripts/run_migration_candidate_rehearsal.py --json

python3 scripts/run_staging_preflight.py --mode local --json
```

预期：Harness、GA、迁移候选演练和 local preflight 为 pass，且迁移候选演练不改变仓库。任何命令的 pass 都不能替代待外部证据项目。

## 进入正式发布前的顺序

1. 数据库负责人提供各目标库的 `alembic current/heads/history`、`alembic_version`、备份和回滚窗口证据。
2. 根据迁移决策包选择候选 A 或 B；在临时副本回放后，先在 staging 单实例验证。
3. 注入 staging 授权和 HTTPS，完成真实固定任务集、强杀接管、直连副作用对账和双 Runtime shadow。
4. 开始连续观测；只有达到窗口和 SLO 门槛，才允许灰度和版本发布。
5. 每次灰度阶段保留 release artifact、preflight、测试、迁移、观测和回滚证据的同一 `release_id`。

## 明确禁止

- 不把 `AUTH_DEV_BYPASS` 当作 staging/生产授权。
- 不把本地唯一 head 结果当作目标数据库历史、升级/回滚和备份证据。
- 不把本地临时 SQLite、离线评测或 Runtime shadow fixture 当成生产稳定性证明。
- 不在未授权时读取真实 Token、执行真实迁移、切换 `real` Runtime、升级版本、commit 或 push。
