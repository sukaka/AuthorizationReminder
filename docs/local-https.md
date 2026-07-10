# 全系统本地 HTTPS

本地 HTTPS Overlay 使用一个 Nginx 网关接管现有 Web 与 HTTP API 端口。应用容器不再直接向宿主机发布 HTTP；Docker 网络内部通信保持 HTTP。

## 生成证书

为本机生成测试 CA 和服务器证书：

```bash
scripts/dev/generate-local-https-cert.sh --host localhost
```

局域网测试时填写实际 IP：

```bash
scripts/dev/generate-local-https-cert.sh --host 192.168.3.33
```

默认证书位于 `.local/https/`，该目录已被 Git 忽略。`local-ca-key.pem` 和 `server-key.pem` 均为私钥，禁止发送、提交或复制到不受控设备。

## 信任测试 CA

macOS 可在确认路径无误后执行：

```bash
sudo security add-trusted-cert \
  -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  .local/https/local-ca.pem
```

也可以用“钥匙串访问”导入 `local-ca.pem` 并设为始终信任。其他访问设备也必须单独导入 CA。只导入 `local-ca.pem`，绝不导入任何 `*-key.pem`。

## 启动

启动全部系统并重建镜像：

```bash
scripts/dev/start-local-https.sh --host localhost
```

使用局域网 IP：

```bash
scripts/dev/start-local-https.sh --host 192.168.3.33
```

已有最新镜像时可加 `--skip-build`。使用 `--dry-run` 只生成证书并打印 Compose 命令。

主要入口：

- 统一登录：`https://HOST:5180`
- 提醒系统：`https://HOST:18080`
- 工单系统：`https://HOST:18081`
- 库存系统：`https://HOST:18082`
- 设备流转：`https://HOST:18083`
- 交付系统：`https://HOST:18084`
- FAQ：`https://HOST:18085`
- 标书系统：`https://HOST:18086`
- 培训考试：`https://HOST:18087`
- 提示词中心：`https://HOST:18088`
- SCA：`https://HOST:18089`
- Dependency-Track：`https://HOST:18091`
- 大屏：`https://HOST:18092`
- AI 助手：`https://HOST:18093`
- AI 助手兼容入口：`https://HOST`
- CMDB：`https://HOST:8090`

## 验证

```bash
curl --cacert .local/https/local-ca.pem https://localhost:5180/health
curl --cacert .local/https/local-ca.pem https://localhost/
curl --cacert .local/https/local-ca.pem https://localhost:18093/
```

检查 Overlay：

```bash
ALL_SYSTEMS_TLS_CERT="$PWD/.local/https/server.pem" \
ALL_SYSTEMS_TLS_KEY="$PWD/.local/https/server-key.pem" \
HTTPS_PUBLIC_HOST=localhost \
docker compose \
  -f docker-compose.yml \
  -f docker-compose.all-systems-https.yml \
  config --quiet
```

HTTP 请求不应直接进入应用；下面命令只有在 HTTP 被拒绝时才成功：

```bash
if curl --fail --max-time 3 http://localhost:18093/; then
  echo "错误：HTTP 入口仍可访问" >&2
  exit 1
fi
```

## 生产使用

生产环境可以复用 Overlay，但必须通过受控路径传入正式证书和私钥。禁止使用本地测试 CA 充当生产 CA。生产证书私钥不得进入 Git、镜像或日志。

## 回退

停止 TLS 网关后，重新用基础 Compose 启动原端口：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.all-systems-https.yml \
  stop https-gateway

docker compose -f docker-compose.yml up -d
```

回退会恢复基础 Compose 的 HTTP 发布，仅用于故障处理或开发，不应作为生产配置。
