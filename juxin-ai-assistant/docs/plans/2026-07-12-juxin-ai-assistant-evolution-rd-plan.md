# 聚信 AI 助手智能成长与多 Agent 研发实施方案

> 版本：1.0
> 编制日期：2026-07-12
> 实施基线：`main@8294a47`，当前项目采用 FastAPI + SQLAlchemy + MySQL/SQLite + React + Tauri + Nginx
> 目标：在不推翻现有系统的前提下，把聚信 AI 助手升级为“回复统一、任务可执行、结果会自检、经验可沉淀、管理员可治理”的企业工作助理。

---

## 1. 结论与实施决策

### 1.1 最终架构决策

采用以下组合，不做全量重写：

```text
统一回复层（FAQ，0 次模型调用）
        ↓ 未命中
总控路由层（判断任务类型、风险和复杂度）
        ├── 普通问答 → 单 Agent
        ├── 固定业务流程 → 确定性工作流
        └── 复杂任务 → 多 Agent 工作流
                          ├── 资料助理
                          ├── 写作助理
                          ├── 审核助理
                          └── 必要时人工确认

所有结果 → 规则自检 → 引用自检 → 质量评分 → 交付
所有反馈 → 学习候选 → 管理员审核 → 灰度发布 → 可回滚
```

具体决策：

1. 保留现有 `agent_loop`、`agent_runtime`、知识检索、长任务、学习中心、技能和治理中心。
2. 不按部门机械拆出十几个长期运行的 Agent；按任务动态启用专业角色。
3. FAQ、固定规则、权限检查、格式校验等确定性逻辑不交给模型处理。
4. 复杂报告、跨资料分析、需要计划和复核的任务才使用多 Agent。
5. 增加 `AgentRuntime` 适配层，第一阶段使用现有 Runtime；第二阶段以功能开关试点 LangGraph。
6. 不允许系统直接“自改代码、自改生产 Prompt、自发发布知识”；只能生成学习候选，必须通过评测和审核。
7. 前台只使用“正在理解、正在查找资料、正在整理、正在复核”等办公语言，不显示 RAG、Embedding、ReAct、Tool Call、Node 等工程术语。

### 1.2 为什么不立即全量替换框架

当前代码已经具备：

- `server/app/agent_loop/`：任务分析、计划、工具执行、观察、反思、生成、质量检查。
- `server/app/agent_runtime/`：工具定义、工具注册、权限和调用日志。
- `server/app/long_tasks.py`：长任务、草稿、取消、失败重试和恢复。
- `server/app/learning_*`：个人记忆、经验、模板、失败案例和评测基础。
- `server/app/hot_questions.py`：热点问题聚合及回复草稿。
- `server/alembic/versions/0024_shared_faqs.py`：统一回复表结构基础。
- `apps/desktop/src/pages/ChatPage.tsx`：聊天、引用、进度和成果交互。
- `apps/desktop/src/pages/admin/GovernanceCenter.tsx`：治理入口。

因此全量重写会重复建设，还会同时放大回归、数据迁移、权限和审计风险。正确做法是先建立可替换接口，再用一个真实工作流验证框架价值。

框架选型原则：

- 长任务、断点恢复、显式流程和人工审批优先选 LangGraph。
- 轻量 Agent、工具、交接和追踪可评估 OpenAI Agents SDK。
- 微软技术栈项目可评估 Microsoft Agent Framework。
- 角色化原型可用 CrewAI，但不作为本项目第一阶段核心依赖。

参考官方资料：

