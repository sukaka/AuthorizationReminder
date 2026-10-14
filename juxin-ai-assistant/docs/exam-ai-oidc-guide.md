# 考试系统与 AI 助手 OIDC 切换手册

## 1. 范围与实际状态

只切换 `train-exam`（考试系统）和 `ai-assistant`（聚信 AI 助手）。投标、工单、大屏、提示词中心、FAQ、库存、实施管理、CMDB、设备流程、提醒、交付保持原有登录方式。本次没有重新建立账号库，也不改变原有角色、部门、应用权限。

源码接入已实施；真实环境启用、建表和 HTTPS/MySQL/桌面联调尚未执行。不能仅更新镜像就认为切换完成。配置中的域名必须替换成实际地址，密钥必须通过环境变量或密钥管理服务注入，不能提交仓库。

## 2. 工作方式

浏览器访问应用的 `/api/oidc/<system>/login`，经统一登录完成授权码 + S256 PKCE，回到同一应用 origin 的 callback。auth 中的集中 BFF 校验 state、浏览器绑定、nonce、RS256 签名、issuer、audience，再建立应用会话。

浏览器只保存 Secure、HttpOnly、SameSite=Lax 的随机会话句柄；Access/Refresh Token 和事务信息在 auth 的既有 OIDC 表中加密保存，不进入前端存储。两个应用使用不同 Cookie，即使同一主机不同端口也不会覆盖彼此。

| 系统 | 登录/回调路径 | 会话 Cookie |
| --- | --- | --- |
| 考试 | `/api/oidc/train-exam/login`、`/api/oidc/train-exam/callback` | `__Secure-juxin_oidc_train_exam` |
| AI | `/api/oidc/ai-assistant/login`、`/api/oidc/ai-assistant/callback` | `__Secure-juxin_oidc_ai_assistant` |

业务 API 把句柄作为 Bearer 发给 auth，同时携带自身固定的 `X-Juxin-OIDC-System`；auth 解析为对应应用的 Access Token，继续检查门户会话、账号、MFA、密码、IP 和权限。开启严格模式后，不接受旧 JWT 作为这两个系统的登录凭据；其他系统仍兼容旧 JWT。

Access Token 15 分钟，接近到期由服务端刷新；业务会话最长 8 小时，不能绕过门户会话撤销。Refresh Token 只开放给已登记的这两个机密 RP，不开放给其他客户端。

## 3. 确认三个 HTTPS 地址

先确定且固定以下 origin，协议、主机、端口必须完全一致：

- 登录：例如 `https://login.example.com`，`AUTH_PUBLIC_URL` 使用此值，`OIDC_ISSUER` 为此值加 `/oidc`。
- 考试：例如 `https://exam.example.com`。
- AI：例如 `https://assistant.example.com`。

现有 Compose 可以使用 HTTPS 端口（门户通常 8443、考试 18087、AI 独立入口 18093），但必须登记实际完整 origin。AI 如选择门户网关 8443 作为入口，就不能同时把 18093 当作同一客户端的默认登录入口。不要混用 IP、localhost、域名或不同端口；Cookie、Origin 校验和 redirect_uri 都会受影响。不要沿用默认的 HTTP auth:5180 作为浏览器登录地址。

## 4. 注册配置

Provider 基础配置和密钥要求见 [统一登录部署手册](oidc-integration-guide.md)。保留已有数据库、JWT 和账号安全配置。

`OIDC_CLIENTS_JSON` 包含两个客户端，若已有其他注册项，保留它们。以下仅为模板，`client_secret` 必须替换为独立的至少 32 随机字节 base64url 编码：

```json
[
  {
    "client_id": "train-exam-web",
    "system_key": "train-exam",
    "client_secret": "REPLACE_WITH_EXAM_RANDOM_SECRET",
    "token_endpoint_auth_method": "client_secret_basic",
    "redirect_uris": ["https://exam.example.com/api/oidc/train-exam/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"]
  },
  {
    "client_id": "ai-assistant-web",
    "system_key": "ai-assistant",
    "client_secret": "REPLACE_WITH_AI_RANDOM_SECRET",
    "token_endpoint_auth_method": "client_secret_basic",
    "redirect_uris": ["https://assistant.example.com/api/oidc/ai-assistant/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"]
  }
]
```

`OIDC_RP_APPS_JSON` 与上面严格对应，app_url 只能是 HTTPS origin，无子路径、查询或片段：

```json
[
  {"system":"train-exam","client_id":"train-exam-web","app_url":"https://exam.example.com/"},
  {"system":"ai-assistant","client_id":"ai-assistant-web","app_url":"https://assistant.example.com/"}
]
```

客户端覆盖文件设置 `OIDC_RP_REQUIRED_SYSTEMS=train-exam,ai-assistant`。缺少任一应用、Provider 未启用、非 Basic 机密客户端或回调不匹配，都拒绝启动，不悄悄退回旧登录。Provider 启动时仅对这些 RP 自动开放刷新授权，不必在注册模板手工填写 refresh_token。

## 5. 数据库、代理与切换步骤

