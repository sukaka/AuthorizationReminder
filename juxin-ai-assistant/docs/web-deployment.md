# 聚信 AI 助手 Web 版 HTTPS 部署

## 地址模型

生产 Web、API、统一登录共用一个 HTTPS Origin：

```text
https://服务器IP:8443/                 Web
https://服务器IP:8443/api/ai/*        AI API
https://服务器IP:8443/portal          统一登录
https://服务器IP:8443/api/auth/*      登录 API
```

这样登录 Cookie、CORS、回跳地址没有跨域差异。生产 Overlay 会移除 AI API、Web、Auth 的宿主机直出端口，只开放非标准 HTTPS 端口 `8443`。桌面端仍使用服务端下发的统一登录地址。

## 1. 准备证书

公网域名推荐使用受信任 CA 证书。只有 IP 时可创建带 IP SAN 的自签证书：

```bash
SERVER_IP=192.0.2.10
CERT_DIR=/opt/juxin-ai-assistant/tls
sudo install -d -m 700 "$CERT_DIR"
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/CN=$SERVER_IP" \
  -addext "subjectAltName=IP:$SERVER_IP" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
sudo chmod 600 "$CERT_DIR/server.key"
```

不得提交 `server.key`、真实 `.env`、API Key 或 Cookie。

## 2. 配置环境

在仓库根目录 `.env` 配置：

```bash
PUBLIC_HOST=192.0.2.10
AI_ASSISTANT_PUBLIC_URL=https://192.0.2.10:8443
AI_ASSISTANT_HTTPS_PORT=8443
AI_ASSISTANT_TLS_CERT=/opt/juxin-ai-assistant/tls/server.crt
AI_ASSISTANT_TLS_KEY=/opt/juxin-ai-assistant/tls/server.key
```

同时填写 `.env.example` 中已有的数据库、统一登录和 AI 助手密钥。`AI_ASSISTANT_PUBLIC_URL` 必须是浏览器实际访问的完整 HTTPS Origin，不能填 `localhost`，不能带路径或末尾 `/`。

生产 Overlay 自动设置：

- `AUTH_PUBLIC_URL`、`PUBLIC_URL`、`CORS_ORIGINS` 为同一 HTTPS Origin。
- `APP_AI_ASSISTANT_URL` 为正确登录回跳地址。
- `VITE_AUTH_PUBLIC_URL` 写入 Web 构建。
- `AUTH_COOKIE_SECURE=true`、`AUTH_SECURITY_STRICT_MODE=true`。

## 3. 校验并启动

```bash
docker compose \
  -f docker-compose.yml \
  -f juxin-ai-assistant/docker-compose.ai-assistant-https.yml \
  config --quiet

docker compose \
  -f docker-compose.yml \
  -f juxin-ai-assistant/docker-compose.ai-assistant-https.yml \
  up -d --build ai-assistant-https
```

检查：

```bash
curl -kfsS https://192.0.2.10/api/ai/health
docker compose \
  -f docker-compose.yml \
  -f juxin-ai-assistant/docker-compose.ai-assistant-https.yml \
  ps
```

健康检查应返回 `{"status":"ok",...}`。防火墙只需向用户网络开放 TCP `8443`；不要开放 `443`、`5193`、`18093`、`5180`。

## 4. 信任自签证书

先通过受保护渠道把 `server.crt` 分发给员工，只分发公钥证书，绝不分发 `server.key`。核对证书 SHA-256 指纹：

```bash
openssl x509 -in server.crt -noout -fingerprint -sha256
```

- Windows：双击 `server.crt`，选择“本地计算机”，导入“受信任的根证书颁发机构”；重启浏览器。
- macOS：用“钥匙串访问”导入“系统”钥匙串，打开证书，在“信任”中设为“始终信任”；重启浏览器。
- Linux：导入系统或浏览器的“Authorities/证书颁发机构”存储，并勾选信任网站身份；重启浏览器。

浏览器地址栏必须显示证书对应的 IP。证书未含 IP SAN、访问了不同 IP、证书过期，均不得点击绕过警告继续使用。

## 5. 验收

1. 打开 `https://服务器IP:8443`，未登录时进入同源 `/portal?system=ai-assistant`。
2. 登录后回到 `https://服务器IP:8443`，地址不含 `localhost`。
3. `GET /api/ai/health` 返回 `200`。
4. 员工能聊天、上传附件、导出 Word、维护个人模型。
5. 普通员工访问管理接口返回 `403`；管理员可访问授权范围。
6. 不可信 Origin 的写请求返回 `403`。
7. 浏览器 Cookie 带 `Secure`，日志不含完整 Cookie、Bearer Token 或 API Key。

自动检查：

```bash
cd juxin-ai-assistant/server
python3 -m pytest tests/test_web_public_security.py tests/test_auth.py tests/test_governance_authorization.py tests/test_user_model_profiles_api.py -q

cd ../apps/desktop
npm test -- session.test.tsx web-mode.test.tsx web-https-deployment.test.ts proxy-config.test.ts
npm run typecheck
npm run build:web
```

## 回滚

```bash
docker compose \
  -f docker-compose.yml \
  -f juxin-ai-assistant/docker-compose.ai-assistant-https.yml \
  stop ai-assistant-https
```

回滚只停止 HTTPS 入口，不删除数据库、上传资料或工作成果。登录异常先检查三个公开地址是否完全一致，再检查证书、Cookie `Secure` 和浏览器时间。
