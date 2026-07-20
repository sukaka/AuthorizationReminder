# 2026-07-19 管理路由权限审计计划

## 目标

完成此前安全审查遗留的“全量管理路由权限审计”，把管理员专属写操作、管理数据读取和用户自有数据接口分别核对到可重复执行的本地检查；不改变真实环境，不提交、不推送。

## 审计范围

- 盘点 `server/app` 下管理路由、管理写操作、公开 Webhook/下载接口和用户自有接口。
- 核对每个敏感操作是否先经过 `get_session`，再经过 `require_action("ai_assistant:admin", ...)` 或明确的资源/用户范围校验。
- 统一管理员别名判断，避免散落的 `role == "admin"` 造成 `superadmin`、`sys_admin`、`platform_admin` 行为不一致。
- 增加静态审计门禁与回归测试，防止后续新增管理写路由绕过统一鉴权。

## 验证

- 针对鉴权与管理路由的定向 pytest。
- 课程对齐门禁、Harness 发布门禁、GA 本地门禁和 `git diff --check`。

## 外部边界

真实 staging/production 登录、数据库迁移、加密密钥、连续观测、灰度发布和版本提交/推送仍需对应环境授权；本计划不把本地旁路证据宣称为生产完成。

## 结果

- 已统一平台管理员别名判断，并完成 `server/app/admin/*_routes.py`、运营、学习、知识库、技能、Agent Hub、渠道任务等敏感路由核对。
- 新增 `server/tests/test_admin_route_auth_audit.py`；静态审计与认证回归 `16 passed`，权限相关路由回归 `92 passed`，后端全量（忽略迁移测试）`1259 passed, 10 skipped`。
- 课程对齐门禁 `23/23`、Harness `266 passed, 9 skipped`、GA 本地门禁 `11/11` 通过；`git diff --check` 通过。
- 未执行真实环境登录、迁移、密钥注入、灰度、版本升级、commit 或 push。
