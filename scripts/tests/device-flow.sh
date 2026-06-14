#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="device-flow"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
DEVICE_FLOW_API_BASE="${DEVICE_FLOW_API_BASE:-http://localhost:5184}"
DEVICE_FLOW_WEB_BASE="${DEVICE_FLOW_WEB_BASE:-http://localhost:18083}"
RUN_E2E="${RUN_E2E:-1}"
RUN_RBAC="${RUN_RBAC:-1}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth device-flow-api web-device-flow
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$DEVICE_FLOW_API_BASE/api/health" "200" "device-flow-api-health"
wait_http_status "$DEVICE_FLOW_WEB_BASE" "200" "device-flow-web"

run_node_check "device-flow/backend/src/index.js"
run_npm_script_if_exists "device-flow/backend" "test"
run_cmd "设备流转 RBAC 测试账号单元测试" node --test "$ROOT_DIR/device-flow/scripts/rbac-test-users.test.js"
run_npm_script_if_exists "device-flow/frontend" "build"

if [[ "$RUN_E2E" == "1" ]]; then
  ADMIN_TOKEN="${AUTH_TOKEN:-}"
  if [[ -z "$ADMIN_TOKEN" ]]; then
    ADMIN_TOKEN="$(resolve_auth_token)"
  fi

  run_cmd "设备流转 smoke-e2e" env API_BASE="$DEVICE_FLOW_API_BASE" AUTH_TOKEN="$ADMIN_TOKEN" bash "$ROOT_DIR/device-flow/scripts/smoke-e2e.sh"
  run_cmd "设备流转 regression-api" env API_BASE="$DEVICE_FLOW_API_BASE" AUTH_TOKEN="$ADMIN_TOKEN" bash "$ROOT_DIR/device-flow/scripts/regression-api.sh"
  run_cmd "设备流转上传失败清理回归" env \
    API_BASE="$DEVICE_FLOW_API_BASE" \
    AUTH_TOKEN="$ADMIN_TOKEN" \
    ROOT_DIR="$ROOT_DIR" \
    bash "$ROOT_DIR/device-flow/scripts/upload-cleanup-regression.sh"

  if [[ "$RUN_RBAC" == "1" ]]; then
    require_cmd docker
    RBAC_RUN_ID="$(node -e "process.stdout.write(require('node:crypto').randomBytes(6).toString('hex'))")"
    RBAC_TEST_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")"
    RBAC_COMPOSE_ARGS=()
    if [[ -n "${COMPOSE_ENV_FILE:-}" ]]; then
      RBAC_COMPOSE_ARGS+=(--env-file "$COMPOSE_ENV_FILE")
    elif [[ -f "$ROOT_DIR/.env" ]]; then
      RBAC_COMPOSE_ARGS+=(--env-file "$ROOT_DIR/.env")
    fi

    rbac_test_users() {
      local mode="$1"
      (
        cd "$ROOT_DIR"
        docker compose "${RBAC_COMPOSE_ARGS[@]}" exec -T auth \
          node - "$mode" "$RBAC_RUN_ID" "$RBAC_TEST_PASSWORD" \
          < "$ROOT_DIR/device-flow/scripts/rbac-test-users.js"
      )
    }

    rbac_test_users setup
    cleanup_rbac_users() {
      rbac_test_users cleanup >/dev/null 2>&1 || true
    }
    trap cleanup_rbac_users EXIT

    ADMIN_USER="device_flow_rbac_admin_${RBAC_RUN_ID}"
    AUDITOR_USER="device_flow_rbac_auditor_${RBAC_RUN_ID}"
    SYSADMIN_USER="device_flow_rbac_sysadmin_${RBAC_RUN_ID}"
    rbac_login_id() {
      local role="$1"
      node -e '
        const { buildTestUsers } = require(process.argv[1]);
        const user = buildTestUsers(process.argv[2]).find((item) => item.role === process.argv[3]);
        if (!user) process.exit(1);
        process.stdout.write(user.phone);
      ' "$ROOT_DIR/device-flow/scripts/rbac-test-users.js" "$RBAC_RUN_ID" "$role"
    }

    ADMIN_TOKEN_RBAC="$(resolve_auth_token_for_user "$(rbac_login_id admin)" "$RBAC_TEST_PASSWORD")"
    AUDITOR_TOKEN_RBAC="$(resolve_auth_token_for_user "$(rbac_login_id auditor)" "$RBAC_TEST_PASSWORD")"
    SYSADMIN_TOKEN_RBAC="$(resolve_auth_token_for_user "$(rbac_login_id sysadmin)" "$RBAC_TEST_PASSWORD")"

    run_cmd "设备流转 rbac-matrix" env \
      API_BASE="$DEVICE_FLOW_API_BASE" \
      AUTH_BASE="$AUTH_BASE" \
      AUTH_TOKEN_ADMIN="$ADMIN_TOKEN_RBAC" \
      AUTH_TOKEN_AUDITOR="$AUDITOR_TOKEN_RBAC" \
      AUTH_TOKEN_SYSADMIN="$SYSADMIN_TOKEN_RBAC" \
      EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS="${EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS:-false}" \
      bash "$ROOT_DIR/device-flow/scripts/rbac-matrix.sh"

    cleanup_rbac_users
    trap - EXIT
  else
    log "跳过 device-flow RBAC（RUN_RBAC=${RUN_RBAC}）"
  fi
else
  log "跳过 device-flow 深度接口测试（RUN_E2E=${RUN_E2E}）"
fi

log "[OK] $SYSTEM_NAME 系统测试通过"
