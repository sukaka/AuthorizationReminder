# 聚信实施记录系统（Sec-Impl）需求说明书

## 1. 系统概述
- 系统名称：聚信实施记录系统
- 前端：`http://localhost:18084`
- 后端：`http://localhost:5185`
- 系统键：`sec-impl`
- 数据库：`juxin_sec_impl`

## 2. 建设目标
- 管理实施项目全流程。
- 保障关键阶段“强制留证+可审计”。
- 提供看板、SLA、批量、审计验签能力。

## 3. 业务范围
- 实施单管理。
- 阶段推进、退回、附件留证。
- 看板与 SLA。
- 审计日志、审计导出、审计验签。

## 4. 角色与权限需求
- `admin`/`sysadmin`：业务写权限。
- `auditor`：仅审计相关能力。
- `auditor` 不能创建实施单、不能推进阶段、不能上传附件。
- 审计菜单（审计日志、审计验签）仅 `auditor` 可见。

## 5. 功能需求
1. 固定流程
- `INIT -> ASSESS -> IMPLEMENT -> TUNE -> TRIAL -> ACCEPT -> HANDOVER -> CLOSED`
- 不可跳步，支持退回重做。

2. 强制留证
- `IMPLEMENT`、`TUNE`、`TRIAL`、`ACCEPT` 阶段需留证。
- 附件需记录阶段、上传人、时间与备注。

3. 审计能力
- 关键操作记录审计日志与签名链。
- 审计日志需记录来源 IP。
- 日志变更信息以前端中文“变更摘要”展示，不直接展示原始 JSON。
- 提供日志检索、CSV 导出、验签校验。

4. 交互要求
- 实施单详情采用可拖动弹窗。
- 支持列表/看板/详情/批量协同。

## 6. 接口需求
- `/api/sec-impl/projects*`
- `/api/sec-impl/dashboard/summary`
- `/api/sec-impl/sla/*`
- `/api/sec-impl/logs`
- `/api/sec-impl/audit/verify`
- `/api/sec-impl/reports/audit.csv`

## 7. 非功能需求
- 数据隔离：独立库 + 独立账号。
- 安全：统一登录鉴权 + 审计签名。
- 可维护：流程、SLA 规则可配置。

## 8. 验收标准
- 全流程可走通并满足留证约束。
- 审计验签可识别篡改。
- `auditor` 仅可访问审计菜单与审计接口。
