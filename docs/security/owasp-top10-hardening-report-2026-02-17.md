# OWASP Top 10 安全加固总报告（分系统）

- 报告日期：2026-02-17
- 范围：提醒系统（reminder）、工单系统（ticketing）、CMDB、库存系统（inventory + shipping-gateway + web-inventory）
- 执行方式：按系统逐个落地（非四系统并行）

## 1. 执行结论

本轮已完成四个系统的基础 OWASP Top 10 加固，重点覆盖：

- A01 访问控制：统一鉴权链收敛、角色校验、受保护资源访问路径
- A03 注入：SQL 参数化、CSV 公式注入防护、输入格式校验
- A04 不安全设计：统一超时、限流、可观测的错误边界
- A05 安全配置错误：CORS 白名单、安全响应头、关闭 `x-powered-by`、代理信任配置
- A06 组件风险：依赖审计并识别未修复上游风险
- A09 日志与监控：关键操作审计写入、错误日志标准化

## 2. 各系统已完成加固

### 2.1 提醒系统（Reminder）

关键落地点：

- 严格模式与启动前安全校验：`/Users/zhanglei/Documents/codex-new/server/index.js:36`
- 鉴权请求超时封装：`/Users/zhanglei/Documents/codex-new/server/index.js:111`
- API 分级限流：`/Users/zhanglei/Documents/codex-new/server/index.js:376`
- 关闭 `x-powered-by`：`/Users/zhanglei/Documents/codex-new/server/index.js:360`
- 截图改为受保护读取接口：`/Users/zhanglei/Documents/codex-new/server/index.js:2339`
- 全局错误处理：`/Users/zhanglei/Documents/codex-new/server/index.js:4283`

配套前端联动（截图授权访问）：

- `/Users/zhanglei/Documents/codex-new/web/src/App.jsx:1386`

### 2.2 工单系统（Ticketing）

关键落地点：

- 严格模式与启动校验：`/Users/zhanglei/Documents/codex-new/ticketing/index.js:14`
- 鉴权请求超时：`/Users/zhanglei/Documents/codex-new/ticketing/index.js:86`
- 关闭 `x-powered-by`：`/Users/zhanglei/Documents/codex-new/ticketing/index.js:150`
- 附件 MIME 白名单配置：`/Users/zhanglei/Documents/codex-new/ticketing/index.js:23`
- 全局错误处理：`/Users/zhanglei/Documents/codex-new/ticketing/index.js:3255`

### 2.3 CMDB

关键落地点：

- 安全配置项（鉴权超时、请求体大小、限流、可信代理）：`/Users/zhanglei/Documents/codex-new/cmdb/internal/config/config.go:45`
- 安全中间件（安全头、Body 限制、IP 限流）：`/Users/zhanglei/Documents/codex-new/cmdb/internal/middleware/security.go:17`
- 路由绑定安全中间件与代理策略：`/Users/zhanglei/Documents/codex-new/cmdb/internal/handler/router.go:19`
- 鉴权响应读取限幅、角色上下文：`/Users/zhanglei/Documents/codex-new/cmdb/internal/auth/middleware.go:71`
- 移除可伪造请求头的操作者来源，改为鉴权上下文：`/Users/zhanglei/Documents/codex-new/cmdb/internal/handler/ci_handler.go:195`
- Dashboard 查询 `LIMIT ?` 参数化：`/Users/zhanglei/Documents/codex-new/cmdb/internal/repository/dashboard_repository.go:72`

### 2.4 库存系统（Inventory）

#### 2.4.1 inventory-api

