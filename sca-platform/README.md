# 九章软件开源组件分析系统 V2.0

当前版本已完成第一到第十二阶段：基础项目初始化、源码上传、依赖识别、漏洞查询、报告导出、SBOM 与容器镜像扫描、持续风险监测、AI 漏洞降噪、软件资产中心、漏洞整改闭环、DevSecOps 集成、最终部署与生产优化。技术栈保持 FastAPI + Vue3 + Element Plus + PostgreSQL + Redis + Celery + Docker Compose；系统可独立部署，身份认证与权限校验复用统一登录平台。

## 生产部署安全清单

- 将 `.env` 中 `POSTGRES_PASSWORD` 替换为至少 16 位随机强密码；Compose 对缺失密码直接拒绝启动。
- 配置 `SCA_WEBHOOK_SECRET`，或分别配置 GitHub、GitLab、Jenkins 密钥，并在网关限制 CI 来源网段。
- 按容量设置上传、分片和解压限制，监控 `/data/sca`、扫描结果和 Trivy 缓存磁盘占用。
- 通过反向代理启用 HTTPS，保留 300 秒以上扫描接口超时，并设置磁盘、数据库、Redis 和 worker 告警。
- 定期执行 `scripts/test-linux.sh`，覆盖前后端测试、构建、`npm audit` 和 `pip-audit`。
- 定期演练 PostgreSQL、上传文件、报告和 SBOM 的备份恢复，并按计划升级已固定版本的扫描器镜像。

## 1. 项目总体架构

```text
浏览器
  -> web-sca:80 / Vue3 + Element Plus
  -> sca-api:5191 / FastAPI Swagger
  -> sca-postgres:5432 / PostgreSQL
  -> sca-redis:6379 / Redis
  -> sca-worker / Celery
  -> sca-beat / Celery Beat
  -> OSV / NVD / GitHub Advisory
  -> Maven Central / npm / PyPI / Go Proxy / GitHub Releases
  -> OpenAI Chat Completions JSON Schema
  -> Syft / Trivy / Grype CLI
  -> GitLab / GitHub Actions / Jenkins Webhook
  -> Nginx HTTPS Reverse Proxy
  -> auth:5180 / 统一身份认证（SCA 专属入口：/sca-login）
```

平台以源码包和镜像为输入，沉淀项目、上传文件、组件、漏洞、报告、SBOM、镜像扫描、持续监测、AI 降噪、软件资产、整改工单、CI/CD 阻断事件与生产运维记录，所有运行路径均由 Docker Compose 承载。

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
│   │   ├── ai_triage_service.py
│   │   ├── asset_service.py
│   │   ├── celery_app.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── dependency_parser.py
│   │   ├── devops_service.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── ops_service.py
│   │   ├── report_service.py
│   │   ├── remediation_service.py
│   │   ├── risk_monitor_service.py
│   │   ├── schemas.py
│   │   ├── sbom_service.py
│   │   ├── upload_service.py
│   │   └── vulnerability_service.py
│   ├── pytest.ini
│   ├── requirements.txt
│   └── tests
│       ├── test_api.py
│       ├── test_ai_triage_assets.py
│       ├── test_remediation_devops_ops.py
│       └── test_risk_monitor.py
├── database
│   └── init
│       └── 001_init_sca.sql
├── deploy
│   ├── backup.sh
│   └── nginx
│       └── sca-platform.conf
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
- `sca-beat`：Celery Beat，定时触发持续风险监测
- `web-sca`：Nginx 托管 Vue3 静态文件，端口 `18089`
- `sca-report-data`：报告文件持久化卷
- `sca-sbom-data`：SBOM、镜像 tar 持久化卷
- `sca-backup-data`：生产备份文件持久化卷

仓库根目录 `docker-compose.yml` 也已接入同一组服务；独立启动本目录时，SCA 通过 `AUTH_SERVICE_URL` 连接已有统一登录服务，用户和会话不在 SCA 内重复维护。

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

文件保存目录为 `/data/sca/uploads`，由 Docker volume `sca-upload-data` 持久化。平台不设置应用层上传大小上限；实际可上传大小取决于 Docker volume/磁盘空间、反向代理、网关和网络超时。生产 Nginx 模板已配置 `client_max_body_size 0`。

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
- `package.json` / `package-lock.json`：解析 npm `dependencies`、`devDependencies`、`peerDependencies`、`optionalDependencies`，存在 lock 文件时优先使用实际安装版本
- `requirements.txt`：解析 PyPI 包名和版本约束
- `go.mod`：解析 Go `require`
- `Dockerfile`：解析 `FROM image:tag`

### 准确率与证据链增强

组件记录新增标准化字段和证据字段，兼容已有 `package_name/package_version/ecosystem/scope`：

