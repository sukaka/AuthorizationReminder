# 设备流转系统测试用例

## 前置条件
- 服务可访问：`http://localhost:5184`
- 已获取 `admin/auditor/sysadmin` Token

## 用例清单
| 用例ID | 场景 | 步骤 | 预期结果 |
|---|---|---|---|
| DF-001 | 健康检查 | `GET /api/health` | 返回 200，`ok=true` |
| DF-002 | 全流程正向推进 | 按 `CREATED->RECEIVED->HARDWARE_CHECKED->OS_INSTALLED->TESTED->APPROVED->PACKED->SHIPPED` 推进 | 全流程完成，最终 `SHIPPED` |
| DF-003 | 禁止跳步 | 尝试跨阶段推进 | 返回 400/409，提示流程顺序错误 |
| DF-004 | 关键阶段留证 | 未上传阶段附件直接推进硬件检查/测试 | 返回失败；上传后可成功 |
| DF-005 | 附件删除保护 | 删除关键阶段最后一个附件 | 返回 409 |
| DF-006 | 退回重做 | 从后续阶段退回到前序阶段 | 退回成功并写审计日志 |
| DF-007 | SLA 规则与手动触发 | 更新 SLA 规则并执行 `/sla/run` | 返回检查数量与结果 |
| DF-008 | 批量推进 | `/jobs/batch/stage` 推进多单 | `success_count` 与目标数量一致 |
| DF-009 | 审计验签 | `GET /api/device-flow/audit/verify` | 返回校验结果，可定位异常 |
| DF-010 | RBAC | auditor 仅可读审计日志/验签，不能阶段推进、退回、上传或删除附件 | 权限边界符合设计 |
| DF-011 | 审计字段完整性 | 执行一次写操作后查询审计日志 | 日志包含来源 IP，变更内容为中文“变更摘要” |

## 自动化脚本
```bash
cd /Users/zhanglei/Documents/codex-new/device-flow/scripts
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5184 ./smoke-e2e.sh
AUTH_TOKEN=<TOKEN> API_BASE=http://localhost:5184 ./regression-api.sh
./rbac-matrix.sh
```
