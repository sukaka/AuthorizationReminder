# 设备流转系统（Device Flow）需求说明书

## 1. 系统概述
- 系统名称：设备流转系统
- 前端：`http://localhost:18083`
- 后端：`http://localhost:5184`
- 系统键：`device-flow`
- 数据库：`juxin_device_flow`

## 2. 建设目标
- 管理设备从收货到发货的标准化流转。
- 对关键阶段形成可审计的执行记录与附件证据。
- 支撑 SLA 看板、批量处理、审计验签。

## 3. 业务范围
- 流转单管理。
- 阶段推进、退回重做、附件留证。
- 看板汇总、SLA 催办、批量导入导出。
- 审计日志与审计链验签。

## 4. 角色与权限需求
- `admin`/`sysadmin`：业务写权限。
- `auditor`：仅审计相关能力（日志、验签、审计导出）。
- 禁止 `auditor` 执行阶段推进、退回、附件上传等写动作。

## 5. 功能需求
1. 固定流程
- `CREATED -> RECEIVED -> HARDWARE_CHECKED -> OS_INSTALLED -> TESTED -> APPROVED -> PACKED -> SHIPPED`
- 不允许跳步，允许按规则退回。

2. 留证与审计
- 附件需关联阶段与上传人。
- 审计日志必须记录来源 IP 与签名链。
- 日志变更信息以前端中文“变更摘要”展示，不直接展示原始 JSON。
- 提供验签接口定位异常日志。

3. 运营能力
- 提供看板总览与超时统计。
- 支持 SLA 规则配置与催办执行。
- 支持批量导入和批量阶段处理。

## 6. 接口需求
- `/api/device-flow/jobs*`
- `/api/device-flow/dashboard/summary`
- `/api/device-flow/sla/*`
- `/api/device-flow/logs`
- `/api/device-flow/audit/verify`

## 7. 非功能需求
- 审计防篡改：日志链签名必须可验证。
- 附件安全：限制 MIME、大小、下载权限。
- 性能：列表与日志接口支持分页。

## 8. 验收标准
- 流程推进满足不可跳步规则。
- 审计链校验可发现篡改并定位 ID。
- `auditor` 仅可访问审计接口与菜单。
