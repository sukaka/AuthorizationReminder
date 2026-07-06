# 聚信 AI 助手 Web 版部署说明

## 目标

让员工通过公网 HTTPS 地址访问聚信 AI 助手。Web 版只开放给已通过统一登录授权的聚信内部员工和管理员。

## 构建

前端构建：

```bash
cd apps/desktop
npm run build:web
```

后端启动前确认静态目录：

```bash
WEB_SPA_ENABLED=true
WEB_STATIC_DIR=/opt/juxin-ai-assistant/web
PUBLIC_URL=https://ai.example.com
CORS_ORIGINS=https://ai.example.com
AUTH_PUBLIC_URL=https://auth.example.com
AUTH_SERVICE_URL=http://auth:5180
AUTH_DEV_BYPASS=false
```

如果前端构建产物直接复制到后端服务器，推荐将 `apps/desktop/dist` 内容同步到 `WEB_STATIC_DIR` 指向的目录：

```bash
rsync -av --delete apps/desktop/dist/ /opt/juxin-ai-assistant/web/
```

## 必需安全配置

- 全站必须使用 HTTPS。
- `CORS_ORIGINS` 只能配置正式 Web 域名。
- `AUTH_DEV_BYPASS=false`。
- `PROMPT_CENTER_RUNTIME_TOKEN`、`CONTENT_ENCRYPTION_KEY`、`AUDIT_HASH_SALT`、`AI_LOCAL_BINDING_SECRET` 必须通过环境变量配置。
- 不允许把真实密钥写入 `.env.example`、文档、日志或前端构建产物。
- 生产环境不要启用开发代理，不要暴露本地 Vite 服务端口。
- 日志中不要输出完整 API Key、Cookie、Bearer Token 或本地绑定令牌。

## Nginx / Ingress 路由

- `/` 指向 FastAPI 或静态资源服务。
- `/api/*` 指向 FastAPI。
- `/assets/*` 指向 Web 静态资源。
- 不开放服务器真实上传目录、导出目录和本地 SQLite 数据库文件。
- 如果由 Nginx 直接托管静态资源，仍需将 API 请求转发到 FastAPI，并保留统一登录 Cookie。

示例路由结构：

```nginx
location /api/ {
  proxy_pass http://juxin-ai-assistant-api;
}

location /assets/ {
  root /opt/juxin-ai-assistant/web;
}

location / {
  try_files $uri /index.html;
}
```

## 统一登录

- Web 版使用统一登录 Cookie，不依赖桌面端 SSO Bearer Token。
- 未登录访问业务接口应返回 `401`。
- 已登录但无权限访问管理能力时应返回 `403`。
- `AUTH_PUBLIC_URL` 必须是用户浏览器可访问的统一登录地址。
- `AUTH_SERVICE_URL` 是后端访问统一登录服务的内网地址。

## Word 导出

- Web 版导出 Word 时通过浏览器下载。
- 下载链接不得暴露服务器真实文件路径。
- 桌面端仍保留本地保存和打开 Word 的能力。

## 验收

1. 未登录访问 `/` 后进入统一登录流程。
2. 未登录访问 `/api/ai/session` 返回 `401`。
3. 登录员工可以进入工作台。
4. 普通员工访问管理接口返回 `403`。
5. 不可信 Origin 发起写请求返回 `403`。
6. 可以完成聊天生成。
7. 可以上传当前附件。
8. 可以导出并下载 Word。
9. 下载链接不暴露服务器真实路径。
10. 日志不包含完整 API Key、Cookie 或 Bearer Token。
11. 桌面端打包脚本仍可用。

## 发布前检查命令

前端检查：

```bash
cd apps/desktop
npm test -- runtime-platform.test.ts session.test.tsx web-mode.test.tsx web-downloads.test.ts web-build-boundary.test.ts
npm run typecheck
npm run build:web
```

后端检查：

```bash
cd server
pytest tests/test_static_web.py tests/test_web_public_security.py tests/test_auth.py tests/test_secret_boundary.py -q
```

重点用户流检查：

```bash
cd apps/desktop
npm test -- employee-flow.test.tsx chat-page.test.tsx task\-run.test.tsx knowledge-page.test.tsx
```

## 回滚

- 如果 Web 静态服务异常，可以先将 `WEB_SPA_ENABLED=false`，只保留 API 服务。
- 如果统一登录异常，优先检查 `AUTH_PUBLIC_URL`、`AUTH_SERVICE_URL`、Cookie 域名和 HTTPS 证书。
- 如果写请求被误拦，检查 `CORS_ORIGINS` 是否包含正式 Web 域名，且前端访问地址与配置完全一致。
