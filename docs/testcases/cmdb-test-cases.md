# CMDB 系统测试用例

## 前置条件
- 服务可访问：`http://localhost:8090`
- 已获取具备 `cmdb` 权限的 Token
- MySQL/Mongo 已初始化

## 用例清单
| 用例ID | 场景 | 步骤 | 预期结果 |
|---|---|---|---|
| CMDB-001 | 健康检查 | `GET /healthz` | 返回 200，`status=ok` |
| CMDB-002 | CI 列表查询 | `GET /api/v1/ci?page=1&page_size=10` | 返回 200，分页结构正确 |
| CMDB-003 | 创建 CI | `POST /api/v1/ci` 提交合法数据 | 返回 201，生成 `ci_uid` |
| CMDB-004 | 查询 CI 详情 | `GET /api/v1/ci/{ci_uid}` | 返回 200，字段完整 |
| CMDB-005 | 更新 CI | `PATCH /api/v1/ci/{ci_uid}` 更新状态/负责人 | 返回 200，版本递增 |
| CMDB-006 | 关系维护 | `POST /api/v1/ci/{ci_uid}/relations` | 返回成功，关系可查询 |
| CMDB-007 | 删除 CI | `DELETE /api/v1/ci/{ci_uid}` | 返回成功，后续查询不可见 |
| CMDB-008 | 权限控制 | 无 `cmdb` 权限 token 访问 `/api/v1/*` | 返回 403 |
| CMDB-009 | 未登录访问 | 无 token 访问 `/api/v1/*` | 返回 401 |
| CMDB-010 | 仪表盘概览 | `GET /api/v1/dashboard/overview` | 返回 200，含 totals/distribution/trend |
| CMDB-011 | 审计日志查询 | `GET /api/v1/audit/logs?page=1&page_size=20` | 返回 200，含 `items/total/page/page_size` |
| CMDB-012 | 审计来源IP | 执行一次写操作后查询审计日志 | 新日志含 `source_ip`，页面可见来源IP列 |
| CMDB-013 | 审计导出CSV | `GET /api/v1/audit/logs/export.csv` | 返回 200，可下载 CSV 且包含来源IP列 |
| CMDB-014 | 审计变更摘要 | 执行 CI 字段变更后查看审计列表 | 变更内容以中文“变更摘要”展示，不直接展示原始 JSON |

## 回归记录
- `2026-02-20` 已修复 `CMDB-010`：`GET /api/v1/dashboard/overview` 返回 200。
- 修复点：`/Users/zhanglei/Documents/codex-new/cmdb/internal/repository/dashboard_repository.go`（趋势 SQL 分组表达式兼容 `ONLY_FULL_GROUP_BY`）。