1. 在隔离环境备份并审查 `auth/oidc-schema.sql`，由管理员授权执行。若 Provider 已正确启用且表存在，不重复迁移。此次客户端接入无需增加考试或 AI 业务表。
2. 固定注入 `AUTH_PUBLIC_URL`、`OIDC_ISSUER`、持久 RSA 私有 JWKS、Cookie 签名密钥、存储加密密钥、两个 JSON 配置；`AUTH_COOKIE_SECURE=true`。确认 Node 24 和原有账号配置。
3. issuer origin 必须代理 `/oidc/`、`/portal` 和 `/api/auth/`；两个应用 origin 必须代理 `/api/oidc/` 到 auth:5180，保留 Cookie、Origin、Host 和 HTTPS 信息，不缓存响应。
4. 入口代理必须覆盖 `X-Real-IP`，正确构造 `X-Forwarded-For`，限定可信代理跳数并禁止公网直连 auth/业务后端。业务校验与 BFF 换码/刷新会转发来源 IP；若前面还有负载均衡，需按真实拓扑配置 real_ip，不能让任意客户端伪造转发头，也不能把所有 IP 加白名单解决误判。BFF 容器必须能够访问公开 issuer，并信任其证书。
5. 前端开关是构建参数，必须重建，不是仅修改容器运行环境。下面命令仅供运维在获得环境切换授权后执行，不代表本次已执行。

从父仓库实际根目录执行：

```bash
docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.clients.override.yml \
  build auth train-exam-api ai-assistant-api web-train-exam web-ai-assistant

docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.clients.override.yml \
  up -d --no-deps auth train-exam-api ai-assistant-api web-train-exam web-ai-assistant

# 根 Compose 网关挂载 https-nginx/default.conf，文件变化后必须重载。
docker compose -f docker-compose.yml restart ai-assistant-https
```

覆盖文件为两个后端设置 `AUTH_OIDC_REQUIRED=true` 和独立 Cookie 名，为两个前端设置 `VITE_OIDC_ENABLED=true`。没有叠加客户端覆盖文件时，默认不会强制切换。不要运行会把密钥展开输出的 `docker compose config`，也不要启动连接真实数据库的测试服务器。

## 6. 用户使用与退出

从统一门户选择考试或 AI，或者打开应用点击登录，即进入 OIDC 授权流程。尚未登录时，在提示页打开门户，完成密码/扫码/MFA/强制改密，再返回提示页点击“已完成登录，继续”；当前尚不是自动回跳体验。用户必须已有对应应用访问权限。

退出先清除对应应用的 RP 会话，再跳转门户 `logout=1`，由门户撤销原统一登录会话。退出端点只接受已登记应用 origin 的 POST。这里沿用门户全局注销，不是标准 OIDC end_session 或所有前端页面的即时广播退出；其他页面的后续请求会重新校验会话。

桌面助手使用远程 WebView 的同一应用接入，不在前端放机密客户端密钥。需确认桌面实际入口正是登记的 AI origin、导航允许登录域名及其 `/oidc/` 路径，完整验证跳转、Cookie 和注销。独立原生公共客户端/系统浏览器方案不属于本次两个 Web BFF 切换。

## 7. 验收清单与故障定位

- 两个新浏览器会话正常登录；已登录门户进入另一应用复用账号，并分别建立应用会话。
- 普通用户、管理员、无应用权限、禁用账号、强制改密、MFA、允许/不允许 IP 都按原规则执行。
- 旧 JWT 无法绕过严格模式；考试会话无法调用 AI 权限接口，反之亦然。
- 错误 state、nonce、签名、回调、重复授权码均拒绝；前端无 Access/Refresh Token。
- 超过 15 分钟访问能刷新；门户注销或权限撤销后不能继续刷新/请求。
- auth 重启后加密会话仍可读取；MySQL 并发消费拒绝重放。再验证桌面退出和重新进入。
- 未切换系统的登录/权限接口回归；不要顺带启用其他 RP。

| 现象 | 检查 |
| --- | --- |
| 登录路径 404 | 是否叠加客户端覆盖、RP 配置是否加载、实际入口 Nginx 是否有 `/api/oidc/` |
| Provider 启动失败 | 表存在、密钥格式、两个完整 RP、精确回调、Node 24 |
| callback 400 | 是否混用 origin/端口、事务 Cookie 是否携带、授权码是否过期/重放、BFF 到 issuer 的网络/TLS、来源 IP |
| 登录后 401 | 严格模式 Cookie 名、业务 API 系统头、门户会话、账号/MFA/改密/IP |
| 登录后 403 | 应用权限、具体业务权限、退出 Origin 是否准确 |

不得将授权码、Cookie、Token、私钥、client_secret 或整份环境变量粘贴到排障日志。

## 8. 回滚

移除客户端覆盖文件；清空 `OIDC_RP_APPS_JSON`、`OIDC_RP_REQUIRED_SYSTEMS`，否则门户仍生成 RP 登录链接。显式恢复两个后端 `AUTH_OIDC_REQUIRED=false`、原 Cookie 名（通常 `juxin_auth_token`），两个前端构建参数恢复 `VITE_OIDC_ENABLED=false`，重新构建并重建对应容器。只移除 Compose 文件可能保留旧配置/镜像，须确认新容器和前端产物确实恢复。

Provider 可继续启用供后续使用；若同时关闭 `OIDC_ENABLED`，先完成两个客户端回滚，否则它们会无法登录。保留表、持久密钥与原数据库，不删除数据；通知用户重新登录。恢复原有登录入口和门户 URL，验证两系统与未切换系统。

## 9. 本地验证记录

已通过：auth Node 24 全量 184 项；AI 前端 46 个文件、377 项；AI typecheck/build、考试前端 build、相关 Python 源码语法检查及 `git diff --check`。

AI Python 定向测试未运行成功：本机测试依赖不完整，默认 Python 缺 pydantic_settings，Python 3.12 缺 HTTP 依赖，临时安装还遇到 pyexpat 动态库符号问题。不能标记后端测试通过；需在完整依赖的隔离环境执行 `python3 -m pytest -q tests/test_auth.py tests/test_project_routes.py`。

真实 HTTPS/MySQL/浏览器/MFA/桌面、Docker 构建与上线验收均待完成。此次未升级版本、提交推送、部署或执行真实迁移。