- [LangGraph 官方文档](https://docs.langchain.com/oss/python/langgraph/overview)
- [OpenAI Agents SDK 官方文档](https://openai.github.io/openai-agents-python/)
- [Microsoft Agent Framework 官方说明](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [CrewAI 官方文档](https://docs.crewai.com/index)

---

## 2. 建设目标与验收指标

### 2.1 用户目标

普通员工无需了解技术架构，登录后直接在对话页完成：

- 问公司共性问题并获得统一、稳定的口径。
- 查公司知识、个人资料或当前附件，并看到真实引用。
- 生成方案、报告、通知、纪要等可直接继续编辑的内容。
- 复杂任务能看到当前进度，失败后能继续或重试。
- 对回答进行纠正，让个人偏好和管理员认可的经验在后续生效。
- 导出 Word、复制内容、保存为工作成果。

### 2.2 管理目标

管理员能够：

- 维护统一问答及相似问法，修改后立即或按发布时间生效。
- 查看热点问题，把高频问题一键转成统一问答候选。
- 审核学习候选、公司模板和知识更新。
- 查看回答命中路径、模型调用率、引用准确率、人工修改率和失败原因。
- 灰度发布 Prompt、统一回复和 Agent 工作流，并快速回滚。

### 2.3 核心量化指标

| 指标 | 第一阶段目标 | 稳定运行目标 | 计算口径 |
|---|---:|---:|---|
| FAQ 命中后模型调用率 | 0% | 0% | `model_called=false` |
| 高频问题统一率 | ≥ 90% | ≥ 97% | 同一 FAQ 版本返回内容一致 |
| 普通问答 P95 首字时间 | ≤ 3 秒 | ≤ 2 秒 | 从发送到首段内容 |
| 复杂任务完成率 | ≥ 90% | ≥ 96% | 非用户取消的任务 |
| 引用准确率 | ≥ 90% | ≥ 95% | 实际支撑回答的引用占比 |
| 无依据时正确拒答率 | ≥ 95% | ≥ 98% | 评测集统计 |
| 管理员人工大改率 | 基线下降 20% | 基线下降 40% | 修改字符占比 > 30% |
| 学习候选误发布 | 0 | 0 | 未经审核进入生产的数量 |
| 工作流无限循环 | 0 | 0 | 超过最大步骤仍未终止 |
| 前端关键操作可访问性 | 100% | 100% | 键盘可达且有可见焦点 |

### 2.4 不在本期范围

- 不允许 Agent 自主修改业务代码并自动部署生产。
- 不允许普通用户上传文件后自动成为公司正式知识。
- 不做无边界的 Agent 自由组队。
- 不让多个 Agent 对所有简单问题重复调用模型。
- 不让同一个模型的“自我感觉评分”成为唯一质量依据。
- 不在前台展示复杂工程日志、完整系统 Prompt 或敏感错误信息。

---

## 3. 当前能力盘点与差距

| 领域 | 当前能力 | 主要差距 | 本方案处理 |
|---|---|---|---|
| 统一问答 | 已有迁移基础和热点问题能力 | 统一问答完整服务、别名、版本、发布闭环需补齐 | P0 完成 |
| Agent Loop | 已有任务分析、计划、检索、反思、质量检查 | 路由策略仍偏内置，缺少统一 Run/Step 契约 | P0/P1 升级 |
| 工具 | 已有注册、权限、日志、知识和学习工具 | 工具输入输出 schema、幂等和健康度需统一 | P1 升级 |
| 长任务 | 已有排队、草稿、取消、重试、恢复 | 当前进程内调度，多实例竞争和步骤级 checkpoint 不足 | P1 升级 |
| 学习 | 已有记忆、经验、模板、失败案例 | 缺少候选、评测、审核、灰度、回滚的完整链路 | P1/P2 完成 |
| 自检 | 已有 QualityChecker、Verifier 和评测题 | 缺少统一评分、输出契约、线上抽检 | P1 完成 |
| 前端 | 已有聊天、引用、进度、学习和治理页面 | 信息密度较高，弹窗式编辑偏多，状态层级可优化 | 全阶段优化 |
| 可观测性 | 已有工具日志、审计和统计页 | 缺少 Run 视角、Agent 步骤、预算和版本关联 | P1 完成 |

### 3.1 实施前必须清理的测试基线

2026-07-12 对当前代码做抽样自检时发现：

- 后端默认系统 Python 为 3.9，无法导入代码使用的 `datetime.UTC`；另一个 Python 3.11+ 环境未安装 SQLAlchemy 等项目依赖。实施前必须统一 Python 3.11/3.12 并安装 `requirements.txt`。
- 前端抽样运行 `chat-page`、`learning-page`、`governance-pages` 共 63 个测试：56 个通过、7 个失败，并出现 1 个未处理的 jsdom 异常。
- 失败主要来自上传弹窗文案/无障碍名称与测试不同：页面按钮是“开始上传（1）”，旧测试仍查找“开始上传”；文件说明变为“文件名：说明”的组合文本，旧测试按单独说明查找。
- 来源预览测试环境缺少 `scrollIntoView` mock，导致异步未处理异常。

这些问题不代表本方案功能失败，但说明当前分支还不是“全绿基线”。正式开发前先建立一个只修测试契约和测试环境的短任务：

1. 明确上传按钮的稳定 accessible name，动态数量放入可见文本或 `aria-describedby`。
2. 更新测试为按 `role="note"` 或完整可访问文本断言，避免依赖 DOM 文本拆分方式。
3. 在 `apps/desktop/tests/setup.ts` 增加受控的 `scrollIntoView` mock。
4. 统一 Python 版本并在 CI 中执行环境预检。
5. 在不新增业务功能的提交中把现有全量测试恢复为绿色，再开始 Phase 0。

---

## 4. 总体技术架构

### 4.1 分层结构

```text
React / Tauri / Web
├── 对话工作区
├── 任务进度与成果区
├── 我的偏好与模板
└── 管理治理中心
            │ HTTPS / SSE / REST
FastAPI API Layer
├── Session / Permission / CSRF
├── Chat / Run / FAQ / Learning / Governance API
└── Public response schema
            │
Decision Layer
├── FAQ Matcher
├── Intent & Complexity Router
├── Risk Policy
└── Runtime Selector
            │
Agent Runtime Adapter
├── NativeRuntime（默认）
└── LangGraphRuntime（试点、功能开关）
            │
Execution Layer
├── Coordinator
├── Research Agent
├── Writer Agent
├── Reviewer Agent
├── ToolRegistry
├── TaskState / Checkpoint
└── Model Gateway
            │
Data & Governance
├── MySQL
├── Redis / 队列锁 / 缓存
├── 向量与关键词索引
├── 文件存储
├── Prompt Center
└── 审计、指标与评测集
```

### 4.2 请求路由顺序

所有请求必须按以下顺序执行，顺序不可由模型自行改变：

1. 身份、权限、会话和请求来源校验。
2. 输入长度、敏感信息和附件安全检查。
3. FAQ 精确/别名/规范化匹配。
4. 判断是否属于固定业务工作流。
5. 判断任务复杂度和风险等级。
6. 选择单 Agent、确定性工作流或多 Agent 工作流。
7. 执行并保存 Run、Step、工具日志和 checkpoint。
8. 执行交付前自检。
9. 保存成果、引用、版本和审计信息。
10. 收集反馈，异步生成学习候选。

### 4.3 路由矩阵

| 场景 | 示例 | 路径 | 最大模型调用 |
|---|---|---|---:|
| 统一问答 | “公司做什么的” | FAQ 直接回复 | 0 |
| 闲聊/润色 | “帮我润色这句话” | 单 Agent | 1 |
| 有资料问答 | “手册中端口是多少” | 检索 + 单 Agent + 引用校验 | 1 |
| 固定任务 | “把这个文件申请进入公司资料” | 确定性工作流 + 人工确认 | 0～1 |
| 复杂报告 | “结合 5 份材料写风险评估报告” | 资料 + 写作 + 审核 | 2～4 |
| 高风险内容 | 合同、对外承诺、个人信息 | 受控工作流 + 强制人工复核 | 1～4 |
| 学习更新 | 高频问题形成标准答复 | 离线学习工作流 + 管理员审核 | 1～2 |

---

## 5. Agent 与工作流设计

### 5.1 总控 Agent（Coordinator）

职责：

- 读取已经通过权限和安全检查的任务摘要。
- 识别目标、输出类型、资料范围、复杂度和风险。
- 从允许的流程中选择一个，不允许任意生成未知流程。
- 控制总步骤、模型次数、Token、时限和失败策略。
- 汇总专业 Agent 的结构化结果，不直接覆盖证据。

输入契约：

```json
{
  "run_id": "uuid",
  "user_goal": "用户原始目标",
  "mode": "risk_assessment",
  "allowed_sources": ["official", "personal", "attachment"],
  "output_type": "report",
  "risk_level": "medium",
  "budget": {"max_steps": 8, "max_model_calls": 4, "timeout_seconds": 300}
}
```

输出契约：

```json
{
  "route": "multi_agent_report",
  "plan": ["收集资料", "生成提纲", "编写正文", "复核结果"],
  "required_agents": ["researcher", "writer", "reviewer"],
  "requires_human_review": false,
  "reason_code": "MULTI_SOURCE_LONG_REPORT"
}
```

禁止事项：

- 不直接获取 API Key。
- 不绕过工具权限。
- 不将个人资料转交给公司知识发布流程。
- 不超过服务端硬限制，即使模型要求继续。

### 5.2 资料 Agent（Researcher）

职责：

- 将问题拆成 1～5 个检索子问题。
- 按公司知识、个人资料、当前附件分区检索。
- 去重、冲突标记、可信度排序。
- 输出证据卡片，不写最终长文。

输出必须包含：

- `source_id`、文件名、页码/章节/片段位置。
- 支撑的事实摘要。
- 来源类型和权限范围。
- 是否存在冲突、是否缺少依据。

### 5.3 写作 Agent（Writer）

职责：

- 只基于用户目标、批准的结构和证据卡片写作。
- 使用当前助手模式、用户偏好和公司模板。
- 对没有依据的内容写“待确认”，不得补造事实。
- 输出正文及“声明—证据”对应关系。

### 5.4 审核 Agent（Reviewer）

职责：

- 检查事实是否有来源。
- 检查引用是否真的支持对应句子。
- 检查结构、格式、敏感信息、绝对化承诺和越权内容。
- 输出结构化问题列表和修订建议。
- 最多允许 Writer 修订两次，超过后转人工或带风险提示交付。

审核不能只依赖大模型，应组合：

1. 确定性规则：格式、必填章节、引用 ID、敏感词、权限。
2. 数据检查：来源是否存在、是否属于当前用户、文件是否启用。
3. 语义评测：引用与声明是否相关。
4. 独立评审 Prompt：避免 Writer 使用同一上下文直接“自评通过”。

### 5.5 学习 Agent（离线）

职责：

- 按日/周聚合高频问题、低分回答、管理员修改和失败任务。
- 生成 FAQ、别名、模板、知识维护、Prompt 修订候选。
- 用固定评测集和历史回放评估候选。
- 输出影响范围、收益、风险和回滚版本。

必须遵守：

- 学习候选默认 `draft`。
- 管理员审核通过后才能进入 `staged`。
- 灰度验证通过后才能进入 `published`。
- 每次发布保留上一版本并可一键回滚。

### 5.6 不需要 Agent 的能力

以下逻辑必须写成普通代码或数据库规则：

- FAQ 精确命中和标准回复返回。
- 权限判断、数据隔离、审计和限流。
- 文件格式、大小、病毒扫描结果和状态校验。
- 数据库事务、幂等、重试次数和超时。
- 引用 ID 存在性、文件归属和检索状态。
- Word 文件生成和模板渲染。
- 发布、停用、删除、回滚等管理操作。

---

## 6. Runtime 和框架接入设计

### 6.1 统一接口

建议新增：

```text
server/app/orchestration/
├── runtime.py
├── contracts.py
├── runtime_selector.py
├── native_runtime.py
├── langgraph_runtime.py
├── workflow_registry.py
├── budget_guard.py
├── checkpoint_store.py
└── workflows/
    ├── knowledge_answer.py
    ├── report_generation.py
    └── learning_candidate.py
```

核心接口：

```python
class AgentRuntime(Protocol):
    async def start(self, request: RunRequest) -> RunSnapshot: ...
    async def resume(self, run_id: str, command: ResumeCommand) -> RunSnapshot: ...
    async def cancel(self, run_id: str) -> RunSnapshot: ...
    async def inspect(self, run_id: str) -> RunSnapshot: ...
```

`RunRequest`、`RunSnapshot` 和 Step 事件必须由项目自己定义，不能直接把框架内部对象暴露给 API 和前端。这样更换框架时不修改用户接口。

### 6.2 NativeRuntime

第一阶段默认使用现有模块组合：

- `LoopRunner`
- `ToolRegistry`
- `TaskStateStore`
- `LongTaskService`
- `QualityChecker`
- `Verifier`

改造重点：

- 将当前一次性 `run_chat` 拆成可 checkpoint 的节点。
- 每个节点输入输出结构化并持久化摘要。
- 增加统一预算守卫和状态转换校验。
- 保留现有 API 兼容层，避免前端一次性重构。

### 6.3 LangGraphRuntime 试点

仅实现一个 `report_generation_v2` 图：

```text
START
  ↓
route
  ↓
research
  ↓
evidence_check ──资料不足──→ request_user_input / deliver_with_gap
  ↓资料充足
outline
  ↓
write
  ↓
verify ──不通过且 retry<2──→ revise
  ↓通过或达到上限
human_review_gate（按风险）
  ↓
persist_artifact
  ↓
END
```

试点开关：

```text
AGENT_FRAMEWORK_ENABLED=false
AGENT_FRAMEWORK_PROVIDER=langgraph
AGENT_FRAMEWORK_WORKFLOWS=report_generation_v2
AGENT_FRAMEWORK_ROLLOUT_PERCENT=0
```

上线顺序：开发环境 → 自动评测 → 管理员账号 → 5% 用户 → 20% → 50% → 100%。任何阶段触发失败率、耗时或成本阈值，立即切回 `NativeRuntime`。

### 6.4 模型网关

所有 Agent 只能通过 `ModelGateway` 调用模型：

```text
server/app/model_gateway/
├── gateway.py
├── providers/openai_compatible.py
├── routing.py
├── budget.py
├── retry.py
└── redaction.py
```

要求：

- 兼容当前 `server_model_client.py`，不重复保存密钥。
- API Key 只从服务端环境变量或受保护的用户模型配置读取，不写日志和数据库明文。
- 按任务选择模型：FAQ 不调用、分类用低成本模型、长文用主模型、审核可用独立配置。
- 每次调用记录模型别名、版本、耗时、输入/输出 Token、错误码，不记录敏感正文。
- 配置超时、有限重试、熔断和并发上限。

建议新增环境变量：

```text
AGENT_MAX_STEPS=8
AGENT_MAX_MODEL_CALLS=4
AGENT_MAX_TOOL_CALLS=12
AGENT_RUN_TIMEOUT_SECONDS=300
AGENT_REVIEW_MAX_REVISIONS=2
AGENT_DAILY_TOKEN_BUDGET_PER_USER=200000
AGENT_RUNTIME_DEFAULT=native
AGENT_SHADOW_EVAL_ENABLED=false
```

---

## 7. 统一问答与热点问题闭环

### 7.1 匹配优先级

1. 完全匹配标准问题。
2. 完全匹配管理员维护的相似问法。
3. 规范化匹配：空白、大小写、常见标点和全半角处理。
4. 高置信语义匹配，仅返回候选；达到管理员设定阈值才自动回复。
5. 未命中后进入正常 Agent 路径。

不建议一开始使用生成式模型做 FAQ 判断。语义匹配可先采用向量相似度，并设置严格阈值与冲突检测。

### 7.2 FAQ 数据模型

在已有 `ai_shared_faqs` 基础上补充或调整：

| 字段 | 说明 |
|---|---|
| `uuid` | 对外标识 |
| `question` | 标准问题 |
| `question_normalized` | 规范化文本，唯一索引 |
| `answer` | 当前回复正文 |
| `category` | 分类 |
| `status` | draft/staged/published/disabled |
| `version` | 乐观锁和发布版本 |
| `effective_at` | 生效时间 |
| `expires_at` | 可选失效时间 |
| `owner_department_id` | 维护部门 |
| `reviewer_user_id` | 审核人 |
| `source_links_json` | 回复依据 |
| `created_at/updated_at` | 时间 |

新增 `ai_shared_faq_aliases`：

- `faq_id`
- `alias_text`
- `alias_normalized`
- `status`
- 唯一索引 `(alias_normalized, status)`

新增 `ai_shared_faq_versions` 保存每次发布快照，确保可回滚。

### 7.3 FAQ 返回契约

```json
{
  "answer": "管理员已发布的统一回复",
  "answer_source": "shared_faq",
  "faq_id": "uuid",
  "faq_version": 4,
  "model_called": false,
  "match_type": "alias_exact",
  "confidence": 1.0
}
```

### 7.4 热点转 FAQ

治理中心支持：

1. 查看日、周、月热点。
2. 展开相似问法。
3. 查看当前已有 FAQ 是否覆盖。
4. 一键生成 FAQ 候选并自动带入相似问法。
5. 管理员编辑、补充依据、审核和发布。
6. 发布后用历史问题回放，确认命中率和冲突率。

---

## 8. 自我学习和成长闭环

### 8.1 学习来源

- 用户点赞、点踩和原因。
- 用户明确纠正：“不对，应该……”。
- 管理员修改统一回复和模板。
- 用户复制后再次编辑的差异（仅在用户明确允许且做脱敏摘要后使用）。
- 长任务失败、重试成功和人工接管记录。
- 高频问题聚类。
- 知识检索无结果、低相关和引用被移除记录。
- 评测集失败项。

### 8.2 学习候选类型

| 类型 | 示例 | 发布位置 |
|---|---|---|
| 个人偏好 | “导出 Word 使用公司格式” | 当前用户记忆 |
| 纠错规则 | “只显示真正引用的文件” | 当前用户或公司规则 |
| FAQ | “VPN 怎么申请” | 统一问答 |
| 模板 | “风险评估报告结构” | 个人/公司模板 |
| 知识维护 | “产品端口信息过期” | 知识治理待办 |
| Prompt 修订 | “回答总缺少待确认事项” | Prompt Center 草稿 |
| 技能候选 | “大量用户反复手工整理同类表格” | 能力治理待办 |

### 8.3 候选状态机

```text
draft
  ↓ 自动离线评测通过
evaluated
  ↓ 管理员审核通过
staged
  ↓ 小流量验证通过
published
  ├── 出现问题 → rolled_back
  └── 被新版替代 → superseded
```

### 8.4 发布保护

- 候选必须关联来源样本，但管理界面默认显示脱敏摘要。
- 不得从单个用户的一次反馈直接发布公司规则。
- 公司级候选至少满足样本量阈值或由管理员手动确认“紧急修正”。
- 发布前必须运行核心评测集和该候选影响范围评测集。
- 新版成绩不能低于当前生产版本；关键安全题必须全部通过。
- 发布记录保存发布人、评测报告、影响范围和回滚目标。

### 8.5 可继续增强的能力

本期完成闭环后，可按收益推进：

- 知识时效检测：识别过期日期、版本冲突和失效链接。
- 企业实体关系：产品—版本—模块—部署环境—文档之间建立关系。
- 能力发现：聚类高频复杂任务，建议新增一个可复用能力。
- 部门记忆：个人、部门、公司三级隔离和继承。
- 模型路由：按质量、延迟、成本和任务类型选择模型。
- 反事实回放：用历史问题比较“如果使用新规则会发生什么”。
- 影子运行：新 Agent 不向用户返回，只与生产结果对比。

---

## 9. 数据模型与迁移计划

### 9.1 新增表

#### `ai_agent_runs`

记录一次完整任务：

- `uuid`
- `owner_user_id`
- `conversation_id`
- `runtime`：native/langgraph
- `workflow_name`、`workflow_version`
- `route_type`：faq/single/workflow/multi_agent
- `status`：created/running/waiting/completed/failed/cancelled
- `current_stage`
- `risk_level`
- `budget_json`
- `usage_json`
- `result_artifact_id`
- `error_code`、`error_message_safe`
- `started_at`、`finished_at`、`created_at`、`updated_at`

索引：

- `(owner_user_id, created_at)`
- `(status, updated_at)`
- `(workflow_name, workflow_version)`

#### `ai_agent_run_steps`

- `run_id`
- `sequence`
- `agent_role`
- `node_name`
- `status`
- `input_summary_json`
- `output_summary_json`
- `checkpoint_json`
- `model_call_count`
- `tool_call_count`
- `latency_ms`
- `error_code`
- 时间字段

唯一索引 `(run_id, sequence)`，用于幂等恢复。

#### `ai_learning_candidates`

- `uuid`
- `candidate_type`
- `scope`：personal/department/company
- `owner_user_id`、`department_id`
- `title`
- `payload_ciphertext`、`payload_nonce`
- `evidence_summary_json`
- `status`
- `evaluation_report_json`
- `reviewer_user_id`
- `published_version_id`
- 时间字段

#### `ai_evaluation_cases`

- `uuid`
- `suite_name`
- `case_type`
- `input_ciphertext`
- `expected_rules_json`
- `tags_json`
- `risk_level`
- `status`

#### `ai_evaluation_runs`

- `uuid`
- `suite_name`
- `candidate_id`
- `runtime/workflow/model/prompt` 版本
- `summary_json`
- `passed`
- `created_at`

### 9.2 迁移编号建议

- `0026_agent_runs_and_steps.py`
- `0027_shared_faq_aliases_and_versions.py`
- `0028_learning_candidates.py`
- `0029_evaluation_registry.py`

每个迁移必须：

- 同时支持 MySQL 和测试用 SQLite。
- 提供 downgrade。
- 大表新增索引使用可控窗口执行。
- 发布前备份，迁移失败不启动新版本服务。

---

## 10. API 设计

### 10.1 用户 API

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/ai/runs` | 创建一次任务，服务端自动选择路径 |
| GET | `/api/ai/runs/{run_id}` | 获取任务快照 |
| GET | `/api/ai/runs/{run_id}/events` | SSE 获取进度和内容事件 |
| POST | `/api/ai/runs/{run_id}/cancel` | 取消任务 |
| POST | `/api/ai/runs/{run_id}/retry` | 从安全 checkpoint 重试 |
| POST | `/api/ai/runs/{run_id}/confirm` | 执行高风险动作前确认 |
| POST | `/api/ai/runs/{run_id}/feedback` | 提交反馈或纠正 |
| GET | `/api/ai/artifacts/{id}` | 获取工作成果 |

兼容策略：现有 `/api/ai/chat/prepare`、`complete` 和 `long-tasks` 暂时保留，由适配层转换成 Run，不要求前端一次改完。

### 10.2 管理 API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/api/ai/admin/faqs` | 查询和新建统一问答 |
| PUT | `/api/ai/admin/faqs/{id}` | 编辑草稿 |
| POST | `/api/ai/admin/faqs/{id}/publish` | 发布 |
| POST | `/api/ai/admin/faqs/{id}/rollback` | 回滚 |
| POST | `/api/ai/admin/hot-questions/{id}/create-faq` | 热点转 FAQ 候选 |
| GET | `/api/ai/admin/learning-candidates` | 学习候选列表 |
| POST | `/api/ai/admin/learning-candidates/{id}/evaluate` | 运行评测 |
| POST | `/api/ai/admin/learning-candidates/{id}/approve` | 审核通过 |
| POST | `/api/ai/admin/learning-candidates/{id}/reject` | 驳回 |
| GET | `/api/ai/admin/runs` | 运行质量列表，不默认显示正文 |
| GET | `/api/ai/admin/evaluations/{id}` | 查看评测报告 |

### 10.3 SSE 事件

前端只依赖稳定的业务事件：

```json
{"type":"stage","stage":"retrieving","label":"正在查找资料","progress":25}
{"type":"stage","stage":"writing","label":"正在整理回答","progress":55}
{"type":"delta","content":"增量正文"}
{"type":"source","source":{"id":"...","name":"产品手册.pdf","location":"第 12 页"}}
{"type":"review","label":"正在复核引用和格式","progress":85}
{"type":"completed","artifact_id":"...","quality":{"passed":true}}
```

禁止向前端发送完整模型思维链、系统 Prompt、API Key、内部文件路径和原始异常栈。

---

## 11. 前台产品与视觉方案

### 11.1 设计原则

沿用现有 `apps/desktop/DESIGN.md` 的“安静、可信、克制”风格，并增加：

- 对话是登录后的默认主界面。
- 主任务区尽量保持单一视觉焦点，减少同时出现的卡片数量。
- 技术状态翻译为办公语言。
- 重要信息通过排版、间距和层级表达，避免大面积高饱和颜色。
- 所有等待、空数据、失败、部分成功都提供可恢复操作。
- 深浅色模式均保持正文、边框和状态色对比度。

### 11.2 对话页布局

推荐桌面宽屏结构：

```text
┌──────────────┬────────────────────────────────────┬───────────────┐
│ 会话与历史   │              对话正文              │ 任务详情      │
│              │                                    │               │
│ 新建对话     │ 用户问题                           │ 当前进度      │
│ 今天         │                                    │ 使用的资料    │
│ 最近 7 天    │ 小聚回答                           │ 自检结果      │
│              │ ─────────────                      │ 工作成果      │
│              │ 引用来源（折叠）                   │               │
│              │                                    │               │
│              │ [附件] [资料范围] [输入框] [发送] │               │
└──────────────┴────────────────────────────────────┴───────────────┘
```

布局规则：

- 左栏 240～280px，可收起。
- 中栏最小 640px，最大正文宽度 900px，长行控制在易读范围。
- 右栏 280～320px，只在复杂任务或用户主动展开时显示。
- 窗口宽度小于 1180px 时，右栏变为抽屉。
- 小于 860px 时左栏收起，对话区单列。

### 11.3 对话卡片

用户消息：

- 使用轻微强调背景，不使用厚重阴影。
- 附件显示文件名、类型、大小和处理状态。

助手消息：

- 正文使用 15～16px、1.65 行高。
- 标题、列表、表格、代码块有明确层级。
- 底部操作固定为：复制、导出、保存成果、反馈、重新生成。
- FAQ 命中时显示低干扰标签“统一回复”，不显示“未调用模型”等技术信息。
- 无依据时使用说明卡，提供“上传资料”“换个问法”“查看资料范围”。

### 11.4 任务进度

短任务不显示复杂进度条，只显示一行动态状态。超过 3 秒或多步骤任务才展开：

```text
✓ 已理解需求
✓ 已找到 5 条相关资料
● 正在整理报告
○ 复核引用和格式
```

交互要求：

- 当前步骤有轻微呼吸动画；启用 reduced motion 时静态显示。
- 显示已用时间，但不承诺不可靠的剩余时间。
- 支持停止；失败时原地显示“重试”和“保留当前草稿”。
- 技术错误码仅放到“问题详情”，默认显示用户能执行的解决办法。

### 11.5 引用来源

- 默认折叠成“引用了 3 份资料”。
- 展开后按文件分组，不重复显示同一文件。
- 点击后右侧打开来源预览并高亮引用片段。
- 明确区分“公司资料、我的资料、当前附件、联网资料”。
- 只展示实际用于回答的来源，不展示仅检索但未使用的文件。

### 11.6 学习中心改版

普通员工只看到三个页签：

1. **我的偏好**：称呼、语气、常用格式、禁用表达。
2. **常用模板**：个人模板、公司模板、最近使用。
3. **改进记录**：我纠正过的问题、是否已生效、可以撤销。

不再使用 `window.prompt` 编辑。统一改为右侧抽屉或页面内表单，支持：

- 输入校验和字数提示。
- 保存前预览“它会如何影响后续回答”。
- 启用、停用、删除和撤销。
- 空状态给出真实示例，不展示技术字段。

### 11.7 治理中心改版

治理中心一级导航调整为：

```text
内容治理
├── 统一问答
├── 热点问题
├── 资料治理
└── 模板审核

能力治理
├── 助手能力
├── 工作流
└── 模型与预算

质量与安全
├── 质量看板
├── 学习候选
├── 运行记录
└── 审计日志
```

统一问答页面使用“列表 + 编辑抽屉”：

- 顶部：搜索、分类、状态、命中次数、最近更新筛选。
- 列表：标准问题、回复摘要、相似问法数、状态、版本、命中次数。
- 编辑抽屉：标准问题、相似问法、统一回复、依据、适用范围、生效时间。
- 发布前显示回放结果：预计命中多少历史问题、是否与现有 FAQ 冲突。

质量看板不以炫技大屏为目标，优先展示可行动信息：

- 今天哪些问题失败最多。
- 哪些资料经常检索不到。
- 哪些回答人工修改最大。
- 哪个工作流耗时或成本异常。
- 哪些学习候选等待审核。

### 11.8 视觉验收标准

- 新颜色先加入 `tokens.css`，不在组件内散落十六进制颜色。
- 卡片圆角遵循现有 10/14/20px 层级。
- 普通正文不小于 13px，核心正文 15～16px。
- 按钮具有 hover、active、focus-visible、disabled、loading。
- 错误状态同时使用图标、标题和文字，不只依赖红色。
- 关键页面在 1440×900、1280×800、900×640 三种尺寸无横向溢出。
- 支持浅色、深色和 `prefers-reduced-motion`。
- Playwright 截图基线必须覆盖对话空态、FAQ、复杂任务、失败重试、统一问答编辑和学习中心。

---

## 12. 系统自检设计

“能自己测试”分为运行时自检、离线自动评测和研发测试三层。

### 12.1 运行时交付前自检

每次回答生成后执行：

1. **结构检查**：JSON/schema、必填章节、长度、表格结构。
2. **引用检查**：引用 ID 存在、权限正确、位置有效、内容相关。
3. **事实覆盖**：重要事实是否有证据；无证据是否标记待确认。
4. **安全检查**：敏感信息、越权、绝对化承诺和危险操作。
5. **风格检查**：用户偏好、公司模板和禁用表达。
6. **完整度检查**：是否回答了用户目标，是否缺少关键章节。

自检输出：

```json
{
  "passed": false,
  "score": 78,
  "checks": {
    "schema": "passed",
    "citation": "failed",
    "safety": "passed",
    "style": "passed",
    "completeness": "warning"
  },
  "issues": [
    {"code": "CLAIM_WITHOUT_SOURCE", "severity": "high", "location": "第 2 节第 3 段"}
  ],
  "retryable": true
}
```

策略：

- 高风险检查失败：不得直接交付，修订或转人工。
- 中风险检查失败：最多自动修订两次。
- 达到修订上限：保留草稿并明确提示需人工复核。
- 自检失败不删除已生成草稿。

### 12.2 离线评测集

在现有 `server/eval_questions.json` 基础上升级为多个 suite：

```text
server/evals/
├── routing.json
├── faq.json
├── knowledge_grounding.json
├── report_generation.json
├── safety.json
├── learning_regression.json
└── ui_contract.json
```

每个用例包含：

- 输入、模式、资料范围和模拟权限。
- 期望路由和允许的最大模型调用。
- 必须出现/禁止出现的事实和表达。
- 是否必须引用、允许的来源 ID。
- 风险等级和通过阈值。

示例：

```json
{
  "id": "faq-company-profile-alias",
  "question": "咱们公司主要干嘛",
  "expected_route": "faq",
  "expected_faq_id": "company-profile",
  "max_model_calls": 0,
  "must_include": ["网络安全"],
  "risk_level": "low"
}
```

### 12.3 评分组成

| 项目 | 权重 | 方式 |
|---|---:|---|
| 路由正确 | 15 | 确定性断言 |
| 事实与引用 | 30 | 规则 + 语义相关性 |
| 任务完成度 | 20 | 规则 + 独立评审 |
| 安全合规 | 20 | 强制规则，关键项一票否决 |
| 格式与风格 | 10 | schema + 文本规则 |
| 成本与时延 | 5 | 调用计数和耗时 |

关键安全用例必须 100% 通过；总分达到 85 才允许灰度。

### 12.4 线上影子评测

- 仅抽取经过脱敏的请求摘要或经授权的测试账号请求。
- 新工作流在后台运行，不返回给用户。
- 对比当前生产结果和候选结果的质量、调用次数、耗时。
- 不把影子结果写入正式聊天记录。
- 超出预算时自动停止影子运行。

---

## 13. 研发自动化测试方案

### 13.0 测试环境预检

当前后端代码使用 `datetime.UTC` 等 Python 3.11+ 能力，开发机、CI 和容器必须统一使用 Python 3.11 或 3.12。测试开始前先执行：

```bash
cd juxin-ai-assistant/server
python3 -c "import sys; assert sys.version_info >= (3, 11), sys.version"
python3 -m pip install -r requirements.txt
python3 -c "import fastapi, sqlalchemy, pytest"
node --version
npm --version
```

CI 应基于 `server/Dockerfile` 的同版本 Python 运行后端测试，禁止开发机使用 3.9、CI 使用 3.12 造成结果不一致。后续建议在仓库根目录增加 `.python-version`，并在启动脚本中给出中文错误提示。

### 13.1 后端测试

新增测试文件：

```text
server/tests/
├── test_run_router.py
├── test_runtime_adapter.py
├── test_native_runtime.py
├── test_langgraph_runtime.py
├── test_run_checkpoint.py
├── test_run_budget.py
├── test_shared_faq_matcher.py
├── test_shared_faq_versions.py
├── test_learning_candidates.py
├── test_evaluation_runner.py
├── test_model_gateway.py
└── test_multi_agent_report.py
```

必须覆盖：

- FAQ 命中时模型 Mock 调用次数为 0。
- 同一 FAQ 版本不同用户得到相同正文。
- 普通问题只调用一个生成 Agent。
- 复杂报告按允许顺序执行资料、写作、审核。
- 工具越权时立即失败且记录审计。
- 达到最大步骤/模型次数后停止，不无限循环。
- 服务重启后从最后一个安全 checkpoint 恢复。
- 重复投递同一个 step 不产生重复成果。
- 用户取消后不再调用模型和外部工具。
- Reviewer 连续失败两次后进入人工复核状态。
- 学习候选未经审核不能发布。
- FAQ 回滚恢复旧版本并保留审计记录。

后端命令：

```bash
cd juxin-ai-assistant/server
python3 -m pytest tests -q
python3 scripts/run_learning_eval.py
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

### 13.2 前端组件测试

新增或扩展：

```text
apps/desktop/tests/
├── chat-routing-states.test.tsx
├── chat-run-progress.test.tsx
├── chat-faq-answer.test.tsx
├── chat-review-result.test.tsx
├── faq-admin-page.test.tsx
├── learning-candidates-page.test.tsx
├── learning-page.test.tsx
└── responsive-layout.test.tsx
```

覆盖：

- FAQ 标签、统一回复正文和操作按钮。
- 短任务不显示冗余进度，长任务展示 4 步进度。
- SSE 断线自动重连，重复事件不重复追加正文。
- 失败后保留草稿并可重试。
- 取消后停止流式内容。
- 引用只显示实际使用文件，点击可预览并高亮。
- 编辑抽屉具有 label、错误提示、焦点回归和键盘关闭。
- 空状态、加载、部分成功、403、409、500 的可恢复提示。
- 管理员和普通员工菜单、按钮和 API 权限一致。

前端命令：

```bash
cd juxin-ai-assistant/apps/desktop
npm test
npm run typecheck
npm run build:web
npm run test:e2e
```

### 13.3 E2E 场景

Playwright 至少覆盖：

1. 登录后直接进入对话。
2. FAQ 命中并显示统一回复。
3. 上传附件、等待处理、基于附件提问、查看引用。
4. 复杂报告显示计划、进度、自检和成果。
5. 网络中断后恢复进度。
6. 失败后重试并保留草稿。
7. 管理员从热点问题创建 FAQ、回放、发布。
8. 发布后员工新会话立即命中。
9. 管理员回滚 FAQ，员工获得旧版本回复。
10. 用户纠正回答，产生个人学习候选并可撤销。

### 13.4 视觉回归

输出截图：

```text
apps/desktop/output/playwright/
├── chat-empty-light.png
├── chat-empty-dark.png
├── chat-faq-light.png
├── chat-report-running-light.png
├── chat-report-completed-light.png
├── chat-failed-retry-light.png
├── governance-faq-wide.png
├── governance-faq-narrow.png
├── learning-center-light.png
└── learning-center-dark.png
```

检查项：无截断、无重叠、无横向滚动、焦点清晰、深浅色对比正确、中文换行自然。

### 13.5 CI 门禁

Pull Request 必须通过：

1. Python 单测和迁移测试。
2. TypeScript 类型检查和 Vitest。
3. Web build 和容器构建。
4. 核心 E2E。
5. 离线评测集。
6. Secret scan，禁止提交 API Key、真实用户正文和本地数据库。
7. 关键页面视觉截图生成。

夜间任务增加：全量 E2E、影子评测、检索质量评测、依赖漏洞检查和长任务恢复测试。

---

## 14. 分阶段研发计划

建议团队：后端 2 人、前端 1～2 人、测试 1 人、产品/设计 0.5～1 人。总周期预计 8 周；如果只有 1 名全栈开发，建议按 P0→P1 顺序拆成约 12～16 周。

### Phase 0：基线与统一问答闭环（第 1 周）

目标：先解决共性问题统一、零模型调用和可治理。

后端任务：

- 完成 `SharedFaq` ORM、service、matcher 和管理路由。
- 增加 alias、版本和回滚迁移。
- 在聊天 prepare 最前方接入 FAQ matcher。
- 记录命中类型、FAQ 版本和 `model_called=false`。
- 热点问题增加“转统一问答候选”。

前端任务：

- 治理中心新增“统一问答”。
- 使用列表 + 编辑抽屉 + 发布回放。
- 对话中增加低干扰“统一回复”标识。
- 完善加载、空状态、冲突和发布成功反馈。

测试：

- FAQ 单测、API、权限、并发版本和回滚。
- 命中后模型零调用测试。
- 管理发布到员工命中的 E2E。

验收：

- 管理员可维护、发布、停用和回滚。
- 相同 FAQ 版本返回完全一致。
- FAQ 路径不调用模型。

### Phase 1：统一 Run、预算和自检（第 2～3 周）

目标：把已有 Loop、长任务和工具统一到可追踪运行模型。

后端任务：

- 新增 `ai_agent_runs`、`ai_agent_run_steps`。
- 实现 `AgentRuntime` 和 `NativeRuntime`。
- 增加 `BudgetGuard`、状态转换校验和 step 幂等。
- 将现有 LongTask 与 Run 建立映射。
- 增加统一 Verifier 结果和错误码。
- 提供 Run API 和 SSE 事件。

前端任务：

- 重构 ChatPage 的进度状态为统一事件 reducer。
- 短任务简洁显示，复杂任务显示步骤。
- 失败保留草稿，支持原地重试和取消。
- 右侧任务详情按需展开。

测试：

- 状态机、预算、超时、取消、恢复、SSE 重连。
- 自检失败→修订→交付的完整测试。

验收：

- 任意任务均能通过 `run_id` 回放公开步骤。
- 服务重启后可安全恢复。
- 不存在无限循环和重复成果。

### Phase 2：复杂报告多 Agent 试点（第 4～5 周）

目标：只在复杂报告场景验证多 Agent 和 LangGraph。

后端任务：

- 实现 Coordinator、Researcher、Writer、Reviewer 契约。
- 实现 `report_generation_v2` Native 版本。
- 增加 LangGraph 可选依赖和适配实现。
- 增加人工确认节点、checkpoint 和成果保存。
- 记录每个 Agent 的耗时、模型次数和质量结果。

前端任务：

- 增加报告计划、进度、依据摘要、自检结果和成果卡。
- 不展示 Agent 名称，显示“查找资料、编写内容、复核结果”。
- 支持在完成后打开成果、导出 Word、继续修改。

试点评估：

- 选择 50～100 个真实但脱敏的报告任务。
- Native 单 Agent、Native 多 Agent、LangGraph 多 Agent 三组对比。
- 比较完成度、引用、人工修改率、耗时和成本。

进入下一阶段条件：

- 质量提升至少 10%，或人工大改率下降至少 20%。
- P95 耗时不超过基线 2 倍。
- 平均模型成本不超过基线 2.5 倍。
- 无权限、数据泄漏和不可恢复错误。

未达标处理：保留 Runtime 接口，关闭 LangGraph 开关，继续使用 NativeRuntime。

### Phase 3：学习候选与灰度发布（第 6～7 周）

目标：形成受控的“越用越聪明”闭环。

后端任务：

- 新增学习候选和评测记录。
- 接入高频问题、低分反馈、管理员修改和失败任务。
- 自动生成候选并运行影响范围评测。
- 完成审核、灰度、发布、回滚状态机。

前端任务：

- 学习中心改为“我的偏好、常用模板、改进记录”。
- 治理中心增加“学习候选”。
- 候选详情展示来源摘要、影响范围、评测前后对比和回滚点。

验收：

- 个人纠正可生效和撤销。
- 公司规则未经审核无法发布。
- 发布失败可回滚，且不影响聊天主链路。

### Phase 4：视觉、质量和生产灰度（第 8 周）

目标：达到正式发布要求。

- 完成对话、统一问答、学习中心和质量看板视觉整理。
- 补齐深色、窄屏、键盘、reduced motion。
- 全量运行自动评测、E2E、迁移、恢复和安全测试。
- 管理员试用 → 5% → 20% → 50% → 全量。
- 准备发布说明、运维手册、故障降级和回滚脚本。

---

## 15. 文件级实施清单

### 后端新增

```text
server/app/orchestration/*
server/app/orchestration/workflows/*
server/app/model_gateway/*
server/app/shared_faq_service.py
server/app/shared_faq_matcher.py
server/app/evaluation/*
server/app/learning_candidates/*
server/app/run_routes.py
server/app/admin/shared_faq_routes.py
server/app/admin/learning_candidate_routes.py
server/alembic/versions/0026_*.py ～ 0029_*.py
```

### 后端修改

- `server/app/main.py`：挂载 Run、FAQ 和学习候选路由。
- `server/app/chat_routes.py`：FAQ 前置和旧接口适配。
- `server/app/agent_loop/loop_runner.py`：节点化、预算和 checkpoint。
- `server/app/agent_runtime/tool_registry.py`：schema、幂等和健康状态。
- `server/app/long_tasks.py`：Run 映射、多实例安全恢复。
- `server/app/server_model_client.py`：纳入 ModelGateway。
- `server/app/models.py`：新增模型。
- `server/app/schemas.py`：公开契约。
- `server/app/hot_questions.py`：FAQ 覆盖分析。
- `server/app/learning_eval.py`：多 suite 和版本对比。

### 前端新增

```text
apps/desktop/src/pages/admin/SharedFaqPage.tsx
apps/desktop/src/pages/admin/LearningCandidatesPage.tsx
apps/desktop/src/pages/admin/RunQualityPage.tsx
apps/desktop/src/components/RunProgress.tsx
apps/desktop/src/components/RunDetailsDrawer.tsx
apps/desktop/src/components/QualitySummary.tsx
apps/desktop/src/components/FaqAnswerBadge.tsx
apps/desktop/src/components/EditorDrawer.tsx
apps/desktop/src/api/runs.ts
apps/desktop/src/api/sharedFaqs.ts
```

### 前端修改

- `apps/desktop/src/pages/ChatPage.tsx`：Run reducer、FAQ、进度、质量和成果。
- `apps/desktop/src/pages/LearningPage.tsx`：三页签和抽屉编辑。
- `apps/desktop/src/pages/admin/GovernanceCenter.tsx`：分组导航。
- `apps/desktop/src/pages/admin/HotQuestionsPage.tsx`：转 FAQ。
- `apps/desktop/src/theme/tokens.css`：新增状态、布局和响应式样式。
- `apps/desktop/src/App.tsx`：登录后默认对话及右侧面板状态。

---

## 16. 安全、权限和隐私

- 服务端环境变量中的模型 API Key 不允许通过任何 API 返回。
- 日志只记录脱敏摘要、Hash、计数、耗时和错误码。
- Agent 工具权限由服务端代码校验，模型提供的“允许访问”无效。
- 公司知识、个人资料、当前附件必须使用不同过滤条件和权限上下文。
- 多 Agent 之间只传结构化的最小必要上下文。
- 管理员查看运行记录默认不显示用户正文；查看敏感详情需要更高权限并写审计。
- 对外发送、删除、发布、入库和覆盖文件必须由确定性代码执行，必要时要求用户确认。
- 防止 Prompt Injection：资料内容始终标记为不可信数据，不能改变系统规则和工具权限。
- 设置每用户、每部门、全局并发和 Token 限额，防止循环和成本失控。

---

## 17. 运维、监控与降级

### 17.1 关键监控

- 请求量、FAQ 命中率、模型调用率。
- Run 完成率、失败率、取消率、恢复率。
- 各阶段耗时和 P95。
- 模型 Token、成本、限流、超时和认证失败。
- 工具调用成功率、知识检索空结果率。
- 引用准确率、人工修改率、学习候选通过率。
- 队列长度、最老任务等待时间、重复执行数。

### 17.2 降级顺序

1. LangGraph 异常：切回 NativeRuntime。
2. Reviewer 模型异常：执行确定性检查，标记需人工复核。
3. 向量检索异常：降级关键词检索。
4. Redis 异常：关闭缓存，关键幂等回到数据库。
5. 主模型异常：FAQ 继续可用；普通生成提示重试或切换备用模型。
6. 长任务异常：保留 checkpoint 和草稿，不删除用户成果。

### 17.3 回滚

- 所有新入口受功能开关控制。
- API 契约向后兼容一个完整发布周期。
- 数据迁移优先新增表/字段，不在同版删除旧字段。
- 前端能识别服务端不支持 Run API 时回落旧聊天流程。
- FAQ、Prompt、工作流和学习候选都有独立版本回滚。

---

## 18. 发布验收清单

### 功能

- [ ] 登录后直接进入对话页。
- [ ] FAQ 精确和别名命中，回复统一且零模型调用。
- [ ] 未命中 FAQ 正常进入单 Agent。
- [ ] 复杂报告进入受控多 Agent 流程。
- [ ] 任务可以取消、失败重试、服务重启恢复。
- [ ] 交付前完成引用、格式、安全和完整度自检。
- [ ] 用户可以纠正、撤销个人学习内容。
- [ ] 管理员可以审核、灰度、发布和回滚公司级更新。

### 前台

- [ ] 1440×900、1280×800、900×640 布局正常。
- [ ] 浅色、深色、键盘操作和 reduced motion 正常。
- [ ] 所有加载、空状态、错误状态有下一步操作。
- [ ] 进度使用办公语言，不暴露内部技术术语。
- [ ] 引用按文件分组且只显示真实使用来源。
- [ ] 不再使用浏览器原生 prompt 作为主要编辑方式。

### 测试和安全

- [ ] 后端全量 pytest 通过。
- [ ] 前端 Vitest、typecheck、build 通过。
- [ ] 核心 Playwright E2E 通过。
- [ ] 核心评测集和安全集通过。
- [ ] 数据库 upgrade/downgrade/upgrade 验证通过。
- [ ] 无真实 API Key、用户原文、本地数据库进入 Git。
- [ ] 权限、审计、取消、预算和无限循环测试通过。

### 生产指标

- [ ] 灰度期间 FAQ 错误命中率低于 1%。
- [ ] 复杂任务完成率达到 90%。
- [ ] P95 时延和模型成本未超过准入阈值。
- [ ] 无高等级数据泄露和越权事件。
- [ ] 回滚演练成功。

---

## 19. 最小可交付版本（MVP）

如果需要最快落地，先交付以下六项，不等待完整多 Agent：

1. 统一问答完整闭环，命中后不调用模型。
2. 热点问题一键生成统一问答候选。
3. 统一 Run/Step 状态和预算限制。
4. 回答交付前的引用、格式和安全自检。
5. 学习候选必须经过管理员审核。
6. 对话页、统一问答页和学习中心的视觉与状态改版。

完成 MVP 后再用“复杂报告生成”验证 LangGraph 和多 Agent。这样即使框架试点最终不采用，FAQ、自检、学习治理、前台体验和可观测性投入仍然全部有效。

---

## 20. Definition of Done

任一研发任务只有同时满足以下条件才算完成：

1. 有明确用户结果和失败恢复方式。
2. 服务端权限和审计已覆盖。
3. 先有失败测试，再有实现，测试稳定通过。
4. API、状态、错误码和数据迁移有文档。
5. 前台覆盖加载、空状态、成功、失败和窄屏。
6. 不泄露内部 Prompt、密钥、思维链和敏感正文。
7. 有指标可判断上线是否真的变好。
8. 有功能开关或版本回滚路径。
9. 已运行本阶段约定的自动化测试和评测集。
10. 代码评审、测试记录和发布说明已完成。
