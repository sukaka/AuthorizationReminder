# 聚信 AI 助手设计规格

**日期：** 2026-06-19  
**状态：** 已完成产品方向确认，待书面规格复核  
**目标版本：** 聚信 AI 助手 `1.0.0`；平台仓库 `5.87.0`  
**适用平台：** Windows 10/11 x64、macOS Apple Silicon arm64

## 1. 产品目标

“聚信 AI 助手”是北京聚信得仁科技有限公司内部的任务式 AI 工作台。员工选择“我要做什么”，填写结构化表单，系统自动组合已发布 Prompt、公司知识和输出约束，再由员工自行配置的模型生成结果。

产品不要求员工学习、搜索或复制复杂 Prompt。第一版覆盖通用、销售、产品交付、商务投标、行政人力、技术与安全服务、文档生成、培训考试八类助手，并提供历史、收藏、反馈、安全提示和管理能力。

### 1.1 已确认的优先约束

1. 不建设独立账号密码登录、独立 JWT、初始化管理员或本地用户体系。
2. 登录、会话、应用访问权、用户、角色和组织关系全部复用现有统一登录系统。
3. 复用根 Docker Compose 的 MySQL 容器，新建独立 schema `juxin_ai_assistant`，不使用 SQLite。
4. Prompt 内容和版本继续由现有提示词管理中心维护，AI 助手只绑定和读取已发布版本。
5. 用户可以自行配置多个模型，服务端不限制供应商。
6. 模型调用统一使用 OpenAI 兼容协议。
7. 模型配置和 API Key 只保存在当前桌面设备；API Key 存入系统钥匙串，绝不上传服务端。
8. 表单输入和模型输出加密保存在服务端，支持跨设备历史、反馈、统计和审计。
9. 所有有权进入应用的员工默认可见全部八类助手与任务。
10. 界面参考 macOS 的克制、清晰和材质层次，同时提供浅色与深色两套主题。

## 2. 范围与非范围

### 2.1 第一版范围

- 统一登录跳转、会话校验和统一门户入口。
- 八类助手、动态任务表单、搜索、收藏和最近使用。
- Prompt 已发布版本绑定、基础知识检索和服务端 Prompt 编排。
- 桌面端多个个人模型配置、系统钥匙串、本地直连和流式生成。
- 敏感信息检测、显式确认、生成历史、复制、重新生成和反馈。
- 任务、知识、系统设置、统计和审计管理。
- 部门负责人任务建议和 Prompt 修改建议。
- 系统托盘、单实例、本地草稿、待同步结果和清理缓存。
- Windows x64 与 macOS arm64 构建脚本、文档和安装包配置。

### 2.2 明确不做

- 不复制统一登录页面、用户管理、部门管理、密码、MFA 或 JWT 签发逻辑。
- 不在 AI 助手中复制 Prompt 编辑器和版本管理；相关操作跳转提示词管理中心。
- 不建设服务端模型供应商目录、管理员模型配置或服务端 API Key 表。
- 不承诺支持非 OpenAI 兼容协议；以后通过本地适配器扩展。
- 不建设向量数据库、复杂 RAG、Word/PPT/Excel 文件导出或自动更新服务器。
- 不支持离线 AI 生成；离线只保留草稿和待同步结果。
- 不支持 Intel Mac 或 universal macOS 包。

## 3. 方案选择

### 3.1 采用方案：远程工作台 + Tauri 本地模型桥接

React 工作台由内网服务器提供，Tauri 加载该固定业务地址。这样 WebView 与现有平台使用同一站点 Cookie，可直接复用当前统一登录。Tauri 只暴露经过收窄的本地命令，用于模型配置、系统钥匙串、模型请求、托盘和本地缓存。

FastAPI 负责业务权限、任务、表单、Prompt 编排、知识检索、敏感检测、历史、反馈和管理。模型请求从用户电脑直接发往用户选择的 OpenAI 兼容地址；FastAPI 不接收 API Key，也不代理模型流量。

