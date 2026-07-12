# 独立系统版本最终修复报告（第 3 轮）

- 工作树：`/Users/zhanglei/Documents/codex-new/.worktrees/independent-system-versioning`
- 日期：2026-07-12
- 提交：本报告所在 `HEAD`（最终哈希以 `git rev-parse HEAD` 为准，并在交付消息中记录）
- 结论：审查报告列出的 3 项 IMPORTANT 与 1 项 MINOR 均已修复。

## 变更

1. 新增声明式 `versionTargets`，将 AI 助手后端/根 Compose 与 SCA 后端、系统 Compose、`.env.example`、根 Compose 四个服务纳入各自 `VERSION`。
2. registry 强制校验目标路径归属（系统路径或共享路径）、文件存在、selector 唯一匹配、命名 `version` 捕获为严格 SemVer 且与 `VERSION` 一致。
3. 同一系统内按文件合并目标编辑；`all` scope 会合并多个系统对共享根 Compose 的非重叠编辑，具体 scope 只更新对应系统字段，不触碰依赖工具版本。
4. AI/SCA 运行时与部署默认值全部初始化为 `1.0.0`。
5. 将 stash 恢复纳入 amend 事务；恢复冲突时恢复原 HEAD、清理冲突状态，在原 HEAD 上恢复用户 staged/unstaged/untracked 改动并删除自动 stash，最终保留原始错误。
6. bootstrap 默认目录改为 `/root/AuthorizationReminder`，默认分支改为 `main`，并保留 `BOOTSTRAP_BRANCH` 显式覆盖。
7. 删除无效 `switchBranch` sentinel 注入，改由真实 `runPostCommit` 测试断言执行前后当前分支不变。
8. 更新 `docs/versioning.md`，说明新增运行时/部署目标、共享文件合并规则和完整事务语义。

## 回归测试

- 新增 AI/SCA runtime target drift 与精确同步测试，验证未声明的 `APP_VERSION` 和 `DEPENDENCY_CHECK_VERSION` 不变。
- 新增 registry 目标缺失、重复和 VERSION drift 拒绝测试。
- 新增 `feat(all)` 共享根 Compose 合并测试。
- 新增真实 Git stash 冲突测试：用户未提交的 `auth/package.json` 与自动版本目标冲突后，HEAD、状态、内容和 stash 列表均与执行前一致。
- bootstrap 测试同时覆盖稳定默认分支/目录与显式自定义分支。

## 验证

- `npm run test:versioning`：56/56 通过。
- `node --test juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs`：6/6 通过。
- `bash scripts/tests/bootstrap-full-server.sh`：通过。
- JSON 审计：通过。
- YAML 审计（根 Compose、SCA Compose）：通过。
- TOML 审计（AI 助手 Cargo.toml）：通过。
- registry drift 审计：15/15 系统无漂移。
- `git diff --check`：通过。

## RED 证据

实现前新增回归测试稳定复现 4 类失败：缺少 `versionTargets`、AI/SCA drift 未发现、stash 冲突后 HEAD 未回滚、`all` 未同步共享 Compose；bootstrap 默认分支断言同时失败。实现后以上测试与完整验证全部通过。
