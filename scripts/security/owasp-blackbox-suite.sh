#!/usr/bin/env bash
set -euo pipefail

# ------------------------
# OWASP Blackbox Suite
# ------------------------
# 默认只读探测，不修改业务数据。
# 如需执行写入型验证（上传绕过等），设置 RUN_WRITE_TESTS=true。

AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"
REMINDER_BASE="${REMINDER_BASE:-http://localhost:5179}"
FAQ_BASE="${FAQ_BASE:-http://localhost:5186}"
DEVICE_FLOW_BASE="${DEVICE_FLOW_BASE:-http://localhost:5184}"
SEC_IMPL_BASE="${SEC_IMPL_BASE:-http://localhost:5185}"
CMDB_BASE="${CMDB_BASE:-http://localhost:8090}"
INVENTORY_BASE="${INVENTORY_BASE:-http://localhost:5183}"
TICKETING_BASE="${TICKETING_BASE:-http://localhost:5182}"
TENDER_BASE="${TENDER_BASE:-http://localhost:5187}"

ADMIN_TOKEN="${ADMIN_TOKEN:-}"
AUDITOR_TOKEN="${AUDITOR_TOKEN:-}"
EDITOR_TOKEN="${EDITOR_TOKEN:-}"
RUN_WRITE_TESTS="${RUN_WRITE_TESTS:-false}"
CURL_TIMEOUT="${CURL_TIMEOUT:-8}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

REQ_CODE=""
REQ_BODY_FILE=""
REQ_HEADER_FILE=""

cleanup_req_files() {
  if [[ -n "${REQ_BODY_FILE:-}" && -f "$REQ_BODY_FILE" ]]; then
    rm -f "$REQ_BODY_FILE"
  fi
  if [[ -n "${REQ_HEADER_FILE:-}" && -f "$REQ_HEADER_FILE" ]]; then
    rm -f "$REQ_HEADER_FILE"
  fi
  REQ_CODE=""
  REQ_BODY_FILE=""
  REQ_HEADER_FILE=""
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[PASS] $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[FAIL] $1"
  if [[ -n "${REQ_CODE:-}" ]]; then
    echo "       HTTP: $REQ_CODE"
  fi
  if [[ -n "${REQ_BODY_FILE:-}" && -f "$REQ_BODY_FILE" ]]; then
    local body
    body="$(head -c 300 "$REQ_BODY_FILE" | tr '\n' ' ')"
    if [[ -n "$body" ]]; then
      echo "       BODY: $body"
    fi
  fi
}

skip() {
  SKIP_COUNT=$((SKIP_COUNT + 1))
  echo "[SKIP] $1"
}

service_status() {
  local url="$1"
  local code
  code="$(curl -sS --connect-timeout "$CURL_TIMEOUT" --max-time "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
    echo "1"
  else
    echo "0"
  fi
}

request() {
  local method="$1"
  local url="$2"
  local token="${3:-}"
  local body="${4:-}"
  local content_type="${5:-application/json}"
  local extra_headers=()
  if [[ "$#" -gt 5 ]]; then
    extra_headers=("${@:6}")
  fi

  cleanup_req_files
  REQ_BODY_FILE="$(mktemp)"
  REQ_HEADER_FILE="$(mktemp)"

  local cmd=(curl -sS --connect-timeout "$CURL_TIMEOUT" --max-time "$CURL_TIMEOUT" -X "$method" "$url" -D "$REQ_HEADER_FILE" -o "$REQ_BODY_FILE" -w '%{http_code}')
  if [[ -n "$token" ]]; then
    cmd+=( -H "Authorization: Bearer $token" )
  fi
  if [[ -n "$body" ]]; then
    cmd+=( -H "Content-Type: $content_type" -d "$body" )
  fi
  if [[ "${#extra_headers[@]}" -gt 0 ]]; then
    local h
    for h in "${extra_headers[@]}"; do
      [[ -n "$h" ]] && cmd+=( -H "$h" )
    done
  fi

  REQ_CODE="$("${cmd[@]}" || true)"
}

expect_status() {
  local case_name="$1"
  local expected="$2"
  if [[ "$REQ_CODE" == "$expected" ]]; then
    pass "$case_name"
  else
    fail "$case_name (expected $expected)"
  fi
}

