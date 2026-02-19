# 安全产品实施记录系统（Sec Impl）

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

访问：`http://localhost:8084`

## Docker 启动
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth sec-impl-api web-sec-impl
```

## 验证脚本
冒烟：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/scripts
AUTH_TOKEN=<统一登录token> API_BASE=http://localhost:5185 ./smoke-e2e.sh
```

回归：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/scripts
AUTH_TOKEN=<统一登录token> API_BASE=http://localhost:5185 ./regression-api.sh
```

权限矩阵：
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/scripts
./rbac-matrix.sh
```

可选环境变量：
- `API_BASE`（默认 `http://localhost:5185`）
- `AUTH_BASE`（默认 `http://localhost:5180`）
- `BUILTIN_PASSWORD`
- `AUTH_TOKEN_ADMIN` / `AUTH_TOKEN_AUDITOR` / `AUTH_TOKEN_SYSADMIN`
- `EXPECT_SYSADMIN_SEC_IMPL_ACCESS=true|false`（默认 `true`）
