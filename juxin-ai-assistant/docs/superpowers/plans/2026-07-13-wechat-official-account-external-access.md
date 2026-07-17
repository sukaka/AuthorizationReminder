# 微信公众号外部问答与资料下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让外部访客从微信公众号菜单进入微信内 H5，在不注册的前提下按公众号 `openid` 使用仅文本问答和下载指定公开资料；同一 `openid` 在滚动 60 分钟内最多提问 15 次、Asia/Shanghai 自然日内最多 30 次。

**Architecture:** 新增一条与员工 SSO、内部桌面端完全隔离的“公众号 OAuth → 外部会话 → 外部问答/资料下载”链路。服务端仅在 OAuth 回调中接收原始 `openid`，保存不可逆 HMAC 摘要；浏览器只持有 HttpOnly 会话 Cookie。Redis Lua 脚本原子预占并在可退款异常时撤销额度；数据库保存不可逆访客标识、用量和下载审计。知识库资料默认不公开，只有管理员显式标记为外部公开且已审核的文件才可被检索或下载。

**Tech Stack:** FastAPI、SQLAlchemy/Alembic、现有 `redis==5.2.1`、现有服务端模型客户端与知识库检索链路、独立 Vite + React 微信 H5、微信公众号网页授权。

---

## 范围与验收口径

- 不做小程序、不接入微信支付、不做外部用户注册、个人资料页、聊天历史或文件上传。
- 身份口径是公众号为该应用返回的 `openid`，不是用户实际微信号；前端与日志不得展示或持久化原始 `openid`。
- 额度只计入**成功开始生成回答的提问请求**。请求在模型开始输出前发生可判定的服务端异常时退还本次额度；用户主动取消、网络在模型已开始输出后中断、进程崩溃后的预占不退还，以避免可被重复消耗模型资源。
- “1 小时”按滚动 60 分钟计算，不是整点分桶；“自然日”固定 `Asia/Shanghai` 的 00:00–23:59:59，限额为 **30 次**。
- 外部资料同时满足：`status=READY`、未删除、`usage_type=official_knowledge`、`review_status in (approved, official)`、`external_public=true`。其它任何资料（包括 `company`、`department`、`project` 权限范围）均不可通过外部链路访问。
- Redis 不可用时外部提问返回 `503 EXTERNAL_QUOTA_UNAVAILABLE`，即失败关闭；下载列表和已签发但未过期的下载令牌不依赖 Redis 以外的内容存储，但令牌校验也失败关闭。

## 外部接口契约

所有外部 API 位于 `/api/wechat/external`，只接受由本方案签发的 HttpOnly 会话 Cookie；不得复用 `/api/ai/chat`、`/api/knowledge/*` 的 SSO 接口。

| 接口 | 用途 | 结果 |
| --- | --- | --- |
| `GET /oauth/login?return_to=/` | 生成一次性 `state` 并 302 到微信网页授权 | 仅允许站内相对路径 |
| `GET /oauth/callback?code=&state=` | 校验 `state`、换取 `openid`、建立外部会话并 302 回 H5 | 不向 URL、HTML 或日志泄露 `openid` |
| `POST /session/logout` | 删除外部会话 Cookie | `204` |
| `GET /bootstrap` | 返回匿名化访客状态和余量 | `hour_remaining`、`day_remaining`、时区与刷新时间 |
| `POST /questions` | 接收一个纯文本问题，检索外部公开资料并生成一次完整回答 | 回答、可展示来源、更新后的额度 |
| `GET /documents` | 列出当前可下载的外部公开资料 | 名称、摘要、类型、大小、更新时间 |
| `POST /documents/{file_uuid}/download-token` | 签发一次性、5 分钟有效且绑定当前会话的下载令牌 | 相对下载 URL |
| `GET /downloads/{token}` | 校验会话、令牌、外部公开状态后回传文件 | `Content-Disposition: attachment` |

`POST /questions` 的请求体只允许 `{ "question": "..." }`：去空格后长度 1–2,000 字符，不接受文件、URL 抓取参数、模型参数、角色指令、会话 ID 或任意额外字段。回答采用非流式 JSON，首版不保留可续接的聊天历史，以控制成本和攻击面。

## 实施任务

### 1. 固化配置、路由边界和依赖注入

**Files:**
- Modify: `server/app/config.py`
- Modify: `server/app/main.py`
- Create: `server/app/wechat_external_dependencies.py`
- Modify: `server/.env.example`（若仓库已有该文件；否则在部署文档中给出同名环境变量，不创建含密钥的示例文件）
- Test: `server/tests/test_wechat_external_config.py`