expect_status_in() {
  local case_name="$1"
  local allowed_csv="$2"
  local ok=0
  IFS=',' read -r -a allowed <<< "$allowed_csv"
  local c
  for c in "${allowed[@]}"; do
    if [[ "$REQ_CODE" == "$c" ]]; then
      ok=1
      break
    fi
  done
  if [[ "$ok" == "1" ]]; then
    pass "$case_name"
  else
    fail "$case_name (expected one of $allowed_csv)"
  fi
}

expect_not_status() {
  local case_name="$1"
  local blocked="$2"
  if [[ "$REQ_CODE" == "$blocked" ]]; then
    fail "$case_name (unexpected $blocked)"
  else
    pass "$case_name"
  fi
}

body_contains_sql_error() {
  if [[ ! -f "$REQ_BODY_FILE" ]]; then
    return 1
  fi
  grep -Eqi "sql syntax|syntax error|sqlstate|mysql|mariadb|ORA-[0-9]+|postgres" "$REQ_BODY_FILE"
}

expect_no_server_error_no_sql_leak() {
  local case_name="$1"
  if [[ "$REQ_CODE" == "500" ]]; then
    fail "$case_name (500 server error)"
    return
  fi
  if body_contains_sql_error; then
    fail "$case_name (SQL error leaked)"
    return
  fi
  pass "$case_name"
}

expect_has_header() {
  local case_name="$1"
  local header_key="$2"
  if grep -Eqi "^${header_key}:" "$REQ_HEADER_FILE"; then
    pass "$case_name"
  else
    fail "$case_name (missing header: $header_key)"
  fi
}

expect_cors_blocked() {
  local case_name="$1"
  local evil_origin="$2"
  if [[ "$REQ_CODE" == "403" ]]; then
    pass "$case_name"
    return
  fi
  local acao
  acao="$(grep -Ei '^Access-Control-Allow-Origin:' "$REQ_HEADER_FILE" | head -n1 | cut -d':' -f2- | xargs || true)"
  if [[ -z "$acao" || "$acao" != "$evil_origin" ]]; then
    pass "$case_name"
  else
    fail "$case_name (evil origin allowed)"
  fi
}

require_token_or_skip() {
  local token="$1"
  local case_name="$2"
  if [[ -z "$token" ]]; then
    skip "$case_name (missing token)"
    return 1
  fi
  return 0
}

# ------------------------
# Service availability
# ------------------------
AUTH_UP="$(service_status "$AUTH_BASE/health")"
REMINDER_UP="$(service_status "$REMINDER_BASE/api/health")"
FAQ_UP="$(service_status "$FAQ_BASE/api/health")"
DEVICE_UP="$(service_status "$DEVICE_FLOW_BASE/api/health")"
SEC_UP="$(service_status "$SEC_IMPL_BASE/api/health")"
CMDB_UP="$(service_status "$CMDB_BASE/healthz")"
INVENTORY_UP="$(service_status "$INVENTORY_BASE/api/health")"
TICKETING_UP="$(service_status "$TICKETING_BASE/health")"
TENDER_UP="$(service_status "$TENDER_BASE/health")"

echo "[INFO] 服务可用性: auth=$AUTH_UP reminder=$REMINDER_UP faq=$FAQ_UP device-flow=$DEVICE_UP sec-impl=$SEC_UP cmdb=$CMDB_UP inventory=$INVENTORY_UP ticketing=$TICKETING_UP tender=$TENDER_UP"

# ------------------------
# A01 Broken Access Control
# ------------------------
if [[ "$AUTH_UP" == "1" ]]; then
  request GET "$AUTH_BASE/api/auth/me"
  expect_status "A01/auth 未登录访问 /api/auth/me" "401"
else
  skip "A01/auth 未登录访问 /api/auth/me (service down)"
fi

if [[ "$REMINDER_UP" == "1" ]]; then
  request GET "$REMINDER_BASE/api/customers"
  expect_status "A01/reminder 未登录访问 /api/customers" "401"
else
  skip "A01/reminder 未登录访问 /api/customers (service down)"
fi

if [[ "$FAQ_UP" == "1" ]]; then
  request GET "$FAQ_BASE/api/auth/me"
  expect_status "A01/faq 未登录访问 /api/auth/me" "401"
else
  skip "A01/faq 未登录访问 /api/auth/me (service down)"
fi

