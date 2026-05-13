#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="prompt-center"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
PROMPT_CENTER_API_BASE="${PROMPT_CENTER_API_BASE:-http://localhost:5189}"
PROMPT_CENTER_WEB_BASE="${PROMPT_CENTER_WEB_BASE:-http://localhost:18088}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth prompt-center-api web-prompt-center
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$PROMPT_CENTER_API_BASE/health" "200" "prompt-center-api-health"
wait_http_status "$PROMPT_CENTER_WEB_BASE" "200" "prompt-center-web"

run_node_check "prompt-center/backend/src/index.js"
run_node_check "prompt-center/backend/src/prompt-service.js"
run_npm_script_if_exists "prompt-center/frontend" "build"
run_npm_script_if_exists "prompt-center/frontend" "test"
run_npm_script_if_exists "prompt-center/backend" "test"

log "[OK] $SYSTEM_NAME 系统测试通过"
