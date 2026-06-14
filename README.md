# 聚信多系统业务平台

本仓库是一个基于统一登录（SSO）的多系统业务平台，包含以下 11 个现役业务系统：

- 授权到期提醒（Reminder）
- 交付系统（Delivery）
- CMDB
- 库存管理（Inventory）
- 设备流转（Device Flow）
- 文档管理（FAQ）
- 标书协同（Tender）
- 培训考试系统（Train-Exam）
- 提示词管理中心（Prompt Center）
- 软件成分分析平台（SCA）
- 统一大屏展示中心（Big Screen）

历史兼容资产：
- `ticketing` / `web-ticketing`：历史工单能力，现役入口已归一到交付系统。
- `sec-impl`：历史实施记录能力，现役入口已归一到交付系统。

目标是：统一账号登录、按系统授权访问、业务库隔离、可通过 Docker Compose 一键启动。

## 1. 架构与系统边界

### 1.1 架构组成
- `auth`：统一登录与授权中心（应用入口聚合、权限校验）
- `api`：提醒系统后端
- `delivery-api`：交付系统后端
- `cmdb`：CMDB 后端（Go）
- `inventory-api` + `shipping-gateway`：库存与物流网关
- `device-flow-api`：设备流转后端
- `faq-api`：FAQ 后端（Node.js + OnlyOffice）
- `tender-api`：标书系统后端（Node.js + OnlyOffice + OCR + AI）
- `train-exam-api`：培训考试系统后端（Node.js + Excel 导题 + 自动评分 + 证书）
- `prompt-center-api`：提示词管理中心后端（Node.js + 部门分类 + 版本审计）
- `sca-api`：软件成分分析平台后端（Python FastAPI + PostgreSQL + Redis + Celery）
- `big-screen-api`：统一大屏 BFF（模板、播放列表、数据适配、健康与离线资源）
- `web*`：各系统前端（Nginx + 静态资源）

### 1.2 数据库策略
既有业务复用同一个 MySQL 实例，不同系统独立 Schema 与最小权限账号；软件成分分析平台按技术栈要求使用 PostgreSQL：
- `juxin_reminder`（提醒/登录）
- `juxin_delivery`（交付）
- `cmdb`（CMDB）
- `juxin_inventory`（库存）
- `juxin_device_flow`（设备流转）
- `juxin_faq`（FAQ）
- `juxin_tender`（标书系统）
- `juxin_train_exam`（培训考试系统）
- `juxin_prompt_center`（提示词管理中心）
- `juxin_big_screen`（统一大屏展示中心）
- `juxin_sca`（软件成分分析平台，PostgreSQL）

> 说明：统一实例 + 独立 Schema + 独立运行账号，兼顾运维成本、最小权限和业务隔离。

## 2. 快速开始

### 2.1 环境要求
- Docker Desktop（含 Docker Compose v2）
- Node.js 20+（本地开发/构建）
- Go 1.22+（CMDB 本地开发）

### 2.1.1 容器刷新约定
日常启动默认只拉起已有容器；只有代码变更、首次部署或明确需要刷新镜像时，才执行重建，避免 `up -d --build` 带来的高磁盘 IO。

```bash
cd /Users/zhanglei/Documents/codex-new
./scripts/deploy/docker-compose-aliyun.sh start
```

代码变更后再执行：

```bash
cd /Users/zhanglei/Documents/codex-new
./scripts/deploy/docker-compose-aliyun.sh rebuild
```

> 说明：如只验证某个系统，可在 `start` 或 `rebuild` 后面追加具体服务名。

### 2.2 一键启动（全量）
```bash
cd /Users/zhanglei/Documents/codex-new
cp .env.example .env
# 编辑 .env，填入真实密码与密钥
./scripts/deploy/docker-compose-aliyun.sh rebuild
```

> 说明：根目录 `.env` 是必需文件，`docker compose` 不会从 Git 仓库自动带出这些密码与密钥。可先从 [`.env.example`](/Users/zhanglei/Documents/codex-new/.env.example) 复制生成。`docker-compose-aliyun.sh` 会优先探测你配置的阿里云镜像前缀，探测不到时自动回退官方镜像。

