# 6.0 / 7.0 运维手册（灰度与 GA）

## 0. 本地离线门禁（开发机 / CI）

```bash
cd server
python scripts/run_ga_gate_local.py
# 期望 overall=pass（离线评测 / checkpoint / 多实例模拟 / 连接器 / 安全）
```

启动 HTTP 服务前，必须先确认迁移图只有一个可解析的 head，再把目标数据库迁移到该 head；新库未迁移时服务进程可能启动，但工作流、GA 报告等路径会返回 500：

```bash
cd server
python3 -m alembic heads
DATABASE_URL="$DATABASE_URL" python3 -m alembic upgrade head
```

`alembic heads` 必须只输出一个 revision；输出多个 head、无法解析迁移图或 `upgrade head` 失败时，均不得启动新版本服务，也不得通过指定任意一个 head 绕过门禁。历史上出现过的双 head 示例 `0045_agent_langgraph_checkpoints` 与 `0051_professional_delivery` 已完成收敛；当前工作树已验证为单一 head `0065_chat_generated_files`（共 66 个 revision）。目标 staging/生产数据库仍必须由数据库负责人提供 `alembic current/heads/history`、备份和回滚窗口证据，未完成前保持 fail-closed，不执行正式迁移。

## 1. 发布前一键检查

管理员登录后打开 **治理中心 → 运营看板**（含「运行离线评测」「Checkpoint 恢复套件」按钮），或调用：

```bash
# 就绪探针（DB / 离线评测 / GA 代理 / Hub / 安全审计摘要）
curl -s -H "X-Test-User-ID: admin" -H "X-Test-Role: admin" \
  http://127.0.0.1:18093/api/ai/ops/readiness | jq .

# 安全与特权专项
curl -s -H "X-Test-User-ID: admin" -H "X-Test-Role: admin" \
  http://127.0.0.1:18093/api/ai/ops/security-audit | jq .

# GA 九项门禁
curl -s -H "X-Test-User-ID: admin" -H "X-Test-Role: admin" \
  http://127.0.0.1:18093/api/ai/ops/ga-report | jq .

# Agent Hub 健康 / 熔断
curl -s -H "X-Test-User-ID: admin" -H "X-Test-Role: admin" \
  http://127.0.0.1:18093/api/ai/agent-hub/health | jq .
```

| `readiness.overall` | 动作 |
|---|---|
| `ready` | 可进入灰度阶梯 |
| `ready_with_warnings` | 小流量（≤5%），先处理 warn |
| `not_ready` | 修复 fail 后再灰度 |

## 2. 灰度阶梯

运营看板快捷：`5% → 20% → 50% → 100%`，对应 `PUT /api/ai/ops/feature-flags` 的 `rollout_percent`。这只是日常操作入口，**不构成最终发布证据**。

最终发布必须严格记录并按顺序完成：`internal(0%) → 1%(1%) → 5%(5%) → 20%(20%) → 50%(50%) → 100%(100%)`。每个阶段至少持续 48 小时、状态为 `passed` 且有大于 0 的完成运行数；阶段起止时间必须带时区、不得重叠，完整 canary 窗口至少覆盖连续观测要求（默认 14 天）。缺少内部或 1% 阶段时，即使看板已完成 `5% → 20% → 50% → 100%`，也不能通过稳定发布门禁。

硬规则：

- `learning_auto_publish` **禁止** 为 `true`（API 直接 400）。
- 外部发送高风险内容必须人工确认。
- 出现高危出域 / 越权 / 错发 → 立即 `rollout_percent=0` 或停用对应 Agent。

## 3. 压测与冒烟

