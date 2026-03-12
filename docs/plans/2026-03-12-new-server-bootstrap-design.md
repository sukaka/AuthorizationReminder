# New Server Bootstrap Design

日期：2026-03-12

## 目标

让一台全新的服务器只依赖根 `.env` 和 `docker compose`，就能自动完成 Reminder/Auth 共享库的数据库与账号初始化，并启动整套系统，不再需要手工执行 `auth_user` SQL。

## 设计

- 复用现有单 MySQL 架构，不新增第二套初始化服务。
- 在 [server/db.js](/Users/zhanglei/Documents/codex-new/server/db.js) 中补充 bootstrap 逻辑：
  - 创建 `juxin_reminder`
  - 创建当前服务运行账号
  - 授权当前服务运行账号访问该库
- `api`、`auth`、`ticketing` 在根 Compose 中统一注入 `MYSQL_ADMIN_USER=root` 和 `MYSQL_ADMIN_PASSWORD=${MYSQL_ROOT_PASSWORD}`。
- 新增根级脚本生成 `.env`、启动服务、执行健康检查。
- `AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD` 不自动随机，必须由操作者提供或预先写入 `.env`，避免部署完成后无法登录。

## 验证

- 针对 bootstrap SQL 生成逻辑写最小单测
- `bash -n` 校验新脚本语法
- `docker compose config` 校验根编排
