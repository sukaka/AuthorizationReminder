# 统一登录 OAuth2/OIDC 服务部署与接入

## 1. 本次交付与边界

统一登录服务位于同仓库 `auth/`，现已增加基于 `oidc-provider@9.12.2` 的 OIDC Provider。沿用已有账号、密码登录、扫码登录、MFA、IP 限制、应用访问权限和 MySQL 会话；不是另建一套账号系统。

已支持：OIDC Discovery、公开 JWKS、Authorization Code + S256 PKCE、RS256 ID Token、UserInfo、Token Revocation。授权码 60 秒，Access Token / ID Token 15 分钟，OIDC 会话 / Grant 最长 8 小时，且不能超过原统一登录会话的有效状态。

当前不提供：隐式授权、密码授权、客户端凭据授权、Refresh Token、动态客户端注册、OAuth Introspection 端点、RP-Initiated Logout。`/api/auth/introspect` 是旧业务接口，不能冒充标准 OAuth Introspection。

旧业务登录仍兼容；启用 OIDC 不会自动把现有应用的登录页面改成 OIDC。聚信助手后端可通过已有 Bearer 方式传递标准 Access Token，登录入口、回调、客户端会话仍需另外实施和联调。本次未执行真实数据库迁移、部署、版本升级、Git 提交或推送。

## 2. 服务端文件

| 文件（相对仓库根目录） | 用途 |
| --- | --- |
| `auth/oidc-config.js` | 配置校验，缺少安全配置则拒绝启用 |
| `auth/oidc-service.js` | 协议 Provider、已有登录交互与会话绑定 |
| `auth/oidc-adapter.js` | MySQL 持久化；AES-256-GCM 加密并绑定记录 model/id |
| `auth/oidc-schema.sql` | 需显式执行的建表脚本，不由服务自动执行 |
| `auth/index.js` | 协议挂载、原登录校验和业务权限桥接 |
| `auth/Dockerfile` | 默认 Node 24 LTS、协议模块打包 |
| `juxin-ai-assistant/deploy/oidc/compose.override.yml` | 为父仓库 Compose 注入 OIDC 环境变量 |

## 3. 启用前准备

先在独立测试环境验收，再安排生产切换。需要：固定的 HTTPS 登录域名、精确回调地址、持久密钥、Node 24 LTS、已备份数据库、限定代理链。

生产 issuer 示例：`https://login.example.com/oidc`。必须以 `/oidc` 结尾，不能有尾部斜杠、查询、片段或账号密码。启用后不要随意改 issuer，否则已有 ID Token 与客户端校验会失效。

仅开发时允许 `NODE_ENV` 非 production、`OIDC_ALLOW_HTTP_LOOPBACK=true` 且 issuer 为数字回环地址 HTTP。提供的 Compose 文件用于 HTTPS，不开启该开发例外。

### 3.1 环境变量

| 变量 | 配置要求 |
| --- | --- |
| `OIDC_ENABLED` | `true` 启用；默认 `false` |
| `OIDC_ISSUER` | 固定 HTTPS issuer |
| `OIDC_JWKS_JSON` | 私有 RSA JWK 集合；每把钥匙唯一 `kid`，`alg=RS256`、`use=sig`、RSA 至少 2048 位 |
| `OIDC_COOKIE_KEYS_JSON` | 随机 Cookie 签名密钥字符串数组；每项至少 43 字符，使用至少 32 随机字节的 base64url 编码 |
| `OIDC_STORAGE_KEY` | 32 随机字节的标准 base64 编码，用于持久化加密 |
| `OIDC_CLIENTS_JSON` | 管理员预注册客户端 JSON 数组，见下节 |
| `TRUST_PROXY_HOPS` | 实际可信代理跳数；不得使用任意代理信任，必须限制直连后端 |
| `AUTH_COOKIE_SECURE` | HTTPS 部署必须为 `true` |

原有 JWT、数据库、审计、账号初始化等配置仍需保留。OIDC 与旧登录使用独立签名密钥，不能把旧 JWT_SECRET 当作 RSA 私钥或存储密钥。

通过密钥管理系统或受限权限的外部配置注入变量；不要将真实值放入源码、接入文档、工单或聊天，也不要运行会打印完整环境配置的命令。`OIDC_JWKS_JSON` 含私钥；只有公开 JWKS 端点返回的内容可分发给客户端。

密钥必须跨服务重启保持不变。存储密钥当前不支持多钥匙解密，直接更换会使已有记录无法读取，需要安排全量会话失效和受控清理；不能静默轮换。Cookie 密钥轮换保留旧钥匙验签。签名密钥轮换须先验证协议库的签名钥匙选择行为，保留旧公钥至少覆盖既有 Token 有效期，不应仅假设数组顺序决定签名钥匙。

