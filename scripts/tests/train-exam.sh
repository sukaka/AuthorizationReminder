#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SYSTEM_NAME="train-exam"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
TRAIN_EXAM_API_BASE="${TRAIN_EXAM_API_BASE:-http://localhost:5188}"
TRAIN_EXAM_WEB_BASE="${TRAIN_EXAM_WEB_BASE:-http://localhost:8087}"

step "开始执行 $SYSTEM_NAME 系统一键测试"
compose_up mysql auth train-exam-api web-train-exam
wait_http_status "$AUTH_BASE/health" "200" "auth-health"
wait_http_status "$TRAIN_EXAM_API_BASE/api/health" "200" "train-exam-api-health"
wait_http_status "$TRAIN_EXAM_WEB_BASE" "200" "train-exam-web"

run_node_check "train-exam/backend/src/index.js"
run_npm_script_if_exists "train-exam/frontend" "build"
run_npm_script_if_exists "train-exam/backend" "test"

log "[OK] $SYSTEM_NAME 系统测试通过"
