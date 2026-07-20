# 2026-07-18 RAG P0 检索评测

## 已完成

- 规划并实现独立的 Recall@K、MRR、nDCG@K 评测模块。
- 增加 6 个检索质量人工标注 case，gold 只使用 chunk_id。
- 增加排名 JSON 命令行入口和缺失排名显式标记。
- 增加显式数据库/用户/密钥参数的生产排名导出命令；输出只保留去重 chunk_id，默认禁用外部索引和网络访问。
- 增加 Recall/MRR/nDCG 阈值门禁；指定 `--threshold metric=value` 后，缺排名或低于阈值返回非零退出码。
- 将现有 HybridRetriever 三路融合改为 RRF 主排序，原始分数只作为有界 tie-breaker。
- 在 `deep_retrieve` 增加检索后评分、保留原始问题的确定性查询改写和最多一次重试；评分、重试原因与 query variants 写入 retrieval metadata。
- 为 `NativeLangGraphAdapter.verify` 增加最终交付校验：复用 `check_delivery_quality` 与 `OutcomeEvaluator`，重新检查答案长度、引用、证据数量和无证据拒答，不再把 `succeeded` 状态或非空答案直接视为可交付。
- 新增 `tests/test_native_langgraph_adapter.py`，覆盖有据回答通过、短答案拒绝、无证据拒答通过。

## 未完成

- 尚未在获得明确授权的本地/staging 数据库上运行真实排名导出，因此还没有可发布的真实 Recall/MRR/nDCG 基线。

## 验证

- `tests/test_retrieval_eval.py`：6 passed。
- 更新后 `tests/test_retrieval_eval.py`：9 passed。
- `tests/test_eval_questions.py tests/test_retrieval_eval.py`：7 passed。
- `tests/test_retrieval_fusion.py`：4 passed。
- `tests/test_knowledge_search.py`：17 passed。
- `tests/test_deep_retrieve.py tests/test_native_runtime_knowledge.py tests/test_retrieval_eval.py tests/test_retrieval_fusion.py tests/test_knowledge_search.py`：38 passed。
- 更新后相关检索套件（`test_retrieval_eval.py test_retrieval_fusion.py test_knowledge_search.py test_deep_retrieve.py test_native_runtime_knowledge.py`）：41 passed。
- 最新相关套件（增加 `test_native_langgraph_adapter.py`、`test_multi_agent_and_artifacts.py`）：52 passed。
- Native/真实 LangGraph 适配器聚焦回归：3 passed，1 skipped（可选 LangGraph 依赖测试）。
- `tests/test_phase3_phase4_extensions.py tests/test_deep_retrieve.py tests/test_runtime_shadow.py`：35 passed，8 skipped。
- `tests/test_native_runtime_knowledge.py tests/test_multi_agent_and_artifacts.py tests/test_agent_runtime.py`：50 passed，1 failed；失败是工作区已有的 task_mode_detect payload 断言与其他未提交改动不一致，未触及本次 RAG 文件。
- Python compileall 与 `git diff --check`：通过。
- `git diff --check`：通过。
- 完整后端回归：1247 passed，4 failed，10 skipped；失败为既有 task-mode、enterprise query plan、web source/cache 断言，非本次 RAG 文件。
- harness release gate：265 passed，1 failed，9 skipped；失败同为既有 task-mode payload 断言。
- GA local gate：10 个子门禁通过，唯一失败为上述 harness 回归；staging preflight local 模式通过且未连接 staging。

## 2026-07-18 整体收口

- 修复 task mode 工具契约、运营态 overdue 统计、测试 fetcher 的 DNS 预检边界和知识库同源下载回归。
- 后端全量：1257 passed，10 skipped。
- 桌面端全量：41 个测试文件、325 passed；typecheck 通过。
- harness release gate：266 passed，9 skipped。
- GA local gate：11/11 子门禁通过，overall=pass；离线评测 19/20（0.95），引用准确率和无证据拒答率均为 1.0，恢复率 1.0。
- staging preflight local：overall=pass，未连接 staging。
- `git diff --check`：通过。
- 真实检索排名评测、版本升级、commit/push 仍需显式授权；当前版本 5.3.0 未变更。

## 2026-07-18 课程对齐门禁

- 新增只读 `server/scripts/run_course_alignment_gate.py`，检查课程对齐文档、Week 1–7、关键实现路径、离线评测 case 和真实环境边界。
- 新增 `server/tests/test_course_alignment_gate.py`，覆盖完整 fixture、缺路径和缺文档/周次失败场景。
- 门禁不连接数据库、模型、Redis 或网络；`python3 scripts/run_course_alignment_gate.py --json` 本地通过。

## 2026-07-19 发布前复核

- `python3 scripts/run_staging_preflight.py --mode local --json`：overall=pass；迁移图当前唯一 head 为 `0065_chat_generated_files`，共 66 个 revision。
- 版本设计文档已与实现同步：`npm run test:versioning` 为 56 passed；本轮没有执行版本升级、commit 或 push。
- 本地整改闭环，但真实 staging/生产检索排名、连续观测和正式 commit/push 仍未执行；原因是没有授权环境与发布授权。

## 2026-07-19 最终本地复核

- 后端全量复跑：1257 passed，10 skipped。
- harness release gate：266 passed，9 skipped；GA local gate：11/11 通过。
- 桌面端：typecheck 通过，41 个测试文件、325 passed。
- 课程对齐门禁：23/23 checks passed；`git diff --check` 通过。
- 版本自动化：56 passed；当前各声明版本仍为 5.3.0，未执行版本升级、commit 或 push。

