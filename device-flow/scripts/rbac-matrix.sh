#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5184}"
AUTH_BASE="${AUTH_BASE:-http://localhost:5180}"

BUILTIN_PASSWORD="${BUILTIN_PASSWORD:-Dm1vbnqsILIVjUa5sWixBFos60bKdEKC}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
AUDITOR_USERNAME="${AUDITOR_USERNAME:-auditor}"
SYSADMIN_USERNAME="${SYSADMIN_USERNAME:-sysadmin}"

ADMIN_PASSWORD="${ADMIN_PASSWORD:-$BUILTIN_PASSWORD}"
AUDITOR_PASSWORD="${AUDITOR_PASSWORD:-$BUILTIN_PASSWORD}"
SYSADMIN_PASSWORD="${SYSADMIN_PASSWORD:-$BUILTIN_PASSWORD}"

EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS="${EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS:-false}"

AUTH_TOKEN_ADMIN="${AUTH_TOKEN_ADMIN:-}"
AUTH_TOKEN_AUDITOR="${AUTH_TOKEN_AUDITOR:-}"
AUTH_TOKEN_SYSADMIN="${AUTH_TOKEN_SYSADMIN:-}"

json_field() {
  local field="$1"
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(d['$field'] ?? '');"
}

build_login_payload() {
  local username="$1"
  local password="$2"
  local captcha_token="${3:-}"
  local captcha_code="${4:-}"
  node -e "
const username = process.argv[1];
const password = process.argv[2];
const captchaToken = process.argv[3] || '';
const captcha = process.argv[4] || '';
const payload = { username, password };
if (captchaToken && captcha) {
  payload.captchaToken = captchaToken;
  payload.captcha = captcha;
}
console.log(JSON.stringify(payload));
" "$username" "$password" "$captcha_token" "$captcha_code"
}

login_get_token() {
  local username="$1"
  local password="$2"
  local cookie_jar
  cookie_jar="$(mktemp)"

  local csrf_tmp
  csrf_tmp="$(mktemp)"
  local csrf_code
  csrf_code="$(curl -sS -o "$csrf_tmp" -w '%{http_code}' -c "$cookie_jar" "$AUTH_BASE/api/auth/csrf")"
  local csrf_body
  csrf_body="$(cat "$csrf_tmp")"
  rm -f "$csrf_tmp"
  if [[ "$csrf_code" != "200" ]]; then
    rm -f "$cookie_jar"
    echo "[ERROR] 获取 CSRF token 失败，HTTP ${csrf_code}，返回：${csrf_body}"
    exit 1
  fi
  local csrf_token
  csrf_token="$(printf '%s' "$csrf_body" | json_field token)"
  if [[ -z "$csrf_token" ]]; then
    rm -f "$cookie_jar"
    echo "[ERROR] CSRF token 为空：${csrf_body}"
    exit 1
  fi

  local captcha_token=""
  local captcha_code=""
  local captcha_tmp
  captcha_tmp="$(mktemp)"
  local captcha_http_code
  captcha_http_code="$(curl -sS -o "$captcha_tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" "$AUTH_BASE/api/auth/captcha")"
  local captcha_body
  captcha_body="$(cat "$captcha_tmp")"
  rm -f "$captcha_tmp"
  if [[ "$captcha_http_code" == "200" ]]; then
    local captcha_enabled
    captcha_enabled="$(printf '%s' "$captcha_body" | json_field enabled)"
    if [[ "$captcha_enabled" == "true" ]]; then
      captcha_token="$(printf '%s' "$captcha_body" | json_field token)"
      captcha_code="$(
        printf '%s' "$captcha_body" | node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync(0,'utf8'));
const svg=String(d.svg||'');
const m=svg.match(/<text[^>]*>([^<]+)<\\/text>/i);
console.log((m && m[1] ? m[1] : '').trim());
"
      )"
      if [[ -z "$captcha_token" || -z "$captcha_code" ]]; then
        rm -f "$cookie_jar"
        echo "[ERROR] 自动解析验证码失败：${captcha_body}"
        exit 1
      fi
    fi
  fi

  local payload
  payload="$(build_login_payload "$username" "$password" "$captcha_token" "$captcha_code")"

  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -o "$tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" -X POST "$AUTH_BASE/api/auth/login" -H 'Content-Type: application/json' -H "X-CSRF-Token: $csrf_token" -d "$payload")"
  local body
  body="$(cat "$tmp")"
  rm -f "$tmp"
  rm -f "$cookie_jar"

  if [[ "$code" != "200" ]]; then
    echo "[ERROR] 登录失败 ${username}，HTTP ${code}，返回：${body}"
    exit 1
  fi

  local mfa_required
  mfa_required="$(printf '%s' "$body" | json_field mfaRequired)"
  if [[ "$mfa_required" == "true" ]]; then
    echo "[ERROR] 用户 ${username} 开启了 MFA，脚本无法自动获取 token"
    exit 1
  fi

  local token
  token="$(printf '%s' "$body" | json_field token)"
  if [[ -z "$token" ]]; then
    echo "[ERROR] 用户 ${username} 登录未返回 token：${body}"
    exit 1
  fi
  echo "$token"
}

