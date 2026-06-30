# 现有 Agent 架构分析

审计对象：聚信 AI 助手内测版  
审计日期：2026-06-25

## 总体判断

当前系统已经具备“企业任务型 AI 助手”的核心闭环：任务目录、Prompt 绑定、知识注入、桌面模型调用、结果落库、审计、Word 导出和治理后台。

但它还不是完整意义上的“Agent Runtime”。现阶段更准确的架构名称是：

```text
Task Catalog + Prompt Orchestration + Local Model Bridge + Governance Console
```

也就是“任务驱动的 AI 工作台”，而不是“自然语言意图路由 + 动态技能加载 + 多步状态机 + 工具执行”的通用 Agent 平台。

## 架构能力矩阵

| 能力 | 当前状态 | 证据/位置 | 结论 |
|---|---|---|---|
| Intent Router | 部分存在 | `/api/ai/catalog?query=` 只做目录搜索 | 没有真正的自然语言意图识别与任务路由 |
| Skill Loader | 不存在 | 无独立 skill registry/loader/executor | 当前任务配置承担了“技能入口”的角色 |
| Context Builder | 部分存在 | `server/app/generation_service.py` | prepare 阶段组装 Prompt、输入、知识、治理规则 |
| Task State | 部分存在 | `ai_generation_records.status`、`ai_tasks.status` | 有任务/生成状态，但无多步 Agent 状态机 |
| Audit Log | 已存在 | `server/app/audit.py`、`ai_audit_logs` | 审计设计较完整，且会清洗正文/敏感字段 |
| Knowledge Search | 已存在但简单 | `server/app/knowledge.py` | 任务关联 + 关键词命中排序，非语义检索 |
| Document Generator | 已存在 | `server/app/word_export.py`、`document_governance.py` | 可生成 Word，并补齐公司级结构 |
| Word 导出 | 已存在 | `/api/ai/generations/{uuid}/export.docx` | 服务端生成，桌面端保存到下载目录 |
| 权限控制 | 已存在 | `auth.py`、`require_action` | 复用统一登录和授权中心 |
| Prompt Injection 防护 | 部分存在 | system/user 分离、敏感检测、审计清洗 | 缺少专门注入识别和不可信上下文隔离 |

## 1. Intent Router 分析

### 当前实现

当前系统通过以下方式让用户找到任务：

- 首页最近任务/收藏任务。
- 全部助手列表。
- `/api/ai/catalog` 支持简单 query 搜索。
- 任务以 `Assistant -> Task` 层级组织。

### 不足

当前没有看到以下能力：

- 输入一句自然语言后自动选择最合适任务。
- 多任务候选打分。
- 意图置信度。
- 任务参数自动抽取。
- “未命中任务时建议创建任务”的闭环。

### 结论

Intent Router：不存在完整实现。当前仅为任务目录搜索。

## 2. Skill Loader 分析

### 当前实现

系统中“Skill”的实际替代物是：

- `Assistant`：助手分类。
- `Task`：可执行任务。
- `TaskField`：任务入参 schema。
- `TaskPromptBinding`：任务绑定 Prompt Center 的 Prompt。
- `KnowledgeTaskLink`：任务绑定知识。

### 不足

未见以下结构：

- `skills/` 目录。
- skill manifest。
- 动态加载器。
- 工具权限声明。
- skill 输入输出契约。
- skill 执行沙箱。
- skill version/runtime 兼容策略。

### 结论

Skill Loader：不存在。当前是任务配置系统，不是可插拔技能系统。

## 3. Context Builder 分析

### 当前实现

`prepare_generation` 负责构造模型上下文：

1. 验证任务状态。
2. 读取任务字段。
3. 校验输入。
4. 敏感信息扫描。
5. 查 Prompt 绑定。
6. 从 Prompt Center 拉取已发布 Prompt。
7. 渲染 Prompt 变量。
8. 检索知识。
9. 区分质量规则与参考知识。
10. 注入公司安全规则、任务 Prompt、输出格式、文档治理规则、质量规则。
11. 把员工输入放入 user message。

### 优点

- 模型密钥不进服务端。
- Prompt 来自 Prompt Center 已发布版本。
- 输入和输出加密。
- system message 与 user message 分离。
- 质量规则有最大条数和最大字符数限制。
- 参考知识限制为最多 8 条。

### 不足

- 上下文预算不是按模型 context window 计算。
- 未暴露上下文使用率。
- 未见 token 估算。
- 未见 RAG 片段级来源、可信等级、引用边界。
- 参考知识直接拼入 user message，未明确“不可信内容不得作为指令”。
- Prompt、治理规则、质量规则组合顺序固定在代码里。

### 结论

Context Builder：部分存在，已经承担核心编排；但需要升级为显式组件。

## 4. Task State 分析

### 当前实现

已有状态：

- `ai_tasks.status`：任务 DRAFT/ACTIVE 等。
- `ai_generation_records.status`：生成 PENDING/COMPLETED 等。
- `ai_task_suggestions.status`：建议审核状态。
- 本地队列 `pending/completed`。
- 桌面更新 release 状态。

### 不足

缺少 Agent 任务级状态机：

