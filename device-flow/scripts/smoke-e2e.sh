#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5184}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[ERROR] 请先设置 AUTH_TOKEN（统一登录 Bearer Token）"
  exit 1
fi

# 兼容单 token 冒烟：默认关闭测试/审核双签，避免第二签名人缺失导致流程中断。
curl -sS -X PUT \
  "$API_BASE/api/device-flow/dual-sign/policies" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"policies":[{"stage_code":"TESTED","required_signers":2,"enabled":false},{"stage_code":"APPROVED","required_signers":2,"enabled":false}]}' >/dev/null || true

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" \
      "$API_BASE$path" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" \
      "$API_BASE$path" \
      -H "Authorization: Bearer $AUTH_TOKEN"
  fi
}

upload_file() {
  local path="$1"
  local file="$2"
  local stage_code="$3"
  local remark="$4"
  curl -sS -X POST \
    "$API_BASE$path" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -F "file=@${file}" \
    -F "stage_code=${stage_code}" \
    -F "remark=${remark}" >/dev/null
}

extract_json_field() {
  local field="$1"
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));console.log(data['$field']??'');"
}

request_code() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$API_BASE$path" -H "Authorization: Bearer $AUTH_TOKEN")"
  if [[ "$code" != "$expected_status" ]]; then
    echo "[ERROR] ${method} ${path} 期望 HTTP ${expected_status}，实际 ${code}"
    exit 1
  fi
}

echo "[1/17] 创建流转单"
CREATE_RESP="$(request_json POST /api/device-flow/jobs '{"device_sn":"SN-SMOKE-001","customer_name":"烟测客户","sales_order_no":"SO-SMOKE-001","inbound_tracking_no":"IN-SMOKE-001","remark":"smoke test"}')"
JOB_ID="$(printf '%s' "$CREATE_RESP" | extract_json_field id)"
if [[ -z "$JOB_ID" ]]; then
  echo "[ERROR] 创建流转单失败: $CREATE_RESP"
  exit 1
fi

echo "[2/17] 收货"
request_json POST "/api/device-flow/jobs/$JOB_ID/stages/receive" '{"remark":"收货完成","stage_payload":{"receive_note":"外观完好"}}' >/dev/null

TMP_HW_FILE="$(mktemp /tmp/device-flow-hw-XXXXXX.txt)"
TMP_TEST_FILE="$(mktemp /tmp/device-flow-test-XXXXXX.txt)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TEST_FILE"' EXIT
echo "hardware evidence $(date +%s)" > "$TMP_HW_FILE"
echo "test evidence $(date +%s)" > "$TMP_TEST_FILE"

echo "[3/17] 上传硬件检查附件"
upload_file "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_HW_FILE" "HARDWARE_CHECKED" "硬件检查留证"

echo "[4/17] 硬件检查"
request_json POST "/api/device-flow/jobs/$JOB_ID/stages/hardware-check" '{"remark":"硬件检查通过","stage_payload":{"cpu_match":"PASS","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS"}}' >/dev/null

echo "[5/17] 系统安装"
request_json POST "/api/device-flow/jobs/$JOB_ID/stages/os-install" '{"remark":"安装完成","stage_payload":{"os_name":"JXOS","os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

echo "[6/17] 上传测试附件"
upload_file "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_TEST_FILE" "TESTED" "测试留证"

echo "[7/17] 测试"
TEST_INIT_RESP="$(request_json POST "/api/device-flow/jobs/$JOB_ID/stages/test" '{"remark":"测试通过","signature":"smoke-test-sign-1","stage_payload":{"boot_test":"PASS","network_test":"PASS","stress_test":"PASS","test_result":"PASS"}}')"
TEST_DUAL_TOKEN="$(printf '%s' "$TEST_INIT_RESP" | extract_json_field dual_sign_token)"
if [[ -n "$TEST_DUAL_TOKEN" ]]; then
  request_json POST "/api/device-flow/jobs/$JOB_ID/stages/test" "{\"remark\":\"测试通过\",\"signature\":\"smoke-test-sign-2\",\"dual_sign_token\":\"$TEST_DUAL_TOKEN\",\"stage_payload\":{\"boot_test\":\"PASS\",\"network_test\":\"PASS\",\"stress_test\":\"PASS\",\"test_result\":\"PASS\"}}" >/dev/null
