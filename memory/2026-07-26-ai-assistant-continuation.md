# 聚信 AI 助手体验优化续作检查点

## 当前目标

完成 `juxin-ai-assistant` 的使用体验优化、真实产物验证、全量回归、版本升级、提交和推送。

## 当前分支与基线

- 分支：`codex/ai-assistant-5.0`
- 基线版本：`5.9.0`
- 基线提交：`568aa65f0efdf6b26d79fef95ce9faa0e773b7ac`
- 本轮属于功能优化，自动版本钩子确定的最终版本：`5.11.0`

## 已完成

- 本地发布预检通过。
- Harness 发布门通过：269 passed，9 skipped。
- GA 本地门通过：11 项全部通过，评测 19/20。
- 桌面端相关类型检查通过。
- 定向 Vitest：39/39。
- 全量桌面 E2E：19/19。
- 管理员、经理、审计员导航和权限页面已补齐。
- 既有 E2E 已适配当前首页、聊天、治理和专业交付界面。

## 正在进行

第三阶段：

1. 会话列表增加服务端搜索。
2. 任务中心增加搜索、分页和真实总数。
3. 成果链接保存具体版本，刷新后恢复对应成果和版本。
4. 验证 320、375、768 像素布局无横向滚动、关键操作可见。

## 后续阶段

1. Worker 重启恢复、100 次幂等恢复、状态与完成通知时延。
2. 真实 Dashi PPTX、HTML ZIP、Word、PDF 产物生成和打开验证。
3. 全量后端、前端、E2E、发布门回归。
4. 更新计划和发布记录，升级到最终版本，提交并推送。

## 工作区保护

以下未跟踪内容与本任务无关，不修改、不提交：

- `juxin-ai-assistant/docs/plans/2026-07-26-softcopyright-materials.md`
- `juxin-ai-assistant/docs/softcopyright/`
- `juxin-ai-assistant/scripts/build_softcopyright_docs.py`
- `sca-platform/docs/`
- `sca-platform/frontend/dist/`
- `sca-platform/scripts/__pycache__/`
- `sca-platform/scripts/build_softcopyright_docs.py`
- `sca-platform/scripts/build_softcopyright_pdfs.py`
## 2026-07-26 继续进度（稳定性阶段）

- 当前计划第 1～3 阶段已完成：验收矩阵、Harness/GA/local preflight、聊天与任务搜索分页、深链接恢复、320/375/768 响应式验收。
- 最近验证结果：
  - 前端 `npm run typecheck` 通过。
  - Chat/Tasks/Professional Delivery 定向测试 70/70 通过。
  - 后端聊天、任务、运行服务测试 60/60 通过。
  - 320/375/768 窄屏 Playwright 验收 1/1 通过。
- 当前正在完成第 4 阶段：
  - `checkpoint_recovery.py` 已支持最多 100 个恢复案例，但现有测试只跑 8 个，需要提升为 100 并明确断言失败数/重复副作用为 0。
  - `workflow_control.py` 的通知 outbox 已具备唯一键、租约、fencing、重试和 reconciliation；长任务完成/失败目前没有接入这个持久通知闭环。
  - `ChatPage` 每 1.5 秒刷新运行中长任务，状态时效已满足 3 秒目标；当前产品文案承诺“完成后通知”，但还缺少可读取、可确认的一次性完成通知。
- 下一步：
  1. 复用 WorkflowNotificationOutbox，为长任务终态建立幂等通知；
  2. 增加用户自己的未读通知查询/已读接口；
  3. Chat 页面每 2.5～3 秒读取并显示一次性完成提醒，不新增重复进度框；
  4. 将恢复演练提升到 100 次并运行前后端定向测试；
  5. 继续真实验证 Dashi PPTX、HTML ZIP、Word、PDF 产物。

## 2026-07-26 继续进度（通知与恢复完成）

- 长任务终态通知已经完成：
  - 后端增加用户范围内的未读通知查询、已读确认接口；
  - 完成/失败通知使用任务终态唯一键，重复执行不会产生重复提醒；
  - 重试旧任务时旧通知自动标记已读；
  - 前端每 3 秒读取持久通知，刷新或重新进入后仍可恢复，点击或关闭后确认已读；
  - 没有新增第二个任务进度框。
- 定向验证：
  - 后端长任务测试 8/8 通过；
  - 前端通知测试 2/2 通过；
  - 前端类型检查通过。
