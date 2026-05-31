# 聚信软件成分分析平台

当前版本已完成第一到第六阶段：基础项目初始化、源码上传、依赖识别、漏洞查询、报告导出、SBOM 与容器镜像扫描。技术栈保持 FastAPI + Vue3 + Element Plus + PostgreSQL + Redis + Celery + Docker Compose，并复用聚信统一登录平台。

## 1. 项目总体架构

```text
浏览器
  -> web-sca:80 / Vue3 + Element Plus
  -> sca-api:5191 / FastAPI Swagger
  -> sca-postgres:5432 / PostgreSQL
  -> sca-redis:6379 / Redis
  -> sca-worker / Celery
  -> OSV / NVD / GitHub Advisory
  -> Syft / Trivy / Grype CLI
  -> auth:5180 / 聚信统一登录平台
```

平台以源码包和镜像为输入，沉淀项目、上传文件、组件、漏洞、报告、SBOM、镜像扫描记录，所有运行路径均由 Docker Compose 承载。

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
│   │   ├── report_service.py
│   │   ├── schemas.py
│   │   ├── sbom_service.py
│   │   ├── upload_service.py
│   │   └── vulnerability_service.py
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
- `sca-report-data`：报告文件持久化卷
- `sca-sbom-data`：SBOM、镜像 tar 持久化卷

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

## 9. 第四阶段：漏洞查询模块

### 漏洞查询逻辑

后端服务位于 `backend/app/vulnerability_service.py`，按组件名称、版本和生态进行查询：

- OSV：调用 `POST /v1/query`，归一化 CVE、CVSS、修复版本、发布时间、POC、在野利用标记
- NVD：调用 CVE 2.0 API，支持 `keywordSearch` 与独立 CVE 查询
- GitHub Advisory：配置 `GITHUB_TOKEN` 后调用 GitHub Advisory API；未配置时自动跳过，不影响 OSV/NVD
- CVSS：支持 CVSS v3 向量转基础分，并映射 `critical/high/medium/low/unknown`

### 数据库设计

初始化 SQL 位于 `database/init/001_init_sca.sql`，新增：

- `vulnerabilities`：CVE 编号、CVSS、描述、修复版本、发布时间、等级、POC、在野利用
- `vulnerability_queries`：漏洞源查询审计日志

### FastAPI 接口

- `POST /api/sca/projects/{project_id}/vulnerabilities/query`：按项目组件查询并入库
- `GET /api/sca/projects/{project_id}/vulnerabilities`：漏洞列表
- `GET /api/sca/projects/{project_id}/vulnerabilities/stats`：漏洞统计
- `GET /api/sca/projects/{project_id}/vulnerabilities/trend`：漏洞趋势图数据
- `POST /api/sca/vulnerabilities/cve`：按 CVE 查询详情

### Vue3 页面

前端菜单“漏洞查询”提供项目选择、漏洞查询、漏洞列表、等级标签、POC/在野利用标记、统计卡片和趋势条形图。

## 10. 第五阶段：报告导出模块

### Word / PDF / Excel 模板

模板生成逻辑位于 `backend/app/report_service.py`，输出中文安全分析报告：

- Word：`docx`，包含中文标题、企业 Logo 文本位、项目概况、统计和整改建议
- PDF：`pdf`，包含中文报告数据载荷，可用于归档与下载
- Excel：`xlsx`，包含项目统计、漏洞清单、高危漏洞和修复版本

### 报告内容

- 项目概况、扫描时间、组件统计
- 漏洞统计图、风险等级统计、高危漏洞
- 修复建议、风险趋势、等保整改建议

### API 接口

- `POST /api/sca/projects/{project_id}/reports`：生成报告，参数 `format=docx|pdf|xlsx`
- `GET /api/sca/projects/{project_id}/reports`：报告列表
- `GET /api/sca/reports/{report_id}/download`：下载报告

### Vue3 页面