### 2.2.1 新服务器首启（一键）
```bash
git clone -b codex/5.8.3 https://github.com/sukaka/AuthorizationReminder.git /root/AuthorizationReminder-codex-5.8.3
cd /root/AuthorizationReminder-codex-5.8.3
# 在阿里云容器镜像服务控制台复制真实的 https://...mirror.aliyuncs.com 地址
export ALIYUN_MIRROR_URL='<阿里云镜像加速器真实 HTTPS 地址>'
export AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD='改成你要登录的默认密码'
export PUBLIC_HOST='服务器公网IP或域名，不带协议和端口'
./scripts/deploy/bootstrap-full-server.sh
```

> 说明：`bootstrap-full-server.sh` 默认把仓库同步到 `/root/AuthorizationReminder-codex-5.8.3`，并使用分支 `codex/5.8.3`。如需覆盖，可设置 `BOOTSTRAP_REPO_DIR`、`BOOTSTRAP_BRANCH`、`BOOTSTRAP_REPO_URL`。`ALIYUN_MIRROR_URL`、`AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD`、`PUBLIC_HOST` 为必填项。`ALIYUN_MIRROR_URL` 必须是阿里云控制台给出的真实 HTTP(S) 镜像加速地址，不能保留示例占位符。`PUBLIC_HOST` 只写主机名/IP，不要带 `http://` 或端口。
>
> 如果服务器当前只提供 `HTTP`，根 `.env` 里要保持 `AUTH_COOKIE_SECURE=false` 与 `AUTH_SECURITY_STRICT_MODE=false`，否则 `auth` 会因为安全启动校验直接退出。只有在你已经提供 `HTTPS` 入口时，才把这两个值一起改成 `true`。

### 2.3 常用按系统启动
```bash
# 仅提醒系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth api web

# 仅交付系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth delivery-api web-delivery

# 仅库存系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth shipping-gateway inventory-api web-inventory

# 仅设备流转系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth device-flow-api web-device-flow

# 仅 FAQ 系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth onlyoffice faq-api web-faq

# 仅 标书系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth onlyoffice tender-api web-tender

# 仅 培训考试系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth train-exam-onlyoffice train-exam-api web-train-exam

# 仅 提示词管理中心
./scripts/deploy/docker-compose-aliyun.sh start mysql auth prompt-center-api web-prompt-center

# 仅 软件成分分析平台
./scripts/deploy/docker-compose-aliyun.sh start auth sca-postgres sca-redis sca-api sca-worker sca-scanner-worker web-sca

# 仅 CMDB 系统
./scripts/deploy/docker-compose-aliyun.sh start mysql auth cmdb-mysql-init cmdb web-cmdb
```

> 说明：启动 CMDB 前，需要在根目录 `.env` 中提供 `CMDB_MYSQL_PASSWORD`，用于初始化 `cmdb_user` 并作为运行时数据库密码。

> 说明：`faq-api` 与 `tender-api` 复用同一个 `onlyoffice` 实例时，`DOC_EDITOR_JWT_SECRET` 必须保持一致。`train-exam-api` 已拆分为独立的 `train-exam-onlyoffice` 实例与独立密钥，不应再与 FAQ / 标书系统共用文档密钥。

> 培训考试系统的阿里云 OSS 受管视频现在支持在前端“模型配置”页直接维护；`train-exam-api` 的 `OSS_*` 环境变量仍保留为默认值/兜底配置。OSS 桶需允许浏览器 `PUT` 上传，并放行 `Content-Type`、`ETag` 等必要头。

### 2.4 历史兼容资产说明
`ticketing` / `web-ticketing` 和 `sec-impl` 目录仍作为历史兼容资产保留，用于数据核对、迁移和回溯；现役门户入口、README 和高层设计统一按 11 个现役系统统计。

如需运行历史资产，应单独查阅对应目录 README，并确认不会与现役交付系统的端口、数据迁移任务和权限口径冲突。

