# 多实例 Checkpoint 恢复演练

目标：验证 6.0 GA 指标 **checkpoint 恢复成功率 ≥ 99%** 在多 worker 场景下仍成立。

## 1. 原理

- 每个安全步骤写入 `ai_agent_run_steps.checkpoint_json` 与 `ai_agent_runs.checkpoint_json`
- 失败/取消后 `retry` 调用 `apply_checkpoint_on_retry` 恢复 `stage` / `progress`
- `NativeRuntime` 续跑时跳过已成功步骤（coordinate / research / write），优先复用草稿

## 2. 单机基线（必做）

```bash
cd server
python scripts/run_checkpoint_recovery.py --local --cases 50
# 期望: recovery_rate >= 0.99, passed=true

# 或对运行中的服务
python scripts/run_checkpoint_recovery.py --base-url http://127.0.0.1:18093 --cases 30
```

## 3. 多实例演练（推荐）

1. 启动 **≥2** 个 API/worker 进程，共享同一数据库。
2. 创建复杂任务并在 review 前 kill 其中一个实例（模拟崩溃）。
3. 对同一 `run_id` 调用 `POST /api/ai/runs/{id}/retry`（任意存活实例）。
4. 断言：
   - 状态进入 `retrying` → `running` → `succeeded`；`failed`、`running`、`retrying` 均不得计入恢复成功
   - `progress` 不低于崩溃前 checkpoint
   - events 含 `checkpoint-resume-*` 与 `checkpoint-continue-*`
   - 不重复产生已成功的 `coordinate` / `research` / `write` 步骤（可有 skip 事件）

自动化辅助：

```bash
python scripts/run_multi_instance_checkpoint_drill.py --cases 10
```

（脚本在单进程内模拟「崩溃后另一 session 接管」：写 checkpoint → fail → retry → 仅在终态成功、事件齐全、进度不倒退且无重复安全步骤时通过。它是 fail-closed 本地证据，不能代替真实进程边界演练。）

真实进程边界的租约接管门禁：

```bash
cd server
AI_LOCAL_DEV_MODE=1 AI_ENCRYPTION_KEY="$(python3 -c 'import base64; print(base64.urlsafe_b64encode(b"x" * 32).decode())')" \
python -m pytest tests/test_lease_heartbeat.py::test_sigkill_worker_lease_takeover_uses_two_independent_processes -q
```

该测试会启动 Worker A，取得租约后对其发送 `SIGKILL`；租约到期后由独立 Worker B 接管，并验证旧 fencing token 不能再续租或写入。它是本地进程级证据，不能取代 staging 的真实 API/worker 演练与连续观测。

LangGraph checkpointer 的进程边界演练：

```bash
cd server
/tmp/juxin-langgraph-pilot/bin/python scripts/run_langgraph_checkpoint_drill.py --cases 3
```

脚本使用文件型 SQLite 和每进程独立 SQLAlchemy engine，验证 Worker A 被 `SIGKILL` 后，Worker B 能读取 `cp-1` 并提交 `cp-2`，旧 fencing token 的写入被拒绝。输出为机器可读 JSON；未安装 LangGraph checkpointer 依赖时会安全跳过，不把“未测量”报告成通过。该演练验证本地进程边界与持久化语义，不代表 staging/生产数据库、鉴权或 SLO 已通过。

## 4. 记录模板

| 日期 | 环境 | 实例数 | cases | recovery_rate | 备注 |
|---|---|---:|---:|---:|---|
| YYYY-MM-DD | staging | 2 | 30 | 1.00 |  |

连续两周无高危回退且 rate≥0.99 → 可勾选 GA 清单对应项。
