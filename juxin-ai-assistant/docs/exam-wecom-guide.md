# 培训考试系统接入企业微信

## 1. 实施范围与状态

本次实现企业微信**自建应用工作台入口 + 企业微信内网页免登 + 现有统一账号绑定 + 考试 OIDC 登录**。浏览器继续使用企业微信扫码。没有新增考试账号库，没有接入其他业务系统，没有实现消息通知、通讯录同步、自动开户、JS-SDK、微信小程序或电子监考。

代码修改在父仓库的 `auth/`，不是在考试系统里增加另一套登录。考试前后端复用已经实现的 OIDC 客户端和代理，仍需按照 [考试与 AI OIDC 切换手册](exam-ai-oidc-guide.md) 启用；本次不等于已经完成线上切换。

本地代码与模拟测试已通过；企业微信后台配置、真实 HTTPS/MySQL、手机和桌面客户端联调、Docker 构建及部署未执行。没有读取真实密钥，没有执行数据库迁移，没有升级版本、提交或推送。

## 2. 登录链路

员工从企业微信工作台打开下列入口；请把 `login.example.com` 替换成统一登录实际 HTTPS 域名：

```text
https://login.example.com/api/auth/sso/wecom/start?system=train-exam&entry=workbench
```

不要把企业微信授权 URL 直接填作工作台首页，否则不会生成浏览器绑定的 state Cookie。

1. 统一登录确认考试 `train-exam` OIDC 客户端已加载，未加载则拒绝此次入口登录。
2. 客户端 User-Agent 包含 `wxwork` 时，跳转企业微信网页授权 `snsapi_base`；普通浏览器走原扫码登录。
3. 企业微信回调统一登录。服务端校验 state 签名、随机 nonce、提供方和有效期，并清理本次 state Cookie。授权类型只能来自签名上下文，不能由回调查询参数覆盖。
4. 服务端用自建应用 Secret 换取服务端 access_token，再用 code 获取成员 UserId。只接受企业成员，不用 OpenId、手机号或姓名猜测账号。
5. UserId 必须唯一绑定到现有统一登录用户的 `wecom_id`。未绑定、重复绑定、账号禁用、IP 不允许均拒绝；MFA 和强制改密继续执行。
6. 门户根据用户应用权限进入考试 OIDC 登录入口 `/api/oidc/train-exam/login`，经原有授权码 + PKCE 流程建立考试会话。

企业微信身份授权和内部 OIDC 是两层协议，不能把企业微信 code 当作考试 Token 使用。企业微信 access_token 与应用 Secret 只在服务端使用。既有 OIDC 的应用会话令牌仍不交给网页 JavaScript。

“免登”不等于跳过安全策略：需要 MFA、首次改密、没有考试权限的账号不会直接进入考试。企业微信身份已作为第一因素时，不能再用企业微信消息作为第二因素，需管理员配置其他可用 MFA 方法。

系统管理员、审计员继续遵循已有的专属管理中心优先跳转规则，不会因为本入口绕过该规则；员工考试验收请使用实际拥有考试权限的普通测试账号。企业微信工作台仅提供入口，考试页面没有在本次进行移动端布局重构，应另外检查长题干、附件、提交和计时体验。

## 3. 上线前准备

准备实际统一登录 HTTPS 域名、考试 HTTPS 域名、企业 CorpID、培训考试自建应用 AgentId、同一个应用的 Secret，以及测试成员的企业微信 UserId。

- 先在浏览器验证考试 OIDC 已能正常登录、鉴权、退出；仅有 OIDC 源码或配置示例不够。
- 企业微信客户端必须能访问统一登录域名和考试域名，不能只在开发机 localhost 可用。
- 两个站点使用受客户端信任的 HTTPS 证书；保留 Cookie，不缓存登录和回调响应。反向代理不要丢失查询参数。
- 统一登录入口代理覆盖 `/portal`、`/api/auth/`、`/oidc/`；考试 origin 的 `/api/oidc/` 正确代理到 auth。
- auth 容器能出站访问 `qyapi.weixin.qq.com:443`，并能访问已登记的公开 OIDC issuer。不能关闭 TLS 验证解决证书问题。
- 企业微信 API 使用的出口公网 IP 需按管理后台要求加入可信 IP；有 NAT 时配置 NAT 出口 IP，不是容器私网 IP。
- 检查容器和服务器时钟，避免签名状态或授权码因时间问题失效。

