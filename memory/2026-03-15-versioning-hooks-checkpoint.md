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

## 2026-03-15 Version Branch Alignment Fix

- 修正了一个真实问题：之前 hook 只会把“当前分支”推上去，导致版本 `4.3.0` 可能仍落在 `codex/4.2.0`
- 新逻辑会在升版后先判断当前分支是否等于旧版本分支：
  - 如果是，例如 `codex/4.2.0`
  - 会自动创建并切换到 `codex/4.3.0`
  - 同时把旧分支保留在上一提交，作为回滚点
  - 然后再推送新版本分支

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

## 2026-03-15 Audit Pagination Visibility Fix

- 用户反馈“还是没有分页”，实际根因不是分页逻辑失效，而是分页控件放在审计表格底部，首屏不明显
- 运行态排查确认：
  - 本地 `auth` 容器一度仍在跑旧版 `4.2.0` 镜像
  - 对 `auth` 执行 `docker compose build --no-cache auth` 后，容器已切到 `4.3.1`
  - 运行中 HTML 已包含分页节点
- 这次修复将分页控件从表格下方移动到结果区顶部，确保打开日志列表时就能看到
- 新增 UI 测试约束：
  - `auditPaginationSummary` 必须出现在审计表格标记之前

## 2026-03-15 Audit Logs Loading Fix

- 用户反馈分页出现后，日志列表一直停留在“正在加载审计日志...”
- 运行态根因已确认：
  - 后端 `/api/audit-center/logs` 接口本身可正常返回分页数据
  - 浏览器页面脚本在 `loadAuditLogs()` 入口同步抛出 `ReferenceError: clampNumber is not defined`
  - 由于异常发生在真正发起日志查询前，列表行保持初始“正在加载”占位态
- 这次修复只补了审计中心前端脚本缺失的 `clampNumber`，没有改动接口协议
- 新增 UI 测试约束：
  - 审计中心客户端脚本必须在分页逻辑前定义 `clampNumber`

## 2026-03-15 Audit Total Count Clarification

- 用户确认需要在审计中心直接看到“总条数”
- 当前实现里的 `total` 实际是“条数上限截断后的当前窗口总数”，不是全量命中数
- 这次统一约定：
  - `total` 继续表示当前窗口总数，用于分页
  - `matchedTotal` 表示总命中数
  - `matchedTotalIsExact` 表示总命中数是否精确
- 本地日志通过 `COUNT(*)` 提供精确总数
- 远端日志优先读取 `total / total_count / meta.total / pagination.total`
- 对未返回总数的远端源：
  - 返回条数小于 limit 时，视为精确
  - 返回条数等于 limit 时，只展示“至少 X 条”
- 前端文案已统一成：
  - `总命中 ...`
  - `当前窗口 ...`
  - 分页摘要明确标注“当前窗口第 X / Y 页”

## 2026-03-15 Admin Dedicated Centers Access Fix

- 用户反馈 `admin` 账号看不到管理后台和审计中心。
- 代码排查发现专属中心权限链路不够统一：
  - `canAccessDedicatedCenter()` 已做角色归一化
  - 但 `/api/auth/apps` 里对管理后台/审计中心的 `allow` 仍有精确字符串比较
  - 本地用户系统访问解析也存在对 `admin` 的精确字符串判断
- 这次修复统一为共享 portal 访问解析：
  - 新增 `resolveUserAppAccess()` 与 `normalizePortalRole()`
  - `admin` 即使遇到历史遗留 `app_access` 数据缺少 `admin-center`/`audit-center`，也会拿到两个专属中心
  - `/api/auth/apps` 对两个专属中心的放行判断改为复用 `canAccessDedicatedCenter()`
- 同时修正内置账号启动自愈逻辑：
  - 以前比较的是“解析后的管理员兜底权限”，会误以为数据库里的 `app_access` 已正确
  - 现在改为比较数据库里存储的原始 `app_access`，可自动把内置 `admin/sysadmin/auditor` 修回预期权限集合
- 回归测试已加到 `auth/tests/portal-routing.test.js`

## 2026-03-15 Dedicated Center Rule Correction

- 用户补充了真实需求：
  - `admin` 不应看到管理后台和审计中心
  - `sysadmin` 登录后应直接进入管理后台
  - `auditor` 登录后应直接进入审计中心
- 因此上一版 `4.4.1` 对 `admin` 开放专属中心是错误需求实现，已纠正回角色专属访问模型。
- 修正点：
  - `defaultAppAccessByRole('admin')` 改为仅业务系统，不再包含 `admin-center`/`audit-center`
  - `resolveUserAppAccess()` 对 `admin/sysadmin/auditor` 改为固定权限集合，不再信任历史脏 `app_access`
  - `canAccessDedicatedCenter()` 恢复为仅 `sysadmin` 访问管理后台、仅 `auditor` 访问审计中心
  - `admin-center-users.normalizeAppAccess()` 同步收紧，避免用户管理接口继续把专属中心分配给 `admin`
- 本地运行态验证：
  - `/portal` 仍返回 `200`
  - 需要重建 `auth` 容器并检查数据库中的 `admin/sysadmin/auditor app_access` 是否按新规则自愈