- 恢复与幂等验收：
  - `run_checkpoint_recovery.py --local --cases 100`：100/100 恢复，失败 0；
  - 直接动作 reconciliation 演练：5/5 通过，包括成功重放单副作用、幂等键冲突拒绝、未知结果阻止重试、过期执行进入对账、失败后必须新键；
  - 修复本地 reconciliation 演练缺少安全默认配置的问题，并增加无外部环境变量的 CLI 回归测试，3/3 通过。
- 当前进入真实产物阶段：
  1. 使用 `.local/dashi-ppt-upstream/skills/dashi-ppt/project` 真实生成 PPTX 与 HTML ZIP；
  2. 解压检查 `index.html`、`assets/imported-theme-runtime.js`、字体和主题资源；
  3. 执行 `validate:goal-copy`、`validate:swiss` 并离线打开全部页面；
  4. 验证 Word/PDF 实际文件；
  5. 全量回归后升级最终版本，提交、打标签并推送。

## 2026-07-26 继续进度（真实成果验收完成）

- 新增真实验收脚本：
  - `server/scripts/run_dashi_ppt_acceptance.py`：通过现有业务代码生成 5 页 Dashi 演示，并真实产出 HTML 工程包、PPTX、PDF 和 Word 验收报告；
  - `server/scripts/verify_dashi_html_offline.mjs`：用 Dashi 运行时自带的 Playwright/Chrome 离线逐页访问 ZIP 内的 `index.html`，检查每页完成挂载、正文非空、无“渲染失败”提示、无页面或控制台错误，并截图最后一页。
- 真实验收已经通过：
  - `presentation-html.zip`：5,962,338 字节，207 个文件，其中 186 个字体文件；
  - `presentation.pptx`：3,997,290 字节，5 页；
  - `presentation.pdf`：3,552,789 字节，5 页；
  - `acceptance-report.docx`：40,093 字节，50 个段落；
  - Dashi 官方 `validate:goal-copy` 和 `validate:swiss` 均通过；
  - 离线浏览器逐页验收 5/5 通过，最后一页正常激活，无空白页、渲染失败、页面错误或控制台错误。
- 验收产物位于 `/private/tmp/juxin-dashi-acceptance/`，结构化报告为 `acceptance-report.json`，最后一页截图为 `offline-last-slide.png`。
- 验收过程中修正了两项检查逻辑：
  - 页面选择器限定为 `#deck > section.slide[data-vm-slide-id]`，避免把主题内部嵌套 `section` 错算为演示页；
  - Dashi 对非当前页采用延迟挂载，因此验证器会依次切换到每一页，在页面激活时记录渲染结果，不再只检查最终 DOM。
- 下一步：
  1. 为验收脚本补安全解压、PPTX 页数等自动测试；
  2. 在运行时安装文档中固化真实验收命令和验收标准；
  3. 跑后端、前端、E2E、Harness、GA 和发布预检全量回归；
  4. 更新计划与发布记录，升级最终版本，只提交本任务文件并推送分支和标签。

## 2026-07-26 继续进度（5.11.0 候选完成）

- 真实验收脚本已增加安全 ZIP 解压、PPTX OpenXML/页数和伪造文件拒绝测试。
- Dashi 运行时文档已固化宿主机与 Docker 真实验收命令。
- 全量验证完成：
  - 后端：1306 passed，10 skipped；
  - 前端：348 passed；
  - 桌面 E2E：20 passed；
  - Harness：271 passed，9 skipped；
  - GA 本地总门禁：11/11；
  - 本地发布预检：pass；
  - 版本同步脚本：6/6；
  - 前端生产构建：pass。
- GA 细项：
  - 离线评测 19/20，通过率 95%，引用准确率 100%；
  - Checkpoint 100/100 恢复，重复副作用 0；
  - Runtime shadow 150 条契约差异 0；
  - Agent chaos 7/7，直连副作用对账 5/5。
- 修复原有版本契约遗漏：`src-tauri/Cargo.lock` 的主包版本曾停留在 5.8.0，先补齐到 5.9.0；提交后的自动版本钩子最终将本次功能优化统一为 5.11.0，并同步运行时版本目标。
- 已新增 `docs/releases/5.11.0.md`，明确这是本地候选版本，尚未替代预发布和生产连续观测。
- 功能提交已由版本钩子推送；剩余操作：提交版本记录修正、打 `ai-assistant-v5.11.0` 标签并核对远端。