- 标准字段：`normalized_name`、`package_manager`、`purl`、`cpe`、`group_id`、`artifact_id`、`version_normalized`、`dependency_type`
- 证据字段：`evidence_file`、`evidence_line`、`evidence_text`、`detected_by`、`evidence_level`、`confidence_score`
- 冲突字段：`version_conflict`、`conflict_reason`

当前策略：

- Maven 尽量生成 `pkg:maven/group/artifact@version`
- npm 保留 scope，例如 `@vue/runtime-core`，并生成 PURL
- PyPI 按 PEP 503 风格统一大小写、下划线、点和中划线
- Go module 保留完整 module path
- Dockerfile 基础镜像标记为 `dependency_type=base_image`
- manifest 负责直接依赖证据，lock 文件负责实际安装版本；两者不一致时前端展示“版本来源不一致”

前端“依赖识别”表格可展开每个组件查看证据链、PURL、置信度和版本冲突原因。

### FastAPI 接口

- `GET /api/sca/projects`：项目列表
- `GET /api/sca/projects/{project_id}/components`：依赖列表
- `GET /api/sca/projects/{project_id}/dependency-tree`：依赖树
- `GET /api/sca/projects/{project_id}/scan-tasks`：扫描任务
- `GET /api/sca/projects/{project_id}/scan-logs`：扫描日志

## 9. 第四阶段：漏洞查询模块

### 漏洞查询逻辑

后端服务位于 `backend/app/vulnerability_service.py`，按 PURL、CPE、生态、包名、版本范围和漏洞源进行综合匹配，禁止只靠组件名称直接判定 CVE：

- OSV：调用 `POST /v1/query`，优先使用 PURL 和 ecosystem/name，再用 affected ranges 判断当前版本是否受影响
- NVD：调用 CVE 2.0 API，支持独立 CVE 查询；`keywordSearch` 结果默认标记为待人工确认，避免名称模糊误报
- GitHub Advisory：配置 `GITHUB_TOKEN` 后调用 GitHub Advisory API；结合 patched_versions 判断影响范围
- CVSS：支持 CVSS v3 向量转基础分，并映射 `critical/high/medium/low/unknown`
- 版本范围：`backend/app/version_compare.py` 统一处理 semver、Maven、PEP440、Go pseudo version、Docker tag 和不规则版本号；无法判断时标记 `match_status=unknown`

### 漏洞可信度与风险优先级

每条漏洞新增：

- 匹配字段：`confidence_score`、`match_status`、`matched_by`、`match_reason`、`version_range`、`needs_human_review`
- 风险字段：`risk_priority`、`risk_score`、`priority_reason`、`suggested_deadline`、`remediation_type`、`business_impact`、`false_positive_possibility`
- 情报字段：`epss_score`、`cisa_kev`

评分策略：

- PURL/CPE 精确匹配且版本范围命中：高可信
- `ecosystem + name + version range` 命中：中高可信
- 名称匹配但无版本范围：低可信，进入待人工确认
- 无法判断版本范围：`match_status=unknown`，不进入高危统计和 DevSecOps 阻断
- 风险优先级综合 CVSS、CISA KEV、POC、在野利用、运行时/开发测试依赖、安全版本和 RCE/认证/权限/数据泄露关键词，不只按 CVSS 排序

### 轻量级可达性分析

服务位于 `backend/app/reachability_service.py`，漏洞查询入库时会基于最新上传源码的解压目录执行轻量静态分析：

- Java：识别 `import`、Spring `Controller`、`Service`、`Mapper`、`GetMapping/PostMapping/RequestMapping`
- Python：识别 `import`、`from xxx import xxx`、FastAPI / Flask / Django 路由
- Node.js：识别 `require`、`import`、Express / NestJS / Vue / React 入口

输出字段：

- `reachability_status`：`reachable / possibly_reachable / not_found / unknown`
- `reachability_evidence`
- `entry_points`
- `related_files`
- `call_path_summary`

如果漏洞组件没有任何 import 或调用证据，但项目存在入口点，会标记为“未发现调用证据”。前端漏洞列表可展开查看判断原因、入口点、相关文件和调用证据。

### 数据库设计

初始化 SQL 位于 `database/init/001_init_sca.sql`，新增：

- `vulnerabilities`：CVE 编号、CVSS、可信度、匹配状态、风险优先级、可达性证据、修复期限、业务影响、描述、修复版本、发布时间、POC、在野利用
- `vulnerability_queries`：漏洞源查询审计日志

### FastAPI 接口

- `POST /api/sca/projects/{project_id}/vulnerabilities/query`：按项目组件查询并入库
- `GET /api/sca/projects/{project_id}/vulnerabilities`：漏洞列表
- `GET /api/sca/projects/{project_id}/vulnerabilities/stats`：漏洞统计
- `GET /api/sca/projects/{project_id}/vulnerabilities/trend`：漏洞趋势图数据
- `POST /api/sca/vulnerabilities/cve`：按 CVE 查询详情

