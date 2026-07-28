# AI 助手 5.0 部署与访问排障记忆

### 16. 普通用户被错误展示并授予提示词中心、SCA、大屏

**现象**：用户数据库中的 `app_access` 明确只有 `train-exam`、`ai-assistant`，登录后仍可看到并访问提示词中心、SCA 与大屏。

**根因**：`auth/portal-routing.js` 的 `resolveUserAppAccess` 会无条件补充一组“必需业务门户”权限，门户菜单和接口鉴权都使用该函数，导致展示和实际权限同时越权。

**修复**：移除强制补充逻辑；非特权用户严格使用存储的 `app_access`。普通用户没有存储权限时的默认值统一为 `train-exam`、`ai-assistant`。

**回归要求**：测试必须验证：保存为 `['train-exam', 'ai-assistant']` 的普通用户只返回这两个系统，保存为单一系统时也不得自动附加其他系统。

## 版本基线

- 分支：`codex/ai-assistant-5.0`
- 已部署提交：`786b1b80`
- AI 助手应用版本：`5.16.0`
- 外网入口：`https://8.141.81.201:8443/`
- 内网入口：`https://192.168.3.33:8443/`

## 已处理问题与固定做法

### 1. 外网登录后跳回内网 IP

**现象**：从外网地址访问统一登录后，系统选择页跳转到 `192.168.3.33`。

**根因**：统一登录门户的系统链接使用了部署时的固定 `APP_*_URL` / `AUTH_PUBLIC_URL`，没有保留用户实际访问的主机名。

**修复**：`auth/index.js` 的门户页在跳转前将目标 URL 的 hostname 改为 `window.location.hostname`，同时保留原系统端口、路径和 SSO 参数。

**验证**：

- 外网进入时继续使用外网 IP；
- 内网进入时继续使用内网 IP；
- 管理后台、审计中心等相对 URL 不受影响。

### 2. `8443` 返回主 Web，而不是 AI 助手

**现象**：AI 助手 HTTPS 地址返回“授权到期提醒系统”的页面资源。

**根因**：`ai-assistant-https` 的 Nginx 在启动时解析 `web-ai-assistant` 容器 IP；前端容器随后被重建，旧 IP 被主 Web 容器复用，Nginx 继续代理到旧地址。

**修复**：每次重建 `web-ai-assistant` 或 `ai-assistant-api` 后，同时重建网关：

```bash
docker compose up -d --no-deps --force-recreate --no-build ai-assistant-https
```

**验证**：

```bash
curl -k -sS https://127.0.0.1:8443/ | head
```

页面标题必须为“聚信 AI 助手”，前端资源应为 AI 助手的 `index-*.js`。

### 3. 外网可登录但内容生成请求被 403 拒绝

**现象**：页面和会话列表可访问，但点击内容生成显示“内容生成失败，请稍后重试”。

**根因**：AI API 的写请求启用 Origin 校验；`.env` 中虽有 `AI_ASSISTANT_EXTRA_ORIGINS`，但 `docker-compose.yml` 的 `ai-assistant-api.CORS_ORIGINS` 未包含它。外网 Origin 因此被拒绝为 `ORIGIN_FORBIDDEN`。

**修复**：在 `ai-assistant-api.CORS_ORIGINS` 追加：

```yaml
${AI_ASSISTANT_EXTRA_ORIGINS:-}
```

更新 Compose 环境变量后必须重建 API 和 HTTPS 网关：

```bash
docker compose up -d --no-deps --force-recreate --no-build ai-assistant-api
docker compose up -d --no-deps --force-recreate --no-build ai-assistant-https
```

**验证**：携带外网 `Origin` 的未登录 POST 应返回 `401 未登录`，而不是 `403 ORIGIN_FORBIDDEN`。

### 4. 内容生成报 500：缺少 `reconciliation_*` 数据库字段

**现象**：`POST /api/ai/chat/prepare` 返回 500，前端显示“内容生成失败，请稍后重试”。

