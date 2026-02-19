#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5185}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[ERROR] 请先设置 AUTH_TOKEN（统一登录 Bearer Token）"
  exit 1
fi

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

echo "[1/19] 创建实施单"
CREATE_RESP="$(request_json POST /api/sec-impl/projects '{"project_code":"PRJ-SMOKE-001","product_type":"WAF","customer_name":"烟测客户","sales_order_no":"SO-SMOKE-001","inbound_tracking_no":"IN-SMOKE-001","remark":"smoke test"}')"
JOB_ID="$(printf '%s' "$CREATE_RESP" | extract_json_field id)"
if [[ -z "$JOB_ID" ]]; then
  echo "[ERROR] 创建实施单失败: $CREATE_RESP"
  exit 1
fi

echo "[2/19] 评估"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/assess" '{"remark":"评估完成","stage_payload":{"receive_note":"实施前置条件确认"}}' >/dev/null

TMP_HW_FILE="$(mktemp /tmp/sec-impl-hw-XXXXXX.txt)"
TMP_TUNE_FILE="$(mktemp /tmp/sec-impl-tune-XXXXXX.txt)"
TMP_TRIAL_FILE="$(mktemp /tmp/sec-impl-trial-XXXXXX.txt)"
TMP_ACCEPT_FILE="$(mktemp /tmp/sec-impl-accept-XXXXXX.txt)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TUNE_FILE" "$TMP_TRIAL_FILE" "$TMP_ACCEPT_FILE"' EXIT
echo "implement evidence $(date +%s)" > "$TMP_HW_FILE"
echo "tune evidence $(date +%s)" > "$TMP_TUNE_FILE"
echo "trial evidence $(date +%s)" > "$TMP_TRIAL_FILE"
echo "accept evidence $(date +%s)" > "$TMP_ACCEPT_FILE"

echo "[3/19] 上传实施留证"
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_HW_FILE" "IMPLEMENT" "实施留证"

echo "[4/19] 实施部署"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/implement" '{"remark":"实施部署完成","stage_payload":{"cpu_match":"PASS","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS"}}' >/dev/null

echo "[5/19] 上传联调留证"
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_TUNE_FILE" "TUNE" "联调留证"

echo "[6/19] 联调优化"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/tune" '{"remark":"联调完成","stage_payload":{"os_name":"JXOS","os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

echo "[7/19] 上传试运行留证"
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_TRIAL_FILE" "TRIAL" "试运行留证"

echo "[8/19] 试运行"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/trial" '{"remark":"试运行通过","stage_payload":{"boot_test":"PASS","network_test":"PASS","stress_test":"PASS","test_result":"PASS"}}' >/dev/null

echo "[9/19] 上传验收留证"
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_ACCEPT_FILE" "ACCEPT" "验收留证"

echo "[10/19] 验收"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/accept" '{"remark":"验收通过","stage_payload":{"approve_result":"PASS","approve_note":"符合交付标准"}}' >/dev/null

echo "[11/19] 运维移交"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/handover" '{"remark":"移交完成","stage_payload":{"package_check":"PASS","accessory_check":"PASS","box_no":"HANDOVER-001"}}' >/dev/null

echo "[12/19] 归档关闭"
request_json POST "/api/sec-impl/projects/$JOB_ID/stages/close" '{"remark":"归档完成","outbound_tracking_no":"ACC-SMOKE-001","stage_payload":{"carrier":"实施负责人","shipped_note":"验收归档完成"}}' >/dev/null

echo "[13/19] 校验详情"
DETAIL="$(request_json GET "/api/sec-impl/projects/$JOB_ID")"
CURRENT_STAGE="$(printf '%s' "$DETAIL" | extract_json_field current_stage)"
if [[ "$CURRENT_STAGE" != "CLOSED" ]]; then
  echo "[ERROR] 期望阶段 CLOSED，实际: $CURRENT_STAGE"
  exit 1
fi

echo "[14/19] 校验看板接口"
DASHBOARD="$(request_json GET "/api/sec-impl/dashboard/summary")"
HAS_GENERATED_AT="$(printf '%s' "$DASHBOARD" | extract_json_field generated_at)"
if [[ -z "$HAS_GENERATED_AT" ]]; then
  echo "[ERROR] 看板接口返回异常: $DASHBOARD"
  exit 1
fi

echo "[15/19] 校验日志接口"
LOGS="$(request_json GET "/api/sec-impl/logs?page=1&limit=10&keyword=PRJ-SMOKE-001")"
LOG_COUNT="$(printf '%s' "$LOGS" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(Array.isArray(d)?d.length:'')")"
if [[ -z "$LOG_COUNT" ]]; then
  echo "[ERROR] 日志接口返回异常: $LOGS"
  exit 1
fi

echo "[16/19] 校验看板CSV导出"
DASHBOARD_CSV="$(request_json GET "/api/sec-impl/reports/dashboard.csv?stage=CLOSED&overdue_days=1")"
if [[ "$DASHBOARD_CSV" != *"实施单号"* ]]; then
  echo "[ERROR] 看板CSV导出返回异常"
  exit 1
fi

echo "[17/19] 校验SLA汇总接口"
SLA_SUMMARY="$(request_json GET "/api/sec-impl/sla/summary")"
SLA_TS="$(printf '%s' "$SLA_SUMMARY" | extract_json_field generated_at)"
if [[ -z "$SLA_TS" ]]; then
  echo "[ERROR] SLA汇总接口返回异常: $SLA_SUMMARY"
  exit 1
fi

echo "[18/19] 校验审计验签接口"
VERIFY_RESP="$(request_json GET "/api/sec-impl/audit/verify?limit=100")"
VERIFY_COUNT="$(printf '%s' "$VERIFY_RESP" | extract_json_field total_checked)"
if [[ -z "$VERIFY_COUNT" ]]; then
  echo "[ERROR] 审计验签接口返回异常: $VERIFY_RESP"
  exit 1
fi

echo "[19/19] 校验Excel模板与导出接口"
request_code GET "/api/sec-impl/templates/projects-import.xlsx" 200
request_code GET "/api/sec-impl/reports/projects.xlsx?keyword=PRJ-SMOKE-001" 200

echo "[OK] 全流程冒烟通过，JOB_ID=$JOB_ID"
