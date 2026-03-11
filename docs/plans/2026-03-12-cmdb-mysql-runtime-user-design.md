# CMDB 独立 MySQL 运行账号设计

**日期：** 2026-03-12  
**范围：** `/Users/zhanglei/Documents/codex-new/cmdb`、根目录 `docker-compose.yml`、`cmdb/deploy/docker-compose.yml`、相关文档与示例环境变量  
**目标：** 让 CMDB 运行时不再使用 MySQL `root` 账号，而是使用独立业务账号 `cmdb_user`，并通过环境变量注入密码。

## 背景

当前 CMDB 服务虽然已经只依赖 MySQL，但运行时仍然使用 `root` 直连 `cmdb` 库：

- 根目录 `docker-compose.yml` 中，`cmdb` 的 `MYSQL_DSN` 仍为 `root@cmdb`
- `cmdb/deploy/docker-compose.yml` 中，独立部署版同样使用 `root@cmdb`
- `cmdb-mysql-init` 使用硬编码 root 密码执行初始化 SQL

这会带来两个问题：

- 运行时权限过大，业务服务具备不必要的数据库全局能力
- 密码管理不一致，部分链路仍然依赖硬编码开发密码

## 目标

- CMDB 运行时改用独立账号 `cmdb_user`
- 密码统一通过环境变量 `CMDB_MYSQL_PASSWORD` 管理
- 初始化链路继续使用 root，但 root 密码也改为环境变量读取
- 根目录 compose 与 `cmdb/deploy` 独立部署都能自动完成账号创建与授权
- 不修改 Go 应用配置结构，仍保持 `MYSQL_DSN` 作为唯一数据库连接入口

## 非目标

- 不引入读写分离账号
- 不调整 CMDB 表结构
- 不改变其他系统的数据库账号模型
- 不将 CMDB 从单 DSN 模式重构为 host/user/password 多字段模式

## 方案选型

### 方案 A：固定账号 + 密码走环境变量（采纳）

- 运行时账号固定为 `cmdb_user`
- 密码由 `CMDB_MYSQL_PASSWORD` 注入
- 初始化任务负责建用户和授权

优点：
- 改动最小
- 权限边界清晰
- 与现有 `MYSQL_DSN` 配置方式兼容

缺点：
- 账号名固定，不做额外灵活抽象

### 方案 B：账号名和密码都走环境变量

- 新增 `CMDB_MYSQL_USER` 与 `CMDB_MYSQL_PASSWORD`

优点：
- 灵活性更高

缺点：
- 当前场景没有收益，增加配置复杂度和误配风险

### 方案 C：拆读写账号

- 区分只读与读写连接

优点：
- 权限最细粒度

缺点：
- 当前代码只有一个 DSN，改造成本明显更高，属于过度设计

## 详细设计

### 1. 运行时账号模型

- 新增业务账号：`cmdb_user`@`%`
- 授予权限：`SELECT`、`INSERT`、`UPDATE`、`DELETE` on `cmdb.*`
- 不授予 DDL、授权管理或全局权限

这样 CMDB 运行时只能读写业务表，不能建表、删库或管理用户。

### 2. 初始化链路

新增一个可复用的初始化脚本，供根目录 compose 与 `cmdb/deploy` 共同使用：

- 等待 MySQL 可连接
- 执行 `001_init_cmdb.sql`，完成建库建表
- 使用 root 账号创建或重设 `cmdb_user`
- 授权 `cmdb.*`
- 刷新权限并退出

脚本读取下列环境变量：

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_ROOT_PASSWORD`
- `CMDB_MYSQL_PASSWORD`
- `INIT_SQL_PATH`

### 3. Compose 改造

#### 根目录 `docker-compose.yml`
- `cmdb-mysql-init` 改为挂载并执行统一初始化脚本
- 注入 `MYSQL_ROOT_PASSWORD`、`CMDB_MYSQL_PASSWORD`、`MYSQL_HOST=mysql`、`MYSQL_PORT=3306`
- `cmdb` 服务的 `MYSQL_DSN` 改为 `cmdb_user:${CMDB_MYSQL_PASSWORD}@tcp(mysql:3306)/cmdb?...`

#### `cmdb/deploy/docker-compose.yml`
- 新增一次性初始化任务 `cmdb-db-init`
- 通过 `host.docker.internal:3308` 访问宿主机 MySQL
- 注入 `MYSQL_ROOT_PASSWORD` 与 `CMDB_MYSQL_PASSWORD`
- `cmdb` 依赖 `cmdb-db-init` 完成后再启动
- `MYSQL_DSN` 改为 `cmdb_user:${CMDB_MYSQL_PASSWORD}@tcp(host.docker.internal:3308)/cmdb?...`

### 4. 文档与示例配置

需要同步更新：

- 根目录 `README.md`
- `cmdb/README.md`
- `cmdb/deploy/README.md`
- `docs/manuals/system-mysql-topology.md`
- `cmdb/.env.example`
- 版本说明中列出的环境变量清单

重点说明：

- 新增 `CMDB_MYSQL_PASSWORD`
- `cmdb` 运行时不再使用 root
- 本地独立部署也会自动初始化 `cmdb_user`

## 风险与控制

### 风险
- `CMDB_MYSQL_PASSWORD` 未设置时，compose 会启动失败或初始化失败
- `cmdb/deploy` 若没有 root 密码环境变量，独立部署无法自动建账号
- 若权限授予过少，某些写路径可能失败

### 控制措施
- 初始化脚本对关键环境变量做显式校验
- 通过脚本测试验证授权 SQL 被正确生成
- 使用运行态验证确认 `cmdb_user` 可访问业务接口
- 通过 `SHOW GRANTS FOR 'cmdb_user'@'%'` 验证最终权限

## 验证方案

1. 脚本验证
   - 运行 shell 测试，确认初始化脚本会使用环境变量创建 `cmdb_user`
2. 应用验证
   - `cd /Users/zhanglei/Documents/codex-new/cmdb && go test ./...`
3. 运行态验证
   - `docker compose up -d --build cmdb-mysql-init cmdb web-cmdb`
   - 容器内访问 `http://127.0.0.1:8088/healthz`
   - MySQL 中执行 `SHOW GRANTS FOR 'cmdb_user'@'%'`
4. 业务冒烟
   - 登录后访问模型管理页
   - 调用 `GET /api/v1/models`

## 回滚策略

- 将 `cmdb` 的 `MYSQL_DSN` 改回 root
- 停用初始化脚本中的 `cmdb_user` 创建逻辑
- 保留 `cmdb_user` 账号不影响回滚，必要时可后续手工删除

这次改造不涉及表结构变更，回滚风险主要在运行配置层。
