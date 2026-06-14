#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="inventory"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
INVENTORY_API_BASE="${INVENTORY_API_BASE:-http://localhost:5183}"
SHIPPING_GATEWAY_BASE="${SHIPPING_GATEWAY_BASE:-http://localhost:5190}"
INVENTORY_WEB_BASE="${INVENTORY_WEB_BASE:-http://localhost:18082}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth shipping-gateway inventory-api web-inventory
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$INVENTORY_API_BASE/api/health" "200" "inventory-api-health"
wait_http_status "$INVENTORY_API_BASE/api/ready" "200" "inventory-api-ready"
wait_http_status "$INVENTORY_API_BASE/api/version" "200" "inventory-api-version"
wait_http_status "$INVENTORY_API_BASE/api/build" "200" "inventory-api-build"
wait_http_status "$INVENTORY_API_BASE/api/metrics" "200" "inventory-api-metrics"
wait_http_status "$SHIPPING_GATEWAY_BASE/healthz" "200" "shipping-gateway-health"
wait_http_status "$INVENTORY_WEB_BASE" "200" "inventory-web"

run_node_check "inventory-system/backend/src/index.js"
run_node_check "inventory-system/shipping-gateway/src/index.js"
run_npm_script_if_exists "inventory-system/backend" "test"
run_npm_script_if_exists "inventory-system/frontend" "build"

log "[OK] $SYSTEM_NAME 系统测试通过"
