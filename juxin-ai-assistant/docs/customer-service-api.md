# 客服系统接入聚信 AI 助手

## 接口边界

客服系统通过服务端接口调用聚信 AI 助手，不需要模拟桌面端登录。该接口默认关闭，启用后也只会检索同时满足以下条件的知识：

- 公司级正式知识；
- 已审核、已解析、已索引；
- 明确标记为“允许外部公开”。

没有公开依据或模型输出未通过安全检查时，接口不会猜测回答，而是创建人工工单并返回 `HANDOFF`。

## 服务端配置

通过环境变量配置，不要把真实密钥写入仓库：

```dotenv
CUSTOMER_SERVICE_API_ENABLED=true
CUSTOMER_SERVICE_API_CREDENTIALS={"crm-prod":{"secret":"替换为至少32字节的独立随机密钥"}}
CUSTOMER_SERVICE_API_SIGNATURE_TOLERANCE_SECONDS=300
CUSTOMER_SERVICE_API_MODEL_MAX_OUTPUT_TOKENS=1200
```

部署时必须使用 HTTPS。每套客服系统使用独立的 `credential_id` 和密钥；轮换密钥时可先增加新凭据，切换调用方后再删除旧凭据。
仓库内的 `docker-compose.ai-assistant-https.yml` 已将上述变量传入 API 容器；部署时需和基础 Compose 文件一起加载该覆盖文件。

## 签名规则

请求头：

```text
X-Juxin-Credential: crm-prod
X-Juxin-Timestamp: Unix 秒级时间戳
X-Juxin-Signature: v1=<hex HMAC-SHA256>
```

签名输入为：

```text
timestamp + "." + canonical_json(payload)
```

`canonical_json` 使用 UTF-8、键名排序、无多余空格并保留中文。签名时间默认允许前后偏差 300 秒。

## 发送客户问题

```http
POST /api/ai/customer-service/v1/messages
Content-Type: application/json
```

请求体：

```json
{
  "message_id": "crm-message-001",
  "conversation_id": "conversation-001",
  "customer_id": "customer-001",
  "message": "你们的客服时间是什么？",
  "metadata": {
    "locale": "zh-CN"
  }
}
```

- `message_id`：客服系统内唯一消息编号，同一凭据下作为幂等键。
- `conversation_id`：会话编号。
- `customer_id`：客户编号，仅做隔离、审计和人工转接，不作为知识权限依据。
- `message`：客户问题，最多 2000 字符。
- `metadata`：可选透传上下文，最多 8 KiB；当前不持久化，也不参与模型回答。

`message_id`、`conversation_id` 和 `customer_id` 都不会以原文落库；服务端使用独立审计盐生成不可逆摘要。问题与回答使用内容加密密钥加密保存。

Python 签名与调用示例：

```python
import hashlib
import hmac
import json
import os
import time
import urllib.request

payload = {
    "message_id": "crm-message-001",
    "conversation_id": "conversation-001",
    "customer_id": "customer-001",
    "message": "你们的客服时间是什么？",
    "metadata": {"locale": "zh-CN"},
}
timestamp = str(int(time.time()))
canonical = json.dumps(
    payload,
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
).encode("utf-8")
secret = os.environ["JUXIN_CUSTOMER_SERVICE_SECRET"].encode("utf-8")
signature = hmac.new(
    secret,
    timestamp.encode("ascii") + b"." + canonical,
    hashlib.sha256,
).hexdigest()
body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
request = urllib.request.Request(
    "https://你的聚信地址/api/ai/customer-service/v1/messages",
    data=body,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Juxin-Credential": "crm-prod",
        "X-Juxin-Timestamp": timestamp,
        "X-Juxin-Signature": f"v1={signature}",
    },
)
with urllib.request.urlopen(request, timeout=30) as response:
    print(response.read().decode("utf-8"))
```

成功回答示例：

```json
{
  "request_id": "39a5d61e-6c61-4bcd-aab5-339ee40dc369",
  "message_id": "crm-message-001",
  "status": "ANSWERED",
  "answer": "客服服务时间为每天 9:00 至 18:00。\n\n资料来源：客户服务说明.pdf",
  "sources": [
    {"file_uuid": "...", "file_name": "客户服务说明.pdf"}
  ],
  "handoff_required": false,
  "ticket_id": "",
  "replayed": false
}
```

同一个 `message_id` 和相同内容可安全重试，返回相同 `request_id` 和已加密保存的回答，并标记 `replayed: true`。同一 `message_id` 对应不同客户、会话或问题时返回 `409 CUSTOMER_SERVICE_IDEMPOTENCY_CONFLICT`。

## 查询处理状态

```http
GET /api/ai/customer-service/v1/messages/{message_id}
```

GET 请求的签名载荷固定为：

```json
{"message_id":"crm-message-001"}
```

返回状态包括：

- `PROCESSING`：正在生成；
- `ANSWERED`：已根据公开知识回答；
- `HANDOFF`：已转人工，`ticket_id` 非空；
- `FAILED`：上游处理失败，可换用新的 `message_id` 重试。

## 上线顺序

1. 先执行 Alembic 数据库迁移。
2. 配置独立凭据并重启 API 服务。
3. 在后台将允许对外使用的正式知识显式设为“允许外部公开”。
4. 使用测试客户和测试消息验证 `ANSWERED`、重复请求、无依据转人工三条路径。
5. 接入生产客服系统，并监控 `401`、`409`、`HANDOFF` 和 `FAILED` 比例。
