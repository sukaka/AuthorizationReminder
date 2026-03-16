# 2026-03-16 文档管理系统部门隔离与全局库

## 背景
- 在 `faq` 文档管理系统中落地“全局库 + 部门库”双层文库。
- 默认只允许同部门查看部门库正文，跨部门仅展示题头并支持逐篇申请查看。
- 部门二级管理员负责本部门文档、分类和跨部门申请审批。
- `admin` 负责全局库；`sysadmin` 只做组织与配置维护，不参与业务文档内容访问。

## 本次实现
### auth
- `users` 增加 `department_code`。
- 新增 `department_doc_admins` 表，维护部门文档管理员。
- `auth /api/auth/me` 返回：
  - `scope.department`
  - `scope.managedDepartments`
  - `scope.isDepartmentDocAdmin`
- 管理后台新增部门管理能力，可维护部门文档管理员。

### faq backend
- `faq_articles`、`faq_categories` 增加：
  - `library_scope`
  - `department_code`
- 新增：
  - `faq_article_access_requests`
  - `faq_article_access_grants`
  - `faq_article_department_backfill_queue`
- 列表接口支持三类结果：
  - 全局库全文可见
  - 本部门全文可见
  - 跨部门受限题头卡片
- 新增跨部门申请与审批接口：
  - `POST /api/faq/articles/:id/access-requests`
  - `GET /api/faq/access-requests`
  - `POST /api/faq/access-requests/:id/review`
  - `POST /api/faq/access-grants/:id/revoke`
- 收口了版本、预览、下载、收藏、最近访问、反馈、在线编辑、上传、发布相关权限。

### faq frontend
- 新增“全局库 / 部门库 / 跨部门受限”状态展示。
- 新增文库筛选、部门库分类筛选。
- 新增“申请查看”入口。
- 新增“待审批”菜单与审批队列。
- 新建/编辑文档与分类支持文库范围和部门归属。

## 权限口径
- `admin`
  - 可查看所有文档
  - 可维护全局库
  - 可兜底处理部门申请
- `editor`
  - 仅可管理本部门文档
- 部门文档管理员
  - 可管理所负责部门的文档和分类
  - 可审批查看本部门文档的跨部门申请
- `reviewer`
  - 不因为同部门自动获得文档管理权
- `sysadmin` / `auditor`
  - 不具备业务文档正文访问能力

## 验证
- `node --test auth/tests/admin-center-users.test.js auth/tests/admin-center-departments.test.js auth/tests/department-scope-source.test.js faq/backend/tests/library-access.test.js faq/backend/tests/source.department-library.test.js faq/frontend/tests/source.app.test.cjs`
- `node --check auth/index.js auth/admin-center-users.js auth/admin-center-departments.js server/db.js faq/backend/src/index.js faq/backend/src/db.js faq/backend/src/library-access.js`
- `cd faq/frontend && npm run build`

## 风险与后续
- FAQ 旧模板/片段能力仍保留旧权限模型，但功能已下线，不影响当前主流程。
- 历史文档部门回填依赖 `auth.users.department_code`；无归属文档会进入待处理队列。
- 如果后续要支持“全局库管理员”而非仅 `admin`，需要补独立资格表。