if [[ "$DEVICE_UP" == "1" ]]; then
  request GET "$DEVICE_FLOW_BASE/api/device-flow/jobs"
  expect_status "A01/device-flow 未登录访问 /api/device-flow/jobs" "401"
else
  skip "A01/device-flow 未登录访问 /api/device-flow/jobs (service down)"
fi

if [[ "$SEC_UP" == "1" ]]; then
  request GET "$SEC_IMPL_BASE/api/sec-impl/projects"
  expect_status "A01/sec-impl 未登录访问 /api/sec-impl/projects" "401"
else
  skip "A01/sec-impl 未登录访问 /api/sec-impl/projects (service down)"
fi

if [[ "$CMDB_UP" == "1" ]]; then
  request GET "$CMDB_BASE/api/v1/ci"
  expect_status "A01/cmdb 未登录访问 /api/v1/ci" "401"
else
  skip "A01/cmdb 未登录访问 /api/v1/ci (service down)"
fi

if [[ "$INVENTORY_UP" == "1" ]]; then
  request GET "$INVENTORY_BASE/api/products"
  expect_status "A01/inventory 未登录访问 /api/products" "401"
else
  skip "A01/inventory 未登录访问 /api/products (service down)"
fi

if [[ "$TICKETING_UP" == "1" ]]; then
  request GET "$TICKETING_BASE/api/tickets"
  expect_status "A01/ticketing 未登录访问 /api/tickets" "401"
else
  skip "A01/ticketing 未登录访问 /api/tickets (service down)"
fi

if [[ "$TENDER_UP" == "1" ]]; then
  request GET "$TENDER_BASE/api/tender/bootstrap"
  expect_status "A01/tender 未登录访问 /api/tender/bootstrap" "401"
else
  skip "A01/tender 未登录访问 /api/tender/bootstrap (service down)"
fi

if [[ "$FAQ_UP" == "1" ]]; then
  if require_token_or_skip "$EDITOR_TOKEN" "A01/faq editor 越权访问审计日志"; then
    request GET "$FAQ_BASE/api/faq/logs" "$EDITOR_TOKEN"
    expect_status "A01/faq editor 越权访问审计日志" "403"
  fi
else
  skip "A01/faq editor 越权访问审计日志 (service down)"
fi

