# 客服系统调用聚信助手 API 实施方案

## 目标

为第三方客服系统提供一个独立、可审计、幂等的问答 API。客服系统提交客户问题后，由聚信助手仅基于已审核且允许外部公开的知识生成回答；没有可靠依据或输出不安全时，自动创建人工客服工单。

## 范围

- 新增 `POST /api/ai/customer-service/v1/messages`，同步返回回答或转人工结果。
- 新增 `GET /api/ai/customer-service/v1/messages/{message_id}`，用于重试或查询已处理结果。
- 使用按接入方分配的 HMAC-SHA256 凭据、短时间戳窗口和常量时间比较完成鉴权。
- 使用“接入方 + 外部消息 ID”做持久化幂等；问题与回答均加密落库。
- 仅检索 `external_public=true` 的已审核官方知识，不向外部请求开放通用 Agent 工具权限。
- 复用现有外部问题事件、回答安全检查和人工工单机制。

## 不在本次范围

- 客服平台厂商特有的回调协议和主动推送。
- 图片、语音、文件等多模态消息。
- 管理后台中的凭据配置 UI。
- 生产环境密钥配置与部署。

## 接口约定

请求头：

- `X-Juxin-Credential`：接入方凭据 ID。
- `X-Juxin-Timestamp`：Unix 秒级时间戳。
- `X-Juxin-Signature`：`v1=<hex hmac-sha256>`。

签名内容为 `timestamp + "." + canonical_json(body)`；凭据通过环境变量 `CUSTOMER_SERVICE_API_CREDENTIALS` 注入，不写入仓库。

请求体：

```json
{
  "message_id": "msg-10001",
  "conversation_id": "session-9001",
  "customer_id": "customer-42",
  "message": "你们的售后服务时间是什么？",
  "metadata": {}
}
```

响应包含 `request_id`、`message_id`、`status`、`answer`、`sources`、`handoff_required` 和可选的 `ticket_id`。

## 实施步骤

1. 为外部问题事件增加加密回答字段并编写 Alembic 迁移。
2. 实现客服 API 凭据解析、签名生成与验证。
3. 实现只读公开知识的问答服务和幂等结果读取。
4. 新增路由并接入 FastAPI 主应用。
5. 先写失败测试，再实现至通过；覆盖鉴权、篡改、公开知识边界、转人工和幂等。

## 验证命令

```bash
cd server
python3 -m pytest -q tests/test_customer_service_api.py -ra
python3 -m pytest -q tests/test_external_answer_safety.py tests/test_external_support_tickets.py tests/test_external_hot_questions.py tests/test_wechat_external_security.py -ra
python3 -m alembic heads
python3 scripts/run_migration_candidate_rehearsal.py --json
python3 scripts/run_harness_release_gate.py
cd ..
git diff --check
```

## 验证结果

- 客服 API 与相邻外部回答链路：18 项通过。
- 迁移测试：26 项通过；Alembic 单一 head 为 `0072_external_answer_cipher`。
- 本地迁移候选升级/降级回放：通过，未访问网络或 staging，仓库未被修改。
- 将现有 `0068`–`0070` 迁移改为 batch 模式，保证干净发布快照可在 SQLite 完成回放。
- Harness 发布门禁：278 项通过，9 项因可选依赖未安装跳过。
- 完整后端测试：1470 项通过、10 项跳过、3 项失败。失败来自本次改动前已存在的工作区差异：桌面 Nginx 测试期望旧服务地址，以及桌面 bootstrap 测试期望 `localhost`、当前配置返回 `127.0.0.1`；均不涉及客服 API。
- HTTPS Compose 覆盖文件配置解析通过；`git diff --check` 通过。
- 按功能优化规则将版本从 `5.17.3` 升级至 `5.18.0`；未访问生产或 staging。