```bash
cd server
python scripts/run_ga_smoke.py --base-url http://127.0.0.1:18093 \
  --concurrency 8 --requests 40

# 连续观测快照（追加 JSONL）
python scripts/run_ga_observe.py --base-url http://127.0.0.1:18093 \
  --out ../docs/plans/ga-observe.jsonl
# observe 同时校验响应语义；HTTP 2xx 但 readiness/安全/GA/checkpoint 失败时命令返回非零，
# JSONL 的 probe.semantic_ok=false，不能计入连续通过窗口。
# 每一行必须是 JSON 对象，且 `ts` 必须是带时区的 ISO-8601 时间戳；缺失、无时区或畸形行由 evaluator fail-closed，不能计入窗口。

# 双周窗口评估（≥14 自然日）
python scripts/evaluate_ga_observe.py \
  --in ../docs/plans/ga-observe.jsonl --min-days 14

# checkpoint 恢复专项（API 或本地内存库）
python scripts/run_checkpoint_recovery.py --base-url http://127.0.0.1:18093 --cases 20
python scripts/run_checkpoint_recovery.py --local --cases 20
# 仅终态 succeeded/completed、无安全步骤重复、且 checkpoint 事件齐全才通过
python scripts/run_multi_instance_checkpoint_drill.py --cases 10
```

真实 staging 不使用开发测试头时，先在执行环境设置具备 AI 管理权限的短期 Bearer Token（不要写入 shell 历史、文档或仓库），再传递**环境变量名**：

```bash
export JUXIN_STAGING_GA_TOKEN='通过受保护渠道注入'
export JUXIN_STAGING_RELEASE_ID='release-20260714-001'
python scripts/run_ga_smoke.py --base-url https://staging.example.com \
  --bearer-token-env JUXIN_STAGING_GA_TOKEN
python scripts/run_checkpoint_recovery.py --base-url https://staging.example.com --cases 20 \
  --bearer-token-env JUXIN_STAGING_GA_TOKEN
python scripts/run_ga_observe.py --base-url https://staging.example.com \
  --bearer-token-env JUXIN_STAGING_GA_TOKEN \
  --release-id "$JUXIN_STAGING_RELEASE_ID" \
  --out ../docs/plans/ga-observe-staging.jsonl
```

脚本不会打印 Token；若环境变量不存在会立即失败。真实 API/worker 强杀须在隔离 staging 通过部署平台执行，并记录 run_id、两个 worker 标识、强杀时刻、接管事件和最终成功状态；HTTP checkpoint suite 不能替代该证据。

### 3.2 staging 证据包门禁

在宣布稳定前，必须把启动前检查、真实双 Worker 强杀报告、连续观测和发布证据汇总为一个机器可读结果。四个文件都应由受控执行环境生成；不要把 Token 写进任何文件：

```bash
python scripts/run_staging_preflight.py --mode staging \
  --base-url https://staging.example.com \
  --bearer-token-env JUXIN_STAGING_GA_TOKEN \
  --release-id "$JUXIN_STAGING_RELEASE_ID" \
  --json > preflight-staging.json

# 这里的 recovery-staging.json 必须来自真实 staging 部署平台的双 Worker 演练，
# 不能直接使用 local_process_boundary_rehearsal 输出。
python scripts/evaluate_staging_evidence.py \
  --preflight preflight-staging.json \
  --recovery recovery-staging.json \
  --observe ../docs/plans/ga-observe-staging.jsonl \
  --release release-staging.json \
  --json
```

`release-staging.json` 只允许根据真实执行结果生成，下面是字段契约示例，不是可直接用于放行的证明：

