# 7.0 Connector SDK 发布规范

> 对应主方案 §11.1 / §11.2 / §11.12：Agent 接入中心、能力注册协议、市场与低代码。

## 1. 目标

让内部与外部 Agent 以**统一契约**接入聚信 AI 助手 Agent Gateway，而无需了解厂商私有协议。平台提供：

| 能力 | 模块 |
|---|---|
| 能力描述 / 健康检查 / 调用 | `app.connector_sdk.base` |
| 限流 / 熔断 / 重试 | `app.connector_sdk.resilience` |
| 凭证加密与日志脱敏 | `app.connector_sdk.credentials` |
| 参考 HTTP 实现 | `app.connector_sdk.http_connector.HttpConnector` |
| 注册与路由 | `app.agent_hub.AgentHub` |

## 2. 最小契约

实现 `BaseConnector`：

```python
from app.connector_sdk import (
    BaseConnector,
    CapabilitySpec,
    ConnectorHealth,
    ConnectorMeta,
    InvokeRequest,
    InvokeResult,
)

class MyConnector(BaseConnector):
    def __init__(self) -> None:
        self.meta = ConnectorMeta(
            connector_id="vendor.my_agent",
            name="示例 Agent",
            vendor="acme",
            version="1.0.0",
            description="做摘要与问答",
            capabilities=(
                CapabilitySpec(
                    name="summary",
                    description="短摘要",
                    max_data_level="L1",
                    timeout_sec=30,
                    cost_per_call_micros=500,
                ),
            ),
            endpoint="https://example.internal/v1/invoke",
        )

    def health(self) -> ConnectorHealth:
        ...

    def invoke(self, request: InvokeRequest) -> InvokeResult:
        ...
```

### 2.1 字段说明

| 字段 | 要求 |
|---|---|
| `connector_id` | 小写字母数字 `._-`，全局唯一；`local.*` 保留给内置 |
| `capabilities` | 至少一个能力名，供智能路由打分 |
| `max_data_level` | `L0` 公开 … `L3` 机密；平台出域策略会拦截超限 |
| `timeout_sec` | 硬超时；默认 30s |
| `cost_per_call_micros` | 成本账本，单位微元/μ 货币 |

### 2.2 HTTP 约定（参考实现）

`POST {endpoint}` JSON：

```json
{
  "input_text": "用户任务文本（可能已脱敏）",
  "context": { "user_id": "...", "run_id": "...", "egress_level": 1 },
  "run_id": "...",
  "step_id": "..."
}
```

成功响应建议：

```json
{ "output": "结果文本", "usage": { "tokens": 120 } }
```

4xx 视为业务失败（不重试）；5xx / 网络错误进入重试与熔断。

## 3. 弹性默认值

| 组件 | 默认 |
|---|---|
| RateLimiter | 60 次 / 60 秒（每连接） |
| CircuitBreaker | 连续 5 次失败打开；30s 后半开探测 |
| RetryPolicy | 最多 3 次（含首次），指数退避 + jitter；仅网络/5xx |

熔断打开时返回 `error=circuit_open`，路由可切换备用 Agent。

## 4. 凭证与安全

1. **禁止**在前端、Prompt、普通日志中输出原始密钥。
2. 使用 `CredentialVault` + `CONTENT_ENCRYPTION_KEY` 落库；展示用 `mask_secret`。
3. 所有外部调用经 `evaluate_egress`：L3 机密仅本地/内部 Agent；L2 需确认。
4. 每次调用写入 `AgentCallLog` 与（如出域）`egress_audit`。

```python
from app.connector_sdk import CredentialVault, mask_secret

vault = CredentialVault(settings.content_encryption_key)
sealed = vault.seal({"api_key": raw_key}, aad="agent-credential:vendor.x")
# 日志
print(mask_secret(raw_key))  # abcd…****…wxyz
```

## 5. 注册到 Agent Hub

### 5.1 进程内

```python
from app.agent_hub import get_agent_hub, HttpExternalAgent, AgentDescriptor

hub = get_agent_hub()
hub.register_http(
    agent_id="acme.summary",
    name="Acme 摘要",
    description="外部摘要服务",
    endpoint="https://acme.example/invoke",
    capabilities=["summary", "http"],
    auth_header="Authorization: Bearer <token>",
)
```

### 5.2 HTTP API（管理员）

```http
POST /api/ai/agent-hub/agents/http
{
  "agent_id": "acme.summary",
  "name": "Acme 摘要",
  "endpoint": "https://acme.example/invoke",
  "capabilities": ["summary"],
  "auth_header": "Authorization: Bearer xxx",
  "cost_per_call_micros": 800
}
```

健康检查：

```http
GET /api/ai/agent-hub/health
GET /api/ai/agent-hub/health?agent_id=local.echo
```

市场授权：`POST /api/ai/agent-hub/market/{agent_id}/status` body `{"status":"authorized"}`。

## 6. 发布检查清单

- [ ] `connector_id` 与能力标签符合命名规范
- [ ] 合约测试：健康、成功调用、4xx、5xx、超时
- [ ] 出域：L2/L3 样本文本被正确拦截或脱敏
- [ ] 凭证加密存储，列表 API 不回显密钥
- [ ] 成本字段与审计字段完整
- [ ] 熔断打开后主任务可降级到 `local.*`
- [ ] 文档：能力说明、适用场景、数据等级、SLA

## 7. 与 6.0 的边界

- Connector **不**实现任务状态机、SSE、成果与引用系统。
- 每次外部调用必须挂在某个 `Run` / `Step` 上（`run_id` / `step_id` 传入）。
- 外部结果仍经内部 Reviewer / 质量规则，不得直接对客户发送。

## 8. 内置厂商连接器

| Agent ID | 厂商 | 环境变量 | 无密钥行为 |
|---|---|---|---|
| `kimi.chat` | Moonshot / Kimi | `KIMI_API_KEY` / `MOONSHOT_API_KEY`，可选 `KIMI_BASE_URL`、`KIMI_MODEL` | dry-run 摘要 |
| `jimeng.image` | 即梦视觉 | `JIMENG_API_KEY`，可选 `JIMENG_ENDPOINT` | dry-run 占位素材 + 审核标记 |

Settings 等价字段：`kimi_api_key`、`kimi_base_url`、`kimi_model`、`jimeng_api_key`、`jimeng_endpoint`。

即梦品牌策略：命中屏蔽词（如「竞品商标伪造」）返回 `brand_policy_blocked`；成功结果带 `review_required=true`。

```bash
# 本地 dry-run 调用
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Test-User-ID: dev' -H 'X-Test-Role: user' \
  -d '{"input_text":"请总结产品风险","egress_confirmed":false}' \
  http://127.0.0.1:18093/api/ai/agent-hub/agents/kimi.chat/invoke
```

## 9. 相关代码

| 路径 | 说明 |
|---|---|
| `server/app/connector_sdk/` | SDK 本体 |
| `server/app/connector_sdk/vendors/` | Kimi / 即梦实现 |
| `server/app/agent_hub.py` | Hub 注册与 HTTP 适配 |
| `server/app/agent_hub_routes.py` | REST |
| `server/app/data_egress.py` | 出域 L0–L3 |
| `server/app/agent_router.py` | 智能路由 |
| `server/tests/test_connector_sdk_and_security.py` | 合约测试 |
| `server/tests/test_vendors_and_checkpoint.py` | 厂商 + checkpoint |
