# 现有系统盘点报告

审计对象：聚信 AI 助手内测版  
审计日期：2026-06-25  
审计范围：`/Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant`，并参考父级 `docker-compose.yml` 中 AI 助手相关服务。  
审计原则：只盘点现状，不重写项目，不做大规模重构，不新增复杂功能。

## 1. 当前技术栈

### 前端与桌面端

- React 19 + TypeScript 6 + Vite 8。
- Tauri 2 桌面壳，Rust 2021。
- Tauri 插件：`single-instance`、`updater`。
- UI 主要是自研 CSS token + 少量 Ant Design 依赖。
- 前端测试：Vitest、Testing Library、jsdom。
- 端到端测试：Playwright。

### 桌面本地能力

- Rust `reqwest` 调 OpenAI 兼容模型接口。
- SSE 流式解析并通过 Tauri event 推送增量内容。
- 本地模型配置保存于应用数据目录。
- API Key 当前使用本机加密文件保存，不再默认依赖 macOS 钥匙串。
- 本地草稿、离线待同步结果、旧数据迁移使用本地加密记录存储。
- Word 导出通过桌面端保存到系统下载目录。

### 服务端

- Python FastAPI。
- SQLAlchemy 2 + Alembic。
- MySQL 8，独立 schema：`juxin_ai_assistant`。
- `python-docx` 生成 Word。
- `cryptography` 对输入、输出、知识库、反馈等正文内容加密。
- `httpx` 调统一登录与 Prompt Center。
- Pytest + respx 测试服务端。

### 外部依赖系统

- 统一登录/授权中心：`auth`，端口 `5180`。
- Prompt Center：`prompt-center-api`，端口 `5189`。
- AI 助手后端：`ai-assistant-api`，端口 `5193`。
- AI 助手 Web 工作台：`web-ai-assistant`，端口 `18093`。

## 2. 目录结构

```text
juxin-ai-assistant/
├── README.md
├── apps/
│   └── desktop/
│       ├── src/                    # React 工作台、启动页、页面、API client、本地同步逻辑
│       ├── src-tauri/              # Tauri/Rust 桌面能力
│       ├── tests/                  # React/Vitest 测试
│       ├── e2e/                    # Playwright 测试
│       ├── scripts/                # 桌面构建、版本、更新清单脚本
│       ├── Dockerfile              # Web 工作台镜像
│       └── package.json
├── server/
│   ├── app/                        # FastAPI 应用、服务、模型、审计、知识库、Word 导出
│   ├── app/admin/                  # 治理中心、任务、知识库、设置、建议、桌面更新管理
│   ├── alembic/                    # 数据库迁移
│   ├── catalog/                    # 助手/任务/手册/知识/质量规则种子
│   ├── scripts/                    # DB 初始化、种子导入、手册编译
│   ├── tests/                      # 服务端测试
│   ├── Dockerfile
│   └── requirements.txt
└── scripts/                        # macOS/Windows 构建与更新包脚本
```

父级 `/Users/zhanglei/.codex/worktrees/29dc/codex-new/docker-compose.yml` 提供容器编排。

## 3. 启动方式

### 容器方式

父级 monorepo 的 README 给出的 AI 助手启动方式：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
docker compose up -d mysql auth prompt-center-api prompt-center-ai-seed ai-assistant-db-init ai-assistant-api web-ai-assistant
```

常用开发重建：

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new
docker compose up -d --build web-ai-assistant ai-assistant-api
```

### 本地 Web 开发

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
npm install
npm run dev
```

默认 Vite 端口：`18093`。

### Tauri 桌面开发

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/apps/desktop
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
AI_ASSISTANT_BUILD_MODE=development npm run tauri dev
```

### 服务端本地开发

```bash
cd /Users/zhanglei/.codex/worktrees/29dc/codex-new/juxin-ai-assistant/server
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 5193 --reload
```

### 构建与测试入口

- 前端构建：`npm run build`
- 前端测试：`npm test`
- Rust 测试：`cargo test`
- 服务端测试：`.venv/bin/python -m pytest tests -q`
- macOS 构建脚本：`scripts/build-macos-arm64.sh`
- Windows 构建脚本：`scripts/build-windows.ps1`

## 4. 主要模块

### 前端页面模块