### 3.2 未采用方案

- **直接扩展提示词中心：** 开发较快，但会把 Prompt 管理和员工任务工作台耦合，并偏离 FastAPI 服务端要求。
- **完全本地打包 React + 独立认证票据：** 可离线加载 UI，但现有 SSO 没有桌面授权码或回调机制，必须扩展认证协议，超出当前必要范围。
- **服务端模型网关：** 易于统一审计，但违背“用户自带模型、API Key 只在本地、服务端不限制供应商”的确认结果。

## 4. 总体架构

### 4.1 组件

1. **统一登录 `auth`**
   - 继续签发 `juxin_auth_token` HttpOnly Cookie。
   - 提供 `/api/auth/introspect`、`/api/auth/authorize` 和统一门户。
   - 新增系统键 `ai-assistant`、门户入口和授权动作。
2. **AI 助手 Web `web-ai-assistant`**
   - React + TypeScript，桌面优先并可在普通浏览器打开管理页面。
   - 生成能力只在受信任的 Tauri 容器中启用；普通浏览器显示“请使用桌面客户端”。
3. **AI 助手 API `ai-assistant-api`**
   - Python FastAPI + SQLAlchemy 2 + Alembic。
   - 通过统一登录 introspect/authorize 校验 Cookie，不签发自己的会话。
4. **桌面壳 `juxin-ai-assistant/apps/desktop/src-tauri`**
   - Tauri 2 + Rust。
   - 加载固定内网工作台 URL。
   - 管理本地模型资料、系统钥匙串、流式请求、托盘、单实例和本地队列。
5. **提示词管理中心 `prompt-center`**
   - 继续作为 Prompt 内容和版本的唯一事实来源。
   - 增加仅供服务端调用的已发布 Prompt 运行时读取接口。
6. **MySQL `mysql`**
   - 复用现有容器，使用独立 schema `juxin_ai_assistant`。

### 4.2 信任边界

- 浏览器页面永远拿不到模型 API Key。
- FastAPI、MySQL、提示词中心和统一登录永远拿不到模型 API Key。
- Tauri Rust 命令从系统钥匙串按配置 ID 读取密钥，只把最终 HTTP 请求发给用户配置的模型地址。
- Tauri 命令不提供“读取明文密钥”能力；UI 只能获知密钥是否已配置。
- 服务端生成内容使用独立内容加密密钥加密；密钥只通过环境变量或部署密钥系统提供。

## 5. 统一认证与权限

### 5.1 会话流程

1. Tauri 加载配置的 AI 工作台 URL。
2. Web 调用 `GET /api/ai/session`。
3. FastAPI 把现有 Cookie 转交统一登录 `/api/auth/introspect`。
4. 未登录时 Web 顶层跳转统一登录 `?system=ai-assistant`，不显示本地登录表单。
5. 登录成功后统一门户返回 AI 工作台。
6. FastAPI 对业务写操作调用 `/api/auth/authorize`，不相信前端传入的角色或部门。
7. 退出登录调用统一登录退出接口并清理本地非敏感会话缓存；模型钥匙串不随退出自动删除。

### 5.2 授权动作

| 动作 | 允许主体 | 用途 |
|---|---|---|
| `app:enter` / `ai_assistant:use` | 拥有应用访问权的用户 | 浏览任务、生成、个人历史与反馈 |
| `ai_assistant:department:stats` | `managedDepartments` 非空的负责人 | 查看所管理部门统计 |
| `ai_assistant:task:suggest` | 部门负责人 | 提交常用任务或 Prompt 修改建议 |
| `ai_assistant:admin` | `admin`、`sysadmin` | 任务、知识和系统设置管理 |
| `ai_assistant:audit:read` | `admin`、`auditor` | 查看全局审计 |

