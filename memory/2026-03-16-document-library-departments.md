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

## 运行态补丁
- 首轮 `5.2.0` 本地重建时发现 `auth` 容器启动失败，原因是 `auth/Dockerfile` 漏打包 `admin-center-departments.js`。
- 已补 Dockerfile 与打包测试，后续版本需包含：
  - `auth/admin-center-departments.js`
  - `auth/tests/auth-dockerfile-packaging.test.js`

## 真实联机验收
- 已在本地容器环境跑通“技术部申请查看财务部文档”的真实接口链路。
- 验收路径：
  - `reviewer(FIN)` 作为财务部文档管理员创建部门库分类与文档
  - `editor(TECH)` 在跨部门列表中只能看到题头卡片，`summary` 为空，详情接口返回 `403`
  - `editor(TECH)` 提交访问申请
  - `reviewer(FIN)` 在待审批列表中看到申请并审批通过，授权时长为 `7d`
  - `editor(TECH)` 审批后再次访问详情接口返回 `200`，可读取正文摘要与完整权限对象
- 真实结果确认：
  - 跨部门未授权时只暴露标题，不暴露正文摘要
  - 申请流、审批流、授权生效都正常
  - 部门文档管理员不需要 `editor` 角色也可审批和管理本部门受控文档
- 本地联机验收期间曾临时：
  - 给 `editor/reviewer` 分配部门
  - 给 `reviewer` 增加财务部文档管理员关系
  - 关闭统一登录验证码以便脚本登录
- 上述本地测试数据与验证码配置在验收后均已回滚，未保留在当前环境中。

## 文档管理系统白屏修复
- 现象：`http://localhost:8085` 打开后只剩背景，浏览器控制台报错 `ReferenceError: Cannot access 'Al' before initialization`。
- 根因：
  - `faq/frontend/src/App.jsx` 中 `allCategoryIds` 的 `useMemo` 定义在 `filteredCategories` 之前，初始化时触发 TDZ。
  - 本地 `web-faq` 在 `docker compose up -d --build` 后未自动切到新镜像，`8085` 仍在提供旧 bundle `index-Ct8G4-_1.js`。
- 修复：
  - 将 `allCategoryIds` / `allCategoriesSelected` 移动到 `filteredCategories` 定义之后。
  - 新增源码回归测试，强制约束两者声明顺序。
  - 重新构建前端后，对 `web-faq` 执行 `--force-recreate --no-deps`，确认页面改为提供新 bundle `index-CUs5-Eak.js`。
- 验证：
  - `node --test faq/frontend/tests/source.app.test.cjs`
  - `cd faq/frontend && npm run build`
  - `curl http://127.0.0.1:8085` 已返回新 bundle 资源路径