- [ ] 先写配置测试：关闭开关时所有外部路由返回 `404`；启用开关但缺 `WECHAT_OFFICIAL_ACCOUNT_APP_ID`、`WECHAT_OFFICIAL_ACCOUNT_APP_SECRET`、`WECHAT_EXTERNAL_SESSION_SECRET` 或 `WECHAT_OPENID_HASH_SALT` 时，生产配置校验失败。
- [ ] 在 `Settings` 增加以下配置（均通过环境变量注入，不写入仓库）：

  ```python
  wechat_external_enabled: bool = False
  wechat_official_account_app_id: str = ""
  wechat_official_account_app_secret: str = ""
  wechat_oauth_redirect_uri: str = ""
  wechat_external_h5_origin: str = ""
  wechat_external_session_secret: str = ""
  wechat_openid_hash_salt: str = ""
  wechat_external_redis_prefix: str = "juxin:ai:wechat-external"
  wechat_external_hourly_question_limit: int = 15
  wechat_external_daily_question_limit: int = 30
  wechat_external_download_token_ttl_seconds: int = 300
  ```

- [ ] 复用现有 `knowledge_redis_url` 作为 Redis 地址，但外部通道强制要求 `knowledge_redis_enabled=true`；不要在两处创建不同 Redis 连接字符串或误用缓存“降级可用”的行为。
- [ ] 在 `main.py` 显式 `include_router(wechat_external_router)`，并让依赖在 `wechat_external_enabled=false` 时返回 404。将 `wechat_external_h5_origin` 加入生产 `cors_origins` 的校验白名单；不为外部路由放宽现有写请求来源中间件。
- [ ] 测试 OAuth callback 的 GET 不受写入 Origin 检查影响，而 H5 的 POST 只接受配置的 HTTPS Origin，不接受任意 Origin 或 `null`。

### 2. 增加外部访客、用量和下载审计的数据模型