```json
{
  "schema_version": "1.4",
  "environment": "staging",
  "release_id": "release-20260714-001",
  "base_url": "https://staging.example.com",
  "generated_at": "2026-07-15T12:00:00Z",
    "migration": {
    "record_id": "migration-20260714-001",
    "from_revision": "previous_revision",
    "to_revision": "current_revision",
    "applied_at": "2026-06-30T08:00:00Z",
    "status": "succeeded",
    "single_head_verified": true,
      "expand_contract": true
    },
  "tests": {
    "report_id": "tests-20260714-001",
    "completed_at": "2026-06-30T09:00:00Z",
    "release_id": "release-20260714-001",
    "base_url": "https://staging.example.com",
    "status": "passed",
    "passed": 207,
    "failed": 0,
    "skipped": 9,
    "harness_release_gate": true
  },
  "core_task_evaluation": {
    "schema_version": "1.1",
    "environment": "staging",
    "source": "staging_runtime_execution",
    "synthetic": false,
    "status": "passed",
    "report_id": "core-eval-20260714-001",
    "completed_at": "2026-06-30T10:00:00Z",
    "release_id": "release-20260714-001",
    "base_url": "https://staging.example.com",
    "task_set_id": "juxin-core-tasks-v1",
    "task_set_sha256": "由 core_task_catalog.json 规范化计算的 64 位 SHA-256",
    "trial_count": 3,
    "baseline_runtime": "native",
    "candidate_runtime": "langgraph",
    "baseline_success_rate": 0.98,
    "candidate_success_rate": 0.99,
    "cases": [
      {
        "task_id": "knowledge-01",
        "category": "knowledge_qa",
        "trial": 1,
        "executed_at": "2026-06-30T09:30:00Z",
        "evidence_ref": "trace://staging/native-and-candidate-run-pair",
        "baseline": {
          "run_id": "native-knowledge-01-t1",
          "passed": true,
          "cost_units": 1.0,
          "step_count": 2,
          "latency_ms": 100.0,
          "human_interventions": 0,
          "duplicate_actions": 0,
          "isolation_id": "native-isolation-knowledge-01-t1"
        },
        "candidate": {
          "run_id": "langgraph-knowledge-01-t1",
          "passed": true,
          "cost_units": 1.1,
          "step_count": 2,
          "latency_ms": 105.0,
          "human_interventions": 0,
          "duplicate_actions": 0,
          "isolation_id": "langgraph-isolation-knowledge-01-t1"
        }
      }
    ],
    "classification_review": {
      "source": "independent_human_review",
      "reviewed_by": "reviewer-001",
      "reviewed_at": "2026-06-30T09:45:00Z",
      "labels": [
        {
          "task_id": "knowledge-01",
          "trial": 1,
          "runtime": "native",
          "expected_passed": false
        }
      ]
    }
  },
  "canary": {
    "report_id": "canary-20260714-001",
    "started_at": "2026-07-01T00:00:00Z",
    "completed_at": "2026-07-15T00:00:00Z",
    "status": "passed",
    "rollout_stages": [
      {
        "stage": "internal",
        "rollout_percent": 0,
        "started_at": "2026-07-01T00:00:00Z",
        "completed_at": "2026-07-03T00:00:00Z",
        "finished_runs": 50,
        "status": "passed"
      },
      {
        "stage": "1_percent",
        "rollout_percent": 1,
        "started_at": "2026-07-03T00:00:00Z",
        "completed_at": "2026-07-05T00:00:00Z",
        "finished_runs": 100,
        "status": "passed"
      },
      {
        "stage": "5_percent",
        "rollout_percent": 5,
        "started_at": "2026-07-05T00:00:00Z",
        "completed_at": "2026-07-07T00:00:00Z",
        "finished_runs": 500,
        "status": "passed"
      },
      {
        "stage": "20_percent",
        "rollout_percent": 20,
        "started_at": "2026-07-07T00:00:00Z",
        "completed_at": "2026-07-09T00:00:00Z",
        "finished_runs": 2000,
        "status": "passed"
      },
      {
        "stage": "50_percent",
        "rollout_percent": 50,
        "started_at": "2026-07-09T00:00:00Z",
        "completed_at": "2026-07-11T00:00:00Z",
        "finished_runs": 5000,
        "status": "passed"
      },
      {
        "stage": "100_percent",
        "rollout_percent": 100,
        "started_at": "2026-07-11T00:00:00Z",
        "completed_at": "2026-07-15T00:00:00Z",
        "finished_runs": 10000,
        "status": "passed"
      }
    ],
    "baseline_success_rate": 0.98,
    "candidate_success_rate": 0.99,
    "p0_incidents": 0,
    "p1_incidents": 0,
    "duplicate_side_effects": 0,
    "dual_owner_incidents": 0
  },
  "rollback_drill": {
    "drill_id": "rollback-20260714-001",
    "executed_at": "2026-07-15T00:10:00Z",
    "status": "succeeded",
    "duration_seconds": 420,
    "feature_flag_restored": true,
    "target_runtime": "native",
    "new_schema_preserved": true
  },
  "production_checkpointer_review": {
    "review_id": "checkpointer-20260714-001",
    "reviewed_at": "2026-07-15T00:20:00Z",
    "reviewer": "release-owner",
    "backend": "postgresql",
    "status": "approved",
    "durable": true,
    "multi_instance_supported": true,
    "fencing_supported": true,
    "restore_test_report_id": "restore-20260714-001"
  }
}
```

