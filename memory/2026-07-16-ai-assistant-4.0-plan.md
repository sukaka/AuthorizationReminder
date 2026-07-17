# 聚信 AI 助手 4.0 自动流程版方案续接记录

## 目标

- 从 `codex/3.0-merged` 创建 4.0 开发分支。
- 评审用户提供的《聚信 AI 助手 4.0——自动流程版总体方案》与 3.0 已提交能力、当前工作树原型和稳定性契约是否匹配。
- 形成可落地、可检测、以系统稳定为最终门槛的改进计划和完整 4.0 方案。
- 将在线文档编辑和 WordPress 式块拖拽纳入 4.0.0 正式范围，复用现有 Office 交付能力并明确复用边界。

## 当前分支与边界

- 已从 `codex/3.0-merged` 创建并切换到 `codex/ai-assistant-4.0`。
- 分支起点：`150da87e347a6a56f97ba48442bbe3b7e51ba3de`（`ai-assistant-v3.0.0`）。
- 工作树在切换前已有大量未提交改动；这些改动全部保留，本任务不清理、不覆盖、不提交或推送。
- 本轮已新增独立 Demo 页面、导航入口、作用域样式、测试和评审记录；不接真实业务写接口、不升级版本、不执行 staging 或生产操作。

## 已确认事实

- 3.0 已提交基线具备专业 Skill、模板、项目范围、成果、事实证据、AI/人工审核与交付能力。
- 当前工作树包含 `workflow_engine.py`、`workflow_routes.py`、`WorkflowDefinition`/`WorkflowVersion` 等未提交工作流骨架。
- 该骨架当前为同步进程内执行：运行和节点未独立持久化；人工审核只返回 `waiting_human`；没有调度、事件收件箱、持久审批、节点恢复、租约/fencing、统一工具调用账本和出站对账闭环。
- 当前工作树已有可复用的 AgentRun/Step/Event、状态契约、ToolRegistry、工具调用账本、Checkpoint、租约/fencing、直接动作/渠道出站对账、专业交付审批和运营门禁。
- 正式发布仍受 Alembic 双 head、staging 双 worker 恢复、真实 provider 对账、生产 checkpointer、连续观测和灰度证据限制。
- 专业成果正文已有 `DeliverableContent.blocks` 和稳定 `block_id`；版本 diff、事实、证据、评论和审核均围绕块定位，适合继续作为文档领域事实源。
- 当前专业成果页通过 `textarea` 把多个块折叠为纯文本，无法编辑或拖拽表格、图片，也会削弱块级结构。
- 桌面端当前没有富文本/块编辑/拖拽依赖；现有 Office 代码主要覆盖模板、上传解析、DOCX/XLSX/PPTX 产物、下载和交付，不是浏览器在线编辑器。

## 初步结论

- 用户方案的产品方向和业务边界适合聚信 AI 助手。
- 原方案不能原样作为开发蓝图：组件和数据表按全新系统设计，容易复制现有状态机、审批、工具执行、审计和恢复语义。
- 不建议推倒重构 3.0；建议先做一次有限的执行内核收敛，让 Workflow 作为 AgentRun 的上层编排，复用统一状态、工具和恢复契约，再分阶段增加触发器、模板和设计器。
- 在线编辑建议采用 Tiptap/ProseMirror + React NodeView，但通过 `BlockEditorAdapter` 读写 `DeliverableContentV2`；Tiptap JSON 只做前端运行态，不能成为第二套服务端事实源。
- Office 复用模板、样式、导入导出、文件哈希、下载和交付链；选区、撤销、表格交互、块拖拽和图片上传状态由内置块编辑器新增。
- 4.0.0 采用单活编辑租约、revision 和 fencing，暂不做 CRDT/OT 多人实时共同编辑。
- 自动保存写入可变 `DeliverableDraft`，用户明确保存/提交审阅才创建不可变 `WorkArtifactVersion`，避免版本风暴。
- 首版拖拽范围为顶层段落、表格和图片；移动保留 `block_id`，复制/拆分生成新 ID，锚点重映射或失效必须可检测。

## 已完成

