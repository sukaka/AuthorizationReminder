# 设备流转系统（Device Flow）

目录：`/Users/zhanglei/Documents/codex-new/device-flow`

## 范围
- 独立系统、独立目录
- 仅复用聚信统一登录
- 不与提醒/CMDB/库存/工单做业务数据联动
- 同 MySQL 实例，独立数据库：`juxin_device_flow`

## 核心流程
`创建 -> 收货 -> 硬件检查 -> 入库(可选) -> 出库(可选) -> 系统安装 -> 测试 -> 审核 -> 装箱 -> 入库(可选) -> 出库(可选) -> 发货`

## V1 功能点
- 阶段严格串行，禁止跳步。
- 硬件检查后、装箱后的入库/出库节点可按实际业务选择跳过。
- 支持退回重做，退回必须填写原因。
- 阶段记录支持结构化字段（硬件检查项、入库/出库记录、安装信息、测试项、审核结论、装箱与发货信息）。
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
  - `auditor`：仅审计相关能力（日志查询、导出、验签）
- 审计日志展示：前端“变更摘要”采用中文差异描述，不直接展示原始 JSON。
- 流转单变更审批：
  - 支持 `WITHDRAW/CANCEL/CORRECT` 审批单发起、撤回、驳回、通过
  - 审批过程全量审计留痕
- 双人复核 + 电子签名：
  - `TESTED/APPROVED` 默认开启双签
  - 首签需指定第二复签人并返回 `dual_sign_token`，仅被指定账号可二签完成阶段推进
- 扫码能力：
  - 支持 `SN/IN/OUT` 条码解析
  - 支持扫码字段写回流转单
- 标签打印：
  - 支持设备贴/箱贴
  - 生成二维码追踪链接
- 硬件基线模板库：
  - 按机型定义检查项模板
  - 单据可按机型自动生成硬件检查 payload 模板
- 导入预校验模式：
  - `dry_run=true` 仅校验不落库，返回错误/告警清单
- 并发冲突保护：
  - 乐观锁（`expected_version` / `If-Match`）
  - 运行时抢占锁（`/jobs/{id}/lock`）
- 交付周期报表：
  - 阶段耗时、人效、逾期趋势、瓶颈阶段
- 细粒度权限策略：
  - 支持按 `role/department/action/stage` 配置 `ALLOW/DENY`
  - 前台“权限设置”可维护菜单、按钮和阶段动作权限
  - 菜单与按钮会按当前用户有效权限自动显示/隐藏
- 数据保留策略：
  - 附件冷热分层（HOT->COLD）
  - 自动归档与清理（支持 dry-run）
- 对外 API 与回调：
  - 外部 API Key 查询单据状态
  - 回调订阅 + 重试队列 + HMAC 签名
- 系统操作看板：
  - 失败率、慢接口、磁盘空间、队列积压

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
- `POST /api/device-flow/scan/parse`：扫码内容解析
- `POST /api/device-flow/jobs/{id}/scan/apply`：扫码字段写回
- `GET|POST|DELETE /api/device-flow/jobs/{id}/lock`：并发占用锁
- `GET|PUT /api/device-flow/hardware/templates`：硬件模板库
- `GET /api/device-flow/jobs/{id}/hardware-baseline`：机型检查项模板
- `GET|PUT /api/device-flow/dual-sign/policies`：双签策略
- `GET /api/device-flow/dual-sign/sessions`：双签会签记录
- `GET|POST /api/device-flow/jobs/{id}/change-requests`：审批单查询/发起
- `POST /api/device-flow/change-requests/{id}/approve|reject|withdraw`：审批流动作
- `GET /api/device-flow/jobs/{id}/labels/{type}`：标签打印（`type=device|box`）
- `GET /api/device-flow/reports/cycle`：交付周期报表
- `GET /api/device-flow/ops/dashboard`：系统操作看板
- `GET|PUT /api/device-flow/settings/attachment-upload`：附件上传大小配置（管理员）
- `GET|PUT /api/device-flow/retention/policies`：保留策略
- `POST /api/device-flow/retention/run`：执行保留策略
- `GET|POST|PUT /api/device-flow/callback/subscriptions`：回调订阅管理
- `POST /api/device-flow/callback/run`：手工触发回调队列消费
- `POST /api/device-flow/api-clients`：创建外部 API 客户端
- `GET /api/external/device-flow/jobs/{jobNo}`：外部查询接口（`x-api-key`）

## 主要环境变量
- 后端数据库隔离：`MYSQL_DATABASE=juxin_device_flow`
- 看板超时天数：`DASHBOARD_OVERDUE_DAYS=3`（可调）
- SLA 自动扫描周期：`SLA_AUTO_RUN_INTERVAL_MS=300000`
- 批量推进上限：`MAX_BATCH_STAGE_JOB_IDS=200`
- 单次导入上限：`MAX_IMPORT_ROWS=500`
- 附件大小上限默认值：`UPLOAD_MAX_FILE_SIZE_MB=10`（首次启动写入，可在前台附件上传区调整）
- 审计签名密钥：`AUDIT_SIGNING_KEY=<strong-random-key>`
- 双签 token 有效期：`DUAL_SIGN_TOKEN_TTL_MINUTES=60`
- 并发锁默认时长：`JOB_LOCK_TTL_SECONDS=300`
- 回调消费者轮询：`CALLBACK_WORKER_INTERVAL_MS=30000`
- 回调单批处理上限：`CALLBACK_WORKER_BATCH=20`
- 运维指标保留天数：`OPS_METRIC_RETENTION_DAYS=14`
- 标签追踪链接基址：`TRACK_LINK_BASE_URL=<https://xxx/device-flow>`
- 附件归档目录：`ARCHIVE_ROOT=./uploads/device-flow-archive`

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

访问：`http://localhost:18083`

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
