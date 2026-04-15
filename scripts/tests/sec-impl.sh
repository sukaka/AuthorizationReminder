#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="sec-impl"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
SEC_IMPL_API_BASE="${SEC_IMPL_API_BASE:-http://localhost:5185}"
SEC_IMPL_WEB_BASE="${SEC_IMPL_WEB_BASE:-http://localhost:18084}"
RUN_E2E="${RUN_E2E:-1}"
RUN_RBAC="${RUN_RBAC:-1}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth sec-impl-api web-sec-impl
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$SEC_IMPL_API_BASE/api/health" "200" "sec-impl-api-health"
wait_http_status "$SEC_IMPL_WEB_BASE" "200" "sec-impl-web"

run_node_check "sec-impl/backend/src/index.js"
run_npm_script_if_exists "sec-impl/frontend" "build"
run_npm_script_if_exists "sec-impl/backend" "test"

if [[ "$RUN_E2E" == "1" ]]; then
  ADMIN_TOKEN="${AUTH_TOKEN:-}"
  if [[ -z "$ADMIN_TOKEN" ]]; then
    ADMIN_TOKEN="$(resolve_auth_token)"
  fi

  run_cmd "安全实施 smoke-e2e" env API_BASE="$SEC_IMPL_API_BASE" AUTH_TOKEN="$ADMIN_TOKEN" bash "$ROOT_DIR/sec-impl/scripts/smoke-e2e.sh"
  run_cmd "安全实施 regression-api" env API_BASE="$SEC_IMPL_API_BASE" AUTH_TOKEN="$ADMIN_TOKEN" bash "$ROOT_DIR/sec-impl/scripts/regression-api.sh"

  if [[ "$RUN_RBAC" == "1" ]]; then
    BUILTIN_PASS="${BUILTIN_PASSWORD:-${BUILTIN_ACCOUNT_DEFAULT_PASSWORD:-Dm1vbnqsILIVjUa5sWixBFos60bKdEKC}}"
    ADMIN_USER="${ADMIN_USERNAME:-admin}"
    AUDITOR_USER="${AUDITOR_USERNAME:-auditor}"
    SYSADMIN_USER="${SYSADMIN_USERNAME:-sysadmin}"

    ADMIN_PASS="${ADMIN_PASSWORD:-$BUILTIN_PASS}"
    AUDITOR_PASS="${AUDITOR_PASSWORD:-$BUILTIN_PASS}"
    SYSADMIN_PASS="${SYSADMIN_PASSWORD:-$BUILTIN_PASS}"

    ADMIN_TOKEN_RBAC="${AUTH_TOKEN_ADMIN:-$(resolve_auth_token_for_user "$ADMIN_USER" "$ADMIN_PASS")}"
    AUDITOR_TOKEN_RBAC="${AUTH_TOKEN_AUDITOR:-$(resolve_auth_token_for_user "$AUDITOR_USER" "$AUDITOR_PASS")}"
    SYSADMIN_TOKEN_RBAC="${AUTH_TOKEN_SYSADMIN:-$(resolve_auth_token_for_user "$SYSADMIN_USER" "$SYSADMIN_PASS")}"

    run_cmd "安全实施 rbac-matrix" env \
      API_BASE="$SEC_IMPL_API_BASE" \
      AUTH_BASE="$AUTH_BASE" \
      AUTH_TOKEN_ADMIN="$ADMIN_TOKEN_RBAC" \
      AUTH_TOKEN_AUDITOR="$AUDITOR_TOKEN_RBAC" \
      AUTH_TOKEN_SYSADMIN="$SYSADMIN_TOKEN_RBAC" \
      EXPECT_SYSADMIN_SEC_IMPL_ACCESS="${EXPECT_SYSADMIN_SEC_IMPL_ACCESS:-true}" \
      bash "$ROOT_DIR/sec-impl/scripts/rbac-matrix.sh"
  else
    log "跳过 sec-impl RBAC（RUN_RBAC=${RUN_RBAC}）"
  fi
else
  log "跳过 sec-impl 深度接口测试（RUN_E2E=${RUN_E2E}）"
fi

log "[OK] $SYSTEM_NAME 系统测试通过"