- 完成方案适配矩阵、目标架构、统一契约、数据模型、API/UI、阶段计划、验收指标、测试矩阵、发布门禁和回滚方案。
- 在完整方案中增加 `DeliverableContentV2`、Draft/EditLease/Media 模型、编辑 API、块编辑器布局、技术选型、保存恢复语义、Office 转换边界、P1A 开发阶段和自动化验收矩阵。
- 完整方案已写入 `juxin-ai-assistant/docs/plans/2026-07-16-ai-assistant-4.0-automatic-workflow-plan.md`。
- 已复核当前分支为 `codex/ai-assistant-4.0`；保留工作树内全部用户改动，仅对现有 `App.tsx` 做追加式导航接入。
- Demo 的目标测试、相关成果页回归、类型检查、Web 构建和浏览器验收均已通过。

## 下一步

- 由用户确认补充后的 4.0.0 范围，尤其是“单人在线编辑 + 其他人只读/接管”而非多人实时共同编辑。
- 获得开发指令后先做 P0：冻结 V2/Draft/Media/EditLease 契约，验证 Tiptap/BlockNote、React 19、中文 IME、拖拽、Office 转换和大文档性能，再锁定依赖。
- P1A 先打通一个现有成果的 V1 读取 → 在线块编辑 → 段落/表格/图片拖拽 → 自动保存 → V2 版本 → DOCX 导出，再进入 P1B 手动自动流程。
- 继续遵守授权边界：未明确授权前不提交、不推送、不操作共享数据库或 staging。

## 4.0 在线编辑 Demo 原型

- 已在 `codex/ai-assistant-4.0` 的现有桌面端增加独立“4.0 编辑 Demo”导航入口。
- 新增页面 `apps/desktop/src/pages/ProfessionalEditorDemoPage.tsx` 和作用域样式 `apps/desktop/src/pages/professional-editor-demo.css`。
- 新增测试 `apps/desktop/tests/professional-editor-demo.test.tsx`，覆盖稳定块 ID、拖拽换序、键盘换序、内容编辑、插入、自动保存、新版本和审核/评论切换。
- 原型包含左侧大纲、中间纸张式编辑器、右侧事实/质量/评论/版本三栏；顶层段落、表格和图片支持真实鼠标拖拽及键盘排序。
- 原型展示单活编辑权、草稿状态、不可变版本、质量阻断和 Office 复用边界；全部为内置演示数据，不连接真实草稿、媒体、Office API 或业务数据库。
- 验证已通过：目标组件测试、TypeScript 类型检查、Web 构建；浏览器真实鼠标拖拽后顺序从 `executive-summary,risk-table,...` 变为 `risk-table,executive-summary,...`，新会话控制台 0 error / 0 warning。
- 产品评审截图：`juxin-ai-assistant/output/playwright/ai-assistant-4-editor-demo.png`。
- Demo 只冻结交互方向；方向确认后再做正式 `BlockEditorAdapter`、Tiptap/ProseMirror 技术验证、Draft/EditLease API、Office 往返和性能/恢复测试。

## 独立原型纠偏与完成记录

- 用户明确要求“完全脱离原有系统”后，嵌入桌面端的 Demo 已降级为历史实现记录，不再作为产品评审入口。
- 当前唯一评审入口为 `juxin-ai-assistant/prototypes/ai-assistant-4.0/`，访问地址为 `http://localhost:18140/`。
- 独立原型采用原生 HTML、CSS、JavaScript 和内置数据，零运行时依赖，不使用原系统 `App`、路由、导航、API Client、登录态、服务探测或数据库。
- 已完成段落/表格/图片编辑和拖拽、键盘换序、大纲同步、新增删除、撤销重做、自动保存、版本快照、证据/质量/评论/版本边栏、编辑权和 Office 边界提示。
- 模型测试 4/4 与语法检查通过；浏览器控制台 0 error / 0 warning；网络仅有 4 个本地静态资源请求；980px 窄屏无横向溢出。
- 已停止原系统 `18093` 服务，并确认独立服务 `18140` 仍返回 HTTP 200；这证明最终原型不依赖原服务。
- 真实鼠标拖拽、标题与大纲同步、自动保存、`V4` 版本创建、质量阻断和提交审核提示均已通过浏览器验收。
- 最终截图：`juxin-ai-assistant/output/playwright/ai-assistant-4-standalone-demo.png`。
- 下一阶段仍以 P0/P1A 为生产边界：先冻结 V2/Draft/EditLease/Office 契约和恢复语义，再接真实后端；不得把当前本地原型状态直接扩展成生产数据模型。