所有已授权员工均可查看全部助手与任务，不按所属部门隐藏。部门信息只用于统计归属、建议范围和审计快照。

### 5.3 不重复建设的页面

- “用户管理”“部门管理”链接统一管理中心。
- “Prompt 管理”“Prompt 版本”链接提示词管理中心。
- AI 助手只维护任务如何绑定已发布 Prompt，不修改 Prompt 本文。

## 6. 用户自带模型（BYOM）

### 6.1 本地配置模型

每位用户可在当前电脑维护多个模型配置、选择默认模型，并在执行任务前切换。配置不跨电脑同步。

| 字段 | 保存位置 | 说明 |
|---|---|---|
| `profile_id` | 本地配置文件 | UUID |
| `display_name` | 本地配置文件 | 用户自定义名称 |
| `base_url` | 本地配置文件 | OpenAI 兼容 API 根地址 |
| `model_id` | 本地配置文件 | 请求中的模型 ID |
| `temperature` | 本地配置文件 | 可选，默认由任务决定 |
| `timeout_seconds` | 本地配置文件 | 10–600 秒 |
| `is_default` | 本地配置文件 | 同时只能有一个默认配置 |
| `api_key` | 系统钥匙串 | 可为空，适配无需鉴权的本地模型 |

第一版使用标准 `Authorization: Bearer <key>` 和 OpenAI Chat Completions 兼容结构。OpenAI、DeepSeek、Kimi、通义及本地 Ollama/vLLM 等只要提供兼容接口即可使用。

### 6.2 本地安全规则

- 公网或非回环地址必须使用 HTTPS。
- HTTP 只允许 `localhost`、`127.0.0.1` 和 `::1`。
- 拒绝 `file:`、`ftp:`、`data:`、`javascript:` 等协议和 URL 用户信息段。
- 默认不跟随跨主机重定向，避免 Authorization 头泄露。
- 日志只记录配置 ID、模型 ID、耗时、状态和脱敏主机名，不记录 API Key、完整请求头或完整 Prompt。
- 首次使用每个配置前，用户必须确认该模型服务符合公司数据使用规范。

### 6.3 Tauri 命令边界

- `model_profile_list`
- `model_profile_upsert`
- `model_profile_delete`
- `model_profile_set_default`
- `model_profile_test`
- `model_generate`
- `model_cancel`

远程 IPC 只允许配置的 AI 工作台精确来源，不允许通配域名。每个命令校验窗口标签、参数长度、URL、安全协议和配置所有权。任何命令都不返回明文密钥。

## 7. 核心业务流程

### 7.1 任务发现

1. 首页展示收藏任务、最近任务、最近记录、安全提示和八类助手。
2. 用户可以跨全部助手搜索任务、收藏、按最近使用排序。
3. 任务详情由服务端返回动态字段、示例、输出说明和安全提醒，前端不写死表单。
4. 第一版字段类型完整支持单行文本、多行文本、下拉、多选、日期、数字、开关，并保留文件上传字段；文件上传在未启用解析器时必须明确显示“暂不支持”，不能静默丢弃。
5. 第一版结果以 Markdown 和安全富文本展示，不承诺直接导出 Word、PPT 或 Excel 文件。

### 7.2 生成流程

1. 用户选择任务和本地模型，填写动态表单。
2. Web 先做即时格式检查，FastAPI 再做权威校验和敏感检测。
3. 如发现风险，FastAPI 返回结构化警告；用户明确确认后才能继续。
4. FastAPI 从提示词中心读取已发布版本，根据任务、标签、优先级和关键词检索知识条目。
5. FastAPI 拼装 system/user 消息、输出约束和安全规则，创建 `PENDING` 记录。
6. FastAPI 返回 `generation_id`、一次性完成令牌、供应商无关的 `messages`、生成参数和安全提示；载荷不包含模型 ID、Base URL、API Key 或鉴权头。
7. Web 调用 Tauri `model_generate`；Rust 按用户选择的本地配置注入模型 ID、Base URL 和钥匙串密钥，再直连模型，流式事件返回 UI。
8. 成功后 Web 用一次性完成令牌调用完成接口；FastAPI 加密保存输入、输出和可用的 token/耗时元数据。
9. 失败或取消时只保存结构化状态和脱敏错误。
10. 网络中断时，最终结果加密暂存在本地待同步队列，恢复后由用户重试同步。

