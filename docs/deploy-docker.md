# Docker 部署（MySQL + Nginx）

## 依赖
- Docker + Docker Compose

## 启动
```bash
cp .env.example .env
# 编辑 .env，填入真实密码与密钥
./scripts/deploy/docker-compose-aliyun.sh up --build
```

如已将基础镜像同步到阿里云 ACR，可在根 `.env` 中设置以下可选前缀：

- `ALIYUN_DOCKERHUB_PREFIX`
- `ALIYUN_ONLYOFFICE_PREFIX`
- `ALIYUN_CONFLUENTINC_PREFIX`
- `ALIYUN_PROVECTUSLABS_PREFIX`

包装脚本会先探测阿里云候选镜像，探测失败时自动回退官方镜像。

## 访问
- 前端：`http://localhost:8080`
- 后端：`http://localhost:5179`（如需直连）

## 数据库
默认使用 MySQL：
- 数据库：`juxin_reminder`
- 用户：`juxin`
- 业务共享密码：来自根 `.env` 的 `MYSQL_SHARED_APP_PASSWORD`
- Root 密码：来自根 `.env` 的 `MYSQL_ROOT_PASSWORD`

如需修改，请编辑根目录 `.env`。推荐先从 [`.env.example`](/Users/zhanglei/Documents/codex-new/.env.example) 复制。

## 架构说明
- 采用官方多架构镜像（`node:20` / `mysql:8.0` / `nginx:1.25`），可在 x86_64 与 arm64 环境构建运行。
- 如需跨架构构建，可使用 `docker buildx` 指定 `--platform`。

## CORS/CSRF
- 默认仅允许 `localhost:5173/8080` 等开发地址访问接口。
- 生产环境可在 `docker-compose.yml` 的 `api` 服务里设置 `CORS_ORIGINS`，例如：`https://your-domain.com`。
- 前端已自动携带 CSRF Token，用于所有 `POST/PUT/DELETE` 请求。