- 鉴权超时、限流、可信代理：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:35`
- 关闭 `x-powered-by`：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:96`
- 通用 fetch 超时封装：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:388`
- `Bearer` 解析收敛与 token 长度校验：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:1066`
- `/api` 全局限流挂载：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:1351`
- CSV 公式注入防护：`/Users/zhanglei/Documents/codex-new/inventory-system/backend/src/index.js:960`

#### 2.4.2 shipping-gateway

- CORS 白名单：`/Users/zhanglei/Documents/codex-new/inventory-system/shipping-gateway/src/index.js:47`
- IP 限流中间件：`/Users/zhanglei/Documents/codex-new/inventory-system/shipping-gateway/src/index.js:61`
- 常量时间 token 比较：`/Users/zhanglei/Documents/codex-new/inventory-system/shipping-gateway/src/index.js:96`
- `/api` 限流挂载：`/Users/zhanglei/Documents/codex-new/inventory-system/shipping-gateway/src/index.js:463`
- 快递单号格式校验：`/Users/zhanglei/Documents/codex-new/inventory-system/shipping-gateway/src/index.js:517`

#### 2.4.3 web-inventory (nginx)

- 安全头 + CSP：`/Users/zhanglei/Documents/codex-new/inventory-system/frontend/nginx.conf:16`
- API 方法限制：`/Users/zhanglei/Documents/codex-new/inventory-system/frontend/nginx.conf:28`
- `index.html` 禁缓存：`/Users/zhanglei/Documents/codex-new/inventory-system/frontend/nginx.conf:31`

## 3. 运行验证与结果

已执行验证：

- 语法与构建：
  - `node --check`（inventory-api / shipping-gateway）通过
  - `npm run build`（web-inventory）通过
  - `docker compose config` 通过
- 运行时验证（2026-02-17）：
  - `web-inventory` 首页返回安全头（`CSP/X-Frame-Options/X-Content-Type-Options`）
  - `TRACE /api/health` 返回 `405`
  - 非白名单 Origin 请求 inventory-api / shipping-gateway 返回 `403`
  - shipping-gateway 触发限流返回 `429`

## 4. 剩余风险与改进建议（按优先级）

### P1（上线前建议完成）

1. 统一登录 token 仍保存在前端 `sessionStorage`（受 XSS 影响面较大）
- 证据：
  - `/Users/zhanglei/Documents/codex-new/web/src/App.jsx:165`
  - `/Users/zhanglei/Documents/codex-new/ticketing/web/src/App.jsx:304`
  - `/Users/zhanglei/Documents/codex-new/cmdb/web/src/App.jsx:225`
  - `/Users/zhanglei/Documents/codex-new/inventory-system/frontend/src/App.jsx:450`
- 建议：迁移到 HttpOnly + Secure + SameSite Cookie 会话方案（由 auth 服务签发，业务服务仅验证）。

2. 配置中的密钥目前以明文环境变量维护（尤其 `docker-compose.yml`）
- 建议：切换 Secret Manager（K8s Secret/Vault/云 KMS），并执行密钥轮换。

### P2（1-2 个迭代内）

1. 依赖风险：`xlsx` 在部分模块存在上游高危且无官方修复版本
- 结果：
  - 根服务 backend 审计存在 `xlsx` 高危
  - `cmdb/web` 审计存在 `xlsx` 高危
- 建议：
  - 生产默认禁用 Excel 导入/解析路径，或改为受控转换服务
  - 评估替代库并逐步替换 `xlsx`

2. `vite/esbuild` 的中危项主要作用于开发服务器场景
- 建议：
  - 生产环境严禁暴露 dev server
  - 统一升级到可用的安全版本窗口（结合前端主版本兼容性）

### P3（持续优化）

1. 统一安全基线自动化（SAST + dependency audit + container scan）纳入 CI
2. 增加告警聚合（登录失败暴增、429 暴增、跨域拒绝异常增长）
3. 审计日志完整性增强（签名/防篡改存储）

## 5. 上线检查清单（Go-Live Checklist）

1. 环境变量与密钥
- 生产 `JWT/AUDIT_SIGNING_KEY/网关 token` 已替换为强随机值
- 非必要的演示开关关闭（如 mock 开关）

2. 边界策略
- 仅允许业务域名在 `CORS_ORIGINS`
- `TRUSTED_PROXIES` 按实际网关链路设置

3. 流量治理
- 核对各服务 `RATE_LIMIT_WINDOW_SEC/RATE_LIMIT_MAX` 与业务峰值
- 确保 429 被前端友好处理

4. 组件与依赖
- 对 `xlsx` 使用路径做灰度开关与监控
- 固定 lockfile，构建流程启用 `npm ci`

5. 运维与监控
- 接入集中日志、错误告警、审计留存策略
- 备份策略验证（MySQL/Mongo）

## 6. 后续建议执行顺序

1. 先完成统一登录 Cookie 化（最高优先）
2. 再做 `xlsx` 替代/隔离
3. 最后补齐 CI 自动化安全门禁

