# Admin Center / Audit Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `auth` 服务内落地独立的 `admin-center` 与 `audit-center`，让 `sysadmin` 和 `auditor` 不再依赖 `reminder` 作为后台入口。

**Architecture:** 复用 `auth` 服务的登录态、数据库和权限能力，在其内部新增两套路由与最小前端页面；门户角色默认跳转改为新系统；相关 API 从 `reminder` 迁移到 `auth`。

**Tech Stack:** Node.js, Express, MySQL, server-rendered HTML + embedded JS, Docker Compose

---

### Task 1: 门户系统定义与角色默认跳转

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 1: Write the failing test**
- 覆盖 `sysadmin` 默认进入 `admin-center`
- 覆盖 `auditor` 默认进入 `audit-center`

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 3: Write minimal implementation**
- 在 `/api/auth/apps` 中加入 `admin-center` / `audit-center`
- 调整门户默认跳转逻辑

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/portal-routing.test.js`
- `git commit -m "feat: route privileged roles to dedicated centers"`

### Task 2: admin-center 用户管理 API

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Create: `/Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`

**Step 1: Write the failing test**
- `GET /api/admin-center/users` 仅 `sysadmin` 成功
- `POST /api/admin-center/users` 可创建用户

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`

**Step 3: Write minimal implementation**
- 从 reminder 提取并迁移用户管理所需最小逻辑

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/admin-center-users.test.js`
- `git commit -m "feat: add admin center user management api"`

### Task 3: admin-center 安全配置 API

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Create: `/Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`

**Step 1: Write the failing test**
- `GET /api/admin-center/security`
- `POST /api/admin-center/security`

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`

**Step 3: Write minimal implementation**
- 复用 `getSecurityConfig` 与配置持久化逻辑

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/admin-center-security.test.js`
- `git commit -m "feat: add admin center security api"`

### Task 4: audit-center 审计 API

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Create: `/Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`

**Step 1: Write the failing test**
- `GET /api/audit-center/logs`
- `GET /api/audit-center/logs/verify`

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`

**Step 3: Write minimal implementation**
- 迁移审计日志查询、导出、验签逻辑

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/audit-center-logs.test.js`
- `git commit -m "feat: add audit center log api"`

### Task 5: admin-center 页面

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 1: Write the failing test**
- `/admin-center` 未登录返回 401/跳登录
- `sysadmin` 能打开页面

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 3: Write minimal implementation**
- 新增 server-rendered admin-center 页面
- 接入用户管理和安全配置 API

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/portal-routing.test.js`
- `git commit -m "feat: add admin center page"`

### Task 6: audit-center 页面

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 1: Write the failing test**
- `/audit-center` 未登录返回 401/跳登录
- `auditor` 能打开页面

**Step 2: Run test to verify it fails**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 3: Write minimal implementation**
- 新增 server-rendered audit-center 页面
- 接入审计日志与验签 API

**Step 4: Run test to verify it passes**
- Run: `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`

**Step 5: Commit**
- `git add auth/index.js auth/tests/portal-routing.test.js`
- `git commit -m "feat: add audit center page"`

### Task 7: Compose 与环境变量

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- Modify: `/Users/zhanglei/Documents/codex-new/.env.example`
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`

**Step 1: Write the failing config/render check**
- 确认 `APP_ADMIN_CENTER_URL` / `APP_AUDIT_CENTER_URL` 渲染存在

**Step 2: Run check to verify it fails**
- Run: `docker compose --env-file /Users/zhanglei/Documents/codex-new/.env.example config | rg "APP_ADMIN_CENTER_URL|APP_AUDIT_CENTER_URL"`

**Step 3: Write minimal implementation**
- 增加新系统 URL 配置
- 文档更新

**Step 4: Run check to verify it passes**
- Run: `docker compose --env-file /Users/zhanglei/Documents/codex-new/.env.example config | rg "APP_ADMIN_CENTER_URL|APP_AUDIT_CENTER_URL"`

**Step 5: Commit**
- `git add docker-compose.yml .env.example README.md`
- `git commit -m "chore: wire admin and audit center urls"`

### Task 8: 端到端验证

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-14-auth-admin-audit-centers-design.md`

**Step 1: Run targeted tests**
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-security.test.js`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/audit-center-logs.test.js`

**Step 2: Run syntax/build verification**
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
- `docker compose build auth`

**Step 3: Manual smoke**
- `sysadmin` 登录应直接进入 `admin-center`
- `auditor` 登录应直接进入 `audit-center`
- `admin-center` 用户创建/安全配置保存可用
- `audit-center` 审计日志查看/验签/导出可用

**Step 4: Commit final integration**
- `git add -A`
- `git commit -m "feat: add dedicated admin and audit centers"`