## 2026-07-19 本地数据源与发布边界复核

- 本地 Docker 仅有 MySQL、Redis、Qdrant 运行，没有 `ai-assistant-api` 容器；未启动、重启或改动任何服务。
- 本地 MySQL 的 `juxin_ai_assistant` 有 1 个知识库、7 个文件和 3,623 个知识块，但容器与工作区均未提供 `AI_CONTENT_ENCRYPTION_KEY`；无法安全解密正文，故未生成真实排名工件。
- 应用仍为 5.3.0；工作树保留现有未提交改动，未执行版本升级、commit 或 push。
- 结论：本地整改与验收门禁完成；真实检索指标、staging 连续观测、目标库迁移/备份/回滚和正式发布仍属于外部证据，不得以本地数据替代。

## 2026-07-19 补充构建与迁移复核

- 微信 H5：typecheck 通过，1 个测试文件 / 1 个测试通过，生产构建通过。
- 桌面端 Web 构建：`npm run build:web` 通过；仅有 Vite bundle size warning，无构建失败。
- `run_staging_preflight.py --mode local --json`：overall=pass；只做本地配置/迁移图检查，未连接 staging。
- `run_migration_candidate_rehearsal.py --json`：current、candidate_a、candidate_b 均升级/降级 round-trip 通过，`repository_unchanged=true`，`staging_or_network_used=false`。
- `run_workflow_release_gate.py --json`：expand、migrate、switch、contract、fresh round-trip 全部通过，`repository_unchanged=true`，`staging_or_network_used=false`。
- `run_staging_recovery_rehearsal.py --json`：本地 3/3 进程边界场景恢复，SIGKILL 后 fencing 接管和旧 Worker 拒绝均通过；这不是 staging 证据。
- `git diff --check`：通过；构建未产生未跟踪产物。

## 2026-07-19 管理审计后全量回归

- 后端全量回归（`tests --ignore=tests/test_migrations.py`）：`1259 passed, 10 skipped`（退出码 0）。新增管理路由静态审计已纳入全量测试。
- `git diff --check`：通过；未执行版本升级、commit 或 push。

## 2026-07-19 当前工作树全量门禁复跑

- 课程对齐门禁：23/23 checks passed。
- 检索、课程对齐与 Agent 定向回归：53 passed；课程对齐门禁 23/23 checks passed。
- 后端全量回归：1257 passed，10 skipped（196.77s）。
- 桌面端全量回归：41 个测试文件、325 passed；typecheck 通过；Web 构建通过，仅有 bundle size warning。
- 微信 H5：typecheck、1 个测试文件 / 1 个测试通过、生产构建通过。
- GA local：11/11 子门禁通过；离线评测 19/20（0.95）；恢复与租约接管演练通过。
- 迁移候选回放：current、candidate_a、candidate_b 均 upgrade/downgrade round-trip 通过，仓库未改变。
- 版本工具：根仓库 56 passed，AI 助手版本仍为 5.3.0；未执行真实 commit/push。
- 仍缺真实 staging/生产的 HTTPS/授权、加密知识库排名指标、连续观测、双 Worker 强杀恢复、目标库备份/迁移/回滚证据；这些不能由本地门禁替代。

## 2026-07-19 迁移后真实 HTTP smoke

- 从全新临时 SQLite 执行 Alembic `upgrade head` 后，以本地 loopback 启动 FastAPI；设置一次性 `CONTENT_ENCRYPTION_KEY`、`AI_LOCAL_BINDING_SECRET` 与开发 bypass，未写入仓库或配置文件。
- `scripts/run_ga_smoke.py --base-url http://127.0.0.1:18094 --concurrency 4 --requests 20`：13/13 端点通过，轻量并发 20/20 无错误；服务随后已停止。
- 第一次 smoke 仅设置了错误的加密密钥环境变量名，checkpoint suite 返回 500；日志明确为缺少 32 字节内容密钥。改用项目实际读取的 `CONTENT_ENCRYPTION_KEY`（URL-safe base64 编码的 32 字节测试值）后全量通过。该诊断不改变业务代码，也不代表生产密钥已配置。
- 结论：本地“迁移后启动 + HTTP 路由 + checkpoint + 轻量并发”闭环已完成；外部 staging/生产证据、正式版本升级与 commit/push 仍未执行。

## 2026-07-19 管理路由权限审计收尾

- 统一平台管理员角色别名判断：`admin`、`superadmin`、`sys_admin`、`platform_admin` 均由 `is_platform_admin_role` 处理；`server/app` 已无精确 `role.strip().lower() ==/!= "admin"` 比较。
- 逐一核对 `server/app/admin/*_routes.py` 与运营、学习、知识库、技能、专业交付目录、Agent Hub、渠道任务等敏感路由，管理处理器均有 `require_action("ai_assistant:admin")` 或受其保护的 helper。
- 新增静态审计测试 `tests/test_admin_route_auth_audit.py`；静态审计与认证回归 `16 passed`，权限相关路由回归 `92 passed`；AST 门禁覆盖所有直接 `role ==/!= "admin"` 形式。
- 本地可闭环的鉴权审计已完成；真实 staging/production 授权、目标库迁移/备份/回滚、密钥、连续观测、灰度以及版本升级/commit/push 仍未执行。
