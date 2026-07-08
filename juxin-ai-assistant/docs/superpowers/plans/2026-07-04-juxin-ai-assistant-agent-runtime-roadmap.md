# 聚信 AI 助手 Agent Runtime 研发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不推翻现有项目的前提下，把聚信 AI 助手从“功能堆叠型聊天应用”升级为“可控、可审计、可扩展的私人工作助理”。

**Architecture:** 保留现有 FastAPI + Tauri + React + MySQL 架构，新增内部 Agent Runtime 层，将已有能力封装为工具。普通用户界面继续使用“查资料、生成文档、保存资料、申请入库、管理员审核”等办公语言，开发者内部使用 Agent、Tool、ContextBuilder、Memory、RAG 等概念。

**Tech Stack:** FastAPI、SQLAlchemy、Alembic、MySQL、React、Tauri、Rust、本地模型配置、python-docx、现有知识库解析与检索模块。

---

## 一、研发原则

1. 不重写项目，不引入第二套系统。
2. 先统一现有能力，再新增复杂能力。
3. 普通用户界面不暴露 ReAct、Tool Call、RAG、Memory、Embedding、MCP 等技术词。
4. 公司知识库必须管理员上传或审核通过；普通用户上传默认进入“我的资料”或“当前附件”。
5. 所有工具调用必须可记录、可追踪、可失败恢复。
6. 回答和 Word 导出中的参考来源只展示实际使用的来源。
7. 没有可靠来源时，必须明确提示“当前资料中未找到明确依据”，不得编造。
8. 所有工具必须支持启用、禁用、权限控制、版本号和安全下线策略。

---

## 二、当前基础

项目已经具备以下基础能力：

- 聊天会话、消息、引用来源：`server/app/chat_service.py`、`server/app/models.py`
- 初步 Agent Loop：`server/app/agent_loop/`
- 上下文构建：`server/app/context/context_builder.py`
- 助手模式路由：`server/app/context/mode_router.py`
- 资料上传、解析、切片、索引：`server/app/knowledge_files.py`
- 公司知识和个人资料检索：`server/app/knowledge_search.py`
- 网页抓取和联网搜索：`server/app/web_sources.py`、`server/app/web_routes.py`
- Word 导出：`server/app/word_export.py`、`server/app/chat_word_export.py`
- 资料审核、分类、回收站、启停检索：`server/app/knowledge_routes.py`
- 用户反馈：`server/app/feedback_service.py`
- 桌面端本地模型配置、测试连接、流式生成、取消生成：`apps/desktop/src-tauri/src/`

当前主要问题：这些能力分散在路由、服务和前端交互中，缺少统一工具抽象、统一调用日志、上下文预算、长对话压缩和基础评估体系。

---

## 三、完整工具化范围

### 1. P0 必须工具化

- [x] 公司知识检索工具：只查管理员上传或审核通过的正式资料。
- [x] 我的资料检索工具：只查当前用户个人资料。
- [x] 当前附件检索工具：只查本次会话上传附件。
- [x] 文件解析工具：统一解析 txt、md、docx、xlsx、pptx、pdf。
- [x] Word 导出工具：支持“仅本次生成内容”和“聚信格式 Word”。
- [x] 引用来源校验工具：只保留实际被回答使用的来源。
- [x] 资料入库申请工具：用户确认后提交管理员审核。
- [x] 管理员审核工具：通过、驳回、改分类、启用正式知识检索。
- [x] 工具调用日志工具：记录每次工具调用状态、耗时、来源数量、错误码。

### 2. P1 应该工具化

- [x] Web 搜索工具：用于联网查找公开资料。
- [x] 网页抓取工具：抓取网页内容、生成摘要、等待用户确认保存。
- [x] 个人记忆工具：保存“我的偏好”，按 user_id 隔离。
- [x] 文档模板选择工具：根据任务类型选择输出结构和 Word 模板。
- [x] 文档结构校验工具：检查输出是否符合聚信文档规范。
- [x] 任务模式识别工具：识别售前、交付、安全运维、风险评估、行政人力等任务。
- [x] 历史任务工具：读取历史任务、恢复上下文、重新生成。
- [x] 用户反馈工具：收集有帮助、不准确、格式不合适等反馈。

### 3. P2 延后工具化

- [x] PPT 生成工具。
- [x] 深度联网调研工具。
- [x] 高级质量评分工具。
- [x] 批量资料治理工具。
- [x] 外部向量库接入工具。
- [x] MCP / A2A 适配工具。

---

## 四、阶段计划

## Phase 0：基线稳定与边界确认

**周期：1-2 天**