- `CREATED`
- `ROUTED`
- `CONTEXT_READY`
- `MODEL_RUNNING`
- `WAITING_USER_CONFIRMATION`
- `TOOL_RUNNING`
- `SYNC_PENDING`
- `FAILED_RETRYABLE`
- `FAILED_FINAL`
- `CANCELLED`

当前状态主要围绕“一次生成记录”，不适合承载复杂 Agent 流程。

### 结论

Task State：部分存在；对单次生成够用，对多步 Agent 不够。

## 5. Audit Log 分析

### 当前实现

审计模块具有以下设计：

- `AuditLog` 独立表。
- 写入 actor、action、entity、result、metadata。
- IP/User-Agent 使用 salt hash。
- metadata 白名单。
- 敏感 key 过滤，避免记录 input/output/prompt/content/body/message 等正文。
- 生成、反馈、任务管理、知识库管理、设置、建议等关键动作写审计。

### 不足

- 未见审计事件的统一枚举和覆盖率报告。
- 模型调用开始/结束、取消、失败原因等本地侧事件不一定都进入服务端审计。
- Prompt 注入/敏感确认这类安全事件可进一步独立成审计类型。

### 结论

Audit Log：已存在，基础较好。

## 6. Knowledge Search 分析

### 当前实现

知识库检索逻辑：

- 只检索与当前任务关联的知识。
- 解密知识正文。
- 根据 `keywords_json` 是否出现在输入文本中打分。
- 按 score、priority、uuid 排序。
- 质量规则和参考知识分开处理。

### 优点

- 任务级知识隔离明确。
- 知识正文加密存储。
- 支持质量规则作为强约束注入。
- 有数量/字符上限。

### 不足

- 不是语义检索。
- 没有向量索引。
- 没有召回解释。
- 没有去重/冲突解决。
- 知识内容直接进入上下文，缺少不可信边界提示。
- 检索前会解密全部关联知识，对大规模知识库性能会受限。

### 结论

Knowledge Search：已存在但属于轻量关键词检索。

## 7. Document Generator 与 Word 导出分析

### 当前实现

- 服务端 `word_export.py` 使用 `python-docx` 生成 Word。
- 支持封面、页眉、页脚、修订记录、标题编号、表格解析、补齐公司级必备章节。
- `document_governance.py` 根据文档类型注入结构要求。
- 导出 API 返回 docx 二进制。
- 桌面端保存到下载目录，文件名做安全清洗，避免覆盖。

### 不足

- Word 模板写在代码里，不是 `.docx` 模板或可配置模板。
- 样式扩展需要改代码。
- 导出失败只有通用错误提示，缺少可诊断错误码。
- 暂未见异步导出任务队列，大文档导出仍是请求内完成。

### 结论

Document Generator / Word 导出：已存在，满足当前内测，但模板化程度不足。

## 8. 权限控制分析

### 当前实现

- 所有核心 API 依赖 `get_session`。
- 统一登录 introspect 校验 Cookie。
- 检查用户 apps 是否包含 `ai-assistant`。
- 管理类动作调用 `require_action("ai_assistant:admin")`。
- 生成类动作调用 `require_action("ai_assistant:use")`。
- 建议提交有 `ai_assistant:task:suggest` 和部门资源参数。
- 前端按 role 控制菜单展示。
- Tauri 命令用 `guard_business` 和本地 session bind 限制调用来源。

### 不足

- 前端 role 控制只用于显示，真实控制仍依赖服务端；这是正确的，但报告中要提醒不要把前端菜单当权限。
- 本地 Tauri 权限边界依赖窗口来源、工作台状态、本地绑定，需要继续保持测试覆盖。
- 管理员能访问知识正文，需明确审计与最小权限策略。

### 结论

权限控制：已存在，且比普通内测项目更完整。

## 9. Prompt Injection 防护分析

### 当前已有防护

- 系统规则与用户输入分为 system/user 两条 message。
- 服务端字段白名单校验，拒绝未知字段。
- 敏感信息检测和确认。
- 审计日志不记录正文、Prompt、密钥等敏感字段。
- 模型 API Key 不传服务端。
- 输出要求加入正式业务文档约束。

### 主要缺口

- 参考知识和用户输入中如果包含“忽略以上规则”等文本，目前没有专门隔离或检测。
- 未见 Prompt Injection 分类器或规则库。
- 未见把检索内容包裹为“非指令资料”的统一模板。
- 未见对 Prompt Center 内容发布前的安全 lint。
- 未见模型输出安全复核器。

### 结论

Prompt Injection 防护：部分存在，仍是下一阶段高优先级改造点。

## 10. 当前架构图

```text
统一登录 auth
   ↑ Cookie introspect / authorize
   │
React/Tauri 工作台 ──────── FastAPI ai-assistant-api ─────── Prompt Center
   │                               │                         ↑
   │                               │                         │ published prompt
   │                               ↓
   │                         MySQL juxin_ai_assistant
   │                         - tasks/fields/bindings
   │                         - encrypted history
   │                         - knowledge
   │                         - audit
   │
   ├─ 本地模型配置 + 本地加密 API Key
   ├─ OpenAI compatible provider /chat/completions
   ├─ 本地草稿 / 离线同步队列
   └─ Word 保存到下载目录
```
