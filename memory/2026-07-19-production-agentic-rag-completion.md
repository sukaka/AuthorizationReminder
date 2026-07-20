# 2026-07-19 Production Agentic RAG 整体复核记忆

## 目标

继续完成 `jamwithai/production-agentic-rag-course` 对聚信 AI 助手的整体整改，并核对“本地实现完成”和“正式发布完成”是否被混淆。

## 本轮证据

- 课程对齐门禁：23/23 checks passed。
- 管理员路由认证专项：82 passed；四类平台管理员角色别名统一由 helper 判断。
- 后端非迁移全量：1259 passed, 10 skipped；跳过项是本地未安装的 Tantivy/LangGraph 可选依赖。
- Harness release gate：266 passed, 9 skipped。
- GA local gate：11/11；离线问答 19/20，引用准确率 1.0，无证据拒答率 1.0，恢复 15/15 + 5/5，Runtime shadow 150/150 且 mismatch 0。
- 桌面端：typecheck、41 个测试文件/325 个测试、生产构建通过；微信 H5 typecheck/test/build 通过。
- 本地 staging preflight：pass；迁移图唯一 head 为 `0065_chat_generated_files`，66 个 revision；未连接 staging。
- 根仓库版本自动化：56 passed；当前 AI Assistant `VERSION` 仍为 `5.3.0`。
- 正式迁移测试：`26 passed`；迁移候选演练、工作流发布门禁均在临时配置下 `overall=pass`；本地进程恢复演练 `3/3 recovered`、恢复率 `1.0`。
- 可选依赖覆盖：隔离安装 Tantivy/LangGraph 后，关键词索引与 checkpoint 定向测试 `4 passed`、Runtime shadow `25 passed`，后端非迁移全量 `1270 passed, 0 skipped`。
- 覆盖测试暴露并修复 LangGraph 非法初始状态 fail-closed 分支丢失 `prepare` 进度的问题；修复后 execute/verify 回调未被调用。
- 使用同一隔离可选依赖路径复跑 Harness/GA：Harness `275 passed`，GA `11/11`，离线问答 `19/20`、引用准确率/无证据拒答率均为 `1.0`，Runtime shadow `150/150` 且 `0 mismatch`。

## 结论与边界

课程对应的代码整改、权限收口、离线评测、本地恢复演练、发布预检和版本规则自动化已在工作树落地并通过本地可重复门禁。真实 staging/生产的 HTTPS 与授权、目标数据库 current/heads/history、备份/回滚、真实固定任务集连续观测，以及正式版本升级、commit、push 尚未执行；原因是当前没有目标环境、凭据注入和发布负责人授权。不得把 `AUTH_DEV_BYPASS`、临时 SQLite 或 local preflight 当成生产证据。

本轮迁移/发布演练使用的 `AUTH_DEV_BYPASS` 和绑定密钥只存在于进程环境，没有写入仓库、日志或记忆文件。

可选依赖只安装在 `/tmp/juxin-rag-optional-venv`，未修改生产 requirements 或当前解释器环境。

本轮 Harness/GA 复跑仍只在本地执行；GA 输出要求真实 `evaluate_ga_observe` 连续观测后才能宣布 GA。

## 正式发布交接输入契约

要完成外部闭环，发布负责人仍需通过受控环境提供：staging HTTPS 地址、短期 Bearer token（仅环境变量注入）、唯一 `release_id`、目标数据库 `alembic current/heads/history` 与备份/回滚证据、双 Worker 强杀/fencing/副作用对账/双 Runtime shadow 证据、固定任务集连续观测 JSONL，以及明确的版本 bump/commit/push 授权。当前工作树没有这些 staging/生产变量、Docker 服务或目标数据库连接，不能把本地 pass 宣布为正式发布完成。

## 继续复核记录

- 当前分支 `codex/ai-assistant-5.0` 与上游 ahead/behind 均为 `0`；AI Assistant 与桌面端版本仍为 `5.3.0`。
- 根仓库 `npm run test:versioning` 重新通过：`56 passed, 0 failed`；测试使用临时仓库，不改变当前工作树。
- 课程对齐门禁重新通过：`23/23 checks passed`；`git diff --check` 通过。
- 当前环境仅发现本地进程变量，未发现 staging/生产目标变量；Docker 服务状态无法作为可用目标环境证据，且当前进程无目标数据库连接。

## 下次继续

只有在用户提供目标 staging/production URL、通过环境变量注入的授权方式、数据库负责人证据和明确的 release/commit/push 授权后，才能执行外部发布闭环；在此之前保持版本不变，不提交、不推送。