### Vue3 页面

前端菜单“漏洞查询”提供项目选择、漏洞查询、漏洞列表、等级标签、优先级、风险分、可信度、匹配状态、POC/在野利用标记、统计卡片和趋势条形图，并支持筛选高可信、中可信、低可信、待确认和疑似误报漏洞。

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

## 12. 第七阶段：持续风险监测

### GitHub API 调用

服务位于 `backend/app/risk_monitor_service.py`，GitHub Release 使用：

```text
GET {GITHUB_API_URL}/repos/{owner}/{repo}/releases/latest
Authorization: Bearer {GITHUB_TOKEN}
```

### Maven / PyPI / npm / Go 查询逻辑

- Maven：`MAVEN_SEARCH_URL?q=g:"groupId" AND a:"artifactId"&rows=1&wt=json`
- npm：`{NPM_REGISTRY_URL}/{package}`，读取 `dist-tags.latest`
- PyPI：`{PYPI_API_URL}/{package}/json`，读取 `info.version`
- Go：`{GO_PROXY_URL}/{module}/@latest`，读取 `Version`

### 版本比较算法

`compare_versions()` 支持 `v1.2.3`、预发布后缀、主/次/补丁比较；`version_delta()` 输出 `major/minor/patch/none`。

### Celery 定时任务

`sca-beat` 每 `RISK_MONITOR_INTERVAL_SECONDS` 秒触发 `sca.monitor_risks`：

1. 查询组件最新版本和生命周期状态
2. 统计组件关联漏洞变化
3. 写入 `risk_monitor_snapshots`
4. 写入 `risk_change_records`
5. 产生 `risk_alerts`
6. 如启用邮件通知，记录通知渠道和收件人

### API 接口

- `POST /api/sca/projects/{project_id}/risk-monitor/run`：手动执行项目监测
- `GET /api/sca/projects/{project_id}/risk-monitor/snapshots`：监测快照
- `GET /api/sca/projects/{project_id}/risk-monitor/alerts`：风险提醒
- `GET /api/sca/projects/{project_id}/risk-monitor/changes`：历史变化记录
- `GET /api/sca/projects/{project_id}/risk-monitor/trend`：提醒趋势图数据

### Vue3 页面

菜单“持续监测”提供项目选择、立即监测、版本更新建议、EOL 状态、风险提醒和趋势条形图。

## 13. 第八阶段：AI 漏洞降噪与优先级排序

### OpenAI API 集成

服务位于 `backend/app/ai_triage_service.py`，通过 Chat Completions 调用：

```text
POST {OPENAI_API_URL}
model={OPENAI_MODEL}
response_format.type=json_schema
```

未配置 `OPENAI_API_KEY` 时自动使用本地规则降级，结果标记为 `local-heuristic`，便于开发和离线测试。

### Prompt 模板

系统提示要求模型只基于系统提供的结构化上下文分析，不允许捏造 PoC、在野利用、KEV、EPSS、可达性或业务事实。上下文不足时必须输出 `Review`。

输入上下文包括项目上下文、组件信息、漏洞信息、匹配证据、版本判断结果、运行时依赖、开发依赖、测试依赖、公网暴露、核心业务、实际调用、运行路径、POC、KEV、EPSS、可达性、修复版本、防护措施、修复复杂度和历史人工处置记录。

### JSON Schema

模型必须输出严格 JSON：

- `ai_priority`：`P0/P1/P2/P3/Review/Ignore`
- `confidence`
- `is_likely_false_positive`
- `reason`
- `evidence_summary`
- `business_impact`
- `fix_advice`
- `fix_deadline`
- `temporary_mitigation`
- `need_manual_review`
- `manual_review_reason`

### 脱敏方案

`sanitize_for_ai()` 会递归脱敏 `token/secret/password/authorization/cookie/api_key`，并移除 URL 中的用户名密码。AI 请求只发送漏洞必要字段和业务上下文，不发送源码文件内容。

### 数据库设计

新增 `ai_triage_results`，记录 AI 风险等级、降噪原因、修复建议、人工确认状态、模型名、token 统计、`ai_schema_version` 和 `input_hash`。同一漏洞在上下文未变化时复用已有结论，便于审计和节省 Token。

### API 接口

- `POST /api/sca/projects/{project_id}/ai-triage/analyze`：批量 AI 分析
- `GET /api/sca/ai-triage/meta`：输出 Prompt 模板、JSON Schema、支持优先级和脱敏字段
- `GET /api/sca/projects/{project_id}/ai-triage/results`：AI 结果列表
- `POST /api/sca/ai-triage/{result_id}/confirm`：人工确认、误报、延期、忽略

### Vue3 页面

