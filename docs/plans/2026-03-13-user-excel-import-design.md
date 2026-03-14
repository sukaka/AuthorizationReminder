# 用户 Excel 批量导入设计

## 背景

当前提醒系统门户的“用户管理”仅支持单条新增，入口位于 [web/src/App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx)。后端用户 CRUD 在 [server/index.js](/Users/zhanglei/Documents/codex-new/server/index.js)，同一服务已经具备以下可复用能力：

- `multer` 内存上传
- `parseImportFile`，可解析 `xlsx/xls/csv`
- `importRateLimiter`
- `import_jobs` 导入记录表
- `xlsx` 结果文件生成依赖

因此本次不新增独立服务，也不做前端逐条创建，而是在现有 reminder server 内补一个“用户 Excel 导入”闭环。

## 已确认需求

- 导入格式改为 Excel（`xlsx/xls`）
- Excel 中每行提供完整字段
- 重复 `username` 时跳过，并记录失败原因
- 初始密码不从 Excel 读取，由服务端为每个成功导入用户独立随机生成
- 管理员在导入完成后拿到一份结果 Excel，包含成功账号和对应初始密码
- 页面只展示导入汇总，不长期展示密码明文

## 非目标

- 不做异步任务队列
- 不做结果文件长期持久化下载
- 不新增“更新已存在用户”模式
- 不做批量禁用、批量重置密码等额外用户运维功能
- 本轮不支持 CSV 作为用户导入主路径

## 方案对比

### 方案 A：前端解析 Excel，逐条调用 `/api/users`

- 优点：后端路由改动最少
- 缺点：密码生成与失败控制分散在前端；导入日志无法聚合；浏览器中会短时间持有大量明文密码；网络失败时难以判断已导入到哪一行

结论：不采用。

### 方案 B：后端新增 `/api/import/users` 并统一处理

- 优点：可直接复用服务端导入基础设施、权限、日志、限流、Excel 解析和 `xlsx` 生成能力
- 优点：随机初始密码只在服务端生成，安全边界更清晰
- 优点：重复账号跳过、错误汇总、导入记录都可以和客户/联系人导入保持一致

结论：采用。

### 方案 C：异步导入任务 + 结果文件持久化下载

- 优点：适合超大批量
- 缺点：需要新增任务状态、结果文件存储、二次下载鉴权与清理策略，复杂度明显高于当前需求

结论：本轮不采用。

## 目标体验

### 用户管理页

在“用户管理”面板新增一个 Excel 导入区块，放在单条新增表单下方、列表上方，包含：

- 文件选择按钮：仅接受 `.xlsx,.xls`
- 简短格式说明：列名、必填项、`app_access` 推荐写法
- 上传按钮或选择即上传入口
- 导入完成后的汇总区：`成功 / 跳过 / 总数`
- 提示文案：结果 Excel 已自动下载，详细失败原因可在“导入记录”查看

页面不回显密码列表，只保留一次性下载结果文件。

### 结果文件

服务端在导入完成后直接返回一个结果 Excel，至少包含以下列：

- `username`
- `role`
- `is_active`
- `app_access`
- `result`
- `reason`
- `initial_password`

约束：

- 成功行写入随机初始密码
- 失败行的 `initial_password` 为空
- 结果文件通过浏览器立即下载，不写入 `import_jobs`

## Excel 字段设计

### 必填列

- `username` / `账号`
- `role` / `角色`
- `is_active` / `状态`
- `app_access` / `可访问系统`

### 可选列

- `email` / `邮箱`
- `phone` / `手机号`
- `wecom_id` / `企业微信UserID`

### 不再接收的列

- `password`
- `初始密码`

如果导入文件中包含密码列，本轮按“忽略该列”处理，不作为失败条件。

### 字段口径

- `role` 复用现有角色集合：`admin`、`editor`、`sysadmin`、`auditor`、`user`、`viewer`、`sales`
- `is_active` 支持 `1/0`、`启用/禁用`、`true/false` 的宽松映射，最终落成 `1` 或 `0`
- `app_access` 推荐写法：`faq|tender|train-exam`
- 为降低录表错误，解析器可兼容 `|`、`,`、`，`、`、`、`;` 作为分隔符，但 UI 文案只推荐 `|`

## 后端设计

### 新增接口

- `POST /api/import/users`

接口特性：

- 权限：`requireRole(['sysadmin'])`
- 上传：`upload.single('file')`
- 限流：复用 `importRateLimiter`
- 解析：复用 `parseImportFile`

### 导入流程

1. 校验上传文件存在且可解析
2. 逐行做字段归一化
3. 按现有单用户创建规则校验：
   - 用户名格式
   - 角色合法性
   - 邮箱格式
   - 手机号格式
   - `app_access` 至少一个
4. 用当前安全配置的密码策略生成每个成功行的随机初始密码
5. 若 `username` 已存在，则跳过并记录 `用户名已存在`
6. 成功插入用户后，写操作日志 `CREATE`
7. 写入一条 `import_jobs(type='users')` 记录，保存汇总与错误清单，但不保存明文密码
8. 生成结果 Excel 并直接作为响应体返回

### 返回方式

为了同时满足“页面显示汇总”和“立即下载结果 Excel”，接口返回 `blob`，并通过响应头带汇总信息：

- `X-Import-Total`
- `X-Import-Created`
- `X-Import-Skipped`
- `X-Import-Error-Count`
- `X-Import-Filename`

这样前端不需要再请求第二个下载接口，也不需要在数据库保存密码结果。

## 前端设计

前端上传逻辑放在 [web/src/App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx)：

- 新增用户导入状态：上传中、最近一次汇总
- 通过 `fetch('/api/import/users')` 上传 `FormData`
- 读取响应头汇总后更新 UI
- 将响应体转为 `Blob` 并触发下载
- 失败时仍沿用现有 `normalizeApiError` 和 toast/modal 提示

为避免继续膨胀 `App.jsx`，建议抽一个很小的前端 helper，负责：

- 读取导入汇总响应头
- 解析结果文件名
- 封装下载动作

## 安全与审计

- 随机初始密码仅在单次导入响应的结果 Excel 中出现，不写入数据库日志
- `import_jobs.errors_json` 仅记录失败原因，不记录密码
- 仍沿用现有 CSRF、防重放 cookie、导入限流
- `username` 校验本身已限制危险字符，能避免把公式型用户名写入结果文件
- `app_access` 在入库前仍经 `normalizeAppAccess` 收敛，避免越权系统键写入

## 测试策略

### 后端

新增独立单测覆盖：

- `app_access` 单元格解析
- `is_active` 宽松归一化
- 随机密码满足当前密码策略
- 重复用户跳过且统计正确
- 结果 Excel 生成时成功行带密码、失败行不带密码

### 前端

新增轻量 helper 单测覆盖：

- 从响应头读取汇总
- 没有文件名时回退默认文件名

### 回归验证

- `node --test server/tests/user-import.test.js`
- `node --test web/src/user-import.test.js`
- `node --check server/index.js`
- `npm --prefix web run lint`
- `npm --prefix web run build`

## 预期改动文件

- `server/index.js`
- `server/tests/user-import.test.js`
- `server/api/openapi/reminder-v1.yaml`
- `web/src/App.jsx`
- `web/src/App.css`
- `web/src/user-import.js`
- `web/src/user-import.test.js`
- `docs/manuals/reminder-user-manual.md`
