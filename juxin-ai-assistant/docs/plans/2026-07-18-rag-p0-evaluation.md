# RAG P0 检索评测基线

## 目标

为现有混合检索链路建立可重复、与生成模型解耦的检索质量基线，支持后续比较 RRF、查询改写和文档评分改造前后的 Recall@K、MRR、nDCG@K。

## 范围

- 新增人工标注的检索评测 case，gold 数据只保存 chunk_id，不保存答案正文或用户数据。
- 新增纯 Python 指标实现和聚合报告。
- 新增命令行入口，接收生产检索器导出的排名 JSON。
- 本轮保持权限过滤、缓存和 Agent 图边界不变；在已有 `deep_retrieve` 内增加确定性的检索后评分、查询改写和最多一次重试。

## P1 第二项设计

- 首次检索仍使用原始查询，保留原有 hybrid/lexical 路径。
- 对结果计算轻量、可解释的覆盖率和证据长度评分，不把评分当作权限判断。
- 仅在无结果、覆盖不足、证据过短或多意图覆盖不足时触发一次重试。
- 重试查询由原问题、产品别名和既有同义词组成，不能丢弃原始关键词；不调用外部模型。
- 将评分、改写查询和重试原因暴露到已有 retrieval metadata，方便 run quality 观测。

## 验证命令

```bash
cd /Users/zhanglei/Documents/codex-new/juxin-ai-assistant/server
python3 -m pytest -q tests/test_retrieval_eval.py
python3 -m pytest -q tests/test_eval_questions.py tests/test_retrieval_eval.py
git diff --check
```

## 结果

- `python3 -m pytest -q tests/test_retrieval_eval.py`：6 passed。
- 更新后 `python3 -m pytest -q tests/test_retrieval_eval.py`：9 passed，覆盖阈值门禁、排名脱敏导出和生产检索适配器。
- `python3 -m pytest -q tests/test_eval_questions.py tests/test_retrieval_eval.py`：7 passed。
- `python3 -m pytest -q tests/test_retrieval_fusion.py`：4 passed。
- `python3 -m pytest -q tests/test_knowledge_search.py`：17 passed。
- `python3 -m pytest -q tests/test_deep_retrieve.py tests/test_native_runtime_knowledge.py tests/test_retrieval_eval.py tests/test_retrieval_fusion.py tests/test_knowledge_search.py`：38 passed。
- `python3 -m pytest -q tests/test_phase3_phase4_extensions.py tests/test_deep_retrieve.py tests/test_runtime_shadow.py`：35 passed，8 skipped。
- `python3 -m pytest -q tests/test_native_runtime_knowledge.py tests/test_multi_agent_and_artifacts.py tests/test_agent_runtime.py`：50 passed，1 failed；失败项是工作区既有的 `task_mode_detect` payload 断言与其他未提交改动不一致，未触及本次 RAG 文件。
- 完整后端回归 `python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra`：1247 passed，4 failed，10 skipped；4 个失败均为工作区既有的 task-mode、enterprise query plan 和 web source/cache 断言，未触及本次 RAG 文件。
- `python3 scripts/run_harness_release_gate.py`：265 passed，1 failed，9 skipped；失败同为既有 `task_mode_detect` payload 断言。
- `python3 scripts/run_ga_gate_local.py --json`：offline eval、checkpoint、混沌演练等 10 项通过；唯一失败为上述既有 harness 回归。
- `python3 scripts/run_staging_preflight.py --mode local --json`：pass；未连接 staging。
- `python3 -m compileall -q ...`（本次新增/修改 Python 文件）：通过。
- `git diff --check`：通过。

同时完成 P1 第一项：`HybridRetriever` 现在按向量、BM25、关键词三路排名计算 RRF；原始分数只作为有界的次级排序依据。这样避免不同量纲的分数直接相加，并保留稳定的文件覆盖排序规则。

## 下一步

已增加只输出 chunk_id 的生产检索排名导出命令；命令必须显式传入 DB 地址、评测用户和内容加密密钥环境变量，默认使用显式禁用的外部索引，不会隐式连接 Qdrant/Redis。

已将 Recall/MRR/nDCG 阈值检查接入评测命令，缺排名或低于阈值时返回非零退出码，作为后续 CI/发布门禁的可组合基础。

P1 第二项已完成：`deep_retrieve` 增加检索后评分、保留原问题的确定性查询改写、最多一次重试，并将 `query_variants`、`retry_reason`、`retrieval_grade` 写入已有 retrieval metadata。

本轮继续完成 Agent 图边界的交付校验：`NativeLangGraphAdapter.verify` 不再只判断结果是否非空，而是在成功状态投递前重新运行现有确定性质量门和成功契约。校验覆盖答案长度、资料引用、证据数量和无证据拒答；失败结果以安全错误码和有限的质量问题列表返回，不携带正文或用户数据。新增 3 个适配器单元测试，覆盖正常有据回答、短答案拒绝和无证据拒答放行。

本轮验证：

- `python3 -m pytest -q tests/test_native_langgraph_adapter.py tests/test_retrieval_eval.py tests/test_retrieval_fusion.py tests/test_knowledge_search.py tests/test_deep_retrieve.py tests/test_native_runtime_knowledge.py tests/test_multi_agent_and_artifacts.py -ra`：52 passed。
- `python3 -m pytest -q tests/test_native_langgraph_adapter.py tests/test_runtime_shadow.py -k 'native_adapter or langgraph_real'`：3 passed，1 skipped。
- `python3 -m compileall -q app/agent_runtime/native_langgraph_adapter.py tests/test_native_langgraph_adapter.py`：通过。
- `git diff --check`：通过。

真实评测运行前仍需确认评测用户、知识库范围与人工标注 chunk ID；不得把正文、答案、文件名或用户标识写入评测产物。实际生产/共享数据库运行需要显式授权，本轮只提供安全的执行入口和测试替身。

## 整体收口验证（2026-07-18）

本轮将本地可完成的整改闭环到 Agent 图交付、回归测试和发布前门禁：

- `TaskModeDetectTool` 恢复稳定的五字段工具契约，避免将扩展路由诊断字段泄漏到旧调用方。
- 企业智能查询计划的 `overdue_task_rate` 按当前运营状态计算，避免历史计划截止日导致过期任务被错误排除；历史快照仍由快照服务负责。
- `WebSearchService` 不在注入式测试 fetcher 前做 DNS 预检，真实 `WebFetcher` 仍在请求和重定向链路执行 SSRF/DNS/IP 安全校验。
- 桌面端知识库下载恢复安全的同源 `window.open` 行为，保留同源 URL 校验，兼容现有桌面壳和回归契约。

最终验证结果：

- 后端全量：`1254 passed, 10 skipped`。
- 桌面端全量：`41 files, 325 passed`。
- harness release gate：`266 passed, 9 skipped`。
- GA local gate：`overall=pass`，11 个子门禁全部通过；离线评测通过率 0.95，引用准确率/无证据拒答率均为 1.0，checkpoint 恢复率 1.0。
- staging preflight local：`overall=pass`，未连接 staging。
- `git diff --check`：通过。

剩余发布动作不在本轮自动执行：真实 staging/生产评测、版本号变更、commit 和 push 需要用户/发布流程明确授权；当前版本仍为 `5.3.0`。