## 4. 企业微信后台配置

管理员在企业微信管理后台创建或选择一个自建应用，名称建议“培训考试”。不要使用企业微信服务商/第三方应用凭据代替自建应用凭据。

1. 设置应用名称、简介、Logo 和可见范围，先只开放测试部门或测试成员。Logo 可使用此前生成的 750×750 PNG。
2. 记录该企业 CorpID、该应用 AgentId 和 Secret，确保三者来自同一企业、同一应用。
3. 应用主页填写上面的统一登录 `/api/auth/sso/wecom/start?system=train-exam&entry=workbench` 地址，不是考试首页，也不是 callback。
4. 在应用网页授权设置中，把**统一登录回调所在域名**配置为可信域名；按后台指引完成域名归属校验。校验文件由运维放在对应域名网站根路径，不能把任意校验文件上传接口暴露给公众。本次未自动生成或发布该文件。
5. 本次实际回调地址为 `https://login.example.com/api/auth/sso/wecom/callback`。如果后台另有企业微信授权登录/扫码登录域名设置，普通浏览器扫码也需配置该回调所在域名。可信域名输入格式以后台提示为准，不要把整条带查询参数的主页 URL 当成域名。
6. 配置应用可信 IP（如后台要求）。确认测试成员在应用可见范围内，且已加入该企业。
7. 保存应用并确认工作台可见；先完成下面的验收再扩大可见范围。

