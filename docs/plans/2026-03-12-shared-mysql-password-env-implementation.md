# Shared MySQL Password Env Cleanup Implementation

日期：2026-03-12

## 实施步骤

1. 修改根 `docker-compose.yml`
   - 共享账号改用 `MYSQL_SHARED_APP_PASSWORD`
   - 所有管理员密码改用 `MYSQL_ROOT_PASSWORD`
   - `sec-impl` / `tender` 应用密码改为独立环境变量
2. 修改受影响服务默认值
   - 移除 `inventory` / `device-flow` / 测试代码中的旧默认业务库密码回退
3. 修改 `.env.example`
   - 根模板与子系统模板统一改为占位值
4. 修改部署文档
   - 明确必须先创建根 `.env`
5. 验证
   - 渲染 Compose
   - 语法检查
   - 仓库检索硬编码残留
