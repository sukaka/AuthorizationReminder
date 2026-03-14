# Admin Center / Audit Center Design

**背景**

当前 `sysadmin` 和 `auditor` 的后台能力实际挂在提醒系统（`reminder`）内：
- 用户管理、安全配置在 `/Users/zhanglei/Documents/codex-new/server/index.js`
- 审计日志、验签、导出也在 `/Users/zhanglei/Documents/codex-new/server/index.js`
- 统一登录门户仅对 `sysadmin` 做了默认跳转到 `reminder`

这与目标不符：
- `sysadmin` 应进入独立的管理后台，负责用户管理和安全管理
- `auditor` 应进入独立的审计后台，负责审计日志查看、验签、导出
- 这两类能力在产品入口和服务职责上都不应再依赖 `reminder`

## 目标

建设两个独立系统：
- `admin-center`
- `audit-center`

并满足：
- `sysadmin` 登录后默认进入 `admin-center`
- `auditor` 登录后默认进入 `audit-center`
- 相关后端 API 从 `reminder` 迁移到 `auth` 服务内，避免继续依赖 `reminder`
- `reminder` 前端去掉面向 `sysadmin` / `auditor` 的后台承载职责

## 约束

- 尽量避免一次性拆分出全新 Node 服务和新数据库，优先复用 `auth` 服务当前已具备的能力：
  - 已连接同一个 MySQL 库
  - 已有 `users`、`send_configs`、`operation_logs` 的读写基础
  - 已有会话、MFA、权限、审计签名相关能力
- 变更应尽量保持小步推进，可独立验证
- 不能引入 reminder 反向代理作为长期方案

## 现状分析

### 已存在能力

`auth` 服务中已经具备：
- 统一登录门户和会话管理
- 用户表访问
- 安全配置读取 (`getSecurityConfig`)
- 审计日志签名与校验相关函数
- 系统入口聚合 (`/api/auth/apps`)

因此，`auth` 服务天然适合作为：
- `admin-center` 的宿主
- `audit-center` 的宿主

### 缺失能力

`auth` 服务当前缺少：
- 面向 `sysadmin` 的用户管理 API
- 面向 `sysadmin` 的安全配置 API
- 面向 `auditor` 的审计日志列表 / 导出 / 验签 API
- 独立后台页面路由与前端页面
- `admin-center` / `audit-center` 在门户中的系统定义与默认跳转规则

## 设计决策

### 1. 系统边界

新增两个系统 key：
- `admin-center`
- `audit-center`

系统职责：
- `admin-center`
  - 用户管理
  - 安全配置
  - 登录安全策略查看与修改
- `audit-center`
  - 审计日志查看
  - 审计链验签
  - 审计导出

`reminder` 不再承担这两类后台入口职责。

### 2. 服务落点

采用单服务承载的独立系统方案：
- `auth` 服务新增：
  - 页面路由：`/admin-center`、`/audit-center`
  - API 前缀：`/api/admin-center/*`、`/api/audit-center/*`

理由：
- 满足“和 reminder 无关”的系统边界
- 复用登录态和数据库连接，显著降低改造量
- 避免新建冗余服务和镜像

### 3. 门户默认跳转规则

- `sysadmin`
  - 无 `system` 参数时默认跳转 `admin-center`
- `auditor`
  - 无 `system` 参数时默认跳转 `audit-center`
- 其他角色
  - 保持现有行为，由门户展示可选系统

### 4. 默认系统权限

调整内置角色默认 `app_access`：
- `sysadmin` 默认只含 `admin-center`
- `auditor` 默认只含 `audit-center`

兼容策略：
- 已存在账号不强制清空旧 `app_access`
- 门户展示层优先展示新系统入口
- 后续可通过迁移脚本收敛历史数据

### 5. 页面实现

在 `auth` 服务中新增两个独立页面：
- `admin-center`
  - 用户列表
  - 创建/编辑/禁用/解锁/重置密码
  - 安全配置编辑
- `audit-center`
  - 审计日志列表
  - 验签结果
  - 导出按钮

实现原则：
- 第一版优先可用，不追求把 `reminder` 页面 1:1 复制过去
- 仅承载角色必需能力
- UI 风格沿用当前统一登录 / 后台样式体系，避免引入新构建链

### 6. API 迁移

从 `reminder` 迁移到 `auth` 的 API：
- `admin-center`
  - `GET /api/admin-center/users`
  - `POST /api/admin-center/users`
  - `PUT /api/admin-center/users/:id`
  - `POST /api/admin-center/users/:id/unlock`
  - `POST /api/admin-center/users/:id/reset-password`
  - `DELETE /api/admin-center/users/:id`
  - `GET /api/admin-center/security`
  - `POST /api/admin-center/security`
- `audit-center`
  - `GET /api/audit-center/logs`
  - `GET /api/audit-center/logs/export`
  - `GET /api/audit-center/logs/verify`
  - `GET /api/audit-center/logs/verify/export`

### 7. reminder 收口

第一阶段不删除 `reminder` 现有接口和 UI，先做到：
- 门户入口不再把 `sysadmin` / `auditor` 导向 `reminder`
- 新系统可独立完成职责

第二阶段再清理 reminder 中旧后台入口和相关冗余页面。

## 风险

### 风险 1：逻辑复制导致 auth 与 reminder 漂移

缓解：
- 优先抽出小型共享 helper，而不是整段复制大块代码
- 只迁移必要 API，避免过度搬运

### 风险 2：旧账号仍带有历史 app_access

缓解：
- 门户默认跳转以角色优先
- 新系统入口显式加入 apps 列表
- 后续补一条数据迁移脚本收敛默认权限

### 风险 3：前端页面从 reminder 拆出后缺少依赖样式

缓解：
- 第一版用 auth 内嵌页面 + 最小 CSS
- 先保证功能完整，再做视觉统一

## 验收标准

- `sysadmin` 登录后直接进入 `admin-center`
- `auditor` 登录后直接进入 `audit-center`
- `admin-center` 可独立完成用户管理与安全配置
- `audit-center` 可独立完成审计日志查看、验签、导出
- `reminder` 不再是 `sysadmin/auditor` 登录后的默认落点
