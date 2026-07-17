# 4.0 provider reconciliation：本地演练

4.0 的业务模板只负责生成 Outbox 副作用意图；`WorkflowControlWorker` 负责租约、重试和最终状态。真实短信、邮件或企业微信 provider 通过 `NotificationProvider` 注入，不改变模板代码。

## 本地 fake provider

```python
from app.provider_reconciliation import FakeNotificationProvider
from app.workflow_control_worker import WorkflowControlWorker

fake = FakeNotificationProvider({
    "run-1:notify": ["failure", "success"],
    "run-2:notify": "timeout",
})
worker = WorkflowControlWorker(settings, notification_provider=fake)
```

可用场景：`success`、`failure`、`timeout`/`unknown`、`duplicate`。同一个 `idempotency_key` 的第二次成功调用只返回 `replayed=true`，不会增加 `effect_count`。

## 状态语义

- `success`：写入 provider receipt，Outbox 变为 `sent`。
- 明确 `failure`：按既有退避策略重试；达到最大次数后变为 `reconciliation_required`。
- `timeout`/未知异常：立即变为 `reconciliation_required`，`next_attempt_at` 清空，后续 tick 不会再次调用 `send`。
- 对账只能调用 `provider.reconcile(row)`。只有 provider 明确返回 `succeeded` 才能变为 `sent`；`failed` 和仍然 `unknown` 保持对账状态，不会盲目补发。

provider 元数据保存在 Outbox `payload_json._provider_reconciliation`，包含 provider、outcome、receipt、错误码和阶段，便于审计与恢复。真实 provider 组装发送内容时必须忽略这个以下划线开头的保留字段。

## 回归测试

在 `server` 目录运行：

```bash
python3 -m pytest tests/test_provider_reconciliation.py tests/test_workflow_business_templates.py tests/test_workflow_control_worker.py -q
```

测试使用内存 SQLite、fake provider，无网络、真实凭证、staging 环境或共享数据库。真实 provider 接入前必须先实现幂等键查询和对账接口；确认未产生副作用后才允许新建 idempotency key。