发布证据当前外层契约为 `schema_version=1.4`：除合法 `release_id` 外，还必须记录规范化的 HTTPS `base_url`；`tests.release_id/base_url` 必须与外层发布证据逐字对应，`migration.to_revision` 必须与 preflight 通过检查中的唯一迁移 head 对应。迁移成功且为单 head、采用 expand/contract；Harness 测试有通过记录且失败数为 0。`core_task_evaluation` 内层契约为 `schema_version=1.1`，必须严格匹配仓库内 `core_task_catalog.json` 的 50 个固定任务和摘要，每个任务至少执行 3 轮，共至少 150 条互不重复的 Native/LangGraph 运行证据；必须来自 `staging_runtime_execution` 且 `synthetic=false`，每条 case 的 `evidence_ref` 必须非空且在整份评测中唯一，禁止用同一 trace 重复冒充多次执行。候选总体成功率和每个任务的成功率均不得低于 Native，防止其他任务的提升掩盖局部退化。校验结果会按任务、类别输出成功率分布，并自动汇总成本、步数、延迟、平均人工介入次数和人工介入 case 比例的基线值、候选值与差值；这些运行指标用于对比和定位，方案未定义的阈值不得临时伪造。所有重复动作计数必须为 0；目录标记为副作用的 30 个任务在每轮的 Native/LangGraph 执行都必须使用全局唯一隔离域，既不能在两个 Runtime 之间共用，也不能跨任务或跨轮次复用。每个 case 必须有 Native 与 LangGraph 各一条独立真值标签，来自 `source=independent_human_review` 的带时区复核记录；标签覆盖全部 300 个运行结果，并重新计算每个 Runtime 的 TP/TN/FP/FN、误拦截率 `FP/(FP+TN)` 与漏拦截率 `FN/(FN+TP)`。缺少复核、复核标签重复/缺失、只有单一真值类别或无法计算任一比率时，核心评测和外层发布均 fail-closed；本轮不擅自增加方案未定义的 FP/FN 放行阈值。示例只展示一条 case，实际工件缺少任一任务/轮次、复用任一 trace、复用任一副作用隔离域或缺失真值复核都会失败。灰度严格完成 `internal → 1% → 5% → 20% → 50% → 100%`。每阶段必须单独记录带时区的起止时间，持续至少 48 小时，`finished_runs` 必须是大于 0 的 JSON 整数，状态必须为 `passed`；阶段不得缺失、乱序或重叠，首尾时间必须与 canary 总时间一致，canary 总窗口还必须至少覆盖连续观测要求（默认 14 天）。候选成功率还必须不低于基线，且 P0/P1、重复副作用和双 owner 均为 0；回滚到 `native` 在 900 秒内完成并保留新 schema；生产 Checkpointer 经过实名审批，具备持久化、多实例、fencing 和恢复测试记录。所有时间必须带时区，并满足迁移完成 ≤ 测试完成 ≤ 核心任务评测完成 ≤ 灰度开始 ≤ 灰度完成 ≤ 回滚/评审 ≤ `generated_at`；每条 `core_task_evaluation.cases[].executed_at` 还必须落在 `[tests.completed_at, core_task_evaluation.completed_at]` 内，早于本次测试批次的旧执行记录会被拒绝。计数和比率必须是 JSON 数值，不能用字符串冒充。旧版外层发布 `schema_version=1.0/1.1/1.2/1.3` 和旧版核心评测工件会被拒绝。

总门禁要求：preflight 全部通过；恢复报告至少 1000 次、恢复率 ≥99.9%，明确记录 Worker A 被强杀、Worker B 接管、旧 fencing token 被拒绝、无双 owner 和无重复副作用；连续观测必须为 HTTPS、连续 14 天且对账积压为 0；发布证据六个部分全部通过。preflight、恢复报告、核心任务评测、每条观测和发布证据必须使用同一个 `release_id` 与同一个 HTTPS `base_url`；preflight 必须早于灰度开始，强杀/接管和每条观测必须落在 canary 窗口内。门禁会拒绝跨发布、跨环境拼接、本地恢复报告、合成核心任务报告和缺失/畸形发布证据，即使各工件单独看似通过，也不能冒充 staging 稳定性。