菜单“AI 降噪”提供上下文勾选、批量分析、置信度、证据摘要、Token 统计、修复期限、人工确认、Prompt 版本、输出等级和脱敏字段展示。

## 14. 第九阶段：软件资产中心

### Dashboard 页面

菜单“资产中心”提供全局组件库、全局漏洞统计、风险趋势、风险分布、EOL 统计、License 风险统计和资产搜索。

### 图谱设计

`asset_graph()` 输出项目节点、组件节点、项目组件关系、组件依赖关系。

### 风险统计逻辑

- 全局组件库按 `ecosystem + package_name` 聚合
- 风险排序结合最高漏洞等级、P0/P1 分布、漏洞数量和组件风险分
- EOL 来源于持续监测快照
- License 风险默认识别 `GPL/AGPL/LGPL/unknown`
- Dashboard 返回风险分布、EOL 分布、License 分布、风险趋势和 Top 风险项目
- 组件资产返回 `project_ids`、`project_names` 和 `risk_score`，便于定位项目关联

### API 接口

- `GET /api/sca/assets/dashboard`
- `GET /api/sca/assets/components?search=`
- `GET /api/sca/assets/graph`

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

## 15. 第十阶段：漏洞整改闭环

### 工单系统

整改闭环以 `remediation_tickets` 为主表，每个工单关联项目和漏洞，记录整改人、优先级、修复期限、修复版本、验证结果和超时提醒状态。`remediation_events` 记录每一次状态流转，`vulnerability_whitelist` 记录白名单和忽略原因。

### 状态流转逻辑

允许状态：

- `未处理`
- `修复中`
- `待确认`
- `已修复`
- `已忽略`

核心流转：

- `未处理 -> 修复中 / 已忽略`
- `修复中 -> 待确认 / 已忽略`
- `待确认 -> 已修复 / 修复中 / 已忽略`
- `已修复` 和 `已忽略` 为闭环终态

复测通过会进入 `已修复`，复测失败会回到 `修复中`。白名单会将漏洞标记为 `已忽略`，并写入白名单表。

### 数据库设计

- `remediation_tickets`：整改工单
- `remediation_events`：工单生命周期事件
- `vulnerability_whitelist`：漏洞白名单和忽略记录
- `risk_alerts`：超时提醒记录，可接入邮件通知

### FastAPI 接口

- `POST /api/sca/projects/{project_id}/remediation/tickets`：创建整改工单
- `GET /api/sca/projects/{project_id}/remediation/tickets`：工单列表
- `POST /api/sca/remediation/tickets/{ticket_id}/transition`：状态流转
- `POST /api/sca/remediation/tickets/{ticket_id}/verify`：修复验证
- `GET /api/sca/remediation/tickets/{ticket_id}/events`：生命周期事件
- `POST /api/sca/remediation/overdue/check`：手动执行超时提醒检查
- `POST /api/sca/projects/{project_id}/remediation/whitelist`：加入白名单并忽略
- `GET /api/sca/projects/{project_id}/remediation/whitelist`：白名单列表

### Vue3 页面

菜单“整改闭环”提供项目选择、漏洞选择、整改人、修复期限、优先级、工单列表、状态操作、复测验证、白名单列表和手动超时提醒。

### 邮件提醒

`sca-beat` 每 `REMEDIATION_OVERDUE_CHECK_SECONDS` 秒执行 `sca.check_remediation_overdue`。超时工单会写入 `risk_alerts`，当 `NOTIFICATION_EMAIL_ENABLED=true` 时记录 `email` 通知渠道和 `NOTIFICATION_EMAIL_TO` 收件人，便于后续接入企业 SMTP。

## 16. 第十一阶段：DevSecOps 集成

### GitLab / GitHub Actions / Jenkins 集成

CI 系统扫描完成后调用平台 webhook，平台根据项目当前漏洞等级和风险优先级做发布门禁判断。阻断策略优先识别 P0/P1、KEV、在野利用和已确认阻断等级漏洞；阻断等级仍可由 `DEVOPS_BLOCK_SEVERITIES` 配置，默认 `critical,high`。

### Webhook 逻辑

1. 平台先校验 CI 请求签名或共享密钥，再接收项目 ID 或项目名称、流水线号、分支、提交号。
2. 平台定位项目并统计当前漏洞。
3. 自动生成 PDF 安全报告并关联到流水线事件。
4. 如果存在 P0/P1、KEV、在野利用或阻断等级漏洞，事件决策为 `blocked`。
5. 否则事件决策为 `passed`。
6. 结果写入 `devops_scan_events`，Dashboard 聚合阻断率和来源分布。

### API 接口

- `POST /api/sca/devops/webhooks/gitlab`
- `POST /api/sca/devops/webhooks/github`
- `POST /api/sca/devops/webhooks/jenkins`
- `GET /api/sca/devops/events`
- `GET /api/sca/devops/dashboard`

