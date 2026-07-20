# 版本自动推送设计

## 背景

当前仓库已经具备基于提交前缀的自动升版与推送能力：

- `commit-msg` 负责校验提交前缀并规范提交标题
- `post-commit` 负责读取刚提交的 message，自动计算版本升级级别并推送当前分支
- 版本脚本会同步整仓版本号并通过 `git commit --amend --no-verify` 把版本文件并入当前提交
- 当前分支已有 upstream 时执行普通推送；没有 upstream 时首次推送使用
  `--set-upstream`。
- `CODEX_VERSIONING_BYPASS` 会跳过内部 amend 触发的二次推送。

## 目标（已实现）

- 每次 `git commit` 后自动把当前分支推送到 `origin`
- 如果当前分支尚未建立 upstream，首次推送自动使用 `--set-upstream`
- 保留旧版本分支，不做自动删除，便于回滚
- 避免 `post-commit` 在内部 `--amend` 时触发二次推送

## 方案对比

### 方案 A：在 `post-commit` 末尾追加自动推送

优点：

- 与现有自动升版流程直接串联，改动面最小
- 能覆盖“普通提交”和“升版 amend 后提交”两类场景
- 容易复用现有 `CODEX_VERSIONING_BYPASS` 机制，避免二次触发

缺点：

- 推送失败会直接让本次 hook 返回错误，需要用户处理远端问题

### 方案 B：单独新增手工命令触发推送

优点：

- 对 git 提交流程侵入最小

缺点：

- 不满足“每次提交自动推送”的目标
- 仍依赖人工操作，容易遗漏

## 采用方案

采用方案 A，当前实现已落地。

实现方式：

1. 在 `scripts/versioning/automation.js` 新增 `pushCurrentBranch` 帮助函数
2. `post-commit` 先执行自动升版，再执行自动推送
3. 若检测到 `CODEX_VERSIONING_BYPASS`，直接退出，避免内部 amend 的二次推送
4. 文档补充“自动推送当前分支，旧版本分支保留”

## 测试策略与当前状态

- 单测：首次推送时自动设置 upstream
- 集成测试：自动升版 amend 后，远端分支拿到带版本前缀的新提交
- 当前 `npm run test:versioning`：56 个测试通过。
- 本次整改未执行实际 commit/push；正式发布仍需发布负责人明确授权。