观测 JSONL 的每一行还必须是对象，携带相同的 `release_id`，且 `ts` 必须为带时区的 ISO-8601 字符串；非对象行、缺失时间戳、无时区时间戳或非法时间戳都会使观测检查失败，不会被静默跳过。

恢复报告当前契约为 `schema_version=1.1`，必须携带同一发布身份、同一 staging 地址和可审计的运行时间线。除 `total/recovered/failed/recovery_rate/cases` 等既有统计字段外，至少包含以下字段（时间必须是带时区的 ISO-8601）：

```json
{
  "schema_version": "1.1",
  "environment": "staging",
  "mode": "staging_dual_runtime_rehearsal",
  "scope": "dual_runtime_process_boundary",
  "release_id": "release-20260714-001",
  "base_url": "https://staging.example.com",
  "run_id": "staging-run-20260714-001",
  "worker_a_id": "worker-a-001",
  "worker_b_id": "worker-b-001",
  "worker_a_sigkill_at": "2026-07-14T10:00:00Z",
  "takeover_event": {
    "type": "lease_takeover",
    "run_id": "staging-run-20260714-001",
    "worker_id": "worker-b-001",
    "at": "2026-07-14T10:00:02Z"
  },
  "final_status": "succeeded"
}
```

`worker_a_id` 与 `worker_b_id` 必须不同；接管事件必须指向同一 `run_id` 和 Worker B，且发生时间不得早于强杀时间。缺字段、无时区、时间线矛盾或最终状态不是 `succeeded` 时，恢复检查直接失败。

### 3.3 按 run_id 的任务控制 SOP

管理员可针对单个任务查看完整 Run/Step/Event 链路，并执行可审计的暂停、恢复和内部 checkpoint 回滚：

```bash
RUN_ID='从任务列表或告警中取得的 run_id'
BASE_URL='http://127.0.0.1:18093'
AUTH=(-H "X-Test-User-ID: admin" -H "X-Test-Role: admin")

curl -s "${AUTH[@]}" "$BASE_URL/api/ai/ops/runs/$RUN_ID" | jq .
curl -s -X POST "${AUTH[@]}" "$BASE_URL/api/ai/ops/runs/$RUN_ID/pause" | jq .
curl -s -X POST "${AUTH[@]}" "$BASE_URL/api/ai/ops/runs/$RUN_ID/resume" | jq .
curl -s -X POST "${AUTH[@]}" "$BASE_URL/api/ai/ops/runs/$RUN_ID/rollback" | jq .
```

- 这些接口仅限管理员；详情接口同时返回该 `run_id` 的 Run/Step/Event 和范围化 reconciliation 结果。
- 暂停是持久化状态门，重复暂停幂等；运行中的旧 worker 在下一个状态边界会被拒绝继续推进。
- 恢复只有从 `paused` 到 `running` 才会启动 runtime；对已运行任务重复恢复只返回当前快照，不重复执行。
- 回滚只恢复内部安全 checkpoint，并明确返回 `side_effects_reversed=false`；它不会撤销已发出的外部副作用。外部结果未知时，必须按本节的工具/直连对账 SOP 处理，禁止重发原幂等请求。
- 每次控制都会写入 `agent_run.ops_pause`、`agent_run.ops_resume` 或 `agent_run.ops_rollback` 审计动作；没有安全 checkpoint 时回滚返回 `409`，不会伪造恢复成功。

### 3.1 直连与工具回执对账 SOP

这一步处理进程、网络或 worker 中断后留下的 `reconciliation_required`。它不是重试流程：**结果未知时禁止重发**，必须先取得外部系统的权威回执，或保留待对账状态等待人工升级。

#### 触发与取证

1. 管理员先调用 `GET /api/ai/ops/snapshot`，记录两个积压计数；再分别调用：
   - `GET /api/ai/ops/tool-invocations/reconciliation?limit=200`
   - `GET /api/ai/ops/direct-actions/reconciliation?limit=200`
