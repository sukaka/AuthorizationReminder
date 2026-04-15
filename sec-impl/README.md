# 聚信实施记录系统（Sec Impl）

目录：`/Users/zhanglei/Documents/codex-new/sec-impl`

## 范围
- 独立系统、独立目录
- 复用统一登录（auth），系统键：`sec-impl`
- 复用现有 MySQL 实例，独立库：`juxin_sec_impl`
- 服务端口：API `5185`，前端 `8084`

## 固定流程
`INIT -> ASSESS -> IMPLEMENT -> TUNE -> TRIAL -> ACCEPT -> HANDOVER -> CLOSED`

## V1 功能点
- 阶段严格串行：不可跳步，可退回。
- 审计链签名：链式哈希 + 在线验签。
- 关键阶段强制留证：`IMPLEMENT`、`TUNE`、`TRIAL`、`ACCEPT`。
- 批量能力：Excel/CSV 导入、批量阶段推进、导出报表。
- SLA 能力：规则配置、自动扫描、手动触发。
- 附件能力：上传、下载、删除（仅 `admin/sysadmin`）。
- 权限模型：
  - `admin/sysadmin`：写操作
  - `auditor`：只读 + 审计验签
- 审计日志展示：前端“变更摘要”使用中文差异描述（不直接展示原始 JSON）。

## 关键接口
- `GET /api/sec-impl/projects`
- `POST /api/sec-impl/projects`
- `POST /api/sec-impl/projects/{id}/stages/{action}`
- `POST /api/sec-impl/projects/{id}/rework`
- `POST /api/sec-impl/projects/{id}/attachments`
- `POST /api/sec-impl/projects/batch/stage`
- `POST /api/sec-impl/import/projects.xlsx`
- `GET /api/sec-impl/dashboard/summary`
- `GET /api/sec-impl/sla/summary`
- `PUT /api/sec-impl/sla/rules`
- `GET /api/sec-impl/logs`
- `GET /api/sec-impl/audit/verify`

## 主要环境变量
- `MYSQL_DATABASE=juxin_sec_impl`
- `MYSQL_USER=sec_impl_user`
- `MYSQL_PASSWORD=<ENV注入>`
- `MYSQL_ADMIN_USER=root`
- `MYSQL_ADMIN_PASSWORD=<ENV注入>`
- `AUTH_SYSTEM_KEY=sec-impl`
- `AUDIT_SIGNING_KEY=<strong-random-key>`
- `MAX_BATCH_STAGE_JOB_IDS=200`
- `MAX_IMPORT_ROWS=500`
- `UPLOAD_MAX_FILE_SIZE_MB=10`

## 本地启动
后端：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
cp .env.example .env
npm install
npm run dev
```

前端：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/frontend
npm install
npm run dev
```

访问：`http://localhost:18084`

## Docker 启动
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth sec-impl-api web-sec-impl
```

## 验证（Vitest）
安装依赖：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
npm install
```

冒烟：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 ADMIN_LOGIN=admin ADMIN_PASSWORD=<密码> npm run test:smoke
```

权限矩阵：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:rbac
```

回归：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 ADMIN_LOGIN=admin ADMIN_PASSWORD=<密码> npm run test:regression
```

可选环境变量：
- `API_BASE`（默认 `http://localhost:5185`）
- `AUTH_BASE`（默认 `http://localhost:5180`）
- `AUTH_TOKEN`（若提供则直接使用，不再自动登录）
- `BUILTIN_PASSWORD`
- `ADMIN_LOGIN` / `AUDITOR_LOGIN` / `SYSADMIN_LOGIN`（可填用户名或手机号）
- `ADMIN_USERNAME` / `AUDITOR_USERNAME` / `SYSADMIN_USERNAME`（兼容旧变量）
- `ADMIN_PASSWORD` / `AUDITOR_PASSWORD` / `SYSADMIN_PASSWORD`
- `AUTH_TOKEN_ADMIN` / `AUTH_TOKEN_AUDITOR` / `AUTH_TOKEN_SYSADMIN`
- `EXPECT_SYSADMIN_SEC_IMPL_ACCESS=true|false`（默认 `true`）

兼容说明：
- 旧 Bash 脚本仍保留在 `/Users/zhanglei/Documents/codex-new/sec-impl/scripts`，建议优先使用 Vitest。
