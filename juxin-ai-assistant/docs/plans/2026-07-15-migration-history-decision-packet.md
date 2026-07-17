# 正式迁移历史决策包

日期：2026-07-15
范围：聚信 AI 助手迁移图、候选修复和正式执行门槛

## 1. 结论先行

当前仓库的 Alembic 图有两个 head：

```text
0045_agent_langgraph_checkpoints
0051_professional_delivery
```

本地临时副本已经验证：

- 当前图在升级时会 fail-closed，并明确报告 multiple heads；
- 候选 A（把 `0046_project_workspace_foundation` 临时接到 `0045`）可以线性升级和回滚；
- 候选 B（新增临时合并迁移，父版本为 `0045` 和 `0051`）也可以升级和回滚。

在没有共享数据库版本历史的情况下，不能直接改 `0046.down_revision`，也不能直接新增正式 `0052`。如果已有数据库曾经应用过 `0046` 分支但没有 `0045`，候选 A 会把一个未必存在的前置迁移强行插入历史。正式修复应优先考虑候选 B，但必须先完成下文的只读历史核对并获得迁移授权。

## 2. 已确认的历史关系

| 迁移 | 当前父版本 | 主要对象边界 |
| --- | --- | --- |
| `0045_agent_langgraph_checkpoints` | `0044_harness_spec_registry` | LangGraph checkpoint 表、索引和唯一约束 |
| `0046_project_workspace_foundation` | `0026_agent_run_contracts` | 项目和项目成员基础表 |
| `0047_chat_workspace_columns` | `0046_project_workspace_foundation` | 聊天工作区字段和索引 |
| `0048_project_foundation_tables` | `0047_chat_workspace_columns` | 项目工作区相关表 |
| `0049_project_memory_file_artifact` | `0048_project_foundation_tables` | 项目记忆、文件、产物及分类字段 |
| `0050_project_task_delivery_activity` | `0049_project_memory_file_artifact` | 项目任务、交付物、问题和活动 |
| `0051_professional_delivery` | `0050_project_task_delivery_activity` | 专业交付域表 |

因此，`0045` 是一条 checkpoint 分支，`0046` 到 `0051` 是从 `0026` 延伸出的项目/专业交付分支。仓库本地不能推断所有共享数据库是否已经执行过其中某一支。

## 3. 候选方案与选择规则

### 候选 A：线性化 `0046` 的父版本

仅在临时副本中将：

```python
down_revision = "0026_agent_run_contracts"
```

替换为：

```python
down_revision = "0045_agent_langgraph_checkpoints"
```

优点是最终只有一个 head，迁移历史直观。风险是已有数据库可能处于 `0046` 至 `0051`，但没有 `0045`；这会造成 Alembic 认为缺少前置历史，甚至要求执行与既有数据库状态不匹配的迁移。只有在所有目标数据库都能证明 `0045` 已应用或项目从未落后于该版本时才可采用。

### 候选 B：新增正式合并迁移（推荐）

新增一个正式迁移（版本号以仓库实际约定为准），父版本同时指向：

```python
down_revision = (
    "0045_agent_langgraph_checkpoints",
    "0051_professional_delivery",
)
```

合并迁移本身应保持幂等、无业务副作用，并只负责收敛迁移图。它保留两条既有历史，不要求已经存在的数据库重新“补跑”另一支，通常更适合未知或多环境历史。仍需先确认目标数据库没有重复对象、脏迁移或手工改表。

### 决策规则

1. 任何目标数据库出现“当前在 `0046`~`0051`，且没有 `0045`”时，禁止候选 A，选择候选 B。
2. 所有目标数据库都确认包含 `0045`，且没有分支历史差异时，候选 A 可评估；候选 B 仍是更保守的默认方案。
3. 任一环境无法提供版本历史、备份或回滚窗口时，保持当前 fail-closed，不执行正式修复。

## 4. 获得授权后，先做只读核对

以下命令只用于目标环境核对，当前未执行：

```bash
cd /path/to/juxin-ai-assistant/server
python3 -m alembic current
python3 -m alembic heads
python3 -m alembic history --verbose
```

还需要由有权限的数据库运维人员提供：

- `alembic_version` 中所有实例的当前 revision；
- 备份时间、恢复演练结果和目标库大小；
- 0045 checkpoint 表、0046~0051 项目/交付表是否已存在；
- 是否有手工 DDL、跳过迁移或多副本并行发布；
- 维护窗口、锁等待上限和明确回滚负责人。

禁止把数据库密码、token 或连接串写入仓库、终端日志或证据 JSON。

## 5. 正式变更的 go/no-go 门槛

### Go 条件

- 共享数据库版本历史已核对并存档；
- 已选择 A 或 B，并由负责人确认；
- 备份可恢复，且恢复结果通过最小抽样校验；
- 迁移前后 `alembic current`、表清单和关键索引均有证据；
- 单实例先行，观察窗口内无锁超时、重复对象或应用错误；
- staging 双 Runtime、连续观测和授权链路已完成（用户当前选择最后再做，因此暂不进入正式执行）。

### No-go 条件

- 仍然是 multiple heads 且没有经过候选副本验证；
- 任何数据库的 revision 分布不明；
- 没有可验证的备份或回滚窗口；
- 需要临时关闭鉴权、绕过策略或暴露真实密钥；
- staging/生产证据不完整，或连续观测尚未开始。

## 6. 回滚语义

- 候选演练的 downgrade 只证明临时副本可逆，不等同于生产数据可逆。
- 正式迁移前必须确认每个 downgrade 不会删除已被新版本写入的数据；必要时采用前向修复而不是物理回滚。
- 迁移失败时先停止发布、保留错误和 revision 证据，再按备份恢复或执行已批准的前向修复；不得直接手工修改 `alembic_version`。

## 7. 本地可重复演练

在不触碰真实环境的前提下，可重复运行：

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/server
AI_LOCAL_BINDING_SECRET='local-migration-rehearsal-secret-32-bytes!!' \
AUTH_DEV_BYPASS=true \
python3 scripts/run_migration_candidate_rehearsal.py
```

通过标准：`overall=pass`、`repository_unchanged=true`、`staging_or_network_used=false`，且当前图必须按预期 fail-closed，候选 A/B 的 upgrade 和 downgrade 均通过。该演练不替代共享数据库核对，也不构成 staging/生产授权。

## 8. 当前状态

本决策包已完成仓库内的安全准备；正式迁移仍保持暂停。下一步不是继续猜测迁移父链，而是由数据库负责人提供各目标环境的只读 revision 证据并确认候选方案。用户决定“staging 和授权最后再考虑”之前，系统继续使用当前 fail-closed 保护。