### 7.3 重新生成

重新生成创建新记录，以 `parent_generation_id` 关联旧记录，重新读取当前绑定的已发布 Prompt。历史详情明确展示当次实际使用的 Prompt ID 和版本号。

### 7.4 基础知识检索

第一版使用可解释的规则检索：启用状态 → 适用助手/任务 → 标签 → 关键词 → 优先级。检索服务暴露稳定接口，后续可替换为向量或混合检索，不改变生成编排调用方。

## 8. 功能与页面

### 8.1 普通员工

- 工作台、全部助手、任务搜索、收藏和最近使用。
- 动态表单、草稿、敏感提示、模型选择和流式结果。
- 复制全文、重新生成、保存、个人历史、删除个人记录和反馈。
- 多个本地模型配置、默认模型、连接测试和清理本地缓存。

### 8.2 部门负责人

- 普通员工全部能力。
- 所管理部门的任务使用量、成功率、反馈分布和热门任务。
- 提交常用任务调整建议和 Prompt 修改建议，由管理员或提示词审核人员处理。

### 8.3 管理员和审计员

- 助手、任务、动态字段、Prompt 绑定、启停和排序。
- 知识条目、分类、标签、适用任务、优先级和启停。
- 安全提示、敏感规则阈值和通用系统设置。
- 全局使用统计、建议审核和业务审计。
- 用户/部门跳转统一管理中心；Prompt 跳转提示词管理中心。
- 不查看、不配置、不接管任何用户的本地模型或 API Key。

## 9. 视觉与交互设计

### 9.1 macOS 参考方向

界面参考 macOS 的信息层级和交互气质，而不是复制系统应用：内容优先、克制的材质层次、充足留白、细分隔线、圆角面板、清晰焦点和轻量动效。Windows 端保留同一设计语言，但使用平台字体和原生窗口行为。

### 9.2 双主题

- 提供“跟随系统 / 浅色 / 深色”选择；实际视觉主题为浅色与深色两套。
- 使用语义 token：`background`、`surface`、`surface-elevated`、`text-primary`、`text-secondary`、`border`、`accent`、`success`、`warning`、`danger`。
- 浅色使用偏中性的雾白背景与半透明侧栏；深色使用近黑灰而不是纯黑。
- 强调色采用系统蓝；品牌红只用于少量品牌标识和高风险状态。
- 阴影、模糊和透明度在低性能或“减少透明度”环境自动降级。
- 文本和控件满足 WCAG AA 对比度；键盘焦点始终可见。

### 9.3 布局

- 左侧侧栏：工作台、全部助手、历史记录、个人模型、设置；管理权限用户增加管理区。
- 顶栏：当前任务、全局搜索、主题、同步状态和用户菜单。
- 任务执行页桌面宽屏采用“说明 / 表单 / 结果”三栏；窄窗口收敛为分步标签页。
- 结果区支持流式状态、停止、复制、重新生成、反馈和同步状态。
- 所有危险动作使用二次确认，普通成功操作使用轻量提示。

## 10. 数据设计

### 10.1 数据原则

- 所有业务表包含 `created_at`、`updated_at`。
- 需要追责的配置表包含 `created_by`、`updated_by`，保存统一登录用户 ID。
- 状态使用稳定的大写字符串，不依赖 MySQL ENUM，便于迁移 PostgreSQL。
- 主键使用 bigint 自增；对外暴露 UUID，避免枚举内部 ID。
- 业务 JSON 使用 SQLAlchemy JSON 类型；迁移时映射 MySQL JSON/PostgreSQL JSONB。
- 知识正文、生成输入和输出使用 AES-256-GCM 应用层加密，并保存密钥版本。
- 不建 `users`、`roles`、`departments`、`user_roles` 或 `model_configs` 表。

