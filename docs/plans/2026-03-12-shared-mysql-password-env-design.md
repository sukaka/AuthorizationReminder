# Shared MySQL Password Env Cleanup Design

日期：2026-03-12

## 目标

移除根 `docker-compose.yml`、服务默认配置、示例环境文件和部署文档中的旧默认数据库密码硬编码，统一改为环境变量驱动。

## 设计

- 复用现有 `MYSQL_ROOT_PASSWORD` 作为所有需要管理员权限的服务初始化密码，不额外引入第二个 root 密码变量，避免漂移。
- 继续复用 `MYSQL_SHARED_APP_PASSWORD` 作为 Reminder / Ticketing / Inventory / Device Flow 共享账号 `juxin` 的业务密码。
- 为已在 Compose 中硬编码独立密码的服务补齐显式变量：
  - `SEC_IMPL_MYSQL_PASSWORD`
  - `TENDER_MYSQL_PASSWORD`
- 服务代码去掉旧默认业务库密码回退，避免本地运行时悄悄落回历史配置。
- `.env.example` 与各子系统 `.env.example` 统一改成占位值，不再提供可直接投入运行的弱默认密码。

## 验证

- `docker compose --env-file .env.example config`
- `node --check` 针对受影响 JS 文件做语法检查
- 全仓库检索旧默认数据库密码字面量
