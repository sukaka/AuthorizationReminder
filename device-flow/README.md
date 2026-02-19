# 设备流转系统（Device Flow）

目录：`/Users/zhanglei/Documents/codex-new/device-flow`

## 范围
- 独立系统、独立目录
- 仅复用聚信统一登录
- 不与提醒/CMDB/库存/工单做业务数据联动
- 同 MySQL 实例，独立数据库：`juxin_device_flow`

## 核心流程
`创建 -> 收货 -> 硬件检查 -> 系统安装 -> 测试 -> 审核 -> 装箱 -> 发货`

## V1 功能点
- 阶段严格串行，禁止跳步。
- 支持退回重做，退回必须填写原因。
- 阶段记录支持结构化字段（硬件检查项、安装信息、测试项、审核结论、装箱与发货信息）。
- 阶段推进前端/后端双重校验（必填字段、失败项说明、数值范围）。
- 附件留证：支持按阶段上传/下载附件。
- 硬件检查、测试阶段推进前必须有对应阶段附件留证。
- 附件删除（仅 `admin/sysadmin`），且关键阶段最后一个留证附件不可删除。
- 审计能力：
  - 日志列表在线查询（支持分页与条件筛选）
  - CSV 导出（支持日期/动作/操作人/关键词筛选）
- 看板总览：阶段分布、处理中/完成统计、超时单（默认 3 天未更新）。
  - 支持在页面调节超时阈值（1-30 天）
  - 支持按阶段、客户筛选看板
  - 支持导出看板明细 CSV
  - 支持查看最近操作日志
- 审计日志支持点击流转单号直接跳转到详情
- SLA 催办：
  - 支持按阶段配置阈值（小时）与提醒间隔（分钟）
  - 后端定时自动扫描超时单并生成催办记录
  - 支持手动执行催办
- 批量处理（Excel）：
  - 下载导入模板
  - Excel/CSV 批量导入流转单
  - 按筛选条件导出流转单 Excel
  - 按动作批量推进阶段（带统一 payload）
- 审计防篡改：
  - 操作日志写入链式签名（prev_hash + hash）
  - 支持审计链在线验签与异常定位
- 权限细化：
  - `admin/sysadmin`：全流程写操作
  - `auditor`：允许测试与审核、允许退回、允许上传附件

## 关键接口
- `GET /api/device-flow/dashboard/summary`：看板汇总
- `GET /api/device-flow/reports/dashboard.csv`：看板明细导出
- `GET /api/device-flow/sla/summary`：SLA 汇总
- `PUT /api/device-flow/sla/rules`：更新 SLA 规则
- `POST /api/device-flow/sla/run`：手动执行 SLA 催办
- `POST /api/device-flow/import/jobs.xlsx`：批量导入流转单
- `GET /api/device-flow/templates/jobs-import.xlsx`：下载导入模板
- `GET /api/device-flow/reports/jobs.xlsx`：导出流转单 Excel
- `POST /api/device-flow/jobs/batch/stage`：批量推进阶段
- `GET /api/device-flow/logs`：审计日志列表（分页）
- `GET /api/device-flow/reports/audit.csv`：审计日志导出
- `GET /api/device-flow/audit/verify`：审计链验签
- `DELETE /api/device-flow/attachments/{id}`：删除附件（管理员）

## 主要环境变量
- 后端数据库隔离：`MYSQL_DATABASE=juxin_device_flow`
- 看板超时天数：`DASHBOARD_OVERDUE_DAYS=3`（可调）
- SLA 自动扫描周期：`SLA_AUTO_RUN_INTERVAL_MS=300000`
- 批量推进上限：`MAX_BATCH_STAGE_JOB_IDS=200`
- 单次导入上限：`MAX_IMPORT_ROWS=500`
- 附件大小上限：`UPLOAD_MAX_FILE_SIZE_MB=10`
- 审计签名密钥：`AUDIT_SIGNING_KEY=<strong-random-key>`

## 本地启动
### 后端
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/backend
cp .env.example .env
npm install
npm run dev
```

### 前端
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/frontend
npm install
npm run dev
```

访问：`http://localhost:8083`

## Docker
在根目录执行：
```bash
cd /Users/zhanglei/Documents/codex-new
docker compose up --build mysql auth device-flow-api web-device-flow
```

## 冒烟脚本
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/scripts
AUTH_TOKEN=<统一登录token> API_BASE=http://localhost:5184 ./smoke-e2e.sh
```

## 回归脚本（负向/边界）
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/scripts
AUTH_TOKEN=<统一登录token> API_BASE=http://localhost:5184 ./regression-api.sh
```

## 角色权限矩阵验收脚本
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/scripts
./rbac-matrix.sh
```

可选环境变量：
- `API_BASE`（默认 `http://localhost:5184`）
- `AUTH_BASE`（默认 `http://localhost:5180`）
- `BUILTIN_PASSWORD`（默认与 `docker-compose` 中 `BUILTIN_ACCOUNT_DEFAULT_PASSWORD` 一致）
- `AUTH_TOKEN_ADMIN` / `AUTH_TOKEN_AUDITOR` / `AUTH_TOKEN_SYSADMIN`（若不传，脚本会尝试用内置账号登录获取）
- `EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS=true|false`（默认 `false`，即验证 sysadmin 默认无 device-flow 访问权限）