### 10.2 表结构

| 表 | 关键字段 | 用途 |
|---|---|---|
| `ai_assistants` | `uuid`, `code`, `name`, `description`, `icon`, `sort_order`, `status` | 八类助手 |
| `ai_tasks` | `uuid`, `assistant_id`, `code`, `name`, `description`, `output_format`, `safety_notice`, `status`, `sort_order` | 任务定义 |
| `ai_task_fields` | `uuid`, `task_id`, `field_key`, `label`, `field_type`, `required`, `placeholder`, `example`, `options_json`, `validation_json`, `sort_order` | 动态表单 |
| `ai_task_prompt_bindings` | `task_id`, `prompt_external_id`, `version_policy`, `pinned_version`, `status` | 绑定提示词中心 Prompt |
| `ai_knowledge_items` | `uuid`, `title`, `category`, `tags_json`, `content_ciphertext`, `content_nonce`, `key_version`, `priority`, `status` | 基础知识 |
| `ai_knowledge_task_links` | `knowledge_id`, `task_id` | 知识与任务多对多 |
| `ai_generation_records` | `uuid`, `sso_user_id`, `username_snapshot`, `department_snapshot`, `task_id`, `prompt_external_id`, `prompt_version`, `input_ciphertext`, `output_ciphertext`, `key_version`, `model_display_name`, `model_id`, `status`, `latency_ms`, `usage_json`, `parent_generation_id`, `error_code` | 生成历史 |
| `ai_feedback_records` | `uuid`, `generation_id`, `sso_user_id`, `feedback_type`, `content_ciphertext`, `key_version` | 用户反馈 |
| `ai_user_favorites` | `sso_user_id`, `task_id` | 收藏；用户与任务唯一 |
| `ai_task_suggestions` | `uuid`, `sso_user_id`, `department_code`, `suggestion_type`, `task_id`, `content_ciphertext`, `status`, `reviewed_by`, `reviewed_at` | 负责人建议及审核 |
| `ai_system_settings` | `setting_key`, `value_json`, `status` | 非秘密系统设置 |
| `ai_audit_logs` | `uuid`, `sso_user_id`, `action`, `entity_type`, `entity_uuid`, `result`, `metadata_json`, `ip_hash`, `user_agent_hash` | 脱敏审计 |

### 10.3 生成记录保护

- 列表查询只读取明文元数据，不解密输入输出。
- 只有记录本人、管理员或符合部门范围的负责人可按权限解密详情。
- 普通用户可删除自己的记录；删除写审计并清除密文。
- 审计和统计不依赖输入/输出明文。

## 11. API 设计

统一前缀为 `/api/ai`。所有接口使用统一 Cookie；除健康检查外均经过 introspect，写接口再做 authorize 和 CSRF/Origin 校验。

### 11.1 会话与目录

- `GET /api/ai/session`
- `POST /api/ai/logout`
- `GET /api/ai/assistants`
- `GET /api/ai/tasks`
- `GET /api/ai/tasks/{task_uuid}`
- `GET /api/ai/favorites`
- `PUT /api/ai/favorites/{task_uuid}`
- `DELETE /api/ai/favorites/{task_uuid}`

### 11.2 生成、历史与反馈

- `POST /api/ai/generations/prepare`
- `POST /api/ai/generations/{generation_uuid}/complete`
- `POST /api/ai/generations/{generation_uuid}/fail`
- `POST /api/ai/generations/{generation_uuid}/regenerate`
- `GET /api/ai/generations`
- `GET /api/ai/generations/{generation_uuid}`
- `DELETE /api/ai/generations/{generation_uuid}`
- `POST /api/ai/generations/{generation_uuid}/feedback`