**目标：** 明确当前功能边界，避免后续改造误伤现有能力。

- [x] 梳理现有聊天、资料库、Word 导出、模型配置、管理员审核链路。
- [x] 固化现有关键接口清单。
- [x] 确认“普通用户”和“管理员”权限边界。
- [x] 确认当前版本号，按功能优化规则规划下一版为第二位升级。
- [x] 建立最小回归用例：普通聊天、查公司知识、查我的资料、上传附件、导出 Word、管理员审核。

**验收标准：**

- 能列出当前所有已有工具能力和缺失能力。
- 能跑通最小回归链路。
- 后续任务不再争论“当前是否已有这个功能”。

---

## Phase 1：Agent Runtime 与工具注册表

**周期：4-6 天**

**目标：** 不改用户界面，先在后端建立统一工具层。

**建议新增模块：**

- `server/app/agent_runtime/__init__.py`
- `server/app/agent_runtime/types.py`
- `server/app/agent_runtime/tool_base.py`
- `server/app/agent_runtime/tool_registry.py`
- `server/app/agent_runtime/tool_logger.py`
- `server/app/agent_runtime/tools/knowledge_tools.py`
- `server/app/agent_runtime/tools/file_tools.py`
- `server/app/agent_runtime/tools/export_tools.py`
- `server/app/agent_runtime/tools/review_tools.py`
- `server/app/agent_runtime/tools/web_tools.py`
- `server/app/agent_runtime/tools/memory_tools.py`
- `server/app/agent_runtime/tools/history_tools.py`

**任务：**

- [x] 定义 `ToolInput`、`ToolResult`、`ToolError`、`ToolContext`。
- [x] 定义 `BaseTool`，统一 `name`、`description`、`permission`、`timeout_seconds`、`execute()`。
- [x] 定义 `ToolRegistry`，支持注册、查询、执行、禁用、版本标记和权限检查。
- [x] 包装现有公司知识检索、我的资料检索、当前附件检索。
- [x] 包装现有 Word 导出。
- [x] 包装现有资料入库申请和管理员审核。
- [x] 增加工具调用日志，避免只靠散落业务日志排查。

**验收标准：**

- 同一个入口能执行不同工具。
- 每次工具调用都有成功/失败/耗时/错误码记录。
- 工具失败不会导致整轮对话不可恢复。
- 普通用户不能调用管理员工具。
- 废弃工具可以只关闭入口和调用权限，不影响旧任务记录回放。

---

## Phase 2：引用来源治理与上下文工程

**周期：4-7 天**

**目标：** 解决引用乱、上下文浪费、历史消息无限膨胀的问题。

**重点模块：**

- `server/app/context/context_builder.py`
- `server/app/chat_service.py`
- `server/app/knowledge_search.py`
- `server/app/chat_word_export.py`
- `server/app/word_export.py`

**任务：**

- [x] 将 ContextBuilder 明确拆成 Gather、Select、Structure、Compress 四步。
- [x] Gather：收集系统提示、公司画像、助手模式、用户问题、最近历史、我的偏好、检索证据、工具结果。
- [x] Select：按权限、相关性、新近性、资料等级选择上下文。
- [x] Structure：按 Role、Task、Evidence、Context、Output 拼装消息。
- [x] Compress：长对话超过阈值后生成摘要，只保留关键决策、未完成事项、已确认事实。
- [x] 回答完成后，根据实际回答内容过滤引用来源。
- [x] Word 导出使用同一套“实际引用来源”结果。
- [x] 没有检索命中时，不把无关文件放到参考来源。

**验收标准：**

- 用户问泛泛问题时，不再显示无关资料引用。
- 用户问某个附件时，只显示实际使用的附件来源。
- Word 导出和聊天回答的引用来源一致。
- 长对话不会把全部历史原样塞给模型。

---

## Phase 3：资料解析、入库和权限闭环

**周期：5-8 天**

**目标：** 把“上传、解析、分类、入库、审核、检索”做成完整闭环。

**重点模块：**

- `server/app/knowledge_files.py`
- `server/app/knowledge_routes.py`
- `server/app/knowledge_search.py`
- `apps/desktop/src/pages/KnowledgePage.tsx`

**任务：**

- [x] 增加 PDF 文本解析。
- [x] 统一 txt、md、docx、xlsx、pptx、pdf 的块结构：文件名、页码/章节、sheet/slide、chunk_index。
- [x] 上传后自动生成摘要、建议分类、建议文档类型。
- [x] 普通用户默认保存到“我的资料”。
- [x] 申请进入公司知识库时，必须二次确认。
- [x] 管理员审核通过后，才允许进入公司知识检索。
- [x] 审核不通过时，资料仍可保留在用户“我的资料”中。
- [x] 支持上传文件改名，并同步影响前端展示和引用名称。