### GitHub Actions 示例

GitHub 使用请求体 HMAC SHA-256 签名，密钥通过 `GITHUB_WEBHOOK_SECRET` 配置；未单独配置时回退到 `SCA_WEBHOOK_SECRET`。

```yaml
name: sca-gate
on: [push]
jobs:
  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Notify SCA gate
        run: |
          body="{\"project_name\":\"$GITHUB_REPOSITORY\",\"pipeline_id\":\"$GITHUB_RUN_ID\",\"ref\":\"$GITHUB_REF_NAME\",\"commit_sha\":\"$GITHUB_SHA\"}"
          signature="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SCA_WEBHOOK_SECRET" -hex | sed 's/^.* /sha256=/')"
          curl -fsS -X POST "$SCA_URL/api/sca/devops/webhooks/github" \
            -H "Content-Type: application/json" \
            -H "X-Hub-Signature-256: $signature" \
            -d "$body"
```

### Jenkins Pipeline 示例

```groovy
pipeline {
  agent any
  stages {
    stage('SCA Gate') {
      steps {
        sh '''
          curl -fsS -X POST "$SCA_URL/api/sca/devops/webhooks/jenkins" \
            -H "Content-Type: application/json" \
            -H "X-SCA-Webhook-Token: ${SCA_WEBHOOK_SECRET}" \
            -d "{\"project_name\":\"${JOB_NAME}\",\"pipeline_id\":\"${BUILD_NUMBER}\",\"ref\":\"${BRANCH_NAME}\",\"commit_sha\":\"${GIT_COMMIT}\"}"
        '''
      }
    }
  }
}
```

### 部署方案

GitLab 使用 `X-Gitlab-Token`，Jenkins 使用 `X-SCA-Webhook-Token` 或 `Authorization: Bearer ...`。生产环境必须配置平台专用密钥，并建议额外通过 Nginx、WAF 或 API 网关限制 CI 网段。平台内的人工查看接口继续走聚信统一登录授权。

## 17. 第十二阶段：最终部署与生产优化

### 最终部署架构

```text
用户/CI
  -> Nginx HTTPS
  -> web-sca / sca-api
  -> sca-postgres / sca-redis
  -> sca-worker / sca-beat
  -> Docker volumes: uploads / reports / sbom / backups
```

### Docker Compose 优化

- 数据库、Redis、上传目录、报告目录、SBOM 目录和备份目录均使用 Docker volume。
- `sca-worker` 和 `sca-beat` 与 `sca-api` 使用同一镜像，确保任务代码一致。
- `sca-beat` 使用 `/tmp/celerybeat-schedule`，避免容器只读或权限差异导致定时任务启动失败。
- 根目录 compose 会同时启动统一登录与 SCA；项目内 compose 可单独启动 SCA，但需要先准备可访问的 `AUTH_SERVICE_URL`，默认 `AUTH_DEV_BYPASS=false`。

### Nginx 与 HTTPS

配置文件：`deploy/nginx/sca-platform.conf`。

- 80 自动跳转 443
- TLS 1.2 / 1.3
- HSTS、X-Frame-Options、Referrer-Policy
- `/api/` 反向代理到 `sca-api:5191`
- `/` 反向代理到 `web-sca:80`

证书路径示例：

```text
/etc/nginx/certs/sca.example.com.crt
/etc/nginx/certs/sca.example.com.key
```

### JWT 安全

九章 SCA 业务接口复用统一登录平台，后端通过 `juxin_auth_token` 调用统一登录的 introspect/authorize 接口。生产环境建议：

- `AUTH_DEV_BYPASS=false`
- Cookie 开启 `HttpOnly`、`Secure`、`SameSite`
- Nginx 全站 HTTPS
- 统一登录侧开启短期访问令牌和刷新令牌轮换

### 自动备份方案

