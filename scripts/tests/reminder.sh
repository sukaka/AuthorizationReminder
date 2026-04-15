#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="reminder"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
REMINDER_API_BASE="${REMINDER_API_BASE:-http://localhost:5179}"
REMINDER_WEB_BASE="${REMINDER_WEB_BASE:-http://localhost:18080}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth api web
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$REMINDER_API_BASE/api/health" "200" "reminder-api-health"
wait_http_status "$REMINDER_WEB_BASE" "200" "reminder-web"

run_node_check "server/index.js"
run_npm_script_if_exists "web" "build"

log "[OK] $SYSTEM_NAME 系统测试通过"