## 3. 服务入口与端口

| 系统 | 地址 |
|---|---|
| 统一登录 | `http://localhost:5180` |
| 统一大屏展示中心 | `http://localhost:18092` |
| 统一大屏后端 | `http://localhost:5192` |
| 提醒前端 | `http://localhost:18080` |
| 提醒后端 | `http://localhost:5179` |
| 交付系统前端 | `http://localhost:18084` |
| 交付系统后端 | `http://localhost:5185` |
| 库存前端 | `http://localhost:18082` |
| 库存后端 | `http://localhost:5183` |
| 设备流转前端 | `http://localhost:18083` |
| 设备流转后端 | `http://localhost:5184` |
| FAQ 前端 | `http://localhost:18085` |
| FAQ 后端 | `http://localhost:5186` |
| 标书前端 | `http://localhost:18086` |
| 标书后端 | `http://localhost:5187` |
| 培训考试前端 | `http://localhost:18087` |
| 培训考试后端 | `http://localhost:5188` |
| 提示词中心前端 | `http://localhost:18088` |
| 提示词中心后端 | `http://localhost:5189` |
| 软件成分分析前端 | `http://localhost:18089` |
| 软件成分分析后端 | `http://localhost:5191` |
| CMDB 前端 | `http://localhost:8090` |
| MySQL（宿主机映射） | `localhost:3308` |
| SCA PostgreSQL（宿主机映射） | `localhost:5433` |

## 4. 默认账号与权限

内置账号（由 `auth` 管理）：
- `admin`
- `editor`
- `reviewer`
- `sysadmin`
- `auditor`

默认密码由环境变量控制：
- `BUILTIN_ACCOUNT_DEFAULT_PASSWORD`

建议首次登录立即修改密码。
统一登录会话采用浏览器会话 Cookie，关闭浏览器后需重新登录。

权限原则：
- `admin`：业务管理与写操作主角色
- `editor`：标书系统编辑角色 + FAQ/培训考试写入角色
- `reviewer`：FAQ/培训考试审核角色
- `sysadmin`：系统管理与配置主角色
- `auditor`：审计与只读校验主角色
- 各系统可通过 `app_access` 做精细化入口控制

## 5. 本地开发

### 5.1 提醒系统（根目录）
```bash
cd /Users/zhanglei/Documents/codex-new
npm install
npm run dev
```

### 5.2 其它前后端（示例）
```bash
# 交付系统后端
cd /Users/zhanglei/Documents/codex-new/delivery/backend
npm install
npm run dev

# 交付系统前端
cd /Users/zhanglei/Documents/codex-new/delivery/frontend
npm install
npm run dev

# FAQ 后端
cd /Users/zhanglei/Documents/codex-new/faq/backend
npm install
npm run dev

# FAQ 前端
cd /Users/zhanglei/Documents/codex-new/faq/frontend
npm install
npm run dev

# 培训考试后端
cd /Users/zhanglei/Documents/codex-new/train-exam/backend
npm install
npm run dev

# 培训考试前端
cd /Users/zhanglei/Documents/codex-new/train-exam/frontend
npm install
npm run dev

# CMDB 后端
cd /Users/zhanglei/Documents/codex-new/cmdb
go run ./cmd/cmdb
```

## 6. 测试与验收

### 6.1 快速健康检查
```bash
curl -sS http://localhost:5179/api/health
curl -sS http://localhost:5179/api/ready
curl -sS http://localhost:5179/api/version
curl -sS http://localhost:5179/api/build
curl -sS http://localhost:5179/api/metrics
curl -sS http://localhost:5185/api/health
curl -sS http://localhost:5183/api/health
curl -sS http://localhost:5184/api/health
curl -sS http://localhost:5186/api/health
curl -sS http://localhost:5187/api/health
curl -sS http://localhost:5188/api/health
curl -sS http://localhost:5189/api/health
curl -sS http://localhost:5191/api/health
curl -sS http://localhost:5192/api/health

# CMDB 后端未直接映射宿主机端口，可从容器内检查
docker compose exec cmdb wget -qO- http://127.0.0.1:8088/api/health
```