### 3.2 注册客户端

仅为运营方控制的可信一方应用注册客户端：服务会在用户有应用权限时自动批准授权，不提供第三方授权确认页面。不要对外开放注册。

Web 服务端客户端模板（占位值不是可用密钥或实际地址）：

```json
[
  {
    "client_id": "ai-assistant-web",
    "system_key": "ai-assistant",
    "token_endpoint_auth_method": "client_secret_basic",
    "client_secret": "REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES_BASE64URL",
    "redirect_uris": ["https://assistant.example.com/api/ai/oidc/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"]
  }
]
```

此回调路径只是接入方案示例，助手当前并未实现它，不能直接注册后就认为已完成接入。Web 客户端密钥必须保存在服务端，不能放入前端 JS。

桌面公共客户端使用 `token_endpoint_auth_method: "none"`、无 client_secret、数字回环回调（例如 `http://127.0.0.1:54321/callback`）。客户端必须实现本地回调监听，使用系统浏览器；不要用嵌入 WebView 收集密码。当前不支持自定义 scheme 回调。原生回环端口匹配遵循协议库的原生客户端规则，不应把服务端登记端口当成额外身份验证。

`system_key` 必须与现有应用权限键匹配；聚信助手为 `ai-assistant`。不配置通配回调，不登记他人控制的域名。仅支持 `authorization_code` 和 `code`，所有客户端都必须使用 S256 PKCE。

### 3.3 显式建表

由数据库管理员审查并在授权的目标数据库执行 `auth/oidc-schema.sql`。这里只列准备动作，不代表本次已执行。使用已有安全登录路径，不在命令行写密码：

```bash
# 从父仓库根目录执行；先确认目标实例与备份。
mysql --login-path=YOUR_APPROVED_LOGIN_PATH juxin_reminder < auth/oidc-schema.sql
```

表必须存在且运行账号有 SELECT/INSERT/UPDATE/DELETE 权限。启用时会检查表列可读，缺表即启动失败；不自动创建新表。适配器读取时拒绝过期记录，后台清理可由运维定期执行小批量语句：

```sql
DELETE FROM auth_oidc_artifacts
WHERE expires_at <= UNIX_TIMESTAMP() LIMIT 1000;
```

清理必须针对确认的数据库，经授权执行；过期不依赖清理及时性。Grant 撤销按 grant_id 清理关联记录；授权码消费通过原子条件更新避免并发兑换。

### 3.4 HTTPS 路由

现有网关配置尚未统一增加 OIDC 路由。选择实际生效的 Nginx 配置增加以下路由，保持 `/oidc` 路径，不重写成 `/api/auth`：

