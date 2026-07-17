# 聚信 AI 助手项目约定

## 项目结构

- `server/`：FastAPI 服务、Agent Loop/Harness、Alembic 迁移和 Python 测试。
- `apps/desktop/`：桌面端 React/Tauri 前端及 Vitest/Playwright 测试。
- `docs/`：实施方案、运维手册、发布证据和用户文档。
- `VERSION`：项目版本唯一来源；桌面端声明版本必须与它一致。

## 本地开发与验证

后端命令从 `server/` 执行：

```bash
python3 -m pytest -q tests --ignore=tests/test_migrations.py -ra
python3 scripts/run_harness_release_gate.py
python3 scripts/run_ga_gate_local.py --json
python3 scripts/run_staging_preflight.py --mode local --json
```

桌面端命令从 `apps/desktop/` 执行：

```bash
npm run typecheck
npm test -- --reporter=dot
```

正式迁移测试必须单独运行；出现多个 Alembic head 时必须 fail-closed，不能用 `upgrade head` 指定任一 head 绕过门禁。迁移候选只能使用 `server/scripts/run_migration_candidate_rehearsal.py` 的临时副本回放。

## 安全和发布边界

- 本地测试使用临时配置；不得把 Token、密钥、`.env` 内容或用户数据写入仓库、日志或记忆文件。
- 未得到明确授权前，不访问 staging/生产，不执行真实迁移，不切换 `real` Runtime，不升级版本，不 commit 或 push。
- 版本规则：大改版升第一位，功能优化升第二位，Bug 修复升第三位；发布动作必须通过版本门禁并由用户授权。
- 写入、外部副作用和恢复必须经过统一状态契约、工具契约、租约/fencing 和对账语义；不要在路由或页面中复制一套旁路状态机。

## 工作循环

每次非平凡改动都要：

1. 先在方案文件中写明目标、范围和验证命令。
2. 做最小可 review 改动。
3. 运行与改动范围匹配的测试和 `git diff --check`。
4. 将结果、未完成项和下一步写入 `docs/plans/` 及当天 `memory/` 文件。
