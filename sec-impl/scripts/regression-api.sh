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
  local route="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" \
      "$API_BASE$route" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" \
      "$API_BASE$route" \
      -H "Authorization: Bearer $AUTH_TOKEN"
  fi
}

extract_json_field() {
  local field="$1"
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(d['$field']??'');"
}

request_status() {
  local method="$1"
  local route="$2"
  local expected_status="$3"
  local body="${4:-}"
  local tmp
  tmp="$(mktemp)"

  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -d "$body")"
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $AUTH_TOKEN")"
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

request_code() {
  local method="$1"
  local route="$2"
  local expected_status="$3"
  local body="${4:-}"
  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -d "$body")"
  else
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$API_BASE$route" -H "Authorization: Bearer $AUTH_TOKEN")"
  fi
  if [[ "$code" != "$expected_status" ]]; then
    echo "[ERROR] ${method} ${route} 期望 HTTP ${expected_status}，实际 ${code}"
    exit 1
  fi
}

upload_file() {
  local route="$1"
  local file="$2"
  local stage_code="$3"
  local remark="$4"
  curl -sS -X POST \
    "$API_BASE$route" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -F "file=@${file}" \
    -F "stage_code=${stage_code}" \
    -F "remark=${remark}"
}

echo "[1/19] 创建实施单"
CREATE_RESP="$(request_json POST /api/sec-impl/projects '{"project_code":"PRJ-REG-001","product_type":"WAF","customer_name":"RegressionCustomer","remark":"regression"}')"
JOB_ID="$(printf '%s' "$CREATE_RESP" | extract_json_field id)"
if [[ -z "$JOB_ID" ]]; then
  echo "[ERROR] 创建实施单失败: $CREATE_RESP"
  exit 1
fi

TMP_HW_FILE="$(mktemp /tmp/sec-impl-reg-hw-XXXXXX.txt)"
TMP_TUNE_FILE="$(mktemp /tmp/sec-impl-reg-tune-XXXXXX.txt)"
TMP_TEST_FILE1="$(mktemp /tmp/sec-impl-reg-test1-XXXXXX.txt)"
TMP_TEST_FILE2="$(mktemp /tmp/sec-impl-reg-test2-XXXXXX.txt)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TUNE_FILE" "$TMP_TEST_FILE1" "$TMP_TEST_FILE2"' EXIT

echo "implement evidence $(date +%s)" > "$TMP_HW_FILE"
echo "tune evidence $(date +%s)" > "$TMP_TUNE_FILE"
echo "test evidence 1 $(date +%s)" > "$TMP_TEST_FILE1"
echo "test evidence 2 $(date +%s)" > "$TMP_TEST_FILE2"

echo "[2/19] 评估"
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/assess" 200 '{"remark":"评估完成"}' >/dev/null

echo "[3/19] 上传实施留证"
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_HW_FILE" "IMPLEMENT" "实施留证" >/dev/null

echo "[4/19] 实施部署 FAIL 无说明（应失败）"
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/implement" 400 '{"stage_payload":{"cpu_match":"FAIL","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS"}}' >/dev/null

echo "[5/19] 实施部署 FAIL + 说明（应成功）"
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/implement" 200 '{"remark":"有异常","stage_payload":{"cpu_match":"FAIL","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS","hardware_note":"cpu型号不一致"}}' >/dev/null

echo "[6/19] 联调优化缺少平台名称（应失败）"
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/tune" 400 '{"stage_payload":{"os_version":"1.0.0","install_result":"PASS"}}' >/dev/null
upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_TUNE_FILE" "TUNE" "联调留证" >/dev/null
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/tune" 200 '{"stage_payload":{"os_name":"JXOS","os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

echo "[7/19] 上传试运行留证并完成试运行"
ATTACH_1="$(upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_TEST_FILE1" "TRIAL" "测试留证1" | extract_json_field id)"
request_status POST "/api/sec-impl/projects/$JOB_ID/stages/trial" 200 '{"stage_payload":{"boot_test":"PASS","network_test":"PASS","stress_test":"PASS","test_result":"PASS"}}' >/dev/null

echo "[8/19] 删除 TRIAL 阶段最后一个附件（应 409）"
request_status DELETE "/api/sec-impl/attachments/$ATTACH_1" 409 >/dev/null

echo "[9/19] 再上传一个 TRIAL 附件后删除其中一个（应成功）"
ATTACH_2="$(upload_file "/api/sec-impl/projects/$JOB_ID/attachments" "$TMP_TEST_FILE2" "TRIAL" "测试留证2" | extract_json_field id)"
request_status DELETE "/api/sec-impl/attachments/$ATTACH_2" 200 >/dev/null

echo "[10/19] 日志日期 from > to（应 400）"
request_status GET '/api/sec-impl/logs?from=2026-02-20&to=2026-02-19' 400 >/dev/null