脚本：`deploy/backup.sh`。

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
BACKUP_DIR=/data/sca/backups ./deploy/backup.sh
```

建议生产 crontab：

```cron
30 2 * * * cd /opt/juxin/sca-platform && BACKUP_DIR=/data/sca/backups ./deploy/backup.sh >> /var/log/sca-backup.log 2>&1
```

### 系统监控方案

- 健康检查：`GET /health`
- 就绪检查：`GET /ready`
- 容器状态：`docker compose ps`
- API 日志：`docker compose logs -f sca-api`
- Worker 日志：`docker compose logs -f sca-worker sca-beat`
- 备份记录：`GET /api/sca/ops/backups`
- 运维配置：`GET /api/sca/ops/config`

### PostgreSQL / Redis 优化建议

- PostgreSQL：开启自动 vacuum，按数据量调整 `shared_buffers`、`work_mem`、连接池上限，并定期检查慢 SQL。
- Redis：开启持久化或托管高可用实例，限制最大内存和淘汰策略，单独使用 broker/result/cache DB。
- Celery：生产环境按扫描规模增加 worker 并发，长任务建议拆分队列。
- Nginx：保持 `client_max_body_size 0` 以允许大文件上传，并按网络环境调整代理超时、Docker volume 和磁盘容量。

## 18. 启动方法

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

统一登录与 SCA 一体启动：

```bash
cd /Users/zhanglei/Documents/codex-new
cp .env.example .env
./scripts/deploy/docker-compose-aliyun.sh rebuild mysql auth sca-postgres sca-redis sca-api sca-worker sca-scanner-worker web-sca
```

访问地址：

- SCA 前端：`http://localhost:18089`
- 后端：`http://localhost:5191`
- SCA 专属登录：`http://localhost:5180/sca-login`
- 统一登录门户：`http://localhost:5180/portal`

## 19. 测试方法

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

第十到第十二阶段单独验证：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
docker compose run --rm --no-deps \
  -e PYTHONPATH=/app \
  -e DATABASE_URL=sqlite:////tmp/sca-test.db \
  -e AUTH_DEV_BYPASS=true \
  -e DEVOPS_BLOCK_SEVERITIES=critical,high \
  -e CELERY_TASK_ALWAYS_EAGER=true \
  -v "$PWD/backend/tests:/app/tests:ro" \
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function \
  tests/test_remediation_devops_ops.py