所有 11 个现役业务后端都统一暴露 `/api/metrics`，并在响应头返回 `X-Request-Id`。服务侧访问日志输出结构化 JSON，包含 `request_id`、请求路径、状态码和 `duration_ms`。

### 6.2 设备流转自动化脚本
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/scripts
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5184 ./smoke-e2e.sh
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5184 ./regression-api.sh
./rbac-matrix.sh
```

### 6.3 交付系统自动化（Vitest）
```bash
cd /Users/zhanglei/Documents/codex-new/delivery/backend
npm run test:smoke
npm run test:regression
npm run test:rbac
```

### 6.4 全系统测试用例文档
- `/Users/zhanglei/Documents/codex-new/docs/testcases/auth-sso-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/reminder-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/ticketing-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/inventory-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/device-flow-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/sec-impl-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/faq-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/train-exam-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/cmdb-test-cases.md`
- `/Users/zhanglei/Documents/codex-new/docs/testcases/test-run-2026-02-20.md`

### 6.5 全系统用户使用手册
- `/Users/zhanglei/Documents/codex-new/docs/manuals/README.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/auth-sso-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/reminder-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/ticketing-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/inventory-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/device-flow-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/sec-impl-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/faq-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/train-exam-user-manual.md`
- `/Users/zhanglei/Documents/codex-new/docs/manuals/cmdb-user-manual.md`

## 7. 关键环境变量（建议）

公共建议：
- `AUTH_JWT_SECRET`：统一 JWT 密钥
- `AUTH_CONFIG_SECRET_KEY` / `TENDER_CONFIG_SECRET_KEY`：敏感配置加密密钥
- `AUTH_AUDIT_SIGNING_KEY` / `DELIVERY_AUDIT_SIGNING_KEY` / `DEVICE_FLOW_AUDIT_SIGNING_KEY` / `TENDER_AUDIT_SIGNING_KEY` / `TRAIN_EXAM_AUDIT_SIGNING_KEY`：审计签名密钥
- `CORS_ORIGINS`：允许来源白名单
- `AUTH_COOKIE_NAME`：统一会话 Cookie 名称
- `SHIPPING_GATEWAY_TOKEN`：库存系统调用物流网关的共享调用令牌

系统关键项：
- Reminder：`MYSQL_USER=reminder_user`、`MYSQL_DATABASE=juxin_reminder`、`REMINDER_MYSQL_PASSWORD`
- Delivery：`AUTH_SYSTEM_KEY=delivery`、`MYSQL_USER=delivery_user`、`MYSQL_DATABASE=juxin_delivery`、`DELIVERY_MYSQL_PASSWORD`
- Inventory：`AUTH_SYSTEM_KEY=inventory`、`MYSQL_USER=inventory_user`、`MYSQL_DATABASE=juxin_inventory`、`INVENTORY_MYSQL_PASSWORD`
- Device Flow：`AUTH_SYSTEM_KEY=device-flow`、`MYSQL_USER=device_flow_user`、`MYSQL_DATABASE=juxin_device_flow`、`DEVICE_FLOW_MYSQL_PASSWORD`
- FAQ：`AUTH_SYSTEM_KEY=faq`、`MYSQL_USER=faq_user`、`MYSQL_DATABASE=juxin_faq`、`FAQ_MYSQL_PASSWORD`
- Tender：`AUTH_SYSTEM_KEY=tender`、`MYSQL_USER=tender_user`、`MYSQL_DATABASE=juxin_tender`、`TENDER_MYSQL_PASSWORD`
- Train-Exam：`AUTH_SYSTEM_KEY=train-exam`、`MYSQL_USER=train_exam_user`、`MYSQL_DATABASE=juxin_train_exam`、`TRAIN_EXAM_MYSQL_PASSWORD`
- Prompt Center：`AUTH_SYSTEM_KEY=prompt-center`、`MYSQL_USER=prompt_center_user`、`MYSQL_DATABASE=juxin_prompt_center`、`PROMPT_CENTER_MYSQL_PASSWORD`
- Big Screen：`AUTH_SYSTEM_KEY=big-screen`、`MYSQL_USER=big_screen_user`、`MYSQL_DATABASE=juxin_big_screen`、`BIG_SCREEN_MYSQL_PASSWORD`
- CMDB：`AUTH_SYSTEM_KEY=cmdb`、`MYSQL_DSN=.../cmdb`

## 8. 安全基线

- OWASP Top 10:2025 作为平台安全控制口径，高层设计中维护 A01-A10 的控制映射。
- 会话依赖 `HttpOnly` Cookie + Token introspect
- 登录 Cookie 不设置持久化过期时间（关闭浏览器后失效）
- 关键写操作与权限判断走统一授权服务
- 审计日志链式签名（防篡改）
- 审计界面统一显示中文“变更摘要”（不直接展示原始 JSON）
- 业务接口默认启用输入校验与分页限制
- 上传接口限制 MIME、大小与行数（批量导入）
- 生产配置不在 Compose 中内置固定示例密钥、弱默认密码或共享数据库口令。
- 现役业务 Schema 使用独立运行账号，初始化权限和运行权限分离。
- 现役业务后端统一暴露 `/api/health`、`/api/ready`、`/api/version`、`/api/build`、`/api/metrics`。
- 现役业务后端统一贯穿 `X-Request-Id`，结构化访问日志包含 `request_id` 和 `duration_ms`。

## 9. 目录结构

```text
/Users/zhanglei/Documents/codex-new
├── auth/                  # 统一登录
├── server/                # 提醒系统后端
├── web/                   # 提醒系统前端
├── ticketing/             # 历史兼容资产：工单系统
├── inventory-system/      # 库存系统 + 物流网关
├── device-flow/           # 设备流转系统
├── delivery/              # 交付系统
├── sec-impl/              # 历史兼容资产：实施记录系统
├── faq/                   # FAQ 系统（Node + OnlyOffice + Web）
├── tender/                # 标书系统（Node + OnlyOffice + OCR + AI）
├── train-exam/            # 培训考试系统（Node + Web）
├── prompt-center/         # 提示词管理中心（Node + Web）
├── sca-platform/          # 软件成分分析平台（FastAPI + Vue3）
├── big-screen-center/     # 统一大屏展示中心（Express + Vue3）
├── cmdb/                  # CMDB（Go + Web）
├── docs/                  # 发布、测试、设计文档
└── docker-compose.yml     # 统一编排
```

## 10. 发布与变更文档

- `/Users/zhanglei/Documents/codex-new/docs/versioning.md`
- `/Users/zhanglei/Documents/codex-new/docs/releases/2.0.1.md`
- `/Users/zhanglei/Documents/codex-new/docs/releases/2.0.1-rc1-regression-checklist.md`
- `/Users/zhanglei/Documents/codex-new/docs/releases/2.1.0-rc1.md`
- `/Users/zhanglei/Documents/codex-new/docs/releases/device-flow-v1-checklist.md`
- `/Users/zhanglei/Documents/codex-new/docs/releases/sec-impl-v1-checklist.md`

## 11. 常见问题

### Q1：登录成功但看不到某系统入口？
检查该用户 `app_access` 是否包含对应系统键（如 `delivery`、`inventory`、`device-flow`、`faq`、`tender`、`train-exam`、`prompt-center`、`sca`、`big-screen`、`cmdb`）。

### Q2：跨域报错（CORS）？
在 `docker-compose.yml` 的对应服务里补齐 `CORS_ORIGINS`，包含访问页面的实际域名与端口。

### Q3：文件上传失败？
确认 MIME 类型、文件大小、导入行数是否超过系统限制。

### Q4：怎么只回滚单个系统数据？
各系统独立库，按 schema 回滚即可，不影响其它系统。

---

如需新增系统或做生产化（K8s、灰度、集中观测），建议先补齐：
- 环境分层（dev/stage/prod）
- 统一密钥管理
- CI/CD 与自动回归流水线
