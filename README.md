# 聚信授权到期提醒系统

一个用于管理客户授权到期提醒的系统，支持客户/联系人管理、授权管理、发送计划、发送渠道配置、操作日志与安全配置。前端采用 Vite + React，后端采用 Node.js + Express，支持 MySQL 与 Docker 一键部署。

## 功能概览
- 客户管理：维护客户名称、聚信销售、渠道销售
- 联系人管理：联系人信息、客户关联、状态启停
- 授权管理：到期日期、提醒天数、状态
- 发送计划：选择联系人/授权/渠道与提醒天数
- 发送渠道配置：邮箱、阿里云短信、企业微信
- 操作日志：登录/登出/关键操作记录，支持筛选与导出
- 安全配置：登录失败限制、登录验证码、二次验证
- 账号安全：每个用户可独立启用二次验证与谷歌认证（支持扫码）

## 快速开始（Docker）
```bash
docker compose up --build
```

访问：
- 前端：`http://localhost:8080`
- 后端：`http://localhost:5179`

默认数据库端口映射为：主机 `3308` → 容器 `3306`。

## 默认账号
- 用户名：`admin`
- 密码：`123456`

首次登录后请尽快修改密码。

## 运行环境与端口
- 前端（Nginx）：`8080`
- 后端（Node/Express）：`5179`
- MySQL：`3308`（宿主机）

## 配置说明
可在 `docker-compose.yml` 的 `api` 环境变量中配置：
- `CORS_ORIGINS`：允许的来源（逗号分隔），例如：`http://公网IP:8080,https://your-domain.com`
- `JWT_SECRET`：JWT 签名密钥（建议生产环境配置）
- `CSRF_SECURE`：是否强制 CSRF Cookie 为 `Secure`（HTTPS 场景设置为 `true`）
- `CONFIG_SECRET_KEY`：用于加密存储邮箱密码/短信密钥/企业微信 Secret（建议设置为至少32位随机字符串）

数据库可配置：
- `MYSQL_HOST` / `MYSQL_PORT`
- `MYSQL_USER` / `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

## 发送配置注意事项
- 邮箱/短信/企业微信配置修改后必须点击“保存配置”，否则测试发送会提示未保存。
- 敏感信息会加密存储，若未配置 `CONFIG_SECRET_KEY` 将无法保存新的密码/密钥。

## 本地开发
```bash
npm install
npm run dev
```

## 目录结构
```
server/         后端服务与数据库初始化
web/            前端应用
docker-compose.yml  Docker 编排
web/nginx.conf  前端 Nginx 配置
```

## 安全说明
- 默认开启 CSRF 保护，前端会自动获取并携带 `X-CSRF-Token`
- CORS 默认仅允许 `localhost` 与 `8080/5173`，公网访问需配置 `CORS_ORIGINS`

## 常见问题
1. **CORS 报错**
   - 在 `docker-compose.yml` 的 `api` 环境变量中设置 `CORS_ORIGINS` 为你的访问域名/公网IP

2. **登录 403（CSRF）**
   - 使用 HTTP 时请不要开启 `CSRF_SECURE=true`
   - 使用 HTTPS 时可设置 `CSRF_SECURE=true`

## 技术栈
- 前端：React + Vite
- 后端：Node.js + Express
- 数据库：MySQL
- 部署：Docker + Nginx