前端菜单“报告导出”支持选择项目、选择报告格式、生成和下载。

## 11. 第六阶段：SBOM 与容器镜像扫描

### Syft / Trivy / Grype 集成代码

集成逻辑位于 `backend/app/sbom_service.py`：

- SBOM 生成：根据数据库组件生成 CycloneDX 或 SPDX JSON，Docker 已预留 `TOOL_SYFT_PATH`
- 镜像扫描：调用 `trivy image --format json` 或 `grype -o json`
- 工具缺失：返回 `tool_missing`，页面可见，不会导致 API 崩溃
- 镜像 tar：上传到 `/data/sca/sbom/images` 后交给扫描器分析

### SBOM 数据结构

- `sbom_documents`：SBOM 文件、格式、组件数量、来源
- `image_scans`：镜像引用、扫描器、状态、风险评分、摘要
- `image_scan_findings`：镜像漏洞、等级、修复版本、描述

### Docker 镜像扫描流程

1. 页面输入镜像名或上传镜像 tar
2. 后端创建 `image_scans` 记录
3. 调用 Trivy 或 Grype
4. 解析 JSON，写入 `image_scan_findings`
5. 按严重等级计算镜像风险评分

### API 接口

- `POST /api/sca/projects/{project_id}/sbom`：生成 CycloneDX / SPDX
- `GET /api/sca/projects/{project_id}/sbom`：SBOM 列表
- `GET /api/sca/sbom/{sbom_id}/download`：下载 SBOM
- `POST /api/sca/image-scans`：扫描 Docker 镜像
- `POST /api/sca/image-scans/tar`：上传镜像 tar 并扫描
- `GET /api/sca/image-scans`：镜像扫描列表
- `GET /api/sca/image-scans/{scan_id}/findings`：镜像漏洞明细

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

## 12. 启动方法

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

## 13. 测试方法

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
  -e CELERY_TASK_ALWAYS_EAGER=true \
  -v "$PWD/backend/tests:/app/tests:ro" \
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests
```

前端 Docker 构建验证：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
docker compose build web-sca
```

## 14. 如何验证上传、漏洞、报告和 SBOM 成功

1. 前端访问 `http://localhost:18089`
2. 进入“源码上传”
3. 填写项目名称和扫描备注
4. 选择 `.zip`、`.tar.gz` 或 `.tgz`
5. 点击“上传并扫描”
6. 上传进度到 `100%`
7. 文件列表中状态从 `completed/scanning` 变为 `scanned`
8. 进入“依赖识别”，能看到依赖列表和依赖树
9. 进入“漏洞查询”，点击“查询漏洞”，能看到漏洞列表、统计和趋势
10. 进入“报告导出”，生成并下载 Word / PDF / Excel 报告
11. 进入“SBOM/镜像扫描”，生成 CycloneDX / SPDX，或输入镜像名进行扫描
12. 进入“扫描日志”，能看到解析日志和识别数量

## 15. 常见报错解决方案

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

### 漏洞查询没有 GitHub Advisory 数据

GitHub Advisory 需要配置：

```bash
GITHUB_TOKEN=your_github_token
```

未配置时系统仍会查询 OSV 和 NVD。

### NVD 请求限流

配置 NVD API Key：

```bash
NVD_API_KEY=your_nvd_api_key
```

### 镜像扫描返回 tool_missing

当前镜像内未安装对应 CLI。可在运行环境中安装或挂载 Syft / Trivy / Grype，并设置：

```bash
TOOL_SYFT_PATH=syft
TOOL_TRIVY_PATH=trivy
TOOL_GRYPE_PATH=grype
```

### 报告或 SBOM 下载 404

确认 Docker volume 未被删除，并检查：

```bash
docker compose logs sca-api
docker compose exec sca-api ls -lah /data/sca/reports /data/sca/sbom
```

### 扫描失败

查看扫描日志：

```bash
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/<project_id>/scan-logs
docker compose logs sca-worker
```
