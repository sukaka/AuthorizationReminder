# 聚信 AI 助手 5.0 生产门禁 Runbook

本文是 5.0 候选从“可演示/可回归”进入生产发布的执行清单。当前分支仍保持 `VERSION=3.0.0`；没有完成全部门禁和授权，不得改成 `5.0.0`。

## 1. 发布前冻结

1. 确认分支、候选提交和数据库迁移目录已冻结，记录 `git rev-parse HEAD`、`VERSION` 和迁移 head。
2. 备份真实数据库，并验证备份可以在隔离库恢复；保留恢复耗时、行数校验和校验结果。
3. 导出当前 4.0 Workflow Ledger/Outbox 的未完成项，确认 5.0 不会重复消费或改变既有幂等键。
4. 由业务负责人确认企业范围、指标定义、通知收件人和高风险建议动作的人工审批人。

## 2. 代码和迁移验证

在仓库根目录执行：

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant
PYTHONPATH=server python3 -m compileall -q server/app server/tests
cd server
python3 -m pytest -q
git diff --check
```

在临时 SQLite 和目标数据库的隔离副本分别执行升级、降级、再次升级：

```bash
alembic upgrade 0062_enterprise_capability_evaluation
alembic downgrade 0056_workflow_control
alembic upgrade head
```

实际迁移前必须由 DBA 审核 SQL、锁等待、索引创建和回填批次；命令中的数据库 URL 只通过环境变量注入，不写入仓库或日志。

## 3. 授权与 Provider 门禁

- 用真实 SSO 测试内部员工、部门负责人、管理员、外部授权用户四类身份，验证组织/项目/审计日志不得越权。
- 使用 staging 的密钥管理和 Provider 连接，验证超时、限流、重试、幂等冲突和凭证轮换；禁止把生产密钥复制到本地或测试日志。
- 验证通知 Outbox 的邮件/IM/Provider 消费失败后可重试、可人工暂停，且不会绕过建议审批。

## 4. 运行可靠性演练

至少在 staging 做以下故障注入并留存结果：

1. 两个 Worker 同时领取同一计划/事件：只有一个 lease/fencing token 能提交副作用。
2. Worker 在执行中断电：恢复后继续同一 run，不新建重复业务事实。
3. 数据库短暂不可用：任务进入可观测的重试/失败终态，不丢失审计记录。
4. 篡改计划的组织、主体、策略版本或范围指纹：Worker 拒绝执行并产生告警。
5. 备份恢复后重新消费 Ledger/Outbox：结果与恢复前一致。

## 5. 灰度、回滚和监控

- 先对单组织、低风险建议动作灰度；观察成功率、P95 延迟、重试率、队列积压、审计写入失败和数据质量 unresolved 数量。
- 设定自动停止阈值：权限拒绝异常、重复副作用、fencing 失败、Provider 错误或队列积压超过业务阈值时停止灰度。
- 回滚应用版本前先暂停 5.0 调度和 Provider 消费；保留 Ledger/Outbox，不删除审计和快照；回滚后执行对账。
- 迁移回滚只允许按 DBA 审核的反向脚本执行，禁止直接删除新表或绕过备份。
- 监控必须能按组织、计划、workflow run、建议 action 和 idempotency key 追踪一条链路。

## 6. 版本升级与发布

只有前述门禁全部有证据、业务负责人和 DBA 明确批准后，才执行：

```bash
printf '5.0.0\n' > VERSION
git add VERSION
git commit -m "release: ai-assistant v5.0.0"
git push origin codex/ai-assistant-5.0
```

版本规则：大改版升第一位，功能优化升第二位，Bug 修复升第三位。当前候选未满足生产门禁，保持 `3.0.0`，不得提前执行上述发布命令。
