# 交付系统

目录：`/Users/zhanglei/Documents/codex-new/delivery`

## 范围
- 独立系统、独立目录
- 复用统一登录（auth），系统键：`delivery`
- 复用现有 MySQL 实例，独立库：`juxin_delivery`
- 服务端口：API `5185`，前端 `8084`

## 固定流程
`INIT -> ASSESS -> IMPLEMENT -> TUNE -> TRIAL -> ACCEPT -> HANDOVER -> CLOSED`

## V1 功能点
- 阶段严格串行：不可跳步，可退回。
- 同时保留“项目”维度：项目成员、评论、排期统一挂到交付单。
- 审计链签名：链式哈希 + 在线验签。
- 关键阶段强制留证：`IMPLEMENT`、`TUNE`、`TRIAL`、`ACCEPT`。
- 批量能力：Excel/CSV 导入、批量阶段推进、导出报表。
- SLA 能力：规则配置、自动扫描、手动触发。
- 附件能力：上传、下载、删除（`admin/editor` 可删除）。
- 权限模型：
  - `admin/editor/reviewer/user/sales`：交付写操作
  - `auditor`：只读审计与验签
  - `sysadmin`：不进入交付业务
- 审计日志展示：前端“变更摘要”使用中文差异描述（不直接展示原始 JSON）。

## 关键接口
- `GET /api/delivery/projects`
- `POST /api/delivery/projects`
- `PUT /api/delivery/projects/{id}/members`
- `GET /api/delivery/orders`
- `POST /api/delivery/orders`
- `POST /api/delivery/orders/{id}/phases/{action}`
- `POST /api/delivery/orders/{id}/rework`
- `GET /api/delivery/orders/{id}/comments`
- `POST /api/delivery/orders/{id}/comments`
- `GET /api/delivery/orders/{id}/schedules`
- `POST /api/delivery/orders/{id}/schedules`
- `POST /api/delivery/orders/{id}/attachments`
- `POST /api/delivery/orders/batch/phase`
- `POST /api/delivery/import/orders.xlsx`
- `GET /api/delivery/dashboard/summary`
- `GET /api/delivery/sla/summary`
- `PUT /api/delivery/sla/rules`
- `GET /api/delivery/audit/logs`
- `GET /api/delivery/audit/verify`
- `node src/migrate-legacy.js`（支持 dry-run）

## 主要环境变量
- `MYSQL_DATABASE=juxin_delivery`
- `MYSQL_USER=delivery_user`
- `MYSQL_PASSWORD=<ENV注入>`
- `MYSQL_ADMIN_USER=root`
- `MYSQL_ADMIN_PASSWORD=<ENV注入>`
- `AUTH_SYSTEM_KEY=delivery`
- `AUDIT_SIGNING_KEY=<strong-random-key>`
- `MAX_BATCH_STAGE_JOB_IDS=200`
- `MAX_IMPORT_ROWS=500`
- `UPLOAD_MAX_FILE_SIZE_MB=10`

## 本地启动
后端：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
cp .env.example .env
npm install
npm run dev
```

前端：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/frontend
npm install
npm run dev
```

访问：`http://localhost:8084`

## Docker 启动
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth delivery-api web-delivery
```

## 验证（Vitest）
安装依赖：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
npm install
```

冒烟：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 ADMIN_LOGIN=admin ADMIN_PASSWORD=<密码> npm run test:smoke
```

权限矩阵：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:rbac
```

回归：
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 ADMIN_LOGIN=admin ADMIN_PASSWORD=<密码> npm run test:regression
```

可选环境变量：
- `API_BASE`（默认 `http://localhost:5185`）
- `AUTH_BASE`（默认 `http://localhost:5180`）
- `AUTH_TOKEN`（若提供则直接使用，不再自动登录）
- `BUILTIN_PASSWORD`
- `ADMIN_LOGIN` / `AUDITOR_LOGIN`
- `ADMIN_PASSWORD` / `AUDITOR_PASSWORD`
- `AUTH_TOKEN_ADMIN` / `AUTH_TOKEN_AUDITOR`
- `DELIVERY_MIGRATION_DRY_RUN=true|false`
- `DELIVERY_MIGRATION_LIMIT=<N>`

兼容说明：
- `src/migrate-legacy.js` 默认从 `juxin_reminder` 和 `juxin_sec_impl` 读取旧数据并折叠到 `juxin_delivery`。