request_status_with_token() {
  local method="$1"
  local route="$2"
  local expected_status="$3"
  local token="$4"
  local body="${5:-}"
  local tmp
  tmp="$(mktemp)"

  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$body")"
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $token")"
  fi

  local payload
  payload="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$code" != "$expected_status" ]]; then
    echo "[ERROR] ${method} ${route} 期望 HTTP ${expected_status}，实际 ${code}"
    echo "[ERROR] 返回：${payload}"
    exit 1
  fi

  echo "$payload"
}

upload_file_with_token() {
  local route="$1"
  local file="$2"
  local stage_code="$3"
  local remark="$4"
  local expected_status="$5"
  local token="$6"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "$API_BASE$route" -H "Authorization: Bearer $token" -F "file=@${file}" -F "stage_code=${stage_code}" -F "remark=${remark}")"
  local payload
  payload="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$code" != "$expected_status" ]]; then
    echo "[ERROR] 上传 ${route} 期望 HTTP ${expected_status}，实际 ${code}"
    echo "[ERROR] 返回：${payload}"
    exit 1
  fi

  echo "$payload"
}

echo "[1/18] 检查设备流转服务可用"
curl -sS "$API_BASE/api/health" >/dev/null

echo "[2/18] 获取 admin/auditor/sysadmin token"
if [[ -z "$AUTH_TOKEN_ADMIN" ]]; then
  AUTH_TOKEN_ADMIN="$(login_get_token "$ADMIN_USERNAME" "$ADMIN_PASSWORD")"
fi
if [[ -z "$AUTH_TOKEN_AUDITOR" ]]; then
  AUTH_TOKEN_AUDITOR="$(login_get_token "$AUDITOR_USERNAME" "$AUDITOR_PASSWORD")"
fi
if [[ -z "$AUTH_TOKEN_SYSADMIN" ]]; then
  AUTH_TOKEN_SYSADMIN="$(login_get_token "$SYSADMIN_USERNAME" "$SYSADMIN_PASSWORD")"
fi

echo "[3/18] 校验系统访问权限"
request_status_with_token GET /api/auth/me 200 "$AUTH_TOKEN_ADMIN" >/dev/null
request_status_with_token GET /api/auth/me 200 "$AUTH_TOKEN_AUDITOR" >/dev/null
if [[ "$EXPECT_SYSADMIN_DEVICE_FLOW_ACCESS" == "true" ]]; then
  request_status_with_token GET /api/auth/me 200 "$AUTH_TOKEN_SYSADMIN" >/dev/null
else
  request_status_with_token GET /api/auth/me 403 "$AUTH_TOKEN_SYSADMIN" >/dev/null
fi

echo "[4/18] admin 创建流转单"
TS="$(date +%s)"
CREATE_RESP="$(request_status_with_token POST /api/device-flow/jobs 201 "$AUTH_TOKEN_ADMIN" "{\"device_sn\":\"SN-RBAC-${TS}\",\"customer_name\":\"RBAC客户\",\"remark\":\"rbac matrix\"}")"
JOB_ID="$(printf '%s' "$CREATE_RESP" | json_field id)"
if [[ -z "$JOB_ID" ]]; then
  echo "[ERROR] 创建流转单失败：${CREATE_RESP}"
  exit 1
fi

echo "[5/18] auditor 尝试收货（应被拒绝）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/receive" 403 "$AUTH_TOKEN_AUDITOR" '{"remark":"auditor receive"}' >/dev/null

echo "[6/18] admin 收货"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/receive" 200 "$AUTH_TOKEN_ADMIN" '{"remark":"admin receive"}' >/dev/null