if [[ "$DEVICE_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A01/device-flow admin 越权访问审计日志"; then
    request GET "$DEVICE_FLOW_BASE/api/device-flow/logs" "$ADMIN_TOKEN"
    expect_status "A01/device-flow admin 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/device-flow auditor 访问审计日志"; then
    request GET "$DEVICE_FLOW_BASE/api/device-flow/logs" "$AUDITOR_TOKEN"
    expect_status "A01/device-flow auditor 访问审计日志" "200"
  fi
else
  skip "A01/device-flow 审计权限校验 (service down)"
fi

if [[ "$SEC_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A01/sec-impl admin 越权访问审计日志"; then
    request GET "$SEC_IMPL_BASE/api/sec-impl/logs" "$ADMIN_TOKEN"
    expect_status "A01/sec-impl admin 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/sec-impl auditor 访问审计日志"; then
    request GET "$SEC_IMPL_BASE/api/sec-impl/logs" "$AUDITOR_TOKEN"
    expect_status "A01/sec-impl auditor 访问审计日志" "200"
  fi
else
  skip "A01/sec-impl 审计权限校验 (service down)"
fi

if [[ "$CMDB_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A01/cmdb admin 越权访问审计日志"; then
    request GET "$CMDB_BASE/api/v1/audit/logs" "$ADMIN_TOKEN"
    expect_status "A01/cmdb admin 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/cmdb auditor 访问审计日志"; then
    request GET "$CMDB_BASE/api/v1/audit/logs" "$AUDITOR_TOKEN"
    expect_status "A01/cmdb auditor 访问审计日志" "200"
  fi
else
  skip "A01/cmdb 审计权限校验 (service down)"
fi

if [[ "$INVENTORY_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A01/inventory admin 越权访问审计日志"; then
    request GET "$INVENTORY_BASE/api/operation-logs" "$ADMIN_TOKEN"
    expect_status "A01/inventory admin 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/inventory auditor 访问审计日志"; then
    request GET "$INVENTORY_BASE/api/operation-logs" "$AUDITOR_TOKEN"
    expect_status "A01/inventory auditor 访问审计日志" "200"
  fi
else
  skip "A01/inventory 审计权限校验 (service down)"
fi

if [[ "$TICKETING_UP" == "1" ]]; then
  if require_token_or_skip "$EDITOR_TOKEN" "A01/ticketing editor 越权访问审计日志"; then
    request GET "$TICKETING_BASE/api/operation-logs" "$EDITOR_TOKEN"
    expect_status "A01/ticketing editor 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$ADMIN_TOKEN" "A01/ticketing admin 访问审计日志"; then
    request GET "$TICKETING_BASE/api/operation-logs" "$ADMIN_TOKEN"
    expect_status "A01/ticketing admin 访问审计日志" "200"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/ticketing auditor 访问审计日志"; then
    request GET "$TICKETING_BASE/api/operation-logs" "$AUDITOR_TOKEN"
    expect_status "A01/ticketing auditor 访问审计日志" "200"
  fi
else
  skip "A01/ticketing 审计权限校验 (service down)"
fi

if [[ "$TENDER_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A01/tender admin 越权访问审计日志"; then
    request GET "$TENDER_BASE/api/tender/audit/logs" "$ADMIN_TOKEN"
    expect_status "A01/tender admin 越权访问审计日志" "403"
  fi
  if require_token_or_skip "$AUDITOR_TOKEN" "A01/tender auditor 访问审计日志"; then
    request GET "$TENDER_BASE/api/tender/audit/logs" "$AUDITOR_TOKEN"
    expect_status "A01/tender auditor 访问审计日志" "200"
  fi
else
  skip "A01/tender 审计权限校验 (service down)"
fi

# ------------------------
# A03 Injection (SQLi-style payload)
# ------------------------
SQLI_PAYLOAD="%27%20OR%201%3D1--%20"

if [[ "$REMINDER_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/reminder SQLi payload"; then
    request GET "$REMINDER_BASE/api/customers?search=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/reminder SQLi payload"
  fi
else
  skip "A03/reminder SQLi payload (service down)"
fi

if [[ "$FAQ_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/faq SQLi payload"; then
    request GET "$FAQ_BASE/api/faq/articles?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/faq SQLi payload"
  fi
else
  skip "A03/faq SQLi payload (service down)"
fi

if [[ "$DEVICE_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/device-flow SQLi payload"; then
    request GET "$DEVICE_FLOW_BASE/api/device-flow/jobs?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/device-flow SQLi payload"
  fi
else
  skip "A03/device-flow SQLi payload (service down)"
fi

if [[ "$SEC_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/sec-impl SQLi payload"; then
    request GET "$SEC_IMPL_BASE/api/sec-impl/projects?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/sec-impl SQLi payload"
  fi
else
  skip "A03/sec-impl SQLi payload (service down)"
fi

if [[ "$CMDB_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/cmdb SQLi payload"; then
    request GET "$CMDB_BASE/api/v1/ci?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/cmdb SQLi payload"
  fi
else
  skip "A03/cmdb SQLi payload (service down)"
fi

if [[ "$INVENTORY_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/inventory SQLi payload"; then
    request GET "$INVENTORY_BASE/api/products?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/inventory SQLi payload"
  fi
else
  skip "A03/inventory SQLi payload (service down)"
fi

if [[ "$TICKETING_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/ticketing SQLi payload"; then
    request GET "$TICKETING_BASE/api/tickets?search=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/ticketing SQLi payload"
  fi
else
  skip "A03/ticketing SQLi payload (service down)"
fi

if [[ "$TENDER_UP" == "1" ]]; then
  if require_token_or_skip "$ADMIN_TOKEN" "A03/tender SQLi payload"; then
    request GET "$TENDER_BASE/api/tender/bids?keyword=${SQLI_PAYLOAD}" "$ADMIN_TOKEN"
    expect_no_server_error_no_sql_leak "A03/tender SQLi payload"
  fi
else
  skip "A03/tender SQLi payload (service down)"
fi

# ------------------------
# A05 Security Misconfiguration
# ------------------------
if [[ "$AUTH_UP" == "1" ]]; then
  request GET "$AUTH_BASE/health"
  expect_has_header "A05/auth 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/auth 响应头检查 (service down)"
fi

if [[ "$REMINDER_UP" == "1" ]]; then
  request GET "$REMINDER_BASE/api/health"
  expect_has_header "A05/reminder 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/reminder 响应头检查 (service down)"
fi

if [[ "$FAQ_UP" == "1" ]]; then
  request GET "$FAQ_BASE/api/health"
  expect_has_header "A05/faq 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/faq 响应头检查 (service down)"
fi

if [[ "$DEVICE_UP" == "1" ]]; then
  request GET "$DEVICE_FLOW_BASE/api/health"
  expect_has_header "A05/device-flow 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/device-flow 响应头检查 (service down)"
fi

if [[ "$SEC_UP" == "1" ]]; then
  request GET "$SEC_IMPL_BASE/api/health"
  expect_has_header "A05/sec-impl 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/sec-impl 响应头检查 (service down)"
fi

if [[ "$CMDB_UP" == "1" ]]; then
  request GET "$CMDB_BASE/healthz"
  expect_has_header "A05/cmdb 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/cmdb 响应头检查 (service down)"
fi

if [[ "$INVENTORY_UP" == "1" ]]; then
  request GET "$INVENTORY_BASE/api/health"
  expect_has_header "A05/inventory 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/inventory 响应头检查 (service down)"
fi

if [[ "$TICKETING_UP" == "1" ]]; then
  request GET "$TICKETING_BASE/health"
  expect_has_header "A05/ticketing 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/ticketing 响应头检查 (service down)"
fi

if [[ "$TENDER_UP" == "1" ]]; then
  request GET "$TENDER_BASE/health"
  expect_has_header "A05/tender 响应头 X-Content-Type-Options" "X-Content-Type-Options"
else
  skip "A05/tender 响应头检查 (service down)"
fi

# CORS evil origin check (服务返回 403 或不回显恶意 origin 均可接受)
EVIL_ORIGIN="https://evil.example.com"
if [[ "$AUTH_UP" == "1" ]]; then
  request OPTIONS "$AUTH_BASE/api/auth/login" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: POST"
  expect_cors_blocked "A05/auth CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/auth CORS 检查 (service down)"
fi

if [[ "$REMINDER_UP" == "1" ]]; then
  request OPTIONS "$REMINDER_BASE/api/customers" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/reminder CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/reminder CORS 检查 (service down)"
fi

if [[ "$FAQ_UP" == "1" ]]; then
  request OPTIONS "$FAQ_BASE/api/faq/articles" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/faq CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/faq CORS 检查 (service down)"
fi

if [[ "$DEVICE_UP" == "1" ]]; then
  request OPTIONS "$DEVICE_FLOW_BASE/api/device-flow/jobs" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/device-flow CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/device-flow CORS 检查 (service down)"
fi

if [[ "$SEC_UP" == "1" ]]; then
  request OPTIONS "$SEC_IMPL_BASE/api/sec-impl/projects" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/sec-impl CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/sec-impl CORS 检查 (service down)"
fi

if [[ "$INVENTORY_UP" == "1" ]]; then
  request OPTIONS "$INVENTORY_BASE/api/products" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/inventory CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/inventory CORS 检查 (service down)"
fi

if [[ "$TICKETING_UP" == "1" ]]; then
  request OPTIONS "$TICKETING_BASE/api/tickets" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/ticketing CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/ticketing CORS 检查 (service down)"
fi

if [[ "$TENDER_UP" == "1" ]]; then
  request OPTIONS "$TENDER_BASE/api/tender/bids" "" "" "application/json" "Origin: $EVIL_ORIGIN" "Access-Control-Request-Method: GET"
  expect_cors_blocked "A05/tender CORS 阻断恶意 Origin" "$EVIL_ORIGIN"
else
  skip "A05/tender CORS 检查 (service down)"
fi

# ------------------------
# A10 SSRF-related callback guard smoke check
# ------------------------
if [[ "$FAQ_UP" == "1" ]]; then
  request POST "$FAQ_BASE/api/faq/editor/callback/fake-session?token=fake" "" '{"status":2,"url":"http://127.0.0.1:22/"}'
  expect_not_status "A10/faq 回调入口不应 500" "500"
else
  skip "A10/faq 回调入口检查 (service down)"
fi

# ------------------------
# Optional write tests
# ------------------------
if [[ "$RUN_WRITE_TESTS" == "true" ]]; then
  if [[ "$DEVICE_UP" == "1" ]]; then
    if require_token_or_skip "$ADMIN_TOKEN" "A05/device-flow 上传类型绕过"; then
      request POST "$DEVICE_FLOW_BASE/api/device-flow/jobs" "$ADMIN_TOKEN" '{"device_sn":"SEC-BB-DF-001","customer_name":"SecBB","remark":"bb"}'
      if [[ "$REQ_CODE" != "200" && "$REQ_CODE" != "201" ]]; then
        fail "A05/device-flow 创建测试工单"
      else
        local_job_id="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.id||'')" "$REQ_BODY_FILE" 2>/dev/null || true)"
        if [[ -z "$local_job_id" ]]; then
          fail "A05/device-flow 创建测试工单后无法解析 ID"
        else
          tmp_file="$(mktemp /tmp/device-flow-blackbox-XXXXXX.sh)"
          echo 'echo pwned' > "$tmp_file"
          cleanup_req_files
          REQ_BODY_FILE="$(mktemp)"
          REQ_HEADER_FILE="$(mktemp)"
          REQ_CODE="$(curl -sS --connect-timeout "$CURL_TIMEOUT" --max-time "$CURL_TIMEOUT" -X POST \
            "$DEVICE_FLOW_BASE/api/device-flow/jobs/$local_job_id/attachments" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -F "file=@${tmp_file};type=text/x-shellscript;filename=poc.sh" \
            -F "stage_code=TESTED" \
            -D "$REQ_HEADER_FILE" -o "$REQ_BODY_FILE" -w '%{http_code}' || true)"
          rm -f "$tmp_file"
          if [[ "$REQ_CODE" == "400" ]]; then
            pass "A05/device-flow 上传类型绕过被阻断"
          else
            fail "A05/device-flow 上传类型绕过被阻断 (expected 400)"
          fi
        fi
      fi
    fi
  else
    skip "A05/device-flow 上传类型绕过 (service down)"
  fi

  if [[ "$SEC_UP" == "1" ]]; then
    if require_token_or_skip "$ADMIN_TOKEN" "A05/sec-impl 上传类型绕过"; then
      request POST "$SEC_IMPL_BASE/api/sec-impl/projects" "$ADMIN_TOKEN" '{"project_code":"SEC-BB-SI-001","product_type":"WAF","customer_name":"SecBB","remark":"bb"}'
      if [[ "$REQ_CODE" != "200" && "$REQ_CODE" != "201" ]]; then
        fail "A05/sec-impl 创建测试实施单"
      else
        local_job_id="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.id||'')" "$REQ_BODY_FILE" 2>/dev/null || true)"
        if [[ -z "$local_job_id" ]]; then
          fail "A05/sec-impl 创建测试实施单后无法解析 ID"
        else
          tmp_file="$(mktemp /tmp/sec-impl-blackbox-XXXXXX.sh)"
          echo 'echo pwned' > "$tmp_file"
          cleanup_req_files
          REQ_BODY_FILE="$(mktemp)"
          REQ_HEADER_FILE="$(mktemp)"
          REQ_CODE="$(curl -sS --connect-timeout "$CURL_TIMEOUT" --max-time "$CURL_TIMEOUT" -X POST \
            "$SEC_IMPL_BASE/api/sec-impl/projects/$local_job_id/attachments" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -F "file=@${tmp_file};type=text/x-shellscript;filename=poc.sh" \
            -F "stage_code=TRIAL" \
            -D "$REQ_HEADER_FILE" -o "$REQ_BODY_FILE" -w '%{http_code}' || true)"
          rm -f "$tmp_file"
          if [[ "$REQ_CODE" == "400" ]]; then
            pass "A05/sec-impl 上传类型绕过被阻断"
          else
            fail "A05/sec-impl 上传类型绕过被阻断 (expected 400)"
          fi
        fi
      fi
    fi
  else
    skip "A05/sec-impl 上传类型绕过 (service down)"
  fi
else
  skip "写入型测试已关闭（RUN_WRITE_TESTS=false）"
fi

cleanup_req_files

echo
echo "========== OWASP Blackbox Summary =========="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"
echo "SKIP: $SKIP_COUNT"

authoritative_exit=0
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  authoritative_exit=1
fi
exit "$authoritative_exit"