- `HomePage`：工作台首页、收藏任务、最近任务、最近生成。
- `AssistantsPage`：全部助手和任务列表。
- `TaskRunPage`：任务表单、生成、停止、重新生成、Word 导出、反馈。
- `HistoryPage`：历史记录列表、详情、复制、删除、反馈。
- `ModelProfilesPage`：个人模型配置、测试连接、默认模型。
- `GovernanceCenter`：治理中心入口。
- `KnowledgeAdminPage`：知识库管理。
- `TaskAdminPage`：任务管理。
- `SuggestionsPage`：任务建议提交/审核。
- `AuditPage`：审计日志展示。
- `DesktopUpdatesPage`：桌面更新发布管理。
- `LauncherPage`：桌面启动页、服务器地址、统一登录、工作台打开。

### 服务端模块

- `main.py`：FastAPI 路由入口。
- `generation_service.py`：生成 prepare/complete/regenerate 的核心编排。
- `prompt_client.py`：访问 Prompt Center，拉取已发布或暂存 Prompt。
- `knowledge.py`：知识检索。
- `word_export.py`：Word 文档生成。
- `history_service.py`：历史记录列表、详情、导出载荷。
- `feedback_service.py`：生成结果反馈。
- `audit.py`：审计日志清洗与写入。
- `auth.py`：统一登录会话校验与动作授权。
- `field_validation.py`：动态字段校验。
- `sensitive.py`：敏感信息检测与确认摘要。
- `document_governance.py`：手册 V1.10 的文档治理规则注入。
- `desktop_update_*`：桌面更新发布与下载。
- `admin/*`：治理中心管理 API。

### 桌面 Rust 模块

- `model_client.rs`：OpenAI 兼容模型调用、SSE、取消、错误映射。
- `commands.rs`：Tauri 命令入口，模型配置、生成、取消。
- `model_profile_store.rs`：模型配置与密钥存储逻辑。
- `keychain.rs`：本机加密密钥库与系统钥匙串适配。
- `local_queue.rs` / `local_record_store.rs`：本地草稿、待同步结果。
- `file_export_commands.rs`：Word 保存到下载目录。
- `window_manager.rs`：启动页/工作台窗口管理。
- `server_config.rs` / `server_probe.rs`：服务器地址配置与探测。
- `update_manager.rs` / `update_commands.rs`：桌面更新检查、下载、安装。

## 5. 数据流

### 登录与本地绑定

1. 前端调用 `/api/ai/session`。
2. 后端通过统一登录 `auth` introspect 校验 Cookie。
3. 后端返回用户信息、部门权限、应用授权和 `local_binding_token`。
4. Tauri 工作台调用 `local_session_bind`，把当前本地会话绑定到该用户。
5. 后续 Tauri 命令需要本地用户已绑定，避免未登录 Webview 调本地模型/本地文件能力。

### 任务目录数据流

1. 后端从 `ai_assistants`、`ai_tasks`、`ai_task_fields` 读取任务目录。
2. 前端调用 `/api/ai/home`、`/api/ai/catalog`、`/api/ai/tasks/{task_code}`。
3. 用户选择任务后，前端按服务端返回字段动态渲染表单。

### Agent 生成数据流

1. 用户在 `TaskRunPage` 填写动态字段。
2. 前端调用 `/api/ai/generations/prepare`。
3. 后端完成：权限校验、字段校验、敏感信息检测、Prompt Center 拉取 Prompt、渲染 Prompt、检索知识、组装 system/user messages、创建 `PENDING` 生成记录，并加密保存输入。
4. 前端收到 `messages`、`temperature`、`generation_uuid`、`completion_token`。
5. Tauri 端使用本地模型配置和本地 API Key 调模型 `/chat/completions`。
6. 模型输出通过 Tauri event 流式回传前端。
7. 模型完成后，前端调用 `/api/ai/generations/{uuid}/complete`。
8. 后端校验 completion token，加密保存输出，状态从 `PENDING` 变为 `COMPLETED`。
9. 如果同步失败，前端把结果写入本地加密队列，网络恢复后重试 complete。

### 历史与导出数据流

1. `/api/ai/generations` 返回历史元数据。
2. `/api/ai/generations/{uuid}` 解密并返回本人生成详情。
3. `/api/ai/generations/{uuid}/export.docx` 服务端生成 Word 二进制。
4. 浏览器模式下载文件；桌面模式调用 Tauri `generation_word_save` 保存到下载目录。

## 6. Agent 调用流程

当前系统不是“服务端代理模型”的架构，而是“服务端编排上下文 + 桌面端本地模型调用”的架构。

```text
用户选择任务
  ↓
动态表单收集输入
  ↓
后端 prepare：任务 + Prompt + 知识 + 治理规则 + 安全规则
  ↓
返回 provider-neutral messages
  ↓
桌面端选择本地模型配置和 API Key
  ↓
调用 OpenAI 兼容 /chat/completions stream
  ↓
前端流式显示输出
  ↓
后端 complete 加密落库
  ↓
历史、反馈、Word 导出
```