echo "[11/19] 看板接口可用"
DASHBOARD_RESP="$(request_status GET '/api/sec-impl/dashboard/summary' 200)"
DASHBOARD_TS="$(printf '%s' "$DASHBOARD_RESP" | extract_json_field generated_at)"
if [[ -z "$DASHBOARD_TS" ]]; then
  echo "[ERROR] 看板接口返回异常: $DASHBOARD_RESP"
  exit 1
fi

echo "[12/19] 看板筛选参数校验"
request_status GET '/api/sec-impl/dashboard/summary?stage=INVALID' 400 >/dev/null
FILTERED_DASHBOARD="$(request_status GET '/api/sec-impl/dashboard/summary?stage=TRIAL&customer=RegressionCustomer&overdue_days=2' 200)"
FILTERED_TS="$(printf '%s' "$FILTERED_DASHBOARD" | extract_json_field generated_at)"
if [[ -z "$FILTERED_TS" ]]; then
  echo "[ERROR] 看板筛选接口返回异常: $FILTERED_DASHBOARD"
  exit 1
fi

echo "[13/19] 看板CSV导出可用"
DASHBOARD_CSV="$(request_status GET '/api/sec-impl/reports/dashboard.csv?stage=TRIAL&customer=RegressionCustomer&overdue_days=2' 200)"
if [[ "$DASHBOARD_CSV" != *"实施单号"* ]]; then
  echo "[ERROR] 看板CSV导出内容异常"
  exit 1
fi

echo "[14/19] SLA汇总接口可用"
SLA_SUMMARY="$(request_status GET '/api/sec-impl/sla/summary' 200)"
SLA_GENERATED="$(printf '%s' "$SLA_SUMMARY" | extract_json_field generated_at)"
if [[ -z "$SLA_GENERATED" ]]; then
  echo "[ERROR] SLA汇总返回异常: $SLA_SUMMARY"
  exit 1
fi

echo "[15/19] SLA手动催办可执行"
SLA_RUN_RESP="$(request_status POST '/api/sec-impl/sla/run' 200 '{"max_scan":100}')"
SLA_CHECKED="$(printf '%s' "$SLA_RUN_RESP" | extract_json_field checked)"
if [[ -z "$SLA_CHECKED" ]]; then
  echo "[ERROR] SLA手动催办返回异常: $SLA_RUN_RESP"
  exit 1
fi

echo "[16/19] 审计链验签接口可用"
VERIFY_RESP="$(request_status GET '/api/sec-impl/audit/verify?limit=200' 200)"
VERIFY_CHECKED="$(printf '%s' "$VERIFY_RESP" | extract_json_field total_checked)"
if [[ -z "$VERIFY_CHECKED" ]]; then
  echo "[ERROR] 审计验签返回异常: $VERIFY_RESP"
  exit 1
fi

echo "[17/19] Excel模板与导出可用"
request_code GET '/api/sec-impl/templates/projects-import.xlsx' 200
request_code GET '/api/sec-impl/reports/projects.xlsx?keyword=PRJ-REG-001' 200

echo "[18/19] 批量阶段推进可用"
BATCH_CREATE="$(request_json POST /api/sec-impl/projects '{"project_code":"PRJ-REG-BATCH-001","product_type":"NDR","customer_name":"RegressionBatch","remark":"batch-stage"}')"
BATCH_JOB_ID="$(printf '%s' "$BATCH_CREATE" | extract_json_field id)"
if [[ -z "$BATCH_JOB_ID" ]]; then
  echo "[ERROR] 批量测试实施单创建失败: $BATCH_CREATE"
  exit 1
fi
BATCH_STAGE_RESP="$(request_status POST '/api/sec-impl/projects/batch/stage' 200 "{\"action\":\"assess\",\"job_ids\":[${BATCH_JOB_ID}],\"remark\":\"batch assess\",\"stage_payload\":{\"receive_note\":\"batch assess\"}}")"
BATCH_SUCCESS="$(printf '%s' "$BATCH_STAGE_RESP" | extract_json_field success_count)"
if [[ "$BATCH_SUCCESS" != "1" ]]; then
  echo "[ERROR] 批量推进返回异常: $BATCH_STAGE_RESP"
  exit 1
fi

echo "[19/19] 批量推进后阶段校验"
BATCH_DETAIL="$(request_status GET "/api/sec-impl/projects/$BATCH_JOB_ID" 200)"
BATCH_STAGE="$(printf '%s' "$BATCH_DETAIL" | extract_json_field current_stage)"
if [[ "$BATCH_STAGE" != "ASSESS" ]]; then
  echo "[ERROR] 批量推进后阶段异常，期望 ASSESS，实际: $BATCH_STAGE"
  exit 1
fi

echo "[OK] 回归校验通过，JOB_ID=$JOB_ID"