`prepare` 的敏感警告响应使用 `409 SENSITIVE_CONFIRMATION_REQUIRED`，包含稳定警告代码和一次性确认摘要。客户端确认后携带摘要重试，避免仅靠布尔值绕过。

### 11.3 负责人能力

- `GET /api/ai/department-stats`
- `POST /api/ai/suggestions`
- `GET /api/ai/suggestions/mine`

### 11.4 管理接口

- `GET|POST /api/ai/admin/tasks`
- `GET|PUT|DELETE /api/ai/admin/tasks/{task_uuid}`
- `PUT /api/ai/admin/tasks/{task_uuid}/fields`
- `PUT /api/ai/admin/tasks/{task_uuid}/prompt-binding`
- `GET|POST /api/ai/admin/knowledge`
- `GET|PUT|DELETE /api/ai/admin/knowledge/{knowledge_uuid}`
- `GET|PUT /api/ai/admin/settings`
- `GET /api/ai/admin/stats`
- `GET /api/ai/admin/suggestions`
- `POST /api/ai/admin/suggestions/{suggestion_uuid}/review`
- `GET /api/ai/admin/audit-logs`

### 11.5 提示词中心运行时接口

- `GET /api/prompt-center/runtime/prompts/{prompt_id}/published`
- 可选 `?version=<number>` 读取仍可用的指定发布版本。
- 仅接受 AI 助手服务端凭据和内网来源；不暴露给桌面或浏览器。
- 返回模板正文、系统提示、变量定义、输出约束、安全规则和准确版本号。

## 12. 敏感信息与安全提示

第一版检测密码语义、token、`api_key`、secret、`access_key`、私钥、手机号、身份证号、邮箱、IPv4、URL 和账号密码组合。检测结果包含类型、位置范围和脱敏预览，不在日志中保存原文。

用户确认后可以继续，但以下提示始终展示：

- 不输入账号密码、密钥、生产口令或未经授权的客户内部数据。
- IP、域名、客户名称和联系方式应脱敏。
- 对外正式内容必须人工审核。
- 合规结论需结合实际情况确认。
- 合同、报价、回款由销售负责人确认。
- 投标响应、评分项和废标风险由商务负责人或项目负责人复核。
- 使用个人模型意味着相关任务内容会发送到用户选择的模型服务。

## 13. 异常与恢复

| 场景 | 行为 |
|---|---|
| SSO 失效 | 跳转统一登录，保留本地草稿 |
| 无应用权限 | 展示 403 和返回统一门户入口 |
| FastAPI 离线 | 允许编辑草稿，不创建新生成任务 |
| 提示词中心不可用 | 阻止新生成并明确提示，不静默使用过期版本 |
| 模型连接/鉴权/限流/超时 | Tauri 返回稳定错误码和可操作建议，不上传密钥 |
| 用户取消 | 中止本地请求，服务端记录 `CANCELLED` |
| 完成回存失败 | 本地加密排队，显示待同步并允许重试 |
| 内容解密失败 | 不返回损坏内容，记录高优先级安全审计 |

## 14. 初始数据

### 14.1 助手与任务