2. 对每条记录保存 `uuid`、`run_id`（工具调用）、`user_id`、`tool_name`/`action_name`、`idempotency_key`、`request_hash`（从审计日志或数据库只读查询取得）和时间窗。不要把 Bearer Token、请求正文中的密钥或个人敏感数据复制到工单。
3. 通过对应外部厂商的官方控制台/API 查询业务回执。优先使用 `idempotency_key`；不支持时使用业务对象唯一标识加时间窗。回执至少要能唯一对应操作、包含外部操作/对象标识、发生时间、最终状态和原始 JSON 响应。**不能唯一确认**已生效或未生效时，结论只能是“未知”，不得猜测。

#### 工具调用处置

- 已有唯一的成功回执：调用 `POST /api/ai/ops/tool-invocations/{uuid}/reconcile`，提交 `{"action":"confirm_succeeded","result_payload":{...},"output_summary":{...},"source_count":1}`。`result_payload` 必须是可回放 JSON；`output_summary` 只放安全摘要。
- 有权威的未生效/未产生副作用回执：提交 `{"action":"confirm_not_applied"}`。系统会将状态置为 `failed`，后续重试必须使用新的 `Idempotency-Key`。
- 结果未知：不调用 reconcile、不重发原请求，保持 `reconciliation_required`，附上外部查询证据并升级负责人。

#### 直连动作处置

- 已有唯一的成功回执：调用 `POST /api/ai/ops/direct-actions/{uuid}/reconcile`，提交 `{"action":"confirm_succeeded","response_status":200,"response_payload":{...}}`。`response_status` 必须是原成功 HTTP 状态，`response_payload` 必须符合该动作原始 JSON 响应契约，否则接口应返回 422。
- 有权威的未生效/未产生副作用回执：提交 `{"action":"confirm_not_applied"}`；不要复用原幂等键。
- 结果未知：不调用 reconcile、不重发原请求，保持 `reconciliation_required` 并升级；相同幂等键只能得到“结果未知”保护性响应。

#### 关闭条件（可检测）

1. **对账后再次查询快照**：重新调用两个 reconciliation 列表和 `GET /api/ai/ops/snapshot`。
2. 对已处置记录核对 `status`、`reconciliation_resolution`、`reconciled_by_user_id`、`reconciled_at`；`operator_confirmed_succeeded` 必须能回放原结果。
3. 本次工单的 `reconciliation_required` 数量必须下降；换句话说，reconciliation_required 数量必须下降。发布/GA 观测要求两个积压计数均为 **0**。仍有积压即判定失败，不得以“已通知”代替关闭。

GA 观测会把 Agent 工具和直连动作任一待对账积压视为失败。

GA 报告中的 `checkpoint_recovery_rate` 会在生成时跑轻量恢复套件（SAVEPOINT 回滚，不污染业务数据）。

建议每个工作日跑一次 smoke + observe，连续 **两周** 对照
`docs/plans/2026-07-12-ga-observation-checklist.md`。

## 4. 故障处置

| 现象 | 处置 |
|---|---|
| 某外部 Agent 连续失败 | Hub health 显示 `circuit_open`；路由降级到 `local.*`；检查厂商侧 |
| 出域大量拒绝 | 查 `GET /api/ai/data-egress/audits` 与成本摘要；核对文案是否误标机密 |
| 任务堆积 | 查 runs `running/queued`；检查 worker / channel_jobs 迁移 |
| 学习误发布风险 | 确认 `learning_auto_publish=false`；回滚候选状态 |
| 加密密钥缺失 | 配置 `CONTENT_ENCRYPTION_KEY`（32 字节 urlsafe base64） |

## 5. 回滚

1. `rollout_percent → 0` 或关闭相关 feature flag。
2. Agent 市场 `status=disabled` 或 `DELETE /api/ai/agent-hub/agents/{id}`。
3. 通道：停用飞书/企微 webhook 配置。
4. 数据库：按 alembic 降序回滚（仅在有备份时）。

## 6. 相关文档

- GA 观测清单：`docs/plans/2026-07-12-ga-observation-checklist.md`
- Connector SDK：`docs/connector-sdk.md`
- 实施进度：`docs/plans/2026-07-12-implementation-status.md`
