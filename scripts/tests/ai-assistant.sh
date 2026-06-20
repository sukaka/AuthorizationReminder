#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

PYTHON_BIN="${AI_ASSISTANT_PYTHON:-$ROOT_DIR/juxin-ai-assistant/server/.venv/bin/python}"
CARGO_BIN="${CARGO_BIN:-cargo}"

step "开始执行 ai-assistant 一键测试"
run_cmd "AI assistant compose source" node --test "$ROOT_DIR/tests/ai-assistant-compose-source.test.js"
step "AI assistant backend tests"
(
  cd "$ROOT_DIR/juxin-ai-assistant/server"
  "$PYTHON_BIN" -m pytest tests -q
)
run_npm_script_if_exists "juxin-ai-assistant/apps/desktop" "test"
run_npm_script_if_exists "juxin-ai-assistant/apps/desktop" "build"
run_npm_script_if_exists "juxin-ai-assistant/apps/desktop" "test:e2e"
run_cmd "AI assistant Rust tests" "$CARGO_BIN" test --manifest-path "$ROOT_DIR/juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml"

compose_up mysql auth prompt-center-api ai-assistant-db-init ai-assistant-api web-ai-assistant
wait_http_status "${AUTH_BASE:-http://localhost:5180}/health" "200" "auth-health"
wait_http_status "${AI_ASSISTANT_API_BASE:-http://localhost:5193}/health" "200" "ai-assistant-api-health"
wait_http_status "${AI_ASSISTANT_WEB_BASE:-http://localhost:18093}" "200" "ai-assistant-web"
wait_http_status "${AI_ASSISTANT_API_BASE:-http://localhost:5193}/api/ai/session" "401" "ai-assistant-session"

log "[OK] ai-assistant 系统一键测试通过"
