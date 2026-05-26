# 聚信软件成分分析平台

第一阶段基础项目初始化，目标是先跑通 FastAPI + Vue3 + Element Plus + PostgreSQL + Redis + Celery + Docker Compose，并复用聚信统一登录平台。

## 1. 项目总体架构

```text
浏览器
  -> web-sca:80 / Vue3 + Element Plus
  -> sca-api:5191 / FastAPI Swagger
  -> sca-postgres:5432 / PostgreSQL
  -> sca-redis:6379 / Redis
  -> sca-worker / Celery
  -> auth:5180 / 聚信统一登录平台
```

第一阶段只提供平台总览、登录态承接、健康检查、Swagger 文档和任务队列示例，不提前开发完整 SCA 扫描能力。

## 2. 目录结构

```text
sca-platform
├── .env
├── .env.example
├── README.md
├── docker-compose.yml
├── backend
│   ├── Dockerfile
│   ├── app
│   │   ├── auth.py
│   │   ├── celery_app.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models.py
│   │   └── schemas.py
│   ├── pytest.ini
│   ├── requirements.txt
│   └── tests
│       └── test_api.py
├── database
│   └── init
│       └── 001_init_sca.sql
├── frontend
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx.conf
│   ├── package.json
│   ├── src
│   │   ├── App.vue
│   │   ├── api.js
│   │   ├── main.js
│   │   └── styles.css
│   └── vite.config.js
└── scripts
    ├── start-linux.sh
    ├── start-windows.ps1
    ├── test-linux.sh
    └── test-windows.ps1
```

## 3. Docker Compose

项目内 compose 包含：

- `sca-postgres`：PostgreSQL 16，初始化 SQL 挂载到 `/docker-entrypoint-initdb.d`
- `sca-redis`：Redis 7，供缓存和 Celery 使用
- `sca-api`：FastAPI，端口 `5191`
- `sca-worker`：Celery worker
- `web-sca`：Nginx 托管 Vue3 静态文件，端口 `18089`

仓库根目录 `docker-compose.yml` 也已接入同一组服务，并将统一登录入口加入 `auth`。

## 4. PostgreSQL 配置

默认配置位于 `.env`：

```bash
POSTGRES_DB=juxin_sca
POSTGRES_USER=sca_user
POSTGRES_PASSWORD=change_me_sca_postgres_password
DATABASE_URL=postgresql+psycopg://sca_user:change_me_sca_postgres_password@sca-postgres:5432/juxin_sca
```

初始化 SQL：`database/init/001_init_sca.sql`。

## 5. Redis 配置

```bash
REDIS_URL=redis://sca-redis:6379/0
CELERY_BROKER_URL=redis://sca-redis:6379/1
CELERY_RESULT_BACKEND=redis://sca-redis:6379/2
```

## 6. Swagger API

启动后访问：

- Swagger：`http://localhost:5191/docs`
- OpenAPI JSON：`http://localhost:5191/openapi.json`
- 健康检查：`http://localhost:5191/health`
- 就绪检查：`http://localhost:5191/ready`

## 7. 启动方法

Linux/macOS：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
cp .env.example .env
./scripts/start-linux.sh
```

Windows PowerShell：

```powershell
cd C:\path\to\codex-new\sca-platform
Copy-Item .env.example .env
.\scripts\start-windows.ps1
```

接入聚信统一登录的完整启动：

```bash
cd /Users/zhanglei/Documents/codex-new
cp .env.example .env
./scripts/deploy/docker-compose-aliyun.sh rebuild mysql auth sca-postgres sca-redis sca-api sca-worker web-sca
```

访问地址：

- 前端：`http://localhost:18089`
- 后端：`http://localhost:5191`
- 统一登录：`http://localhost:5180`

## 8. 测试方法

Linux/macOS：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
./scripts/test-linux.sh
```

Windows PowerShell：

```powershell
cd C:\path\to\codex-new\sca-platform
.\scripts\test-windows.ps1
```

也可以分开执行：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
docker compose build sca-api web-sca
docker compose run --rm --no-deps \
  -e PYTHONPATH=/app \
  -e DATABASE_URL=sqlite:////tmp/sca-test.db \
  -e AUTH_DEV_BYPASS=true \
  -v "$PWD/backend/tests:/app/tests:ro" \
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests
```

## 9. 常见报错解决方案

### 端口被占用

修改 `.env` 中 `API_PORT`、`WEB_PORT`，或停止占用 `5191/18089/5433/6380` 的进程。

### 前端跳转登录后看不到系统入口

确认统一登录用户的 `app_access` 包含 `sca`。管理员默认可见，业务管理员默认包含 `sca`。

### PostgreSQL 初始化数据没有变化

PostgreSQL 只在数据卷首次创建时执行初始化 SQL。需要重置时执行：

```bash
docker compose down -v
docker compose up -d --build
```

### Redis 或 Celery 连接失败

先检查容器状态：

```bash
docker compose ps
docker compose logs sca-redis sca-worker
```

### 统一登录平台不可用

项目内独立 compose 默认 `AUTH_DEV_BYPASS=true`，用于本地骨架验证。根目录 compose 使用真实统一登录，需先启动 `auth` 服务。