**根因**：运行代码向 `ai_agent_tool_calls` 写入下列字段，但历史迁移 `0039_agent_tool_reconciliation_audit` 误作用于旧表 `ai_agent_tool_invocations`：

- `reconciliation_resolution`
- `reconciled_by_user_id`
- `reconciled_at`

**修复**：新增正式迁移 `0067_agent_tool_calls_reconciliation_fields`，为活动表 `ai_agent_tool_calls` 添加字段及索引；执行数据库初始化迁移：

```bash
docker compose build ai-assistant-db-init ai-assistant-api
docker compose run --rm --no-deps ai-assistant-db-init
```

然后重建 AI API 和网关。

**验证**：

```bash
docker compose exec -T ai-assistant-api alembic current
docker compose exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "USE juxin_ai_assistant; SHOW COLUMNS FROM ai_agent_tool_calls LIKE \"reconciliation%\";"'
```

迁移应显示 `0067_agent_tool_calls_reconciliation_fields (head)`，且字段存在。

### 5. 内容生成报 500：联网检索 URL 超出 `chunk_id` 长度

**现象**：`POST /api/ai/chat/prepare` 返回 500，前端仍显示“内容生成失败，请稍后重试”；API 日志包含 `Data too long for column 'chunk_id'`。

**根因**：联网检索的引用记录将原始结果 URL 写入 `ai_chat_message_sources.chunk_id`，而该列历史上只允许 64 个字符。普通网页 URL 可以更长，写库失败使整个生成请求回滚。

**修复**：将模型字段改为 `Text`，并新增迁移 `0068_chat_message_source_chunk_id_text`，把 `ai_chat_message_sources.chunk_id` 扩展为 `TEXT`。执行迁移后重建 API 和 HTTPS 网关。

**验证**：

```bash
docker compose exec -T ai-assistant-api alembic current
docker compose exec -T mysql sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -e "USE juxin_ai_assistant; SHOW COLUMNS FROM ai_chat_message_sources LIKE \\"chunk_id\\";"'
```

迁移应显示 `0068_chat_message_source_chunk_id_text (head)`，`chunk_id` 类型应为 `text`；再次发起含联网检索的内容生成不应出现 `Data too long for column 'chunk_id'`。

### 6. Word 导出报 400：缺少幂等请求头

**现象**：聊天页或知识库页点击 Word 导出失败；日志显示 `POST /api/export/word 400`，但没有 DOCX 生成异常。

**根因**：后端导出接口要求 1–128 字符的 `Idempotency-Key`，用于避免重复创建导出文件；前端两个导出请求未传该请求头，因而在进入导出逻辑前被拒绝。

**修复**：`apps/desktop/src/api/chat.ts` 的 `/api/export/word` 和 `/api/export/word/content` 请求均传入新生成的 UUID 作为 `Idempotency-Key`；重建 `web-ai-assistant` 后必须重建 `ai-assistant-https`。

**验证**：浏览器点击导出时，`POST /api/export/word` 应返回 `201`，随后下载接口返回 DOCX 文件，而非 `400 缺少或无效的 Idempotency-Key`。

### 7. 大师 PPT 主题预览图裂开

**现象**：大师 PPT 制作前确认页显示破损图片图标；页面中的预览 URL 是 `/api/skills/dashi-ppt/theme-preview`。

**根因**：宿主机已有 Dashi PPT 运行时和主题预览图，但 `ai-assistant-api` 容器没有配置 `DASHI_PPT_RUNTIME_ROOT`，也没有挂载运行时目录，预览接口无法解析固定主题图而返回 `503`。

**修复**：Compose 将 `${DASHI_PPT_RUNTIME_HOST_PATH}/..` 以只读方式挂载到 `/opt/dashi-ppt`，并设置 `DASHI_PPT_RUNTIME_ROOT=/opt/dashi-ppt/project`。运行时目录的同级 `assets/skill/theme-style-grid.png` 随之可被认证接口提供。

