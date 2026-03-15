# 2026-03-15 Versioning Hooks Checkpoint

## Goal

- 把版本号规则固化到 git 提交流程
- 每次普通 `git commit` 自动判断版本级别并自动升版
- 提交信息与版本号对齐

## Chosen Design

- `commit-msg` hook
  - 校验提交前缀是否合法
  - 支持 `breaking:` / `major:` / `feat:` / `minor:` / `perf:` / `fix:` / `patch:` / `docs:` / `chore:` / `style:` / `refactor:` / `test:` / `build:` / `ci:` / `revert:`
  - 支持 Conventional Commit scope
  - 支持 `type!:` 和 `type(scope)!:` 按主版本处理
- `post-commit` hook
  - 读取刚提交的 message
  - 自动判断 `major` / `minor` / `patch`
  - 自动同步所有 package 版本、运行时版本常量、bootstrap 默认分支和 README 示例
  - 通过 `git commit --amend --no-verify` 把版本改动并入当前 commit
  - 最终提交标题格式：`[vX.Y.Z] 原始标题`

## Files Added

- `/Users/zhanglei/Documents/codex-new/scripts/versioning/automation.js`
- `/Users/zhanglei/Documents/codex-new/scripts/versioning/commit-msg.js`
- `/Users/zhanglei/Documents/codex-new/scripts/versioning/post-commit.js`
- `/Users/zhanglei/Documents/codex-new/scripts/versioning/install-hooks.js`
- `/Users/zhanglei/Documents/codex-new/.githooks/commit-msg`
- `/Users/zhanglei/Documents/codex-new/.githooks/post-commit`
- `/Users/zhanglei/Documents/codex-new/tests/versioning-automation.test.js`

## Files Updated

- `/Users/zhanglei/Documents/codex-new/package.json`
- `/Users/zhanglei/Documents/codex-new/docs/versioning.md`

## Verification

- `node --test /Users/zhanglei/Documents/codex-new/tests/versioning-automation.test.js`
- `npm run test:versioning`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/login-page-version.test.js`
- 真实临时仓库验证：
  - 安装 `.githooks`
  - 提交 `feat: runtime hook check`
  - 自动改写为 `[v4.2.0] feat: runtime hook check`
  - 自动同步 `package.json` 版本为 `4.2.0`

## Local Activation

- 当前仓库已执行：
  - `git config --local core.hooksPath .githooks`

## Follow-up

- 如果后续要把 tag / release note 也自动化，可以在 `post-commit` 基础上继续扩展，但当前版本先只保证 commit 与版本号同步，不自动打 tag。
- 用户偏好：以后版本升级完成后，由助手继续负责远端分支推送和 upstream 对齐，不再停在本地 commit。
- 用户偏好：旧版本分支默认保留，用于回滚，不自动删除。

## 2026-03-15 Auto Push Update

- `post-commit` 已扩展为：
  - 自动升版并 amend 当前提交
  - 自动把当前分支推送到 `origin`
  - 新分支首次推送自动建立 upstream
  - 内部 `git commit --amend --no-verify` 触发的二次 `post-commit` 会被 `CODEX_VERSIONING_BYPASS` 跳过，避免重复推送
- 已新增自动化测试覆盖：
  - 首次推送自动建立 upstream
  - 升版 amend 后推送远端分支

## 用户交付偏好补充

- 以后每次完成代码改动，在最终回复里都要附上“服务器更新命令”
- 命令要可直接复制执行，并按本次受影响服务给最小更新范围
- 服务器更新命令默认先执行 `git pull` 拉取最新代码，再执行对应服务更新

## 2026-03-15 Audit Pagination Update

- 审计中心日志列表已改为分页模式
- 默认每页 10 条
- 保留原有“条数上限”作为当前检索窗口上限
- 统一审计聚合接口返回分页结构：
  - `items`
  - `page`
  - `pageSize`
  - `total`
  - `totalPages`
  - `hasMore`
  - `systems`
  - `queryLimit`
- 导出继续导出当前筛选窗口内的全部记录，而不是只导出当前页
