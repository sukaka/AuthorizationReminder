# 全系统本地 HTTPS 设计

## 目标

所有浏览器和 HTTP API 对外入口只通过 HTTPS 访问，同时保留现有端口，避免修改各 SPA 的基础路径。提供可重复生成的本地测试 CA 和服务器证书，用于 `localhost`、回环地址和指定局域网 IP 测试。

## 范围

统一 TLS 网关接管以下对外端口：

- AI 助手兼容入口：`443`
- 认证与 API：`5179`、`5180`、`5182` 至 `5193`
- CMDB Web：`8090`
- 各业务 Web：`18080` 至 `18093`

其中 `18090`、`18091` 分别保留 Dependency-Track API 和前端入口。MySQL、PostgreSQL、Redis 等非 HTTP 协议端口不套用 HTTPS，且不纳入“系统访问入口”。

## 架构

新增一个 Nginx TLS 网关容器。网关在上述端口启用 TLS，并按端口代理到 Docker 网络内现有服务。业务容器继续使用内部 HTTP，原始宿主机 HTTP 端口在 HTTPS Overlay 中全部移除。

用户地址保持端口不变，例如：

- `https://localhost:5180`：统一登录
- `https://localhost:18082`：库存系统
- `https://localhost:18093`：AI 助手

HTTP 访问不会降级或旁路到业务容器。浏览器必须完成 TLS 握手。

## URL 与 Cookie

HTTPS Overlay 将统一覆盖：

- `AUTH_PUBLIC_URL`
- Auth 的全部 `APP_*_URL`
- 各 API 的 `CORS_ORIGINS`
- 各服务公开 URL
- `AUTH_COOKIE_SECURE=true`
- `AUTH_SECURITY_STRICT_MODE=true`

服务间通信仍使用 Docker 内部 HTTP 地址，不把本地 CA 注入业务容器。

## 本地证书

新增脚本生成：

- 本地测试根 CA
- 由该 CA 签发的服务器证书
- SAN：`localhost`、`127.0.0.1`、`::1`、用户传入的主机名或 IP

生成目录默认位于仓库忽略范围，CA 私钥和服务器私钥永不提交。脚本不读取或覆盖生产证书。用户需要手动信任根 CA；自动导入系统钥匙串不属于脚本职责。

## 配置与操作

提供独立 HTTPS Compose Overlay 和启动脚本。启动脚本负责：

1. 校验证书、私钥和公开主机。
2. 渲染 Compose 配置。
3. 构建并启动业务服务与统一 TLS 网关。
4. 输出各系统 HTTPS 地址。

生产环境可复用 Overlay，但必须显式传入正式证书路径；本地生成证书只能用于测试。

## 安全边界

- 不提交任何私钥、真实证书、密码或 Token。
- 不给数据库端口伪装 HTTPS。
- HTTPS Overlay 下不发布业务容器的原始 HTTP 端口。
- TLS 最低版本为 1.2。
- 发送 HSTS、`X-Content-Type-Options`、`Referrer-Policy` 和 `X-Frame-Options` 响应头。
- 本地 CA 与正式生产 CA 明确分离。

## 验收

- Compose 渲染结果只由 TLS 网关发布上述 30 个 HTTPS 系统端口。
- 每个网关监听端口代理到正确服务和容器端口。
- Auth 跳转和应用入口全部为 `https://`。
- HTTPS Cookie 安全开关启用。
- 本地证书 SAN 包含默认地址和指定测试地址。
- 使用 CA 证书执行 HTTPS 冒烟检查成功；对应 HTTP 请求无法直接访问业务服务。
- 现有基础 Compose 仍可用于纯开发，不强制加载 HTTPS Overlay。