**验证**：重建 API 和 HTTPS 网关后，使用已登录会话访问 `/api/skills/dashi-ppt/theme-preview` 应返回 `200 image/png`；大师 PPT 确认页应展示 12 种主题预览图。

### 8. 普通用户不显示“AI 能力”菜单

**要求**：普通用户暂时不应从侧边栏进入“AI 能力”（助手模式、工作流、能力中心、Agent 市场）入口。

**修复**：前端主导航仅当角色通过 `isPlatformAdminRole`（管理员、超级管理员、系统管理员、平台管理员）时渲染“AI 能力”按钮。普通员工、部门负责人及审计员仍可使用对话、项目、任务与交付、知识与学习等入口。

**验证**：以 `employee` 登录时主导航中没有“AI 能力”；以管理员角色登录时该菜单仍显示。

### 9. 更新 `786b1b80` 时的迁移链兼容

**背景**：提交 `786b1b80` 新增项目成员用户名迁移 `0067_project_member_usernames`。当前生产库已应用本地修复迁移 `0067_agent_tool_calls_reconciliation_fields` 和 `0068_chat_message_source_chunk_id_text`。

**固定做法**：将项目成员用户名迁移的 `down_revision` 设为 `0068_chat_message_source_chunk_id_text`，形成单一链：`0066 → agent 0067 → 0068 → project-member 0067`。迁移文件名中的数字不决定 Alembic 顺序，`revision` / `down_revision` 才决定依赖关系。

**验证**：升级后 `alembic current` 应显示 `0067_project_member_usernames (head)`，`ai_project_members` 表应包含 `username` 字段。

### 10. 知识库将“报销单填写说明”误匹配为 WDSP 手册

**现象**：询问“发我报销单填写说明”时，返回“等保合规云管平台 管理员手册”；命中文本仅含“填写多规则组合逻辑”和“策略功能说明”。

**根因**：中文检索以双字词召回，原词面门槛只要命中两个词即可。候选仅凭通用操作词“填写、说明”通过了门槛，未要求命中业务主体“报销/报销单”。

**修复**：为检索增加通用操作词集合；当查询中含业务词时，词面相关性必须同时命中至少一个非通用查询词。这样“填写、说明”不能单独把无关产品手册作为来源。

**验证**：相同问题不再返回 WDSP/等保管理员手册；若公司知识库没有报销资料，应明确提示未找到相关文件，而非提供无关下载。

### 11. 图片/扫描型 Word 被标记为已索引但没有分块

**现象**：知识库中存在《报销单填写说明.docx》，状态显示 `parsed` / `indexed`，但助手回答“没有找到”；数据库中该文件的知识分块数为 0。

**根因**：该 Word 为图片/扫描型文档，常规 DOCX 文本解析没有提取到段落或表格。旧逻辑仍将空结果标记为已索引，检索器没有任何可召回的内容。

**修复**：当受支持文档未能提取正文时，生成一条“文件索引”兜底分块，包含文件名和“原文件已收录，可下载查看”的提示。这样按文件名请求会命中正确文件并显示下载入口；对已有的《报销单填写说明.docx》已执行重解析并生成该分块。

**验证**：查询“发我报销单填写说明”应只命中《报销单填写说明.docx》；结果文本会提示该文档无可检索正文但可下载原文件，不得再误匹配 WDSP 手册。

### 12. 大师 PPT 在 Linux 容器中因 macOS Node 依赖失败

**现象**：主题（如 `theme05`）确认后，后台任务显示“联网或模型调用失败”；真实错误为 `DASHI_PPT_RENDER_FAILED` 或 `DASHI_PPT_PPTX_FAILED`。

**根因**：Dashi 运行时目录由 macOS 宿主机只读挂载到 Linux 容器，内含 macOS 版 `node_modules`。`tsx` 的 `esbuild` 需要 Linux 二进制；此外 PPTX 导出器会写入运行时的 `output/exports`，而宿主机挂载不可写。旧版 `EXPORT_STORAGE_DIR` 未设置，产物还会落在容器临时的 `/app/exports` 中，重建 API 后丢失。

