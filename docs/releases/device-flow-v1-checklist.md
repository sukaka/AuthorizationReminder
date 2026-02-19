# Device Flow V1 上线检查清单

## 发布前
- [ ] `docker compose config` 校验通过。
- [ ] 后端环境变量确认：`MYSQL_DATABASE=juxin_device_flow`。
- [ ] 确认与提醒/CMDB/库存/工单无业务数据读写耦合。
- [ ] `auth` 已配置 `APP_DEVICE_FLOW_URL=http://localhost:8083`。
- [ ] `auth` 中用户 `app_access` 含 `device-flow`。

## 构建与启动
- [ ] 后端：`cd /Users/zhanglei/Documents/codex-new/device-flow/backend && npm ci && node --check src/index.js && node --check src/db.js`
- [ ] 前端：`cd /Users/zhanglei/Documents/codex-new/device-flow/frontend && npm ci && npm run build`
- [ ] 启动：`cd /Users/zhanglei/Documents/codex-new && docker compose up --build mysql auth device-flow-api web-device-flow`

## 功能验收
- [ ] 创建流转单成功。
- [ ] 流程严格串行，不可跳步。
- [ ] 阶段字段校验生效（系统安装必须填系统名称/版本，装箱必须填箱号，发货必须填物流公司与快递单号）。
- [ ] 硬件检查/测试阶段推进前，已上传对应阶段至少1个附件。
- [ ] 退回重做必须填写原因。
- [ ] 阶段时间轴中文显示，含结构化字段。
- [ ] 附件可上传、可下载、可在详情查看。
- [ ] 审计日志列表查询正常（分页、筛选）。
- [ ] 审计 CSV 导出正常（筛选条件生效）。
- [ ] 管理员删除附件正常，关键阶段最后一个留证附件不可删除。
- [ ] 看板总览可展示阶段分布、超时流转单、最近操作日志。
- [ ] 看板超时阈值可在页面调节（1-30 天）。
- [ ] 看板支持按阶段/客户筛选。
- [ ] 看板明细 CSV 导出正常（筛选条件生效）。
- [ ] 审计日志流转单号可点击并跳转到对应详情页。
- [ ] SLA 规则可配置并保存，手动催办可执行，自动催办定时任务正常运行。
- [ ] 批量导入模板可下载，Excel/CSV 批量导入可用。
- [ ] 流转单 Excel 批量导出可用，批量阶段推进可用。
- [ ] 审计验签页面可执行，异常链路可定位到具体日志ID。

## 冒烟脚本
- [ ] 执行：
  - `cd /Users/zhanglei/Documents/codex-new/device-flow/scripts`
  - `AUTH_TOKEN=<你的token> API_BASE=http://localhost:5184 ./smoke-e2e.sh`
- [ ] 结果包含：`[OK] 全流程冒烟通过`

## 回归脚本（负向/边界）
- [ ] 执行：
  - `cd /Users/zhanglei/Documents/codex-new/device-flow/scripts`
  - `AUTH_TOKEN=<你的token> API_BASE=http://localhost:5184 ./regression-api.sh`
- [ ] 结果包含：`[OK] 回归校验通过`

## 角色矩阵脚本
- [ ] 执行：
  - `cd /Users/zhanglei/Documents/codex-new/device-flow/scripts`
  - `./rbac-matrix.sh`
- [ ] 结果包含：`[OK] 角色矩阵校验通过`

## 回滚预案
- [ ] 回滚服务：停止 `device-flow-api` / `web-device-flow` 容器。
- [ ] 保留 `juxin_device_flow` 数据用于问题分析。
- [ ] 门户临时移除 `device-flow` 入口（`auth` 配置层）。

## 首日巡检
- [ ] 每小时抽查 1 条流转单的阶段与审计一致性。
- [ ] 检查附件磁盘路径权限与剩余空间。
- [ ] 检查 5xx/4xx 日志趋势，确认无异常增长。
