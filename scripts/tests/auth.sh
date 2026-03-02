#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="auth"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
ADMIN_LOGIN="${ADMIN_LOGIN:-${ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-${BUILTIN_PASSWORD:-${BUILTIN_ACCOUNT_DEFAULT_PASSWORD:-Dm1vbnqsILIVjUa5sWixBFos60bKdEKC}}}"
RUN_LOGIN_PROBE="${RUN_LOGIN_PROBE:-0}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$AUTH_BASE/portal" "200,301,302" "auth-portal"

run_node_check "auth/index.js"

if [[ "$RUN_LOGIN_PROBE" == "1" ]]; then
  run_cmd "登录流程探测（允许 token / mfaRequired / mfaSetupRequired）" auth_login_probe "$AUTH_BASE" "$ADMIN_LOGIN" "$ADMIN_PASSWORD"
else
  log "跳过登录流程探测（RUN_LOGIN_PROBE=${RUN_LOGIN_PROBE}）"
fi

log "[OK] $SYSTEM_NAME 系统测试通过"
