# 聚信软件成分分析平台

当前版本已完成第一到第十二阶段：基础项目初始化、源码上传、依赖识别、漏洞查询、报告导出、SBOM 与容器镜像扫描、持续风险监测、AI 漏洞降噪、软件资产中心、漏洞整改闭环、DevSecOps 集成、最终部署与生产优化。技术栈保持 FastAPI + Vue3 + Element Plus + PostgreSQL + Redis + Celery + Docker Compose，并复用聚信统一登录平台。

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
  -> auth:5180 / 聚信统一登录平台
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

输入上下文包括项目上下文、组件信息、漏洞信息、匹配证据、版本判断结果、运行时依赖、公网暴露、核心业务、POC、KEV、EPSS、可达性、修复版本、防护措施和历史人工处置记录。

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
- `GET /api/sca/projects/{project_id}/ai-triage/results`：AI 结果列表
- `POST /api/sca/ai-triage/{result_id}/confirm`：人工确认、误报、延期、忽略

### Vue3 页面

菜单“AI 降噪”提供上下文勾选、批量分析、置信度、证据摘要、Token 统计、修复期限和人工确认。

## 14. 第九阶段：软件资产中心

### Dashboard 页面

菜单“资产中心”提供全局组件库、全局漏洞统计、风险趋势、风险分布、EOL 统计、License 风险统计和资产搜索。

### 图谱设计

`asset_graph()` 输出项目节点、组件节点、项目组件关系、组件依赖关系。

### 风险统计逻辑

- 全局组件库按 `ecosystem + package_name` 聚合
- 风险排序结合最高漏洞等级和漏洞数量
- EOL 来源于持续监测快照
- License 风险默认识别 `GPL/AGPL/LGPL/unknown`

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
- `POST /api/sca/projects/{project_id}/remediation/whitelist`：加入白名单并忽略
- `GET /api/sca/projects/{project_id}/remediation/whitelist`：白名单列表

### Vue3 页面

菜单“整改闭环”提供项目选择、漏洞选择、整改人、修复期限、优先级、工单列表、状态操作、复测验证和白名单列表。

### 邮件提醒

`sca-beat` 每 `REMEDIATION_OVERDUE_CHECK_SECONDS` 秒执行 `sca.check_remediation_overdue`。超时工单会写入 `risk_alerts`，当 `NOTIFICATION_EMAIL_ENABLED=true` 时记录 `email` 通知渠道和 `NOTIFICATION_EMAIL_TO` 收件人，便于后续接入企业 SMTP。

## 16. 第十一阶段：DevSecOps 集成

### GitLab / GitHub Actions / Jenkins 集成

CI 系统扫描完成后调用平台 webhook，平台根据项目当前漏洞等级做发布门禁判断。阻断等级由 `DEVOPS_BLOCK_SEVERITIES` 配置，默认 `critical,high`。

### Webhook 逻辑

1. CI 传入项目 ID 或项目名称、流水线号、分支、提交号。
2. 平台定位项目并统计当前漏洞。
3. 如果存在阻断等级漏洞，事件决策为 `blocked`。
4. 否则事件决策为 `passed`。
5. 结果写入 `devops_scan_events`，Dashboard 聚合阻断率和来源分布。

### API 接口

- `POST /api/sca/devops/webhooks/gitlab`
- `POST /api/sca/devops/webhooks/github`
- `POST /api/sca/devops/webhooks/jenkins`
- `GET /api/sca/devops/events`
- `GET /api/sca/devops/dashboard`

### GitHub Actions 示例

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
          curl -fsS -X POST "$SCA_URL/api/sca/devops/webhooks/github" \
            -H "Content-Type: application/json" \
            -d "{\"project_name\":\"$GITHUB_REPOSITORY\",\"pipeline_id\":\"$GITHUB_RUN_ID\",\"ref\":\"$GITHUB_REF_NAME\",\"commit_sha\":\"$GITHUB_SHA\"}"
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
            -d "{\"project_name\":\"${JOB_NAME}\",\"pipeline_id\":\"${BUILD_NUMBER}\",\"ref\":\"${BRANCH_NAME}\",\"commit_sha\":\"${GIT_COMMIT}\"}"
        '''
      }
    }
  }
}
```

### 部署方案

生产环境建议只允许 CI 网段访问 webhook 路径，并通过 Nginx、WAF 或 API 网关补充签名校验。平台内的人工查看接口继续走聚信统一登录授权。

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
- 根目录 compose 已接入统一登录平台，项目内 compose 保留 `AUTH_DEV_BYPASS=true` 方便离线验证。

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

平台业务接口复用聚信统一登录平台，后端通过 `juxin_auth_token` 调用统一登录的 introspect/authorize 接口。生产环境建议：

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
- Nginx：按上传包大小调整 `client_max_body_size` 和代理超时。

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