- **通用：** 工作总结、会议纪要、领导汇报、文档润色、工作计划、项目汇报、微信沟通话术、邮件内容生成。
- **销售：** 客户价值分析、客户需求挖掘、客户异议处理、拜访纪要整理、跟进计划生成、报价说明生成、报价策略建议、合同初稿辅助、合同风险提醒、回款跟进话术、回款风险分析、领导汇报材料。
- **产品交付：** 项目交付方案、项目实施计划、客户配合事项、项目风险与应对、验收标准、运维交接清单、项目周报、项目月报、项目总结、故障排查报告、客户培训文档、交付问题说明。
- **商务投标：** 招标文件解读、评分项分析、投标响应点提取、资格要求提取、实质性条款提取、废标风险检查、投标偏离表生成、投标文件目录生成、投标文件内容润色、投标材料清单、开标前检查清单、投标错误清单检查、商务条款响应、技术参数响应、控标点分析、竞争风险分析。
- **行政人力：** 通知公告、制度草稿、招聘 JD、面试问题、培训计划、员工考核说明、入职培训材料、会议安排通知、团队活动方案、行政制度优化。
- **技术与安全服务：** 安全服务方案、等保合规说明、漏洞整改建议、渗透测试方案、代码审计方案、软件测试方案、风险评估报告、安全加固建议、WAF 问题排查、日志分析说明、客户技术问题回复。
- **文档生成：** Word 文档大纲、PPT 大纲、汇报材料、培训手册、操作手册、项目方案、整改方案、检查清单、表格内容生成。
- **培训考试：** 培训大纲、培训演讲稿、单选题生成、多选题生成、判断题生成、简答题生成、答案解析、考试难度调整、题库去重、培训总结。

商务投标助手不包含合同、报价或回款；这些任务只属于销售助手。

### 14.2 Prompt 初始化

每个初始任务必须绑定一个可用的已发布 Prompt。初始化脚本只创建任务、字段和外部 Prompt 绑定，不复制 Prompt 正文。缺失绑定的任务保持 `DRAFT`，不可被普通用户执行。

## 15. 项目结构

```text
juxin-ai-assistant/
├── apps/
│   └── desktop/
│       ├── src/                 # React + TypeScript 工作台
│       ├── src-tauri/           # Tauri 2、Rust、本地模型桥接
│       └── package.json
├── server/
│   ├── app/
│   │   ├── api/                 # FastAPI 路由
│   │   ├── auth/                # 统一登录客户端与授权依赖
│   │   ├── core/                # 配置、加密、错误和日志
│   │   ├── db/                  # SQLAlchemy、Alembic、会话
│   │   ├── models/              # ORM 模型
│   │   ├── schemas/             # Pydantic 输入输出
│   │   ├── services/            # 任务、生成、历史、反馈
│   │   ├── prompts/             # 提示词中心客户端与编排
│   │   ├── knowledge/           # 可替换检索接口
│   │   └── main.py
│   ├── alembic/
│   ├── scripts/seed.py
│   └── pyproject.toml
├── docs/
├── scripts/
│   ├── dev-start.sh
│   ├── dev-start.ps1
│   ├── build-windows.ps1
│   └── build-macos-arm64.sh
└── README.md
```

## 16. 部署与打包

### 16.1 Docker Compose

根 Compose 增加 `ai-assistant-api` 和 `web-ai-assistant`，依赖 `mysql`、`auth` 和 `prompt-center-api`。API 使用独立数据库名和账号权限，不复用其他业务 schema。Alembic 在显式迁移步骤执行，应用启动不做不可逆自动迁移。

必要环境变量只在 `.env.example` 声明名称和说明，不提交值：

- `AI_ASSISTANT_DATABASE_URL`
- `AUTH_SERVICE_URL`
- `PROMPT_CENTER_URL`
- `PROMPT_CENTER_RUNTIME_TOKEN`
- `AI_CONTENT_ENCRYPTION_KEY`
- `AI_CONTENT_ENCRYPTION_KEY_VERSION`
- `AI_ASSISTANT_PUBLIC_URL`

### 16.2 Windows

- Rust target：`x86_64-pc-windows-msvc`。
- 支持 Windows 10/11 x64。
- 输出 MSI 和/或 NSIS EXE。
- PowerShell 脚本检查 Node、Rust、MSVC、WebView2 和环境配置后构建。

### 16.3 macOS

- Rust target：`aarch64-apple-darwin`。
- 只输出 Apple Silicon App/DMG，不构建 Intel 或 universal。
- shell 脚本检查 Xcode CLT、Rust target、Node 和签名参数。