TMP_HW_FILE="$(mktemp /tmp/device-flow-rbac-hw-XXXXXX.txt)"
TMP_TEST_FILE="$(mktemp /tmp/device-flow-rbac-test-XXXXXX.txt)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TEST_FILE"' EXIT
echo "rbac hw evidence $(date +%s)" > "$TMP_HW_FILE"
echo "rbac test evidence $(date +%s)" > "$TMP_TEST_FILE"

echo "[7/18] admin 上传硬件检查留证"
upload_file_with_token "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_HW_FILE" HARDWARE_CHECKED "rbac-hw" 201 "$AUTH_TOKEN_ADMIN" >/dev/null

echo "[8/18] admin 执行硬件检查 + 系统安装"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/hardware-check" 200 "$AUTH_TOKEN_ADMIN" '{"stage_payload":{"cpu_match":"PASS","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS"}}' >/dev/null
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/os-install" 200 "$AUTH_TOKEN_ADMIN" '{"stage_payload":{"os_name":"JXOS","os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

echo "[9/18] auditor 上传测试留证"
TEST_ATTACH_RESP="$(upload_file_with_token "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_TEST_FILE" TESTED "rbac-test" 201 "$AUTH_TOKEN_AUDITOR")"
TEST_ATTACH_ID="$(printf '%s' "$TEST_ATTACH_RESP" | json_field id)"
if [[ -z "$TEST_ATTACH_ID" ]]; then
  echo "[ERROR] auditor 上传测试附件失败：${TEST_ATTACH_RESP}"
  exit 1
fi

echo "[10/18] auditor 执行测试 + 审核（应允许）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/test" 200 "$AUTH_TOKEN_AUDITOR" '{"stage_payload":{"boot_test":"PASS","network_test":"PASS","stress_test":"PASS","test_result":"PASS"}}' >/dev/null
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/approve" 200 "$AUTH_TOKEN_AUDITOR" '{"stage_payload":{"approve_result":"PASS","approve_note":"ok"}}' >/dev/null

echo "[11/18] auditor 尝试装箱（应被拒绝）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/pack" 403 "$AUTH_TOKEN_AUDITOR" '{"stage_payload":{"package_check":"PASS","accessory_check":"PASS","box_no":"BOX-RBAC"}}' >/dev/null

echo "[12/18] auditor 尝试删除附件（应被拒绝）"
request_status_with_token DELETE "/api/device-flow/attachments/$TEST_ATTACH_ID" 403 "$AUTH_TOKEN_AUDITOR" >/dev/null

echo "[13/18] auditor 执行退回（应允许）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/rework" 200 "$AUTH_TOKEN_AUDITOR" '{"target_stage":"TESTED","reason":"抽检复核","remark":"rbac rework"}' >/dev/null

echo "[14/18] auditor 再次审核（应允许）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/approve" 200 "$AUTH_TOKEN_AUDITOR" '{"stage_payload":{"approve_result":"PASS","approve_note":"recheck ok"}}' >/dev/null

echo "[15/18] auditor 可执行审计验签只读（应允许）"
request_status_with_token GET "/api/device-flow/audit/verify?limit=100" 200 "$AUTH_TOKEN_AUDITOR" >/dev/null

echo "[16/18] auditor 修改 SLA 规则（应被拒绝）"
request_status_with_token PUT "/api/device-flow/sla/rules" 403 "$AUTH_TOKEN_AUDITOR" '{"rules":[{"stage_code":"CREATED","threshold_hours":4,"remind_interval_minutes":120,"enabled":true}]}' >/dev/null

echo "[17/18] admin 装箱 + 发货（应允许）"
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/pack" 200 "$AUTH_TOKEN_ADMIN" '{"stage_payload":{"package_check":"PASS","accessory_check":"PASS","box_no":"BOX-RBAC"}}' >/dev/null
request_status_with_token POST "/api/device-flow/jobs/$JOB_ID/stages/ship" 200 "$AUTH_TOKEN_ADMIN" '{"outbound_tracking_no":"OUT-RBAC-001","stage_payload":{"carrier":"SF","shipped_note":"rbac ship"}}' >/dev/null

echo "[18/18] 校验最终状态"
DETAIL="$(request_status_with_token GET "/api/device-flow/jobs/$JOB_ID" 200 "$AUTH_TOKEN_ADMIN")"
CURRENT_STAGE="$(printf '%s' "$DETAIL" | json_field current_stage)"
if [[ "$CURRENT_STAGE" != "SHIPPED" ]]; then
  echo "[ERROR] 期望最终阶段 SHIPPED，实际：${CURRENT_STAGE}"
  exit 1
fi

echo "[OK] 角色矩阵校验通过，JOB_ID=$JOB_ID"