```nginx
location ^~ /oidc/ {
    proxy_pass http://auth:5180;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

这是单层可信代理示例；多层代理应按实际拓扑调整并校验客户端 IP。后端端口只允许可信代理访问，防止伪造转发头。issuer 的同一 HTTPS origin 还需代理 `/portal` 和 `/api/auth/`，供现有登录、MFA、密码更新使用。不得缓存交互、Token 或 UserInfo 响应；OIDC Cookie 和门户 Cookie 必须可正常传递。

### 3.5 构建与启动

仅在完成环境注入、建表、HTTPS 路由和变更授权后，由运维执行。父仓库 Compose 默认不会自动传入新增变量，应叠加交付文件：

```bash
cd /Users/zhanglei/Documents/codex-new
docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml build auth
docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml up -d --no-deps auth
```

迁移机器使用实际仓库根目录。新 Dockerfile 使用 `AUTH_NODE_IMAGE`，不再使用通用 `NODE_20_BOOKWORM_SLIM_IMAGE` 构建参数。不要降回 Node 20；本地验证使用 Node 24.13.0。不要为了协议测试直接启动连接真实数据库的 `auth/index.js`。

## 4. 客户端接入流程

1. 从固定 issuer 获取 Discovery：`https://login.example.com/oidc/.well-known/openid-configuration`。校验返回 issuer 完全一致；端点以 Discovery 为准，不接受用户输入任意 issuer。
2. 创建一次性的随机 `state`、`nonce`、PKCE `code_verifier`，与发起登录的浏览器会话绑定，服务端或桌面内存保存，短时过期。
3. 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`，不带 `=` padding；使用 `S256`。
4. 跳转 `authorization_endpoint`，带 `client_id`、`response_type=code`、精确 `redirect_uri`、`scope=openid profile`、state、nonce、code_challenge、code_challenge_method。
5. 如未登录，会显示统一登录交互页；在门户完成登录/MFA/强制改密后，返回交互页点击继续。复用现有安全流程，目前不是一体化自动回跳体验。
6. 回调先处理 `error`，然后校验 state、发起会话与有效期，一次性消费 state，拒绝多次回调。
7. 服务端向 `token_endpoint` 发 form-urlencoded POST：`grant_type=authorization_code`、code、原 redirect_uri、code_verifier。机密客户端用 HTTP Basic 验证；公共客户端带 client_id、不带 secret。
8. 用公开 JWKS 校验 ID Token 的签名、仅允许 RS256，并校验 iss、aud、exp、nonce，适用时校验 azp、auth_time；未知 kid 可受控刷新 JWKS。不要只 base64 解码就信任身份。
9. 使用 Access Token 调用 UserInfo，确认 sub 与 ID Token 一致。sub 为稳定的原用户 ID 字符串，业务身份应以 `(issuer, sub)` 定位，而不是姓名或用户名。
10. Web 客户端建立自己的 Secure/HttpOnly/SameSite 会话，Token 放服务端，不放 localStorage、URL 或前端长期持久化；桌面 Access Token 保留内存、到期重新登录。不要把 ID Token 当作 API Access Token。

当前端点通常为 `/oidc/auth`、`/oidc/token`、`/oidc/jwks`、`/oidc/me`、`/oidc/token/revocation`；Discovery 是唯一准确来源。Access Token 是不透明值，不能按 JWT 解码，也不能使用 JWKS 在业务服务离线验证它。

## 5. 现有业务权限接口兼容

标准 Access Token 可用 Bearer 调用以下原有业务接口：

- `GET /api/auth/introspect`：取得现有用户/权限信息；仍不是标准 OAuth Introspection。
- `POST /api/auth/authorize`：沿用现有角色、部门、资源授权。
- `GET /api/auth/system-users?system=ai-assistant`：按原有规则查询目录。

Token 只可用于其注册 `system_key` 对应的授权检查和用户目录查询，不能调用管理接口、登录接口或另一应用的授权接口。OIDC 的 `profile.apps` 只是资料，不意味着跨系统通用 Bearer 权限。

示例请求语义：在 Authorization Header 中放 Access Token，向 `/api/auth/authorize` 发送 `{ "system": "ai-assistant", "action": "app:enter" }`。具体业务动作沿用现有接口契约，不由 OAuth scope 自动映射。

旧会话撤销、账号禁用、强制改密、要求补全 MFA、应用访问权收回、IP 限制会阻止后续使用 Token。已有 OIDC 会话与门户身份失配时，服务销毁该 OIDC 会话并返回 `login_required`；客户端应结束当前登录事务并重新发起授权，不能重复兑换旧授权码。取消应用权限后返回 `access_denied`。已签发 ID Token 本身不会被远程抹除；客户端本地会话有效期与重新检查策略必须自行控制。用户登出使用现有门户登出流程；本次没有提供 OIDC end_session_endpoint 或全应用单点登出。客户端可使用 Discovery 的 revocation_endpoint 撤销自己的 Access Token，不能撤销其他客户端的 Token。

## 6. 验收与回滚

本次本地验证：使用 Node 24.13.0 执行 `node --test tests/*.test.js`，179 项通过，含 10 项新增 OIDC 测试。协议测试覆盖公开原生客户端与服务端 Basic 认证、PKCE、签名/issuer/audience/nonce、授权码重放、Token 撤销与客户端隔离、源会话失效、应用权限撤销，只使用本机随机端口和内存账号/适配器。另执行语法检查与 `git diff --check`。未进行真实 MySQL 适配器集成、真实浏览器/MFA、Docker 构建或生产部署验证，不是 OIDC 官方一致性认证。

上线前必须在隔离环境补验：

- MySQL 建表、重启后的授权状态持久化、真实数据库并发兑换与过期清理。
- HTTPS Discovery / JWKS 的正确地址与公开密钥，Cookie Secure、Host 与代理 IP。
- 正常登录、扫码/MFA、强制改密、prompt=login/max_age、账号切换与权限不足。
- 真实客户端 state/nonce/PKCE、错误回调、重放、ID Token 校验与 Token 撤销。
- 会话撤销、账号禁用、系统权限收回，以及旧系统登录/授权回归。

回滚时设置 `OIDC_ENABLED=false` 并重新创建 auth 容器；协议端点返回 404，旧业务接口仍用旧 JWT 会话。关闭前应通知已切换的 OIDC 客户端，否则它们会无法登录/校验 Access Token。保留表和密钥以便排查和恢复，不自动删除数据。旧版 Node 20 镜像回退需要使用与该运行时匹配的旧依赖镜像，不能仅更改新 Dockerfile 的 Node 参数。

协议依据：[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html)、[原生应用 OAuth 最佳实践 RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)、[oidc-provider 官方项目](https://github.com/panva/node-oidc-provider)。