### 16.4 自动更新

第一版预留 Tauri updater 配置、签名公钥字段和文档，但默认禁用更新检查；待公司提供 HTTPS 更新源和签名私钥管理流程后启用。

## 17. 测试策略

### 17.1 后端

- pytest 覆盖 SSO introspect/authorize、对象级权限、动态字段校验、敏感检测、Prompt 编排、知识检索、加解密、历史归属和管理接口。
- 使用 fake auth/prompt-center 做单元测试，使用 Compose MySQL 做迁移和集成测试。
- 契约测试确认服务端永不接收或记录模型 API Key。

### 17.2 前端

- Vitest + Testing Library 覆盖主题、动态字段、警告确认、流式状态、历史、权限导航和错误恢复。
- Playwright 覆盖统一登录跳转、任务生成纵切、收藏、反馈、管理和双主题关键页面。

### 17.3 Tauri/Rust

- URL 和重定向安全、配置迁移、默认模型唯一性、钥匙串抽象、请求取消、流式解析和本地同步队列单元测试。
- 使用 mock keyring 和 mock HTTP server，测试输出不得包含 API Key。
- macOS arm64 本机构建冒烟；Windows x64 在 Windows runner 构建冒烟。

### 17.4 发布门槛

- 后端、前端、Rust 单元测试通过。
- Compose 健康检查、迁移、种子和 SSO 契约通过。
- 浅色/深色和关键窗口尺寸视觉检查通过。
- secret 扫描、依赖审计和安装包冒烟完成。

## 18. 分阶段实施

1. **平台基础与可用纵切：** 独立 worktree、目录、统一门户入口、FastAPI、MySQL/Alembic、React/Tauri 壳、本地模型配置、一个真实任务端到端生成。
2. **完整员工能力：** 八类任务、动态表单、Prompt/知识编排、敏感确认、历史、收藏、反馈、草稿和同步队列。
3. **管理与治理：** 任务、知识、设置、建议、统计、审计及统一管理中心/提示词中心跳转。
4. **桌面交付与加固：** 托盘、单实例、双主题精修、Windows/macOS 构建、文档、安全与发布验证。

每一阶段都必须产生可运行、可测试的软件，不以占位页面代替后续核心能力。完整目标仍是四阶段全部交付。

## 19. 版本与 Git

- 新桌面应用初始产品版本为 `1.0.0`。
- 本次平台功能新增按规则把仓库版本从 `5.86.0` 升到 `5.87.0`。
- 开发分支为 `codex/5.87.0`。
- 中间提交保持小而可审查；最终发布提交、版本文件、Tauri 版本、构建产物说明和推送状态必须一致。
- 不提交真实 Cookie、API Key、内容加密密钥、服务间凭据或 `.env`。

## 20. 验收标准

1. 未登录用户只能进入现有统一登录，AI 助手仓库中不存在账号密码登录页面或签发 JWT 的代码。
2. 拥有 `ai-assistant` 访问权的员工可以查看全部助手并完成至少一个真实模型生成闭环。
3. 用户可以保存多个 OpenAI 兼容模型配置；API Key 只在系统钥匙串中，服务端请求和日志中均不存在该密钥。
4. Prompt 来自提示词中心明确的已发布版本，生成记录能追溯实际版本。
5. 业务数据位于现有 MySQL 容器的独立 schema，迁移和种子可重复执行。
6. 输入输出加密保存，历史、删除、反馈、部门统计和审计权限符合统一登录范围。
7. 八类助手和约定任务全部初始化，商务投标不出现合同、报价或回款任务。
8. 浅色和深色主题均可用，并可跟随系统；关键页面符合 macOS 参考方向和可访问性要求。
9. Windows x64 与 macOS arm64 构建配置、脚本和说明完整；macOS 不包含 Intel/universal target。
10. 全部发布门槛通过后，仓库版本、应用版本、分支、提交和推送记录相互一致。
