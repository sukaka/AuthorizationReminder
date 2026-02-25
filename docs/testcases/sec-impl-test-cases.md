# 聚信实施记录系统测试用例

## 前置条件
- 服务可访问：`http://localhost:5185`
- 已获取 `admin/auditor/sysadmin` Token

## 用例清单
| 用例ID | 场景 | 步骤 | 预期结果 |
|---|---|---|---|
| SI-001 | 健康检查 | `GET /api/health` | 返回 200，`ok=true` |
| SI-002 | 全流程正向推进 | `INIT->ASSESS->IMPLEMENT->TUNE->TRIAL->ACCEPT->HANDOVER->CLOSED` | 最终阶段为 `CLOSED` |
| SI-003 | 禁止跳步 | 非顺序推进阶段 | 返回 400/409 |
| SI-004 | 关键阶段留证门禁 | 未上传 `IMPLEMENT/TUNE/TRIAL/ACCEPT` 附件即推进 | 被拒绝；补齐留证后成功 |
| SI-005 | 阶段失败项说明校验 | `FAIL` 场景未填说明推进 | 返回 400 |
| SI-006 | 批量推进 | `/projects/batch/stage` 批量执行动作 | 结果统计正确 |
| SI-007 | SLA 规则与执行 | 更新规则并执行 `/sla/run` | 返回检查数量与命中结果 |
| SI-008 | 审计链验签 | `GET /api/sec-impl/audit/verify` | 返回总检查数与问题数 |
| SI-009 | 导入导出 | 下载模板、导入 Excel、导出报表 | 文件可下载，导入结果正确 |
| SI-010 | RBAC | auditor 仅可读与验签，不可写阶段/删附件 | 权限边界正确 |
| SI-011 | 审计字段完整性 | 执行一次写操作后查询审计日志 | 日志包含来源 IP，变更内容为中文“变更摘要” |
| SI-012 | 审计菜单角色边界 | admin/sysadmin/auditor 分别登录前端 | 审计日志与验签菜单仅 auditor 可见 |

## 自动化脚本/命令
```bash
cd /Users/zhanglei/Documents/codex-new/sec-impl/backend
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:smoke
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:regression
AUTH_BASE=http://localhost:5180 API_BASE=http://localhost:5185 npm run test:rbac
```