fi

echo "[8/17] 审核"
APPROVE_INIT_RESP="$(request_json POST "/api/device-flow/jobs/$JOB_ID/stages/approve" '{"remark":"审核通过","signature":"smoke-approve-sign-1","stage_payload":{"approve_result":"PASS","approve_note":"符合交付标准"}}')"
APPROVE_DUAL_TOKEN="$(printf '%s' "$APPROVE_INIT_RESP" | extract_json_field dual_sign_token)"
if [[ -n "$APPROVE_DUAL_TOKEN" ]]; then
  request_json POST "/api/device-flow/jobs/$JOB_ID/stages/approve" "{\"remark\":\"审核通过\",\"signature\":\"smoke-approve-sign-2\",\"dual_sign_token\":\"$APPROVE_DUAL_TOKEN\",\"stage_payload\":{\"approve_result\":\"PASS\",\"approve_note\":\"符合交付标准\"}}" >/dev/null
fi

echo "[9/17] 装箱"
request_json POST "/api/device-flow/jobs/$JOB_ID/stages/pack" '{"remark":"装箱完成","stage_payload":{"package_check":"PASS","accessory_check":"PASS","box_no":"BOX-001"}}' >/dev/null

echo "[10/17] 发货"
request_json POST "/api/device-flow/jobs/$JOB_ID/stages/ship" '{"remark":"发货完成","outbound_tracking_no":"OUT-SMOKE-001","stage_payload":{"carrier":"SF","shipped_note":"已交付快递"}}' >/dev/null

echo "[11/17] 校验详情"
DETAIL="$(request_json GET "/api/device-flow/jobs/$JOB_ID")"
CURRENT_STAGE="$(printf '%s' "$DETAIL" | extract_json_field current_stage)"
if [[ "$CURRENT_STAGE" != "SHIPPED" ]]; then
  echo "[ERROR] 期望阶段 SHIPPED，实际: $CURRENT_STAGE"
  exit 1
fi

echo "[12/17] 校验看板接口"
DASHBOARD="$(request_json GET "/api/device-flow/dashboard/summary")"
HAS_GENERATED_AT="$(printf '%s' "$DASHBOARD" | extract_json_field generated_at)"
if [[ -z "$HAS_GENERATED_AT" ]]; then
  echo "[ERROR] 看板接口返回异常: $DASHBOARD"
  exit 1
fi

echo "[13/17] 校验审计接口权限（admin 应为 403）"
request_code GET "/api/device-flow/logs?page=1&limit=10&keyword=SN-SMOKE-001" 403

echo "[14/17] 校验看板CSV导出"
DASHBOARD_CSV="$(request_json GET "/api/device-flow/reports/dashboard.csv?stage=SHIPPED&overdue_days=1")"
if [[ "$DASHBOARD_CSV" != *"流转单号"* ]]; then
  echo "[ERROR] 看板CSV导出返回异常"
  exit 1
fi

echo "[15/17] 校验SLA汇总接口"
SLA_SUMMARY="$(request_json GET "/api/device-flow/sla/summary")"
SLA_TS="$(printf '%s' "$SLA_SUMMARY" | extract_json_field generated_at)"
if [[ -z "$SLA_TS" ]]; then
  echo "[ERROR] SLA汇总接口返回异常: $SLA_SUMMARY"
  exit 1
fi

echo "[16/17] 校验审计验签接口权限（admin 应为 403）"
request_code GET "/api/device-flow/audit/verify?limit=100" 403

echo "[17/17] 校验Excel模板与导出接口"
request_code GET "/api/device-flow/templates/jobs-import.xlsx" 200
request_code GET "/api/device-flow/reports/jobs.xlsx?keyword=SN-SMOKE-001" 200

echo "[OK] 全流程冒烟通过，JOB_ID=$JOB_ID"