**Files:**
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/0036_wechat_external_access.py`
- Modify: `server/tests/test_migrations.py`
- Test: `server/tests/test_wechat_external_models.py`

- [ ] 先写迁移测试：升级到 head 后存在新表和 `ai_knowledge_files.external_public`；降级到 `0035_agent_governance_bindings` 能移除新表及列；把 `0036_wechat_external_access` 加入线性 head 断言。
- [ ] 给 `KnowledgeFile` 增加 `external_public: bool = False`，迁移列使用 `server_default=sa.false()`，创建后保留默认 false。禁止用现有 `visibility` 或 `permission_scope` 推断外部公开状态，避免历史“公司可见”资料泄露。
- [ ] 建立 `ai_wechat_external_visitors`：`uuid`、唯一 `openid_hash`（64 位 hex）、`status`（`ACTIVE`/`BLOCKED`）、`first_seen_at`、`last_seen_at`、时间戳。`openid_hash = HMAC-SHA256(WECHAT_OPENID_HASH_SALT, openid)`，原始值在 OAuth 回调后立刻丢弃。
- [ ] 建立 `ai_wechat_external_question_audits`：`uuid`、`visitor_id`、唯一 `quota_event_id`、`question_hash`、`status`（`RESERVED`/`SUCCEEDED`/`REFUNDED`/`REJECTED`）、`failure_code`、`model_id`、`latency_ms`、`source_file_ids_json`、`created_at`、`completed_at`。默认只保存标准化问题的 SHA-256；若将来有合规留存需求，另行审批并加密保存正文。
- [ ] 建立 `ai_wechat_external_download_audits`：`uuid`、`visitor_id`、`file_id`、`download_token_hash`、`status`（`ISSUED`/`DOWNLOADED`/`EXPIRED`/`REVOKED`）、`created_at`、`downloaded_at`。令牌本身只以 SHA-256 形式入库。
- [ ] 所有外键使用现有项目的跨 SQLite/MySQL `id_type` 写法，给 `visitor_id`、`file_id`、`status`、`created_at` 和 `external_public` 建必要索引。

### 3. 实现公众号 OAuth 与外部会话

**Files:**
- Create: `server/app/wechat_external_auth.py`
- Create: `server/app/wechat_external_routes.py`
- Create: `server/app/wechat_external_schemas.py`
- Modify: `server/app/main.py`
- Test: `server/tests/test_wechat_external_auth.py`
- Test: `server/tests/test_wechat_external_routes.py`

- [ ] 先写失败测试：缺失/过期/已使用的 `state`、OAuth 返回错误、非 HTTPS 回调、恶意 `return_to`、伪造 Cookie 都不能获得访客身份或访问后续接口。
- [ ] `GET /oauth/login` 生成 256-bit 随机 `state`，在 Redis 保存其 SHA-256、相对 `return_to`、创建时间和 10 分钟 TTL；302 到公众号网页授权地址。`redirect_uri` 必须和配置完全一致且已在公众号后台配置，构建 URL 时只记录请求关联 ID。
- [ ] `GET /oauth/callback` 用一次性 `state` 原子消费，使用服务端 AppSecret 向微信换取 `openid`；对返回体做字段与错误码校验。不要把 `code`、`access_token`、`refresh_token` 或 `openid` 放进日志、审计 metadata、异常详情或重定向 URL。
- [ ] 用 `openid_hash` upsert 访客并更新 `last_seen_at`；`BLOCKED` 返回通用拒绝页。签发仅含 `visitor_uuid`、签发/到期时间、随机 `session_id`、签名的会话 Cookie，属性为 `HttpOnly; Secure; SameSite=Lax; Path=/api/wechat/external`，有效期 8 小时。
- [ ] Cookie 验签密钥独立于 `content_encryption_key`，在生产强制最少 32 字节随机值；会话解析只信任签名后的 `visitor_uuid`，绝不信任浏览器提交的 `openid` 或访客 ID。
- [ ] `GET /bootstrap` 返回访客被限制时所需的最小信息和当前额度，但不返回访客 UUID、哈希或任何微信标识。

### 4. 实现 15 次/滚动小时、30 次/自然日的原子额度服务

**Files:**
- Create: `server/app/wechat_external_quota.py`
- Create: `server/app/wechat_external_service.py`
- Test: `server/tests/test_wechat_external_quota.py`
- Test: `server/tests/test_wechat_external_questions.py`

- [ ] 在测试中以可控时钟覆盖以下边界：第 15 次允许、第 16 次拒绝；10:30 的请求会计入 11:29；上海时区 23:59 与次日 00:00 分属不同自然日；两个并发请求只允许其中一个取得最后一个名额；Redis 异常返回 503；模型在首个输出前失败时退款。
- [ ] 用 Redis Lua 维护三个以 `visitor_uuid` 为维度的 ZSET，成员均为一次性 `quota_event_id`，分值为 Unix 毫秒：`hour`（清理 `now-3600s` 后最多 15）、`day:YYYYMMDD`（按 `Asia/Shanghai` 计算，最多 **30**）、`minute`（建议防刷保护，最多 3）。脚本先清理过期成员，再一次性判断全部上限，再同时写入三个集合；任何一个满额都不写入任何集合。
- [ ] 对小时 ZSET 设置至少 2 小时 TTL、日 ZSET 设置到次日零点后 1 小时、分钟 ZSET 设置 2 分钟 TTL。拒绝时返回 `reason`、`remaining=0` 与精确 `retry_after_seconds`；日限额的重置时间必须是 `Asia/Shanghai` 下一自然日零点。
- [ ] 创建 `reserve_question_quota(visitor_uuid) -> QuotaReservation` 和 `refund_question_quota(reservation)`；退款 Lua 仅移除本次 `quota_event_id`，不可按计数盲减，以免并发下释放其他请求的额度。
- [ ] 请求流程必须是：验证会话与请求体 → 原子预占 → 写 `RESERVED` 审计并提交 → 检索/模型调用 → 写 `SUCCEEDED`；仅在模型尚未开始输出前的可判定服务端失败时，先执行原子退款，再把审计状态改为 `REFUNDED`。限额拒绝也写 `REJECTED` 审计，但不记录问题正文。
- [ ] H5 显示为“近 1 小时剩余 X/15；今日剩余 Y/30”；遇到 429 展示服务端返回的剩余等待时间，遇到 503 显示“系统繁忙，请稍后再试”，不自行本地计数。

### 5. 建立仅外部公开资料可用的检索与问答链路

**Files:**
- Modify: `server/app/knowledge_routes.py`（仅抽取可复用的、无 SSO 的受限资料查询函数；不改外部访问规则）
- Create: `server/app/wechat_external_service.py`
- Create: `server/app/wechat_external_routes.py`
- Test: `server/tests/test_wechat_external_questions.py`
- Test: `server/tests/test_wechat_external_knowledge_scope.py`

- [ ] 先写隔离测试：普通资料、`company` 可见资料、未审核资料、已删除资料、`external_public=false` 的资料，即使其分块命中也绝不能出现在外部来源或模型上下文中。
- [ ] 在知识库检索层新增显式 `external_public_only: bool = False` 过滤参数；为 true 时 SQL 直接 join `KnowledgeFile` 并添加范围与状态条件，不在向量结果返回后才过滤。缓存键应包含 `external_public_only`，防止内部命中缓存被外部请求复用。
- [ ] `POST /questions` 只使用服务端模型配置，禁止外部会话选用内部用户模型配置；固定温度、最大输出 token 和 top-k 为受控的服务器配置，不从客户端读取。
- [ ] 复用 `ContextBuilder` 构造“仅依据公开资料回答；找不到依据时明确说明”的系统约束。没有命中时直接返回固定的无依据提示，不调用模型、不消耗额外额度。
- [ ] 回答仅输出经白名单序列化的 `answer`、`sources[{file_uuid,file_name,section_title,page_number}]` 和额度；不得暴露内部路径、知识库 ID、chunk ID、内部角色、模型密钥或原始审计内容。
- [ ] 为外部资料创建/修改控制点：在 `KnowledgeFileOut`、`KnowledgeFilePatchIn` 和 `update_knowledge_file` 中加入 `external_public`；仅管理员能更新。设置为 true 前服务端再次验证该文件已处于官方审核通过状态，否者 409；文件被撤销审核、归档、删除或禁用 RAG 时自动置 false。

### 6. 实现受限的外部资料列表与下载令牌

**Files:**
- Create: `server/app/wechat_external_downloads.py`
- Modify: `server/app/wechat_external_routes.py`
- Modify: `server/app/knowledge_routes.py`（在状态迁移处撤销外部公开标记）
- Test: `server/tests/test_wechat_external_downloads.py`

- [ ] 先写授权测试：仅外部公开且已审核文件出现在列表；直接访问现有 `/api/knowledge/files/{id}/download` 仍然需要 SSO；伪造、过期、已使用、属于别的会话的令牌全部返回 404；管理员取消公开后旧令牌失效。
- [ ] `GET /documents` 从 `KnowledgeFile` 的严格外部条件查询，分页每页最多 50 条；返回显示安全的文件名、摘要、文件类型、大小、更新时间，绝不返回 `file_path`、`stored_file_name`、所有者或内部权限字段。
- [ ] 下载令牌用 `secrets.token_urlsafe(32)` 生成，数据库仅存 hash，并记录 `visitor_id`、`file_id`、到期时间、状态；响应只给 `/api/wechat/external/downloads/{raw_token}`。每次签发令牌写 `ISSUED` 审计。
- [ ] 下载请求重新验证外部会话、令牌所属访客、到期、一次性状态和文件当前外部公开资格；成功后原子标记 token 已使用并写 `DOWNLOADED`。复用现有文件名清理和 `Content-Disposition` 辅助函数；设置 `Cache-Control: no-store`。
- [ ] 文件读取失败返回通用 404/500 且写审计，不将服务器存储路径、堆栈或对象存储 URL 返回给 H5。

### 7. 新建隔离的微信公众号 H5

**Files:**
- Create: `apps/wechat-h5/package.json`
- Create: `apps/wechat-h5/vite.config.ts`
- Create: `apps/wechat-h5/src/main.tsx`
- Create: `apps/wechat-h5/src/App.tsx`
- Create: `apps/wechat-h5/src/api.ts`
- Create: `apps/wechat-h5/src/styles.css`
- Create: `apps/wechat-h5/tests/app.test.tsx`
- Modify: root deployment config only after确定 H5 的独立域名与构建产物托管位置

- [ ] 不把外部入口加入 `apps/desktop`：该应用含员工和管理员功能，独立 H5 可避免打入内部导航、SSO 逻辑和管理 API。
- [ ] 页面首次加载调用 `/bootstrap`；未认证时只跳转 `/oauth/login?return_to=/`，不在浏览器保存 `openid`、令牌、访客 ID 或额度状态。
- [ ] 页面只包含：产品说明、纯文本输入框、发送按钮、回答/来源区、剩余额度、公开资料列表与下载按钮、错误/重试状态。去掉账户、历史、附件、模型选择、知识库管理和任何员工入口。
- [ ] API 请求使用 `credentials: 'include'`、同一 HTTPS API 域名；不可在 bundle、Vite 环境变量或前端日志中放 AppSecret。下载按钮仅在点击后请求令牌并立即导航到返回 URL。
- [ ] Vitest 覆盖：未认证跳转、额度文案 `15`/`30`、429 倒计时展示、503 展示、无公开文件空态、成功回答来源渲染、下载令牌不写入 localStorage/sessionStorage。
- [ ] H5 响应式最低支持常见微信内置浏览器窄屏；对超长文件名、Markdown 回答和网络中断做换行与错误状态处理。回答渲染禁止 `dangerouslySetInnerHTML`，仅将模型文本以安全的纯文本/受控 Markdown 渲染。

### 8. 配置公众号、部署、可观测性与灰度

**Files:**
- Create: `docs/wechat-official-account-external-access.md`
- Modify: `docker-compose.ai-assistant-https.yml`（仅在现有部署方式承载 H5/Redis 时）
- Test: `server/tests/test_wechat_external_config.py`

- [ ] 在文档列出上线前人工配置清单：已认证的公众号、HTTPS 公网域名、公众号后台的网页授权回调域名、菜单跳转到 H5 URL、后端环境变量、Redis 高可用与备份、H5 的 API Origin/CORS 配置。文档只写变量名与格式，绝不写 AppSecret 或生产域名。
- [ ] 增加结构化日志字段：`request_id`、匿名 `visitor_uuid`、`quota_reason`、`audit_uuid`、HTTP 状态和延迟；日志禁止包含问题正文、`openid`、OAuth code/token、下载原始令牌与本地文件路径。
- [ ] 增加运维指标：OAuth 成功/失败、问答 2xx/429/503、小时/日限额命中、Redis 脚本异常、模型错误、公开资料下载成功/拒绝。告警条件至少包括 Redis 限流不可用和 OAuth 连续失败。
- [ ] 灰度顺序：部署但 `WECHAT_EXTERNAL_ENABLED=false` → 配置并验证回调（只限管理员测试 `openid`）→ 开启白名单公开的 1–3 份无敏感资料 → 观察 24 小时额度、下载和错误指标 → 再配置正式菜单并逐步增加资料。
- [ ] 回滚方法：立即设 `WECHAT_EXTERNAL_ENABLED=false` 或移除公众号菜单；若单份资料有风险，先将其 `external_public=false`，已签发令牌在下载时会二次校验而失效。不得靠删除文件或清 Redis 作为首选应急手段。

## 完整验证与验收

- [ ] 后端定向测试：`cd server && python3 -m pytest -q tests/test_wechat_external_config.py tests/test_wechat_external_models.py tests/test_wechat_external_auth.py tests/test_wechat_external_quota.py tests/test_wechat_external_questions.py tests/test_wechat_external_knowledge_scope.py tests/test_wechat_external_downloads.py tests/test_migrations.py`
- [ ] 后端全量回归：`cd server && python3 -m pytest -q`
- [ ] H5 单测：`cd apps/wechat-h5 && npm test -- --reporter=dot`
- [ ] H5 类型与构建：`cd apps/wechat-h5 && npm run typecheck && npm run build`
- [ ] 人工验收（使用测试公众号和测试资料）：首次 OAuth、重复进入复用会话、15 次滚动小时边界、**30 次自然日边界**、跨上海零点、并发最后一名额、Redis 断开、模型调用前失败退款、模型首 token 后中断不退款、普通资料不可见、公开资料下载一次性令牌、撤销公开后旧令牌失效。
- [ ] 安全验收：检查浏览器存储、网络请求、应用日志、审计表和异常响应，确认不存在原始 `openid`、AppSecret、OAuth token、下载令牌、内部文件路径或内部资料片段；使用普通外部会话访问所有 `/api/ai/*` 与 `/api/knowledge/*` 路径应仍然是未认证/无权限。

## 需要在实施前由业务方提供的非代码事项

1. 已认证公众号的 AppID 与 AppSecret（只以生产环境变量提供）。
2. 一个专供 H5 的 HTTPS 域名，以及可在公众号后台登记的 OAuth 回调域名。
3. 第一批允许外部传播的资料清单与内容责任人；未确认的资料一律保持 `external_public=false`。
4. 外部问答的固定欢迎语、免责声明和服务时间（若无特别要求，首版仅显示“回答仅供参考，以公开资料为准”）。

## 方案自检

- 额度已按用户最新要求写为滚动小时 15 次、上海自然日 **30 次**，并覆盖并发、退款与 Redis 故障。
- 身份只依赖公众号 `openid` 的服务端 HMAC 摘要，不要求注册，也不错误地声称可取得微信号。
- 内部 SSO、内部聊天和知识库下载接口不会对外开放；资料公开必须显式开关并在查询与下载时双重校验。
- 生产联调被列为验收步骤，不作为代码完成的阻塞条件；实施完成时可先以单测、构建和配置检查确认代码覆盖。
