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
│   │   ├── dependency_parser.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   └── upload_service.py
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

## 7. 第二阶段：源码上传模块

### 数据库 SQL

初始化 SQL 位于 `database/init/001_init_sca.sql`，核心表：

- `projects`：项目名称、扫描备注、状态、负责人
- `upload_files`：上传文件记录、断点续传 `upload_id`、大小、路径、状态
- `upload_logs`：上传会话、分片、完成与删除日志

### FastAPI 上传接口

- `POST /api/sca/uploads`：普通上传，表单字段 `project_name`、`scan_note`、`file`
- `POST /api/sca/uploads/sessions`：创建断点续传会话
- `PUT /api/sca/uploads/{upload_id}/chunks/{chunk_index}`：上传分片
- `POST /api/sca/uploads/{upload_id}/complete`：合并分片并进入扫描
- `GET /api/sca/uploads`：文件列表
- `DELETE /api/sca/uploads/{upload_file_id}`：删除上传文件和本地文件

文件保存目录为 `/data/sca/uploads`，由 Docker volume `sca-upload-data` 持久化。大小限制由 `UPLOAD_MAX_BYTES` 控制，默认 `209715200`（200 MB）。

### Vue3 上传页面

前端菜单“源码上传”提供：

- 项目名称
- 扫描备注
- zip / tar.gz / tgz 文件选择
- 普通上传 / 断点续传切换
- 上传进度条
- 上传文件列表和删除操作

## 8. 第三阶段：依赖识别模块

### 依赖解析逻辑

解析器位于 `backend/app/dependency_parser.py`，支持：

- `pom.xml`：解析 Maven `groupId:artifactId` 与 `version`
- `package.json`：解析 npm `dependencies`、`devDependencies`、`peerDependencies`、`optionalDependencies`
- `requirements.txt`：解析 PyPI 包名和版本约束
- `go.mod`：解析 Go `require`
- `Dockerfile`：解析 `FROM image:tag`

### FastAPI 接口

- `GET /api/sca/projects`：项目列表
- `GET /api/sca/projects/{project_id}/components`：依赖列表
- `GET /api/sca/projects/{project_id}/dependency-tree`：依赖树
- `GET /api/sca/projects/{project_id}/scan-tasks`：扫描任务
- `GET /api/sca/projects/{project_id}/scan-logs`：扫描日志

### Celery 任务

上传完成后自动创建 `scan_tasks` 记录，并投递 `sca.scan_uploaded_file`：

1. 安全解压源码包，阻止路径穿越
2. 查找支持的依赖文件
3. 写入 `components`
4. 写入 `component_dependencies`
5. 写入 `scan_logs`
6. 更新上传状态为 `scanned` 或 `failed`

### 示例数据

容器内验证示例：

```bash
docker compose exec -T sca-api sh -lc 'python - << "PY"
from pathlib import Path
import zipfile
p = Path("/tmp/sca-demo.zip")
with zipfile.ZipFile(p, "w") as z:
    z.writestr("requirements.txt", "fastapi==0.115.6\n")
    z.writestr("package.json", "{\"dependencies\":{\"vue\":\"^3.5.13\"}}")
print(p)
PY
curl -sS -F project_name=docker-demo -F scan_note=container-upload-check -F file=@/tmp/sca-demo.zip http://localhost:5191/api/sca/uploads'
```

验证依赖：

```bash
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/1/components
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/1/dependency-tree
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/1/scan-logs
```

## 9. 启动方法

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

## 10. 测试方法

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

## 11. 如何验证上传成功

1. 前端访问 `http://localhost:18089`
2. 进入“源码上传”
3. 填写项目名称和扫描备注
4. 选择 `.zip`、`.tar.gz` 或 `.tgz`
5. 点击“上传并扫描”
6. 上传进度到 `100%`
7. 文件列表中状态从 `completed/scanning` 变为 `scanned`
8. 进入“依赖识别”，能看到依赖列表和依赖树
9. 进入“扫描日志”，能看到解析日志和识别数量

## 12. 常见报错解决方案

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

### 上传文件过大

调整 `.env` 中：

```bash
UPLOAD_MAX_BYTES=209715200
```

根目录 compose 对应变量为：

```bash
SCA_UPLOAD_MAX_BYTES=209715200
```

### 只支持指定压缩格式

源码包必须是 `.zip`、`.tar.gz` 或 `.tgz`。其它格式会返回 `400`。

### 断点续传合并失败

确认所有分片都已上传，且 `total_size` 与最终合并大小一致。失败后可重新创建上传会话。

### 扫描失败

查看扫描日志：

```bash
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/<project_id>/scan-logs
docker compose logs sca-worker
```
