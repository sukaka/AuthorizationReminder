#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="tender"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
TENDER_API_BASE="${TENDER_API_BASE:-http://localhost:5187}"
TENDER_WEB_BASE="${TENDER_WEB_BASE:-http://localhost:8086}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth onlyoffice tender-api web-tender
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$TENDER_API_BASE/health" "200" "tender-api-health"
wait_http_status "$TENDER_WEB_BASE" "200" "tender-web"

run_node_check "tender/backend/src/index.js"
run_npm_script_if_exists "tender/frontend" "build"

TOKEN="${AUTH_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(resolve_auth_token)"
fi

run_cmd "标书系统 smoke-e2e" env AUTH_BASE="$AUTH_BASE" API_BASE="$TENDER_API_BASE" AUTH_TOKEN="$TOKEN" npm --prefix "$ROOT_DIR/tender/backend" run test:smoke

log "[OK] $SYSTEM_NAME 系统测试通过"
