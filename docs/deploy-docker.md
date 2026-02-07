# Docker 部署（MySQL + Nginx）

## 依赖
- Docker + Docker Compose

## 启动
```bash
docker compose up --build
```

## 访问
- 前端：`http://localhost:8080`
- 后端：`http://localhost:5179`（如需直连）

## 数据库
默认使用 MySQL：
- 数据库：`juxin_reminder`
- 用户：`juxin`
- 密码：`juxinpass`
- Root 密码：`rootpass`

如需修改，请编辑 `docker-compose.yml` 中的环境变量。

## 架构说明
- 采用官方多架构镜像（`node:20` / `mysql:8.0` / `nginx:1.25`），可在 x86_64 与 arm64 环境构建运行。
- 如需跨架构构建，可使用 `docker buildx` 指定 `--platform`。

## CORS/CSRF
- 默认仅允许 `localhost:5173/8080` 等开发地址访问接口。
- 生产环境可在 `docker-compose.yml` 的 `api` 服务里设置 `CORS_ORIGINS`，例如：`https://your-domain.com`。
- 前端已自动携带 CSRF Token，用于所有 `POST/PUT/DELETE` 请求。