网页授权接口参考：[企业微信构造网页授权链接](https://developer.work.weixin.qq.com/document/path/91022)、[获取访问用户身份](https://developer.work.weixin.qq.com/document/path/91023)。官方页面在本次工具环境中无法直接读取，已用 [wechatpy 项目自身 OAuth 实现](https://github.com/wechatpy/wechatpy/blob/master/wechatpy/work/client/api/oauth.py) 交叉核对网页授权地址、scope 和网页身份接口。实际后台菜单名称和平台策略应以上线时后台为准，并必须真实联调。

## 5. 服务端环境配置

父仓库根 Compose 已转发这些变量；不需要把 Secret 写进源码或前端构建参数。由运维通过现有环境注入或密钥管理服务配置：

| 变量 | 内容 |
| --- | --- |
| `AUTH_PUBLIC_URL` | 实际统一登录 HTTPS origin，例如 `https://login.example.com` |
| `AUTH_WECOM_CORP_ID` | 企业 CorpID |
| `AUTH_WECOM_AGENT_ID` | 培训考试自建应用 AgentId |
| `AUTH_WECOM_SECRET` | 该自建应用 Secret，仅服务端 |
| `AUTH_COOKIE_SECURE` | 正式环境设为 `true` |
| `OIDC_ENABLED` | `true`，并完成原有 Provider 密钥、数据库和 issuer 配置 |
| `OIDC_RP_APPS_JSON` | 至少保留已登记的考试 RP；目前原客户端覆盖要求考试与 AI 两个 RP 都完整 |

状态有效期默认 300 秒，接口超时默认 5000 毫秒，沿用现有社交登录配置。不要为了排障延长状态有效期到不可控范围。

原客户端覆盖文件继续使用，不要为本次企业微信接入关闭 AI OIDC 或影响其他系统。两个 OIDC JSON、Secret、私钥的注入方式见原切换手册；不要发送到聊天、提交 Git 或运行会将它们全部展开到终端的 `docker compose config`。

环境准备完成并获得环境变更授权后，由运维在父仓库执行；**下面不是本次已经运行的命令**：

```bash
docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.clients.override.yml \
  build auth

docker compose -f docker-compose.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.override.yml \
  -f juxin-ai-assistant/deploy/oidc/compose.clients.override.yml \
  up -d --no-deps auth
```

这两个命令只适用于已经正常启用 OIDC 的环境。若之前没有启用，先按 OIDC 切换手册完成表结构、前后端构建开关、代理和首次切换；不能只重启 auth。变更环境变量后必须重建容器，单纯 `restart` 不加载新环境。

## 6. 绑定员工账号

管理员在现有统一登录用户管理中编辑用户：

1. 在企业微信管理后台读取成员的稳定 UserId/成员账号标识；不要填中文姓名、邮箱、手机号、OpenId 或企业 CorpID。
2. 填入该用户已有的“企业微信 ID”（`wecom_id`）字段，保留平台返回的原始大小写。
3. 确保账号启用、已有考试应用访问权限，并保留原部门和角色。企业微信可见范围不能替代系统权限。
4. 一个企业微信 UserId 只能绑定一个平台账号；不要手工改数据库绕过重复绑定校验。

本次不自动同步通讯录、不自动创建考试账号，也不新增数据库字段。业务身份与历史考试记录仍属于原账号。

## 7. 验收清单

- 企业微信手机端打开工作台应用；普通成员免扫码进入自己原账号的考试系统，历史记录正确。
- 企业微信桌面端重复上述操作；确认实际 UA 可识别为 `wxwork`，否则保留扫码，不把浏览器识别当作身份认证。
- 用普通浏览器打开同一工作台地址，仍可扫码并进入考试；其他原有密码/飞书登录不受影响。
- 未绑定成员、非企业成员、重复绑定、禁用用户、无考试权限、不允许 IP 均不可进入考试。
- 配置 MFA 的账号仍执行允许的第二因素；仅允许企业微信 MFA 的账号应拒绝该登录方式，先调整为独立因素。
- 首次强制改密、MFA 设置、新会话、已登录门户、退出后重进按原策略工作。
- 正常作答、切题、上传附件、提交、超时提交、刷新和返回工作台后重进，在手机端实际验证。
- 验证 Cookie 未被客户端拦截、考试 OIDC 回调成功；刷新超过 Access Token 生命周期后业务可继续使用。
- 错误或缺失 state、篡改回调 flow/system、过期或重复 code 均失败；重新从工作台入口发起，不刷新旧 callback。
- 缺少考试 RP 时入口拒绝登录，不回退为该入口的旧 JWT 授权；原有非企业微信登录入口仍保持原行为。

## 8. 排障与回退

| 现象 | 优先检查 |
| --- | --- |
| 工作台不显示 | 企业、应用可见范围、成员加入状态 |
| 跳到扫码而非内置免登 | 是否用企业微信内置浏览器、UA 是否包含 `wxwork`，不要在普通微信中验收 |
| 平台拒绝 redirect_uri | 可信域名、归属校验、AUTH_PUBLIC_URL 与实际访问 origin 是否一致 |
| 提示登录方式未配置 | 企业微信三项凭据完整、AUTH_PUBLIC_URL 安全、考试 RP 已加载；不能只配置企业微信而不配置 OIDC |
| 未获取到企业成员身份 | 是否为本企业可见成员、自建应用凭据正确，非成员 OpenId 不予登录 |
| 企业身份未绑定 | 管理后台绑定准确的 `wecom_id`，不是手机号或姓名 |
| 第三方登录暂不可用 | 可信 IP、应用凭据、服务器到企业微信网络/TLS、code 是否失效 |
| 登录请求失效 | 从入口重新开始，检查 HTTPS、state Cookie、跨域/代理、时钟；不要使用旧 callback 收藏夹 |
| OIDC 登录后 401/403 | 对应应用 Cookie、考试权限、IP/MFA/改密策略，参照 OIDC 手册 |
| 管理员进入管理中心 | 原有专属中心优先规则，使用普通考试成员验收 |

仅使用脱敏错误码与既有审计事件（`SOCIAL_LOGIN_SUCCESS`、`SOCIAL_LOGIN_FAILED` 等）排查。反向代理/APM 不要记录 callback 查询串；不要分享完整授权 URL、code、Cookie、Token、Secret 或环境文件。企业微信平台错误详情不直接回显给用户。

临时停用时先缩小或关闭企业微信应用可见范围、恢复原入口；如只停用企业微信登录，可由运维撤下 `AUTH_WECOM_SECRET` 的注入并重建 auth，但这也会停用原有企业微信扫码，须提前通知。不要清空 OIDC 配置或撤掉现有两个客户端覆盖；不删除用户绑定、历史考试数据和 OIDC 表。源码回退应使用已验收镜像，并保留已有用户未提交的其他改动。

## 9. 本地验证记录

- 原社交登录基线 16 项通过。
- 新增 4 个协议单元测试先失败后通过，覆盖工作台门禁、网页授权和签名上下文、回调参数不可指定协议、非成员拒绝。
- 新增 2 个实际路由注册隔离测试，包含多组成功与拒绝场景；不启动 HTTP 服务或连接数据库。
- `node --test tests/*.test.js`：统一登录 190 项全部通过。
- `node --check index.js`、`node --check social-login.js`、`git diff --check` 通过。

这些结果不替代第 7 节的真实企业微信和业务验收。