```

完整 Docker Compose 配置验证：

```bash
cd /Users/zhanglei/Documents/codex-new/sca-platform
docker compose config
cd /Users/zhanglei/Documents/codex-new
docker compose config
```

## 20. 如何验证上传、漏洞、报告、SBOM、监测、资产和闭环成功

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
12. 进入“持续监测”，点击“立即监测”，能看到更新建议、提醒和趋势
13. 进入“AI 降噪”，勾选业务上下文并点击“批量分析”
14. 进入“资产中心”，能看到全局组件、漏洞、EOL、License 风险和图谱
15. 进入“整改闭环”，选择漏洞并创建工单，能执行“开始处理”“复测通过”“忽略”
16. 进入“DevSecOps”，点击模拟 GitLab/GitHub/Jenkins 事件，高危漏洞会展示阻断结果
17. 进入“生产运维”，能看到 HTTPS、JWT、备份目录和备份计划
18. 进入“扫描日志”，能看到解析日志和识别数量

## 21. 常见报错解决方案

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

项目内独立 compose 默认 `AUTH_DEV_BYPASS=false`，启动前需确认 `AUTH_SERVICE_URL` 指向可用的统一登录服务。仅运行后端测试时，测试脚本会临时启用 `AUTH_DEV_BYPASS=true`。

### 上传大文件仍失败

平台已取消应用层上传大小限制，不再通过 `UPLOAD_MAX_BYTES` 控制文件大小。如仍出现 413 或连接中断，请检查外层 Nginx/网关/负载均衡是否限制了请求体大小，生产 Nginx 配置需保持 `client_max_body_size 0`；同时检查 Docker volume、磁盘空间和代理超时。

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

### Celery Beat 权限错误

Compose 已将 Beat schedule 写到 `/tmp/celerybeat-schedule`。如果自定义命令，请保留：

```bash
--schedule=/tmp/celerybeat-schedule
```

### DevSecOps Webhook 返回 blocked

说明项目存在 `DEVOPS_BLOCK_SEVERITIES` 命中的漏洞。可先在“整改闭环”创建工单并修复验证，或确认业务隔离后进入白名单。

### 整改工单没有超时提醒

确认 `sca-beat` 正在运行，并检查超时周期：

```bash
docker compose ps sca-beat
docker compose logs sca-beat
```

```bash
REMEDIATION_OVERDUE_CHECK_SECONDS=3600
NOTIFICATION_EMAIL_ENABLED=true
NOTIFICATION_EMAIL_TO=security@example.com
```

### HTTPS 证书路径错误

确认 `deploy/nginx/sca-platform.conf` 中的证书路径与实际挂载一致：

```text
/etc/nginx/certs/sca.example.com.crt
/etc/nginx/certs/sca.example.com.key
```

### 自动备份目录不可写

确认宿主机备份目录和 Docker volume 均存在，并让执行用户拥有写入权限：

```bash
mkdir -p /data/sca/backups
chmod 750 /data/sca/backups
```

### AI 降噪没有调用 OpenAI

确认已通过环境变量配置密钥，密钥不要写入代码：

```bash
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
```

未配置时系统会使用本地规则降级，页面仍可测试流程。

### 扫描失败

查看扫描日志：

```bash
docker compose exec -T sca-api curl -sS http://localhost:5191/api/sca/projects/<project_id>/scan-logs
docker compose logs sca-worker
```
## 20. 多工具联合扫描、兜底识别与未锁定版本风险

本阶段在现有模块上做兼容增强，不重复开发上传、依赖识别、漏洞查询和报告模块。

### 多引擎联动架构

- OpenSCA：本地源码 SCA 识别与国产漏洞/License 补充来源
- Syft：SBOM 生成引擎，输出 CycloneDX JSON 与 SPDX JSON
- Trivy：文件系统、镜像、SBOM 漏洞扫描引擎
- OWASP Dependency-Check：Java 专项漏洞扫描引擎，复用持久化 NVD 缓存
- OWASP Dependency-Track：SBOM 风险管理平台，通过 API 创建项目、上传 CycloneDX BOM、拉取组件/漏洞/License/指标

Dependency-Track 不作为本地命令扫描器使用。九章 SCA 作为统一入口，负责任务编排、原始报告保存、标准化、去重合并、可信度评分、AI 降噪和统一报告。

### 新增后端模块

- `backend/app/scanners/base.py`：命令执行、日志、原始结果保存、标准数据结构
- `backend/app/scanners/opensca_client.py`：OpenSCA 命令封装
- `backend/app/scanners/syft_client.py`：Syft CycloneDX/SPDX SBOM 生成封装
- `backend/app/scanners/trivy_client.py`：Trivy fs/image 扫描封装
- `backend/app/scanners/dependency_check_client.py`：Dependency-Check 扫描和漏洞库更新封装
- `backend/app/scanners/dependency_track_client.py`：Dependency-Track API 客户端
- `backend/app/scanners/normalizers/*`：OpenSCA、Syft、Trivy、Dependency-Check、Dependency-Track 结果标准化
- `backend/app/scanners/merger/*`：组件去重、漏洞去重、多引擎可信度评分

### 扫描任务状态

每个主扫描任务会创建子任务节点：源码准备、OpenSCA、Syft、Trivy、Dependency-Check、Dependency-Track 上传/拉取、标准化、组件合并、漏洞合并、AI 降噪和报告生成。某个工具失败不会导致系统崩溃；工具未安装、缓存不可用或 DTrack 不可用时显示 failed/skipped，主流程仍可展示本地依赖识别结果。

### 无清单兜底识别

当没有发现项目级 `pom.xml`、`package.json`、`requirements.txt`、`go.mod` 等标准清单时，系统不会直接判定无法扫描，会进入兜底识别模式：

- Java：扫描 jar/war/ear、WEB-INF/lib、lib、plugins；优先解析 `META-INF/maven/**/pom.properties`，否则从文件名提取组件和版本
- Node.js：扫描 `node_modules/**/package.json`，保留 npm scope
- Python：扫描 `*.dist-info/METADATA`、`*.egg-info/PKG-INFO` 和 import/from import；仅 import 识别时版本为 `unknown`
- Go/PHP/Ruby/Rust：解析 `go.sum`、`composer.lock`、`Gemfile.lock`、`Cargo.lock`
- 二进制/归档：计算 sha1、sha256、文件大小、文件路径和文件名，作为后续人工确认和跨项目复用依据

未知版本不会被丢弃，统一保存为 `unknown`，标记 `need_manual_version_confirm=true`，不直接进入高危确认统计。前端提供人工补录版本接口，补录后可重新执行漏洞查询。

### 依赖版本未锁定风险

依赖解析时会识别：

- 已锁定版本：精确、唯一、可复现版本，例如 `requests==2.32.3`、Maven `<version>2.15.3</version>`、Go `v1.9.1`
- 未锁定版本风险：只声明包名，没有版本号
- 版本范围风险：`>=`、`^`、`~`、Maven `[5.0,6.0)`、Gradle `1.+`
- 动态版本风险：`latest`、`latest.release`、`SNAPSHOT`
- 版本缺失风险：无法解析实际版本

如果 lock 文件能解析实际版本，漏洞匹配使用实际版本，同时报告声明源依赖文件存在未锁定或范围风险。

### 新增 API

- `GET /api/sca/projects/{project_id}/scan-completeness`：扫描完整性、扫描模式、可信度统计、未知版本数量、补充材料建议
- `PATCH /api/sca/components/{component_id}/manual-version`：人工补录组件实际版本和 PURL
- `GET /api/sca/projects/{project_id}/dependency-track`：Dependency-Track 联动状态
- `POST /api/sca/scan-tasks/{scan_task_id}/rerun`：失败/超时子任务重新执行标记

### Docker Compose 更新

新增服务和卷：

- `scanner-worker`：扫描命令执行 Worker
- `dependency-track-apiserver`：Dependency-Track API 服务
- `dependency-track-frontend`：Dependency-Track 前端
- `sca-scanner-results`：原始扫描报告持久化
- `sca-trivy-cache`：Trivy 缓存持久化
- `sca-dependency-check-data`：Dependency-Check 漏洞库持久化
- `dependency-track-data`：Dependency-Track 数据持久化

### Dependency-Check Java 扫描与运维

Dependency-Check 固定为 `12.1.9`。项目扫描自动识别 Maven、Gradle、JAR、WAR 和 EAR，扫描命令固定使用 `--noupdate`，不会在项目任务中临时下载漏洞库。首次初始化完成前，Java 子任务会降级为 skipped，主扫描流程继续执行。

首次部署后手动初始化漏洞库：

```bash
docker compose exec scanner-worker \
  celery -A app.celery_app.celery_app call sca.update_dependency_check_data
