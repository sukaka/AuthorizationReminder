#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
OVERLAY="${ROOT_DIR}/docker-compose.all-systems-https.yml"
NGINX_CONFIG="${ROOT_DIR}/deploy/https/all-systems-nginx.conf"

test -f "$OVERLAY"
test -f "$NGINX_CONFIG"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
touch "$tmp_dir/cert.pem" "$tmp_dir/key.pem"

export HTTPS_PUBLIC_HOST=localhost
export ALL_SYSTEMS_TLS_CERT="$tmp_dir/cert.pem"
export ALL_SYSTEMS_TLS_KEY="$tmp_dir/key.pem"

docker compose \
  -f "${ROOT_DIR}/docker-compose.yml" \
  -f "$OVERLAY" \
  config --format json >"$tmp_dir/config.json"

routes=$(cat <<'ROUTES'
web-ai-assistant 443 80
api 5179 5179
auth 5180 5180
ticketing 5182 5182
inventory-api 5183 5183
device-flow-api 5184 5184
delivery-api 5185 5185
faq-api 5186 5186
tender-api 5187 5187
train-exam-api 5188 5188
prompt-center-api 5189 5189
shipping-gateway 5190 5190
sca-api 5191 5191
big-screen-api 5192 5192
ai-assistant-api 5193 5193
web-cmdb 8090 80
web 18080 80
web-ticketing 18081 80
web-inventory 18082 80
web-device-flow 18083 80
web-delivery 18084 80
web-faq 18085 80
web-tender 18086 80
web-train-exam 18087 80
web-prompt-center 18088 80
web-sca 18089 80
dependency-track-apiserver 18090 8080
dependency-track-frontend 18091 8080
web-big-screen 18092 80
web-ai-assistant 18093 80
ROUTES
)

while read -r service public_port target_port; do
  [ "$(jq -r --arg service "$service" '.services[$service].ports // [] | length' "$tmp_dir/config.json")" = "0" ]
  jq -e --argjson port "$public_port" '
    .services["https-gateway"].ports
    | any((.published | tonumber) == $port and .target == $port)
  ' "$tmp_dir/config.json" >/dev/null
  grep -Eq "listen[[:space:]]+${public_port}[[:space:]]+ssl;" "$NGINX_CONFIG"
  grep -Eq "^[[:space:]]*${public_port}[[:space:]]+${service}:${target_port};" "$NGINX_CONFIG"
  if jq -e --arg service "$service" '
    [.services[$service].environment? // {} | to_entries[]
      | select(.key | test("PUBLIC_URL|CORS_ORIGINS|^APP_.*_URL$"))
      | .value | strings
      | select(startswith("http://localhost") or startswith("http://127.0.0.1"))]
    | length > 0
  ' "$tmp_dir/config.json" >/dev/null; then
    echo "HTTPS Overlay still exposes an HTTP public URL for $service" >&2
    exit 1
  fi
done <<<"$routes"

[ "$(jq -r '.services["https-gateway"].ports | length' "$tmp_dir/config.json")" = "30" ]

jq -e '
  .services.auth.environment.AUTH_COOKIE_SECURE == "true" and
  .services.auth.environment.AUTH_SECURITY_STRICT_MODE == "true" and
  .services.auth.environment.AUTH_PUBLIC_URL == "https://localhost:5180" and
  .services.auth.environment.APP_REMINDER_URL == "https://localhost:18080" and
  .services.auth.environment.APP_ADMIN_CENTER_URL == "https://localhost:5180/admin-center" and
  .services.auth.environment.APP_AUDIT_CENTER_URL == "https://localhost:5180/audit-center" and
  .services.auth.environment.APP_AI_ASSISTANT_URL == "https://localhost:18093"
' "$tmp_dir/config.json" >/dev/null

jq -e '
  .services.web.build.args.VITE_SSO_PORTAL_URL == "https://localhost:5180" and
  .services["web-sca"].build.args.VITE_SSO_LOGIN_URL == "https://localhost:5180/sca-login" and
  .services["web-big-screen"].build.args.VITE_SCA_APP_URL == "https://localhost:18089" and
  .services["web-big-screen"].build.args.VITE_TRAIN_EXAM_APP_URL == "https://localhost:18087" and
  .services["web-big-screen"].build.args.VITE_REMINDER_APP_URL == "https://localhost:18080" and
  .services["web-ai-assistant"].build.args.VITE_AUTH_PUBLIC_URL == "https://localhost:5180" and
  .services["web-ai-assistant"].build.args.VITE_ADMIN_CENTER_URL == "https://localhost:5180/admin-center" and
  .services["web-ai-assistant"].build.args.VITE_PROMPT_CENTER_URL == "https://localhost:18088"
' "$tmp_dir/config.json" >/dev/null

for frontend_config in \
  web/nginx.conf \
  ticketing/web/nginx.conf \
  inventory-system/frontend/nginx.conf \
  device-flow/frontend/nginx.conf \
  delivery/frontend/nginx.conf \
  faq/frontend/nginx.conf \
  tender/frontend/nginx.conf \
  train-exam/frontend/nginx.conf \
  big-screen-center/frontend/nginx.conf \
  cmdb/web/nginx.conf; do
  grep -Fq 'https://$host:5180' "${ROOT_DIR}/${frontend_config}"
done

echo "all-systems HTTPS config: ok"
