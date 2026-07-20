# Production Agentic RAG Course 对齐验收矩阵

## 目的

本文件把 [jamwithai/production-agentic-rag-course](https://github.com/jamwithai/production-agentic-rag-course) 的七周能力拆成聚信 AI 助手可以验收的工程能力，区分代码已经具备的能力与仍需真实环境数据才能证明的指标。

课程是设计参考，不要求把 OpenSearch、Airflow、Ollama、Gradio、Langfuse 或 Telegram 原样引入现有产品。现有系统优先复用数据库、桌面端、Agent Run 事件流和已有审计/运维面板。

## 对齐结果

| 课程能力 | 现有实现 | 证据/验证 | 状态 |
| --- | --- | --- | --- |
| Week 1：API、持久化与运行基础 | FastAPI、SQLAlchemy、AgentRun/Step/Event、checkpoint 与租约 | `server/app/agent_run_routes.py`；`python3 scripts/run_harness_release_gate.py` | 已实现，本地已验证 |
| Week 2：文档摄取与结构化分块 | PDF/DOCX/XLSX/PPTX/文本解析，章节、页码、sheet 和 chunk 元数据持久化 | `server/app/knowledge_files.py`；知识库文件/解析回归测试 | 已实现，本地已验证 |
| Week 3：关键词/BM25 与相关性基础 | 关键词索引、BM25 候选、过滤器、检索日志 | `server/app/knowledge_keyword_index.py`、`knowledge_search.py`、`KnowledgeSearchLog` | 已实现，本地已验证 |
| Week 4：向量、混合检索与 RRF | 本地/兼容 OpenAI embedding、向量索引、关键词/BM25/向量三路 RRF、文件覆盖约束 | `server/app/retrieval_fusion.py`；`tests/test_retrieval_fusion.py`；`tests/test_knowledge_search.py` | 已实现，本地已验证 |
| Week 5：完整 RAG、引用、拒答与流式 | 检索→生成→质量门；无证据拒答；引用卡片；聊天 NDJSON 和 Agent Run SSE | `server/app/agent_runtime/deep_retrieve.py`、`run_quality.py`、`chat_routes.py`、`agent_run_routes.py` | 已实现，本地已验证 |
| Week 6：缓存与生产观测 | Redis 查询 embedding/向量结果缓存（按知识版本失效）、模型首 token/总耗时日志、审计与 SLO/GA 面板 | `server/app/knowledge_cache.py`、`knowledge_embedding.py`、`ops_slo.py`、`ops_routes.py`；`tests/test_knowledge_cache.py` | 已实现，本地已验证；真实命中率/延迟需环境观测 |
| Week 7：Agentic RAG | 任务模式路由、权限工具门、检索后文档评分、确定性查询改写与一次重试、结果质量/OutcomeEvaluator、透明 loop trace | `server/app/agent_runtime/tools/task_tools.py`、`deep_retrieve.py`、`native_langgraph_adapter.py`、`native_runtime.py`；Native adapter 回归测试 | 已实现，本地已验证 |

## 评测与发布边界

- 检索离线评测已提供人工标注 case、Recall@K/MRR/nDCG、阈值门禁和只输出 `chunk_id` 的生产排名导出：`server/retrieval_eval_cases.json`、`server/scripts/export_retrieval_rankings.py`、`server/scripts/run_retrieval_eval.py`。
- 生产排名导出必须显式提供数据库地址、评测用户和内容加密密钥环境变量；默认禁用外部 Qdrant/Tantivy/Redis，避免本地命令隐式访问共享资源。
- 本地可重复门禁已通过：后端 `1259 passed, 10 skipped`；桌面端 `41 files, 325 passed`；微信 H5 `1 passed`；harness release gate `266 passed, 9 skipped`；GA local gate `11/11`；staging preflight local 通过。
- 仍不能在本地替代的证据：真实评测用户范围与人工标注 chunk ID、staging/生产检索指标、Redis 实际命中率、真实 crash/recovery 演练，以及正式版本发布流程。
- 版本、commit、push 不属于本次本地整改的自动动作；当前版本仍为 `5.3.0`，待发布负责人明确授权后按版本规则执行。

## 本地对齐门禁

对齐文档、Week 1–7 标记、关键实现路径和离线评测 case 由只读脚本统一检查；脚本不连接数据库、模型、Redis 或网络：

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/server
python3 scripts/run_course_alignment_gate.py --json
```

本轮门禁结果：`passed`，全部检查通过。该门禁证明仓库结构与整改计划没有漂移，不替代真实检索排名、缓存命中率、故障恢复或发布授权证据。

## 2026-07-19 本地发布前补充

- 桌面端 `npm run build`、微信 H5 `npm run typecheck` 和 `npm test -- --reporter=dot` 均通过；桌面端仅有 Vite bundle size warning。
- `run_migration_candidate_rehearsal.py --json`：current、candidate_a、candidate_b 均 upgrade/downgrade round-trip 通过，`repository_unchanged=true`，`staging_or_network_used=false`。
- `run_workflow_release_gate.py --json`：expand、migrate、switch、contract、fresh round-trip 全部通过，`repository_unchanged=true`，`staging_or_network_used=false`。
- `run_staging_recovery_rehearsal.py --json`：本地 3/3 进程边界场景恢复，SIGKILL 后 fencing 接管和旧 Worker 拒绝均通过。
- 全新临时 SQLite 从 Alembic head 启动真实 HTTP 服务后，`scripts/run_ga_smoke.py --base-url http://127.0.0.1:18094 --concurrency 4 --requests 20`：13/13 端点通过，轻量并发 20/20 无错误；服务已停止，临时密钥未落盘。首次复测因未设置 `CONTENT_ENCRYPTION_KEY` 暴露配置缺口，补齐一次性 32 字节 URL-safe base64 测试密钥后通过。
- 上述命令只证明本地临时副本和本地配置闭环；仍待真实 staging/生产 HTTPS 授权、目标库备份/迁移/回滚、真实固定任务集连续观测、加密知识库排名与缓存命中率，以及发布负责人授权后执行版本升级、commit、push。

## 2026-07-19 最终本地复核

- 课程对齐门禁：`23/23 checks passed`；管理员权限专项：`82 passed`；版本自动化：`56 passed`。
- 后端非迁移全量：`1259 passed, 10 skipped`；跳过项仍为本地未安装的 Tantivy/LangGraph 可选依赖。
- Harness release gate：`266 passed, 9 skipped`；GA local gate：`11/11`，离线问答 `19/20`、引用准确率 `1.0`、无证据拒答率 `1.0`、恢复/接管与 Runtime shadow `150/150` 均通过。
- 桌面端：类型检查、`41` 个测试文件/`325` 个测试、生产构建均通过；微信 H5 类型检查、测试和构建均通过。构建保留既有 bundle size warning，不影响退出码。
- 结论：课程对应的代码整改、权限收口、离线评测、本地恢复/发布门禁和版本自动化均已落地并可复现；真实 staging/生产授权、目标数据库迁移/备份/回滚、连续观测以及正式版本升级、commit、push 仍需外部授权和证据，不能用本地结果代替。

## 2026-07-19 迁移与发布演练复核

- 正式迁移测试单独执行：`tests/test_migrations.py` 为 `26 passed`；当前 Alembic 图保持唯一 head `0065_chat_generated_files`。
- `AUTH_DEV_BYPASS=true` 并通过进程环境注入一次性本地绑定密钥后，`run_migration_candidate_rehearsal.py --json` 为 `overall=pass`：current、candidate_a、candidate_b 均 upgrade/downgrade 通过，`repository_unchanged=true`，未连接 staging 或网络。
- 同一临时配置下，`run_workflow_release_gate.py --json` 的 expand、migrate、switch、contract、fresh round-trip 全部通过，`repository_unchanged=true`，未连接 staging 或网络。
- `run_staging_recovery_rehearsal.py --json` 为 `3/3 recovered`、`recovery_rate=1.0`；SIGKILL 后 fencing 接管且旧 Worker 被拒绝。
- `AUTH_DEV_BYPASS` 和本地绑定密钥仅用于临时 SQLite/导入配置，不构成 staging/生产授权；真实目标库备份、迁移/回滚、连续观测、灰度及版本发布仍未执行。

## 2026-07-19 可选依赖覆盖复核

- 在 `/tmp/juxin-rag-optional-venv` 隔离环境安装 `tantivy==0.26.0`、`langgraph==1.2.9` 和 `langgraph-checkpoint-sqlite==3.1.0`；没有修改仓库 requirements 或当前解释器环境。
- 关键词索引与 LangGraph checkpoint 定向测试：`4 passed`；Runtime shadow 全量：`25 passed`。
- 注入隔离依赖路径后，后端非迁移全量为 `1270 passed`、`0 skipped`；这覆盖了默认环境中因可选依赖缺失而跳过的测试。
- 覆盖测试暴露并修复了 LangGraph 非法初始状态的 fail-closed 进度丢失：验证节点失败时保留已完成的 `prepare` 步骤，且不会调用 execute/verify 回调。
- 修复仅涉及 `server/app/agent_runtime/langgraph_graph.py`；真实生产 Runtime 仍保持 Native 路径，LangGraph 仍是本地 pilot，未改变生产依赖边界。

## 2026-07-19 Harness/GA 当前复核

- 在同一隔离可选依赖路径下，Harness release gate 为 `275 passed`，退出码为 0。
- GA local gate 为 `11/11`；离线问答 `19/20`，引用准确率 `1.0`，无证据拒答率 `1.0`，checkpoint/跨进程恢复、连接器安全、混沌、直连副作用对账和 Runtime shadow 均通过。
- GA 脚本仍明确提示：只有完成真实生产连续观测 `evaluate_ga_observe`，才能宣布 GA；本轮没有访问 staging/生产。

## 推荐验收顺序

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/server
python3 scripts/export_retrieval_rankings.py \
  --database-url "$EVAL_DATABASE_URL" \
  --sso-user-id "$EVAL_SSO_USER_ID" \
  --content-encryption-key-env CONTENT_ENCRYPTION_KEY \
  --output /tmp/retrieval-rankings.json
python3 scripts/run_retrieval_eval.py \
  --rankings /tmp/retrieval-rankings.json \
  --threshold recall@5=0.80 \
  --threshold mrr=0.80 \
  --threshold ndcg@10=0.80
```

执行前必须由数据/发布负责人确认评测范围与阈值；命令不会打印密钥，也不会把正文或用户标识写入排名文件。