**修复**：Compose 使用三个 Docker 专用卷：`dashi-ppt-node-modules`（在 Linux 容器中执行 `npm ci`）、`dashi-ppt-output`（运行时导出临时目录）和 `ai-assistant-dashi-ppt-exports`（最终 HTML/PPTX 持久化目录）；设置 `EXPORT_STORAGE_DIR=/data/ai-assistant/dashi-ppt-exports`。初始化卷后重建 AI API 和 HTTPS 网关。

**验证**：`npm run render:goal` 与 `npm run export:pptx` 在 API 容器中均成功；主题 `theme05` 的 HTML 工程包与 `presentation.pptx` 均存在且非空；后台任务状态为 `completed`。

## 发布/重启检查清单

1. 拉取代码后确认分支和提交；保留未提交的 `server/Dockerfile` 本地修改。
2. 若 AI API 的代码、Compose 环境或前端发生变化，先构建对应镜像。
3. 运行数据库迁移，再重建 API。
4. 始终在前端/API 容器更新后重建 `ai-assistant-https`，避免 Nginx 使用旧容器 IP。
5. 检查 `https://<外网IP>:8443/` 页面标题为“聚信 AI 助手”。
6. 检查 `/health`、API 容器健康状态和近期日志，确认无 `Unknown column`、`Data too long`、`ORIGIN_FORBIDDEN`、Word 导出的 `缺少或无效的 Idempotency-Key`、`DASHI_PPT_THEME_PREVIEW_UNAVAILABLE`，或反向代理到主 Web 的迹象。
# 13. 长内容后台任务创建失败（MySQL BLOB 64KiB 上限）

- 现象：前端先成功调用 `/api/ai/chat/prepare`，随后调用
  `/api/ai/long-tasks/chat-generation` 返回 500，并提示“内容生成失败，请稍后重试”。
- 根因：加密后的后台任务请求载荷约 248KB，而 `ai_long_tasks.request_ciphertext`
  使用 MySQL `BLOB`（最大 64KiB），插入时触发 `Data too long for column
  'request_ciphertext'`。长 PPT/长上下文请求均可能复现。
- 修复：模型将 `request_ciphertext`、`draft_ciphertext` 在 MySQL 映射为
  `MEDIUMBLOB`（16MiB），迁移 `0069_long_task_payload_mediumblob` 同步修改线上列。
- 验证：执行迁移后检查 `information_schema.COLUMNS` 中两列均为 `mediumblob`；
  使用同等长度的后台任务请求应返回 202，而非 500。
# 14. API 重建后前端代理返回 502

- 现象：`ai-assistant-api` 健康检查正常，但用户访问 `/api/ai/*` 返回“服务暂时不可用”，
  HTTPS 网关访问日志为 502。
- 根因：`web-ai-assistant` Nginx 使用静态 `proxy_pass http://ai-assistant-api:5193`，
  在 API 容器重建后仍指向旧容器 IP。
- 修复：前端 Nginx 使用 Docker DNS 解析器 `127.0.0.11` 与变量形式的
  `proxy_pass`，每 10 秒刷新 `ai-assistant-api` 地址；已重建前端代理容器。
- 验证：HTTPS 入口的未认证请求返回预期 401，而非 502；API、前端代理及 HTTPS
  网关均在运行。
# 15. 联网搜索长 URL 导致内容生成失败

- 现象：`POST /api/ai/chat/prepare` 返回 500，前端显示“内容生成失败，请稍后重试”。
- 根因：搜索引擎验证码/重定向页的 URL 被写入 `ai_chat_message_sources.section_title`，
  超过原 `VARCHAR(255)` 上限，触发 `Data too long for column 'section_title'`。
- 修复：模型和迁移 `0070_chat_message_source_section_title_text` 将该列改为 `TEXT`。
- 验证：超长联网 URL 的回归测试通过；线上字段类型为 `text`，API 健康且 HTTPS
  入口可达。
