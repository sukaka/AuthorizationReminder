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
| Harness 清单和发布证据身份一致 | Harness `261 passed, 9 skipped`；证据回归 `50 passed`；schema `1.4` | 已证实（本地） | staging artifact 的 `release_id`、HTTPS `base_url`、迁移 head 和测试报告完全一致 |
| Alembic 迁移图唯一 head | `python3 -m alembic heads` 当前为 `0045...` 与 `0051...`；local preflight fail-closed | 禁止放行 | 共享数据库历史核对后批准候选 A 或 B，并在临时副本和目标库各自验证 upgrade/downgrade |
| staging 授权与 HTTPS 传输 | `run_staging_preflight.py --mode local` 只验证配置形状 | 待外部证据 | 授权 Bearer 仅通过环境变量注入；HTTPS、最小权限、过期和撤销路径均有证据 |
| 真实固定任务集和连续观测 | `run_ga_gate_local.py` 只覆盖离线/本地演练；观测 evaluator 已有 | 待外部证据 | staging/生产连续观测达到方案阈值；缺失日期、双 owner、待对账、P0 均阻断放量 |
| 版本、提交和推送自动化 | 根仓库 `npm run test:versioning`：`56 passed` | 已证实（未执行发布） | 用户明确授权后按 major/minor/patch 规则 bump、commit、push；未授权前保持版本不变 |

桌面测试确定性补充：`apps/desktop/vite.config.ts` 的 Vitest 已设置 `fileParallelism: false`、`maxWorkers: 1`。配置变更后 `npm run typecheck && npm test -- --reporter=dot` 为 `36` 个测试文件、`272` 个测试全部通过；这只约束本地测试调度，不改变产品运行时并发。

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

预期：Harness 和 GA 为 pass；迁移候选演练为 pass 且仓库不变；local preflight 只因当前正式迁移双 head fail-closed。任何命令的 pass 都不能替代待外部证据项目。

## 进入正式发布前的顺序

1. 数据库负责人提供各目标库的 `alembic current/heads/history`、`alembic_version`、备份和回滚窗口证据。
2. 根据迁移决策包选择候选 A 或 B；在临时副本回放后，先在 staging 单实例验证。
3. 注入 staging 授权和 HTTPS，完成真实固定任务集、强杀接管、直连副作用对账和双 Runtime shadow。
4. 开始连续观测；只有达到窗口和 SLO 门槛，才允许灰度和版本发布。
5. 每次灰度阶段保留 release artifact、preflight、测试、迁移、观测和回滚证据的同一 `release_id`。

## 明确禁止

- 不把 `AUTH_DEV_BYPASS` 当作 staging/生产授权。
- 不指定 `0045` 或 `0051` 任一 head 绕过 multiple-head 门禁。
- 不把本地临时 SQLite、离线评测或 Runtime shadow fixture 当成生产稳定性证明。
- 不在未授权时读取真实 Token、执行真实迁移、切换 `real` Runtime、升级版本、commit 或 push。