**验收标准：**

- PDF、Word、Excel、PPT 上传后可解析入库。
- 普通用户资料不会自动成为公司知识。
- 管理员审核通过前，公司知识检索查不到该资料。
- 引用来源显示文件名、章节/页码、chunk_id 或片段位置。

---

## Phase 4：普通用户体验与管理员体验

**周期：4-6 天**

**目标：** 用户看到的是办公动作，不是技术概念。

**普通用户前端：**

- [x] 聊天页资料来源显示为：公司知识、我的资料、当前附件、联网查找。
- [x] 上传后显示紧凑附件条，不占用输入框。
- [x] 文件保存选项：仅本次使用、保存到我的资料、申请加入公司知识库。
- [x] 我的资料页支持：上传、搜索、分类、改名、问文档、根据资料生成、申请入库。
- [x] 历史任务支持：查看、继续、导出、删除。

**管理员前端：**

- [x] 审核队列：待审核资料、提交人、摘要、建议分类、片段预览。
- [x] 审核动作：通过、驳回、修改分类、启用/停用公司知识检索。
- [x] 分类管理：一级分类、二级分类、创建、编辑、删除、排序。
- [x] 审计记录：谁上传、谁审核、何时入库、是否被引用。

**验收标准：**

- 普通用户界面不出现 RAG、Memory、Embedding、Tool Call 等词。
- 管理员能完整处理入库申请。
- 删除、停用、审核等危险操作不会和普通按钮混在一起。

---

## Phase 5：联网调研工作流

**周期：5-8 天**

**目标：** 将联网查找升级为可控的“联网调研”。

**内部结构：**

- [x] Planner：拆成 3-5 个子问题。
- [x] Searcher：执行搜索和网页抓取。
- [x] Summarizer：总结每个子问题。
- [x] Reporter：输出最终报告。
- NoteTool：保存过程笔记。

**用户界面：**

- 用户看到：规划中、查找资料、整理结论、生成报告。
- 用户确认后，可以保存到我的资料或申请加入公司知识库。

**验收标准：**

- 联网资料不会自动成为公司正式知识。
- 报告能显示来源链接。
- 搜索失败时能降级为普通回答，并明确说明未联网成功。

---

## Phase 6：评估体系和质量看板

**周期：4-7 天**

**目标：** 内测阶段能量化质量，而不是凭感觉判断。

**指标：**

- [x] 工具调用成功率。
- [x] RAG 命中准确率。
- [x] 回答引用来源覆盖率。
- [x] 无来源回答比例。
- [x] 文档生成格式合格率。
- [x] 用户上传文件分类准确率。
- [x] 入库权限控制正确率。
- [x] 用户反馈满意度。

**验收标准：**

- 管理员能看到基础质量统计。
- 每次失败有错误码和排查线索。
- 可以抽样回放一次任务的工具调用和引用来源。

---

## 五、建议版本节奏

按当前约定，这次属于“功能优化”，建议升级第二位版本号。

如果当前桌面端显示为 `1.3.0`，建议：

- Phase 1-3 合并发布：`1.4.0`
- Phase 4-5 发布：`1.5.0`
- Phase 6 发布：`1.6.0`

如果期间只修引用、上传失败、样式错乱等问题，则只升级第三位，例如：`1.4.0 -> 1.4.1`。

---

## 六、不做清单

本轮不做：

- 不照搬 PDF 教程代码。
- 不把整本 PDF 入库。
- 不在普通用户界面暴露技术词。
- 不做复杂多 Agent 自主协作。
- 不把 MCP/A2A/外部向量库作为主架构。
- 不允许模型绕过确认直接删除、入库、审核或改管理员资料。

---

## 七、最小可落地版本

最小版本只做这些：

1. ToolRegistry。
2. 工具调用日志。
3. 公司知识 / 我的资料 / 当前附件检索工具。
4. Word 导出工具。
5. 引用来源实际使用过滤。
6. PDF 解析。
7. 资料入库申请和管理员审核闭环。
8. ContextBuilder 增加 GSSC 和长对话摘要。

完成后应满足：

- 用户能正常聊天和生成文档。
- 用户能上传 docx、xlsx、pptx、pdf、txt、md。
- 用户能查公司知识、我的资料、当前附件。
- 回答和 Word 导出只展示实际使用来源。
- 普通用户资料不会自动进入公司知识库。
- 管理员审核通过后资料才成为正式知识来源。
- 长对话不会无限堆上下文。
