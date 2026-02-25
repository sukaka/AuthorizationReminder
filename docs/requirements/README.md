# 需求说明书总览

本文档集用于定义聚信多系统平台各系统的业务需求、权限边界、接口口径与验收标准。

## 文档列表
- `/Users/zhanglei/Documents/codex-new/docs/requirements/auth-sso-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/reminder-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/ticketing-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/inventory-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/device-flow-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/sec-impl-requirements.md`
- `/Users/zhanglei/Documents/codex-new/docs/requirements/cmdb-requirements.md`

## 统一约束
- 登录与鉴权统一由 `auth` 提供，所有业务系统复用 SSO。
- 所有系统必须通过系统键（`app_access`）控制入口可见性。
- 数据库策略：复用 MySQL 实例、系统独立库/独立表前缀。
- 安全审计：关键操作需保留审计日志，支持导出与校验（按系统能力分层）。
- 角色基线：`admin`、`sysadmin`、`auditor`，并允许扩展业务角色。
- 当前版本口径：`auditor` 仅可访问审计相关功能，不可执行业务写操作。

## 使用说明
- 用于立项评审：关注“业务范围/非范围”和“验收标准”。
- 用于开发排期：关注“功能需求”与“接口需求”。
- 用于测试设计：关注“约束规则”与“验收条目”。