## 7. Prompt / Skill / 知识库 / 模板位置

### Prompt

- Prompt 正式运行时来源：Prompt Center，通过 `prompt_external_id` 拉取已发布 Prompt。
- 本地目录种子来源：`server/catalog/assistants.json` 中每个任务的 `prompt_content`。
- Prompt 绑定关系：数据库表 `ai_task_prompt_bindings`。
- Prompt 客户端：`server/app/prompt_client.py`。
- Prompt 种子/发布校验：`server/scripts/seed_catalog.py`。

### Skill

当前没有独立的可插拔 Skill 包、Skill Loader 或工具执行协议。现有“Skill”的实际形态是：

- `Assistant`：助手分类。
- `Task`：可点击任务。
- `TaskField`：任务输入槽位。
- `TaskPromptBinding`：任务到 Prompt 的绑定。

也就是说，当前系统是“任务型 Agent 工作台”，不是“运行时动态加载技能并执行工具链”的 Agent runtime。

### 知识库

- 种子文件：`server/catalog/manual-v1.10.json`、`server/catalog/manual-v1.10-report.json`。
- 运行时数据表：`ai_knowledge_items`、`ai_knowledge_task_links`。
- 管理 API：`server/app/admin/knowledge_routes.py`。
- 检索逻辑：`server/app/knowledge.py`，按任务关联和关键词命中做轻量排序。
- 质量规则也复用知识库表，通过 tags 区分 `quality_rule`。

### 模板

- 字段模板：`server/catalog/assistants.json` 的 `field_templates`。
- 文档结构模板：`server/app/document_governance.py` 的 `DOCUMENT_TYPE_STRUCTURES`。
- 公司级治理模板：`server/catalog/manual-v1.10.json` 的 `governance.content`。
- Word 版式模板：`server/app/word_export.py` 中以代码方式定义封面、页眉、页脚、标题编号、补齐章节。
- 桌面更新模板/清单：`apps/desktop/scripts/*` 与根 `scripts/create-updater-manifest.mjs`。

## 8. 当前已经实现的功能

- 统一登录 Cookie 会话校验。
- 统一授权动作校验：普通使用、管理员、建议提交等。
- 助手/任务目录。
- 动态任务表单。
- 个人模型配置。
- 模型连接测试。
- OpenAI 兼容流式生成。
- 模型请求取消。
- 敏感信息检测与二次确认。
- 输入、输出、知识、建议、反馈正文加密存储。
- 生成历史列表与详情。
- 历史删除。
- 重新生成。
- 反馈收集。
- Word 导出。
- 输出预览清洗 Markdown 符号。
- 知识库管理。
- 任务管理、字段替换、Prompt 绑定。
- 任务建议提交与管理员审核。
- 部门/管理员统计。
- 审计日志。
- 桌面启动器、服务器探测、工作台窗口管理。
- 桌面自动更新管理。
- 本地草稿。
- 离线生成结果待同步队列。
- 旧本地数据迁移与清理。
- macOS/Windows 构建脚本。
- 服务端、前端、Rust 多层测试。

## 9. 当前未实现或疑似不完整的功能

- 没有真正的 Intent Router：用户不能输入自然语言后自动匹配任务，目前主要靠任务目录和搜索。
- 没有独立 Skill Loader：任务、Prompt、知识是配置化的，但没有动态加载技能模块或工具链。
- Context Builder 仍偏硬编码：prepare 阶段组装上下文，但缺少预算、优先级解释、片段裁剪策略、上下文使用率显示。
- 缺少多步骤 Task State：只有生成记录状态，未建模“计划中、执行中、等待用户、工具调用中、部分完成”等 Agent 任务生命周期。
- 知识检索是关键词匹配，不是语义检索/向量检索。
- Prompt Injection 防护是部分实现：有 system/user 分离、敏感检测、审计脱敏，但未见专门的注入检测、知识引用隔离和不可信内容边界标注。
- 文件上传字段 `FILE_RESERVED` 明确尚未启用。
- Word 模板主要写在代码里，不是可配置模板。
- 模型供应商调用在桌面端完成，服务端不可统一限流、成本统计、模型质量监控。
- 长任务恢复能力有限：支持取消和离线 complete 重试，但生成过程本身不是可恢复任务。
- Prompt Center 与 AI 助手之间缺少更完整的回滚/差异可视化工作流。
- 桌面本地加密密钥文件如果被复制到同机同用户目录外，风险边界需要进一步明确。
