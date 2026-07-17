# 6.0 / 7.0 GA 观测与灰度清单

> 对照：`2026-07-12-ai-assistant-6.0-7.0-integrated-master-plan-v2.md` §8.1 / Phase 6
> 用途：连续两周观测、灰度放量、回滚判定

## 1. 发布前一键检查

> 本清单中的 API、smoke、连续观测和灰度命令只允许在获得相应环境授权后执行。当前已完成的是本地离线门禁：GA `11/11`，Runtime shadow `150/150`；这不构成 staging/生产发布证据。正式迁移双 head 也必须先解决，不能指定任一 head 绕过门禁。

### 1.1 API（管理员）

```bash
# 就绪探针
curl -s -H 'X-Test-Role: admin' -H 'X-Test-User-ID: dev' \
  "$BASE/api/ai/ops/readiness" | jq .

# GA 门禁
curl -s -H 'X-Test-Role: admin' -H 'X-Test-User-ID: dev' \
  "$BASE/api/ai/ops/ga-report" | jq .overall,.summary

# 离线评测
curl -s -X POST -H 'X-Test-Role: admin' -H 'X-Test-User-ID: dev' \
  "$BASE/api/ai/learning-eval/ga-suite" | jq .ga_rates
```

### 1.2 脚本（需服务已启动）

```bash
cd server
# 冒烟 + 轻载
python scripts/run_ga_smoke.py --base-url http://127.0.0.1:18093 \
  --concurrency 8 --requests 40

# 每日观测快照（JSONL，连续两周）
python scripts/run_ga_observe.py --base-url http://127.0.0.1:18093 \
  --out ../docs/plans/ga-observe.jsonl

# 双周窗口评估（最新窗口必须连续 ≥14 个自然日；报告中的缺失日期必须清零）
python scripts/evaluate_ga_observe.py \
  --in ../docs/plans/ga-observe.jsonl --min-days 14
```

通过标准：

- smoke 全部 HTTP 2xx
- load errors = 0
- readiness.overall 为 `ready` 或 `ready_with_warnings`
- ga-report.summary.failed = 0（允许 unknown）

## 2. 灰度路径（方案 Phase 6）

| 阶段 | rollout_percent | 观察时长 | 放行条件 |
|---|---:|---|---|
| 管理员 | 0–1 | 1 天 | readiness 无 fail；无 P0 |
| 5% | 5 | 2 天 | 任务成功率 ≥ 基线；无越权 |
| 20% | 20 | 3 天 | 满意度代理 ≥ 80%；无数据出域事故 |
| 50% | 50 | 3 天 | 复杂任务完成率稳定 |
| 全量 | 100 | 连续 14 天 | §8.1 门禁连续两周达标 |

开关位置：

- 运营看板 → 灰度 5/20/50/100
- 或 `PUT /api/ai/ops/feature-flags` `{"rollout_percent": 20}`

## 3. 每日观测项

| 项 | 来源 | 告警线 |
|---|---|---|
| Run 成功率 | `/ops/snapshot` | 以每日累计计数的增量计算；每个自然日必须有新增完成 Run，成功率 < 90% 或计数回退即失败 |
| 待对账副作用调用 | `/ops/snapshot` | 必须为 0；缺少关键计数、表不可用或待对账积压时均不得继续放量 |
| 出域拒绝异常飙升 | `/ops/cost-summary` | 突增 3× 且误拦用户反馈 |
| Agent 错误率 | cost-summary by_agent | 单 Agent 成功率 < 80% |
| 学习自动发布 | feature-flags | 必须为 false |
| FAQ 模型调用 | ga-report | FAQ 路径应接近 0 模型调用 |
| 通道任务死信 | channel jobs | dead > 0 需排查 |

## 4. 每周 GA 门禁复核（§8.1）

| 指标 | 门槛 | 工具 |
|---|---:|---|
| 任务消息串线 | 0 | 人工 + 日志 |
| FAQ 模型调用率 | 0% | ga-report |
| 复杂任务完成率 | ≥ 95% | ga-report / snapshot |
| checkpoint 恢复 | ≥ 99% | 专项测试 |
| 引用准确率 | ≥ 95% | offline ga-suite + 人工抽检 |
| 无依据拒答率 | ≥ 98% | offline ga-suite |
| 成果审计覆盖 | 100% | ga-report |
| 高风险越权 | 0 | 审计日志 |
| 用户满意度 | ≥ 85% | 反馈统计 |

## 5. 回滚触发

任一出现立即回滚到上一灰度档位或全关新特性：

1. 高风险越权 / 数据出域到未授权外部
2. 生产 P0 故障（登录不可用、全站 5xx）
3. 学习候选被自动发布到生产
4. 连续 2 小时任务成功率 < 70%

回滚动作：

```bash
# 收紧灰度
PUT /api/ai/ops/feature-flags  {"rollout_percent": 0}

# 关闭通道
PUT /api/ai/ops/feature-flags  {"channels": {"feishu": false, "wecom": false}}

# 关闭异步通道（如有问题）
PUT /api/ai/ops/feature-flags  {"channel_async_run": false}
```

## 6. 两周签字栏

| 周次 | 日期 | readiness | ga failed | smoke | 签字 |
|---|---|---|---:|---|---|
| W1 |  |  |  |  |  |
| W2 |  |  |  |  |  |

最新连续两周达标且无高危项 → 可宣布 6.0 GA；间断日期不计入连续窗口。7.0 通道/市场继续按专项门禁观测。
