#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="faq"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
FAQ_API_BASE="${FAQ_API_BASE:-http://localhost:5186}"
FAQ_WEB_BASE="${FAQ_WEB_BASE:-http://localhost:8085}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth onlyoffice faq-api web-faq
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$FAQ_API_BASE/api/health" "200" "faq-api-health"
wait_http_status "$FAQ_WEB_BASE" "200" "faq-web"

run_node_check "faq/backend/src/index.js"
run_npm_script_if_exists "faq/frontend" "build"
run_npm_script_if_exists "faq/backend" "test"

log "[OK] $SYSTEM_NAME 系统测试通过"
