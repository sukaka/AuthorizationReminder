# 微信公众号外部访问部署说明

该功能默认关闭。外部访客通过公众号网页授权获得本应用 `openid` 的不可逆 HMAC 摘要，并使用 HttpOnly Cookie；不需要注册，也不会保存原始 `openid`。

## 上线前配置

1. 准备已认证公众号和独立 HTTPS H5 域名；在公众号后台登记网页授权回调域名，并将菜单链接指向 H5。
2. 在服务端环境注入 `WECHAT_EXTERNAL_ENABLED=true`、`WECHAT_OFFICIAL_ACCOUNT_APP_ID`、`WECHAT_OFFICIAL_ACCOUNT_APP_SECRET`、`WECHAT_OAUTH_REDIRECT_URI`、`WECHAT_EXTERNAL_H5_ORIGIN`、`WECHAT_EXTERNAL_SESSION_SECRET`、`WECHAT_OPENID_HASH_SALT`。
3. 配置 `KNOWLEDGE_REDIS_ENABLED=true` 与可用 Redis。外部额度 Redis 不可用时会失败关闭并返回 503。
4. 构建并托管 `apps/wechat-h5`，使其能以同一 HTTPS API 域名访问 `/api/wechat/external`。
5. 仅由管理员将已审核、已启用 RAG 的正式知识文件设置为 `external_public=true`；公开状态撤销后已有下载令牌会立即失效。

额度为同一公众号 `openid`：滚动 60 分钟最多 15 次，Asia/Shanghai 自然日最多 30 次。不要将任何公众号密钥、OAuth code/token、原始 `openid` 或下载令牌记录到日志。

## 回滚

紧急回滚可将 `WECHAT_EXTERNAL_ENABLED` 改为 `false`，或撤销单个文件的 `external_public`，无需删除资料或清空 Redis。
