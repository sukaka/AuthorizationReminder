# 2026-03-16 交付系统合并落地

## 背景
- 将 `ticketing` 与 `sec-impl` 合并为新的 `delivery` 系统。
- 门户与权限体系从双入口切换为单入口 `delivery`。
- `sysadmin` 继续留在 `auth`，不进入业务；`auditor` 仅审计与验签；业务成员走项目/交付单权限。

## 本次完成
- `auth`
  - 新增 `delivery` 系统入口，门户不再展示 `ticketing` / `sec-impl`。
  - 旧 `app_access` 中的 `ticketing` / `sec-impl` 自动折叠为 `delivery`。
  - `auth` 的 apps/authorize 已支持 `delivery`。
  - 统一审计聚合把旧 `sec-impl` 远端来源切到 `delivery`。
- `delivery/backend`
  - 以 `delivery_orders` 为核心对象，补齐 `delivery_projects`、`delivery_project_members`、`delivery_workflow_events`、`delivery_comments`、`delivery_schedules`。
  - 暴露项目、项目成员、评论、排期、交付物、审计接口。
  - 创建交付单时自动补项目、自动把创建者加入项目成员、按模板生成交付物。
  - 补上项目/交付单级权限：管理员全局，其余业务成员按项目成员权限和单据归属访问。
  - 新增可重跑迁移脚本，支持从 `ticketing` / `sec-impl` 迁移项目、成员、交付单、评论、排期、交付物、阶段记录、附件、审计链、SLA、模板规则。
  - 目标表增加 legacy 标识列，支持幂等迁移与来源追溯。
- `delivery/frontend`
  - 页面与接口统一到 `delivery` 命名空间。
  - 明细页加入评论协作、排期协同、交付物清单。
  - 历史映射文案改为中文，不再直接暴露 `sec-impl` 英文字样。
- `docker-compose`
  - 增加 `delivery-api` 与 `web-delivery`。
  - `auth` 改为指向 `APP_DELIVERY_URL` 与 `AUDIT_SOURCE_DELIVERY_URL`。

## 验证
- `node --check auth/audit-center-logs.js`
- `node --check delivery/backend/src/index.js`
- `node --check delivery/backend/src/db.js`
- `node --check delivery/backend/src/migrate-legacy.js`
- `node --test auth/tests/system-access-display.test.js auth/tests/portal-routing.test.js auth/tests/admin-center-users.test.js auth/tests/delivery-portal-source.test.js delivery/backend/tests/source.delivery.test.js`
- `npm run build` in `delivery/frontend`
- `docker compose -f docker-compose.yml config --services`

## 当前已知未完项
- 没有执行真实数据库迁移，只完成了迁移脚本与目标表幂等设计。
- 没有跑 `delivery` 的在线 e2e，需要联动 `auth + mysql + delivery-api` 后再做。
- 旧 `ticketing` / `sec-impl` 服务仍保留在 compose 中，作为回滚与只读快照基础；门户已不再作为正式入口展示。
