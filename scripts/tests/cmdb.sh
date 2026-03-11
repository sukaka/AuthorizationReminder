#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="cmdb"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
CMDB_WEB_BASE="${CMDB_WEB_BASE:-http://localhost:8090}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth cmdb-mysql-init cmdb web-cmdb
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$CMDB_WEB_BASE" "200" "cmdb-web"
wait_http_status "$CMDB_WEB_BASE/healthz" "200" "cmdb-healthz"

if command -v go >/dev/null 2>&1; then
  run_cmd "go test ./... (cmdb)" bash -lc "cd '$ROOT_DIR/cmdb' && go test ./..."
else
  log "跳过 go test（未安装 go）"
fi

run_npm_script_if_exists "cmdb/web" "build"

log "[OK] $SYSTEM_NAME 系统测试通过"
