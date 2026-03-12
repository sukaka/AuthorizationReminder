# Runtime Middleware Image Policy Design

## Goal
在不触碰 `node`、`golang`、`alpine` 构建基底的前提下，升级仓库内运行时中间件镜像到更安全、更新且兼容当前部署拓扑的版本线，降低已知漏洞暴露面。

## Scope
- 包含：`nginx`、`mysql`、`onlyoffice/documentserver`、`confluentinc/cp-kafka`、`confluentinc/cp-zookeeper`、`provectuslabs/kafka-ui`
- 不包含：`node`、`golang`、`alpine` 等构建阶段基础镜像

## Constraints
- 不能把所有状态型中间件都直接改成原始 `latest`。
- `cmdb/deploy/docker-compose.yml` 仍然使用 ZooKeeper 模式 Kafka，不能升级到 Confluent Platform 8.x，因为官方从 8.0 起移除了 ZooKeeper。
- MySQL 是持久化数据服务，不能使用可能跨主版本的浮动标签，否则会引入数据目录和启动参数不兼容风险。

## Recommended Policy
- Nginx：改为 `nginx:alpine`
  - 含义：跟随官方最新 Alpine 运行时。
  - 风险：镜像内系统包会变化，但对静态资源前端服务影响可控。
- OnlyOffice：保留 `onlyoffice/documentserver:latest`
  - 已经验证当前 Dockerfile 能基于 `latest` 继续构建。
- MySQL：默认回退为 `mysql:8.0`
  - 原因：当前服务器镜像加速环境无法稳定拉取 `mysql:8.4`，先回退到当前可部署的 `8.0` 线。
- Kafka / ZooKeeper：改为 `confluentinc/cp-kafka:7.8.7` / `confluentinc/cp-zookeeper:7.8.7`
  - 这是当前仍兼容 ZooKeeper 模式的较新 7.x 线，避免 8.x 移除 ZooKeeper 带来的架构断裂。
- Kafka UI：保留 `provectuslabs/kafka-ui:latest`

## Files To Change
- `docker-compose.yml`
- `cmdb/deploy/docker-compose.yml`
- `scripts/deploy/resolve-image-sources.sh`
- `scripts/tests/aliyun-image-resolution.sh`
- 所有使用 Nginx 运行时镜像参数的前端 Dockerfile
- 文档：`docs/deploy-docker.md`、已有镜像策略设计/实施文档

## Verification
- `bash -n scripts/deploy/resolve-image-sources.sh`
- `bash -n scripts/deploy/docker-compose-aliyun.sh`
- `bash scripts/tests/aliyun-image-resolution.sh`
- `./scripts/deploy/docker-compose-aliyun.sh config`
- 至少对 `onlyoffice` 做一次定向构建验证，确认 `latest` 路径可用
