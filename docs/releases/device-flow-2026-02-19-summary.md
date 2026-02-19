# Device Flow 2026-02-19 工作总结

## 1. 今日目标
- 按确认方案落地设备流转系统 V1。
- 独立系统、独立目录、独立数据库（同一 MySQL 实例下新建 `juxin_device_flow`）。
- 使用聚信统一登录接入，不与提醒/CMDB/库存/工单做业务联动。

## 2. 今日已完成

### 2.1 系统与部署集成
- 新增独立目录：`/Users/zhanglei/Documents/codex-new/device-flow`。
- 在 `docker-compose.yml` 中新增服务：
  - `device-flow-api`
  - `web-device-flow`
- 明确后端连接同一 MySQL 实例，并使用独立库：`juxin_device_flow`。
- 聚信统一登录侧已纳入 `device-flow` 系统入口与授权判断。

### 2.2 后端能力（V1）
- 流程主线：`创建 -> 收货 -> 硬件检查 -> 系统安装 -> 测试 -> 审核 -> 装箱 -> 发货`。
- 阶段推进严格串行，禁止跳步。
- 退回重做支持，且退回原因必填。
- 每阶段记录执行人/角色/时间/结果/备注，支持结构化阶段字段（硬件检查、安装、测试、审核、装箱、发货）。
- 审计日志写入 `before/after + actor + timestamp + action`。
- 附件留证能力：
  - 上传附件
  - 查询附件
  - 下载附件
- 审计硬约束：推进到 `HARDWARE_CHECKED`、`TESTED` 前，必须至少有 1 个对应阶段附件。
- 角色权限细化：
  - `admin/sysadmin`：主流程写操作
  - `auditor`：允许测试与审核，允许退回

### 2.3 前端能力（V1）
- 页面风格对齐提醒系统：sidebar + hero + card。
- 阶段时间轴已改为中文。
- 支持新建流转单、列表筛选、详情查看。
- 支持按当前阶段展示结构化执行表单并推进流程。
- 支持退回重做。
- 支持附件上传/下载与列表查看。
- 增加“关键节点责任人”展示（谁在什么时候执行了关键阶段）。

### 2.4 文档与脚本
- 完成并更新：
  - `device-flow/README.md`
  - `docs/releases/device-flow-v1-checklist.md`
  - `device-flow/scripts/smoke-e2e.sh`
  - `device-flow/scripts/regression-api.sh`

### 2.5 晚间增强（第二轮）
- 后端新增：
  - 看板汇总接口：`GET /api/device-flow/dashboard/summary`
  - 审计日志分页查询：`GET /api/device-flow/logs`
  - 附件删除接口：`DELETE /api/device-flow/attachments/{id}`（仅管理员）
- 校验增强：
  - 阶段推进增加必填项与失败说明校验（安装、测试、审核、装箱、发货等）。
  - 日期筛选参数统一校验（`YYYY-MM-DD`）。
- 审计增强：
  - 审计 CSV 导出支持动作/操作人/关键词筛选。
- 前端增强：
  - 新增看板总览页（统计、阶段分布、超时流转单）。
  - 审计日志从“仅导出”升级为“在线列表 + 分页筛选 + 导出”。
  - 修复附件上传权限判断，新增管理员附件删除操作入口。

### 2.6 深夜增强（第三轮，按 1/2/3 落地）
- 看板筛选与导出：
  - `GET /api/device-flow/dashboard/summary` 新增 `stage`、`customer` 过滤参数。
  - 新增 `GET /api/device-flow/reports/dashboard.csv` 看板明细导出。
  - 前端看板页新增阶段/客户筛选、重置筛选、明细 CSV 导出。
- 审计跳转优化：
  - 审计日志列表里的流转单号改为可点击，支持一键跳转到“流转详情”。
  - 看板“超时流转单”“最近操作日志”的流转单号也支持点击直达详情。
- 角色矩阵自动验收：
  - 新增脚本：`device-flow/scripts/rbac-matrix.sh`。
  - 覆盖 admin/auditor/sysadmin 的访问与动作边界（包含正向与拒绝校验）。
  - 支持 `CSRF + 验证码` 自动登录流程；也支持直接传入 token 跑验收。
- 同步更新：
  - OpenAPI 升级到 `1.2.0`（新增看板筛选参数与 dashboard CSV 导出接口）。
  - `README.md` 增补看板筛选/导出、审计跳转、角色矩阵脚本说明。

### 2.7 收尾增强（第四轮，继续完善）
- SLA 催办体系：
  - 新增 `device_sla_rules`、`device_sla_reminders` 表。
  - 提供 `SLA 汇总 / 规则更新 / 手动执行催办` 接口。
  - 后端增加自动催办定时任务（可配扫描周期）。
- 批量处理（Excel）：
  - 新增 Excel 导入模板下载。
  - 新增流转单 Excel 导出接口。
  - 新增 Excel/CSV 批量导入流转单接口。
  - 新增批量阶段推进接口（统一动作 + payload）。
- 审计防篡改：
  - 操作日志新增链式签名字段（`chain_prev_hash`、`chain_hash`、`chain_version`）。
  - 写审计日志时串行签名；启动时自动补齐/修复历史链。
  - 新增审计验签接口与前端验签页。
- 前端新增菜单页：
  - `SLA催办`
  - `批量处理`
  - `审计验签`
- 文档与脚本：
  - OpenAPI 升级到 `1.3.0`。
  - `smoke/regression/rbac` 脚本均加入新能力验收项。

## 3. 今日验证结果
- 静态检查：
  - 后端 `node --check` 通过。
  - 前端 `npm run build` 通过。
  - `docker compose config` 通过。
- 流程验证：
  - `smoke-e2e.sh` 在 `5184` 跑通（最终到 `SHIPPED`）。
- 回归验证：
  - `regression-api.sh` 跑通（阶段校验、日志日期校验、关键附件删除保护均通过）。
- 角色矩阵验证：
  - `rbac-matrix.sh` 跑通（含拒绝场景：auditor 收货/装箱/删附件被拒绝；sysadmin 默认无 device-flow 访问）。
- 批量与验签验证：
  - `regression-api.sh` 新增批量推进、SLA、审计验签、Excel 接口校验并通过。
- 负向验证：
  - 未登录访问返回 `401`。
  - 未上传关键阶段附件时推进被正确拦截。
  - 无 `device-flow` 权限用户访问被拒绝（`403`）。
- 数据隔离验证：
  - 同一 MySQL 实例下已可见 `juxin_device_flow`，与其他业务库 schema 隔离。

## 4. 当前状态
- Device Flow V1 已达到可用验证状态，可用于继续联调与试运行。
- 容器层已完成功能联调验证（`5184/8083`），新接口与页面可用。
- 当前仓库存在其他模块的历史改动（非本次范围），本次未做回滚处理。

## 5. 明日建议
- 在网络条件允许时补一次镜像层重建（目前采用容器热更新方式完成验证）。
- 如需上线，补一轮角色矩阵验收（`admin/sysadmin/auditor` 的读写边界）。
