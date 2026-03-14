# 2026-03-14 Admin Center / Audit Center Checkpoint

## Context

- Branch: `codex/4.0.9`
- Time: `2026-03-14 15:24:03 CST`
- Goal: 在 `auth` 服务内落地独立的 `admin-center` 与 `audit-center`，让 `sysadmin` / `auditor` 不再依赖 `reminder` 作为后台入口。

## Completed

- 已确认设计与实施计划：
  - `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-14-auth-admin-audit-centers-design.md`
  - `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-14-auth-admin-audit-centers-implementation-plan.md`
- 已新增纯 helper：
  - `/Users/zhanglei/Documents/codex-new/auth/portal-routing.js`
- 已新增测试：
  - `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- 已完成第一批行为：
  - `sysadmin` 默认系统改为 `admin-center`
  - `auditor` 默认系统改为 `audit-center`
  - `defaultAppAccessByRole('sysadmin') -> ['admin-center']`
  - `defaultAppAccessByRole('auditor') -> ['audit-center']`
  - `/api/auth/apps` 已加入 `admin-center` / `audit-center`
  - `auth` 新增独立页面壳：
    - `/admin-center`
    - `/audit-center`
- 已完成 `admin-center` 第一批后端 API：
  - `GET /api/admin-center/users`
  - `POST /api/admin-center/users`
  - `PUT /api/admin-center/users/:id`
  - `POST /api/admin-center/users/:id/unlock`
  - `POST /api/admin-center/users/:id/reset-password`
  - `DELETE /api/admin-center/users/:id`
  - `GET /api/admin-center/security`
  - `POST /api/admin-center/security`
- 已完成 `audit-center` 第一批后端 API：
  - `GET /api/audit-center/logs`
  - `GET /api/audit-center/logs/export`
  - `GET /api/audit-center/logs/verify`
- 独立页面已经接入第一版交互：
  - `/admin-center` 可执行：
    - 用户列表刷新
    - 新增用户
    - 启用 / 禁用用户
    - 解锁用户
    - 重置密码
    - 删除用户
    - 读取 / 保存安全配置
  - `/audit-center` 可执行：
    - 审计日志查询
    - 审计链校验
    - CSV 导出
- `auth` Dockerfile 已复制新 helper 文件：
  - `/Users/zhanglei/Documents/codex-new/auth/Dockerfile`

## Verification

- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/portal-routing.js`
- `node --check /Users/zhanglei/Documents/codex-new/auth/audit-center-logs.js`
- `docker compose build auth`

以上已通过。

## Not Done Yet

- `audit-center` 仍缺日志验签报告导出、更多筛选项和详情查看
- `admin-center` 仍缺编辑邮箱/手机号/角色/系统权限的页面入口
- 还没做端到端手工登录验证
- 本批改动还未提交、未推送

## Next Step

优先进入下一批：

- 手工跑 `auth`，验证：
  - `sysadmin` 登录默认进入 `/admin-center`
  - `auditor` 登录默认进入 `/audit-center`
  - `admin-center` 的用户动作按钮能真实落库
  - `audit-center` 的日志查询 / 导出能正常响应
- 然后再决定是否拆第二批：
  - 审计中心导出验签报告
  - 管理后台用户编辑表单