```

查看缓存任务日志和工具版本：

```bash
docker compose logs -f scanner-worker

docker compose exec scanner-worker \
  /opt/dependency-check/bin/dependency-check.sh --version
```

查看持久卷占用：

```bash
docker system df -v
docker volume inspect sca-platform_sca-dependency-check-data
```

生产环境建议为 `sca-dependency-check-data` 预留至少 5 GB 可增长空间，并根据灰度项目的实际缓存占用调整容量和告警阈值。定时更新失败时保留旧缓存继续扫描；状态接口和前端会显示最后成功时间、缓存是否过期、扫描耗时以及失败/跳过数量。

全局 suppression 文件为 `backend/dependency-check-suppression.xml`，以只读方式挂载到 `/etc/dependency-check/suppression.xml`。新增误报排除项时，应先确认漏洞与组件证据，修改 XML，并在后端开发环境校验：

```bash
cd backend
PYTHONPATH=. pytest -q tests/test_dependency_check_pipeline.py
cd ..
```

校验通过后再经代码评审、重建 `scanner-worker` 发布。不要在运行中的容器内直接修改 suppression。

Dependency-Check 单源发现默认标记为“待人工复核”，不参与 DevSecOps 门禁；只有与其他引擎稳定交叉确认后才进入现有门禁策略。`NVD_API_KEY` 只能通过环境变量提供，禁止写入仓库、Compose 文件或命令日志。

### 运行方法

所有服务都在 Docker 中运行：

```bash
cd sca-platform
cp .env.example .env
# 按需填写 DEPENDENCY_TRACK_API_KEY、OPENAI_API_KEY、GITHUB_TOKEN 等环境变量
docker compose up -d --build
```

访问：

- 九章 SCA 前端：`http://localhost:18089`
- SCA 专属登录：`http://localhost:5180/sca-login`
- FastAPI Swagger：`http://localhost:5191/docs`
- Dependency-Track API：`http://localhost:18090`
- Dependency-Track 前端：`http://localhost:18091`

### 测试方法

不要在本机直接启动服务。使用 Docker 执行测试：

```bash
cd sca-platform
docker compose build sca-api
docker compose run --rm sca-api pytest -q
```

建议测试样例：

- Maven 项目：验证 `pom.xml`、dependencyManagement、jar pom.properties、OpenSCA/Syft/Trivy/Dependency-Check 子任务状态
- npm 项目：验证 `package.json` 的 `^/~ latest` 风险、`package-lock.json` 实际版本
- Python 项目：验证 `requirements.txt` 精确/未声明/范围版本、import 兜底识别
- Docker 镜像：验证 Syft image 和 Trivy image 扫描输出目录
- Dependency-Track 不可用：验证本地扫描仍完成，子任务展示 failed/skipped
- Dependency-Check 缓存未初始化或锁等待超时：验证 Java 子任务降级 skipped/failed，主扫描仍完成
- 重复漏洞：验证多来源合并为一条并保留来源证据

### 常见报错

- 413 Request Entity Too Large：平台应用层不限制上传大小。检查外层 Nginx/网关是否设置 `client_max_body_size 0`，优先使用断点续传。
- OpenSCA/Syft/Trivy 命令不存在：scanner-worker 镜像中未安装对应工具；任务会显示 failed，不影响本地依赖识别。
- Dependency-Track API Key 错误：配置 `DEPENDENCY_TRACK_API_KEY` 后重启容器，再重新上传 BOM 或重跑子任务。
- Dependency-Check 未初始化：执行漏洞库初始化命令，等待状态接口的 `last_success_at` 更新后重试 Java 项目。
- Dependency-Check 更新失败：检查 `scanner-worker` 网络、NVD 限流、数据卷权限和剩余空间；旧缓存仍保留时项目扫描可继续使用。
- Trivy 数据库下载失败：检查容器网络和 `sca-trivy-cache` 卷权限；可预热缓存后重试。
- 无清单文件组件少：报告会提示补充 lock 文件、SBOM、运行目录、jar/war、Docker 镜像 tar 或依赖树输出以提高准确率。
