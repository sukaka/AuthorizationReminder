#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="ticketing"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
TICKETING_API_BASE="${TICKETING_API_BASE:-http://localhost:5182}"
TICKETING_WEB_BASE="${TICKETING_WEB_BASE:-http://localhost:8081}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth ticketing web-ticketing
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$TICKETING_API_BASE/health" "200" "ticketing-api-health"
wait_http_status "$TICKETING_WEB_BASE" "200" "ticketing-web"

run_node_check "ticketing/index.js"
run_npm_script_if_exists "ticketing/web" "build"

log "[OK] $SYSTEM_NAME 系统测试通过"
