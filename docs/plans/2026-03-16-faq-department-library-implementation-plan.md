# FAQ Department Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `auth + faq` 中落地“全局库 + 部门库 + 跨部门申请查看”，并让部门信息由统一登录侧透传给文档系统。

**Architecture:** 复用 `auth` 里的 `departments` 主表和用户体系，新增用户主部门与部门文档管理员资格；FAQ 后端以 `library_scope + department_code` 做对象级权限边界，并在列表层输出“可读正文”和“仅题头可见”两种卡片。

**Tech Stack:** Node.js, Express, MySQL, React, server-rendered auth admin page, Docker Compose

---

### Task 1: 固化 auth 侧部门模型

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/db.js`
- Modify: `/Users/zhanglei/Documents/codex-new/auth/admin-center-users.js`
- Create: `/Users/zhanglei/Documents/codex-new/auth/admin-center-departments.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/admin-center-departments.test.js`

**Step 1: Write the failing test**
- 用户列表返回 `department_code`
- 用户创建/更新可写入 `department_code`
- 部门列表可返回管理员关系

**Step 2: Run test to verify it fails**
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-departments.test.js`

**Step 3: Write minimal implementation**
- `users` 增加 `department_code`
- 新增 `department_doc_admins`
- 新增部门管理 service

**Step 4: Run test to verify it passes**
- 同上

### Task 2: 透传部门信息到 auth introspect 与管理后台

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/auth/index.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js`
- Test: `/Users/zhanglei/Documents/codex-new/auth/tests/delivery-portal-source.test.js`

**Step 1: Write the failing test**
- `introspect` 源码/返回结构包含 `scope.department` 和 `scope.managedDepartments`
- 管理后台页面包含主部门与部门管理员维护入口

**Step 2: Run test to verify it fails**
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/portal-routing.test.js /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-departments.test.js`

**Step 3: Write minimal implementation**
- 新增部门管理 API
- 用户创建/编辑表单加入主部门
- 新增部门管理面板

**Step 4: Run test to verify it passes**
- 同上

### Task 3: 锁定 FAQ 文库访问规则

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/faq/backend/src/library-access.js`
- Test: `/Users/zhanglei/Documents/codex-new/faq/backend/tests/library-access.test.js`

**Step 1: Write the failing test**
- 全局库文档所有业务用户可读
- 同部门部门库文档可读
- 跨部门未授权仅受限
- 跨部门已授权可读
- 部门管理员只能审批自己部门

**Step 2: Run test to verify it fails**
- `node --test /Users/zhanglei/Documents/codex-new/faq/backend/tests/library-access.test.js`

**Step 3: Write minimal implementation**
- 抽离访问判断 helper

**Step 4: Run test to verify it passes**
- 同上

### Task 4: FAQ 后端数据模型与接口

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/src/db.js`
- Modify: `/Users/zhanglei/Documents/codex-new/faq/backend/src/index.js`
- Test: `/Users/zhanglei/Documents/codex-new/faq/backend/tests/source.department-library.test.js`

**Step 1: Write the failing test**
- 存在文库范围字段、申请审批路由、部门隔离逻辑关键源码片段

**Step 2: Run test to verify it fails**
- `node --test /Users/zhanglei/Documents/codex-new/faq/backend/tests/source.department-library.test.js`

**Step 3: Write minimal implementation**
- 建表/补列
- 列表、详情、分类、收藏、最近访问、预览、下载按新权限收口
- 新增申请/审批/撤销接口

**Step 4: Run test to verify it passes**
- 同上

### Task 5: FAQ 前端最小可用 UI

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.jsx`
- Test: `/Users/zhanglei/Documents/codex-new/faq/frontend/tests/source.app.test.cjs`

**Step 1: Write the failing test**
- 存在“全局库”“部门库”“跨部门受限”“申请查看”“待审批”等关键文案

**Step 2: Run test to verify it fails**
- `node --test /Users/zhanglei/Documents/codex-new/faq/frontend/tests/source.app.test.cjs`

**Step 3: Write minimal implementation**
- 列表状态标签
- 申请查看按钮
- 审批队列
- 分类范围切换

**Step 4: Run test to verify it passes**
- 同上

### Task 6: 验证、容器重建与收口

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/memory/2026-03-16-document-library-departments.md`

**Step 1: Run targeted tests**
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js /Users/zhanglei/Documents/codex-new/auth/tests/admin-center-departments.test.js /Users/zhanglei/Documents/codex-new/faq/backend/tests/library-access.test.js /Users/zhanglei/Documents/codex-new/faq/backend/tests/source.department-library.test.js /Users/zhanglei/Documents/codex-new/faq/frontend/tests/source.app.test.cjs`

**Step 2: Run syntax verification**
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js /Users/zhanglei/Documents/codex-new/auth/admin-center-users.js /Users/zhanglei/Documents/codex-new/auth/admin-center-departments.js /Users/zhanglei/Documents/codex-new/faq/backend/src/index.js /Users/zhanglei/Documents/codex-new/faq/backend/src/db.js /Users/zhanglei/Documents/codex-new/faq/backend/src/library-access.js /Users/zhanglei/Documents/codex-new/faq/frontend/src/App.jsx`

**Step 3: Rebuild services**
- `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml up -d --build auth faq-api web-faq`

**Step 4: Commit**
- `git add -A`
- `git commit -m "feat(faq): add global and department document libraries"`
