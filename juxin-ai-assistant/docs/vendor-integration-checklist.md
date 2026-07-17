# 厂商连接器联调清单（Kimi / 即梦）

## 1. 环境变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Moonshot API Key | `sk-...` |
| `KIMI_BASE_URL` | 可选，默认 `https://api.moonshot.cn/v1` | |
| `KIMI_MODEL` | 可选，默认 `moonshot-v1-8k` | `moonshot-v1-32k` |
| `JIMENG_API_KEY` | 即梦/代理 API Key | |
| `JIMENG_ENDPOINT` | 文生图 HTTP 入口 | `https://proxy.internal/jimeng/v1/images` |
| `CONTENT_ENCRYPTION_KEY` | 凭证落库加密 | 32 字节 urlsafe base64 |

无密钥时 Hub 仍注册 `kimi.chat` / `jimeng.image`，以 **dry-run** 返回可联调的占位结果。

## 2. 冒烟步骤

```bash
# 健康
curl -s -H 'X-Test-User-ID: admin' -H 'X-Test-Role: admin' \
  "$BASE/api/ai/agent-hub/health" | jq .

# Kimi dry-run / live
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Test-User-ID: dev' -H 'X-Test-Role: user' \
  -d '{"input_text":"总结三点风险","egress_confirmed":true}' \
  "$BASE/api/ai/agent-hub/agents/kimi.chat/invoke" | jq .

# 即梦（含品牌策略）
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Test-User-ID: dev' -H 'X-Test-Role: user' \
  -d '{"input_text":"蓝色科技风封面","egress_confirmed":true}' \
  "$BASE/api/ai/agent-hub/agents/jimeng.image/invoke" | jq .

# 预置工作流
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'X-Test-User-ID: dev' -H 'X-Test-Role: user' \
  -d '{"input_text":"为季度复盘写摘要并生成封面","egress_confirmed":true}' \
  "$BASE/api/ai/workflows/vendor_kimi_jimeng/run" | jq .
```

## 3. 验收标准

- [ ] 无密钥：dry-run `ok`，输出含 `[kimi-dry-run]` / `[jimeng-dry-run]`
- [ ] 有密钥：真实 HTTP 2xx，latency 记录到 call log
- [ ] L2/L3 样本文本未经确认时 `egress_denied`
- [ ] 即梦屏蔽词返回 `brand_policy_blocked`
- [ ] 成功结果 `review_required=true`（即梦）
- [ ] 市场可授权 / 停用；停用后 invoke 403
- [ ] 运营看板显示 Hub 健康与成本

## 4. 安全注意

- 密钥只存在服务端 env / 加密 vault，不进前端与 Prompt
- 日志使用 `mask_secret`
- 生产默认关闭 `learning_auto_publish`
