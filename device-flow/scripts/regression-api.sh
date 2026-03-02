#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5184}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[ERROR] 请先设置 AUTH_TOKEN（统一登录 Bearer Token）"
  exit 1
fi

# 兼容单 token 回归：默认关闭测试/审核双签，避免第二签名人缺失导致流程中断。
curl -sS -X PUT \
  "$API_BASE/api/device-flow/dual-sign/policies" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"policies":[{"stage_code":"TESTED","required_signers":2,"enabled":false},{"stage_code":"APPROVED","required_signers":2,"enabled":false}]}' >/dev/null || true

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

echo "[1/19] 创建流转单"
CREATE_RESP="$(request_json POST /api/device-flow/jobs '{"device_sn":"SN-REG-001","customer_name":"RegressionCustomer","remark":"regression"}')"
JOB_ID="$(printf '%s' "$CREATE_RESP" | extract_json_field id)"
if [[ -z "$JOB_ID" ]]; then
  echo "[ERROR] 创建流转单失败: $CREATE_RESP"
  exit 1
fi

TMP_HW_FILE="$(mktemp /tmp/device-flow-reg-hw-XXXXXX.txt)"
TMP_TEST_FILE1="$(mktemp /tmp/device-flow-reg-test1-XXXXXX.txt)"
TMP_TEST_FILE2="$(mktemp /tmp/device-flow-reg-test2-XXXXXX.txt)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TEST_FILE1" "$TMP_TEST_FILE2"' EXIT

echo "hardware evidence $(date +%s)" > "$TMP_HW_FILE"
echo "test evidence 1 $(date +%s)" > "$TMP_TEST_FILE1"
echo "test evidence 2 $(date +%s)" > "$TMP_TEST_FILE2"

echo "[2/19] 收货"
request_status POST "/api/device-flow/jobs/$JOB_ID/stages/receive" 200 '{"remark":"收货完成"}' >/dev/null

echo "[3/19] 上传硬件检查留证"
upload_file "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_HW_FILE" "HARDWARE_CHECKED" "硬件检查留证" >/dev/null

echo "[4/19] 硬件检查 FAIL 无说明（应失败）"
request_status POST "/api/device-flow/jobs/$JOB_ID/stages/hardware-check" 400 '{"stage_payload":{"cpu_match":"FAIL","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS"}}' >/dev/null

echo "[5/19] 硬件检查 FAIL + 说明（应成功）"
request_status POST "/api/device-flow/jobs/$JOB_ID/stages/hardware-check" 200 '{"remark":"有异常","stage_payload":{"cpu_match":"FAIL","memory_match":"PASS","disk_match":"PASS","nic_match":"PASS","serial_match":"PASS","hardware_note":"cpu型号不一致"}}' >/dev/null

echo "[6/19] 系统安装缺少系统名称（应失败）"
request_status POST "/api/device-flow/jobs/$JOB_ID/stages/os-install" 400 '{"stage_payload":{"os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

request_status POST "/api/device-flow/jobs/$JOB_ID/stages/os-install" 200 '{"stage_payload":{"os_name":"JXOS","os_version":"1.0.0","install_result":"PASS"}}' >/dev/null

echo "[7/19] 上传测试留证并完成测试（双签）"
ATTACH_1="$(upload_file "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_TEST_FILE1" "TESTED" "测试留证1" | extract_json_field id)"
TEST_INIT_RESP="$(request_json POST "/api/device-flow/jobs/$JOB_ID/stages/test" '{"signature":"tester-sign-1","stage_payload":{"boot_test":"PASS","network_test":"PASS","stress_test":"PASS","test_result":"PASS"}}')"
TEST_DUAL_TOKEN="$(printf '%s' "$TEST_INIT_RESP" | extract_json_field dual_sign_token)"
if [[ -n "$TEST_DUAL_TOKEN" ]]; then
  request_status POST "/api/device-flow/jobs/$JOB_ID/stages/test" 200 "{\"signature\":\"tester-sign-2\",\"dual_sign_token\":\"$TEST_DUAL_TOKEN\",\"stage_payload\":{\"boot_test\":\"PASS\",\"network_test\":\"PASS\",\"stress_test\":\"PASS\",\"test_result\":\"PASS\"}}" >/dev/null
fi

echo "[8/19] 删除 TESTED 阶段最后一个附件（应 409）"
request_status DELETE "/api/device-flow/attachments/$ATTACH_1" 409 >/dev/null

echo "[9/19] 再上传一个 TESTED 附件后删除其中一个（应成功）"
ATTACH_2="$(upload_file "/api/device-flow/jobs/$JOB_ID/attachments" "$TMP_TEST_FILE2" "TESTED" "测试留证2" | extract_json_field id)"
request_status DELETE "/api/device-flow/attachments/$ATTACH_2" 200 >/dev/null

echo "[9.5/19] 审核双签流程"
APPROVE_INIT_RESP="$(request_json POST "/api/device-flow/jobs/$JOB_ID/stages/approve" '{"signature":"approver-sign-1","stage_payload":{"approve_result":"PASS","approve_note":"ok"}}')"
APPROVE_DUAL_TOKEN="$(printf '%s' "$APPROVE_INIT_RESP" | extract_json_field dual_sign_token)"
if [[ -n "$APPROVE_DUAL_TOKEN" ]]; then
  request_status POST "/api/device-flow/jobs/$JOB_ID/stages/approve" 200 "{\"signature\":\"approver-sign-2\",\"dual_sign_token\":\"$APPROVE_DUAL_TOKEN\",\"stage_payload\":{\"approve_result\":\"PASS\",\"approve_note\":\"ok-2\"}}" >/dev/null
fi

echo "[10/19] 审计日志权限（admin 应 403）"
request_status GET '/api/device-flow/logs?from=2026-02-20&to=2026-02-19' 403 >/dev/null

echo "[11/19] 看板接口可用"
DASHBOARD_RESP="$(request_status GET '/api/device-flow/dashboard/summary' 200)"
DASHBOARD_TS="$(printf '%s' "$DASHBOARD_RESP" | extract_json_field generated_at)"
if [[ -z "$DASHBOARD_TS" ]]; then
  echo "[ERROR] 看板接口返回异常: $DASHBOARD_RESP"
  exit 1
fi

echo "[12/19] 看板筛选参数校验"
request_status GET '/api/device-flow/dashboard/summary?stage=INVALID' 400 >/dev/null
FILTERED_DASHBOARD="$(request_status GET '/api/device-flow/dashboard/summary?stage=TESTED&customer=RegressionCustomer&overdue_days=2' 200)"
FILTERED_TS="$(printf '%s' "$FILTERED_DASHBOARD" | extract_json_field generated_at)"
if [[ -z "$FILTERED_TS" ]]; then
  echo "[ERROR] 看板筛选接口返回异常: $FILTERED_DASHBOARD"
  exit 1
fi

echo "[13/19] 看板CSV导出可用"
DASHBOARD_CSV="$(request_status GET '/api/device-flow/reports/dashboard.csv?stage=TESTED&customer=RegressionCustomer&overdue_days=2' 200)"
if [[ "$DASHBOARD_CSV" != *"流转单号"* ]]; then
  echo "[ERROR] 看板CSV导出内容异常"
  exit 1
fi

echo "[14/19] SLA汇总接口可用"
SLA_SUMMARY="$(request_status GET '/api/device-flow/sla/summary' 200)"
SLA_GENERATED="$(printf '%s' "$SLA_SUMMARY" | extract_json_field generated_at)"
if [[ -z "$SLA_GENERATED" ]]; then
  echo "[ERROR] SLA汇总返回异常: $SLA_SUMMARY"
  exit 1
fi

echo "[15/19] SLA手动催办可执行"
SLA_RUN_RESP="$(request_status POST '/api/device-flow/sla/run' 200 '{"max_scan":100}')"
SLA_CHECKED="$(printf '%s' "$SLA_RUN_RESP" | extract_json_field checked)"
if [[ -z "$SLA_CHECKED" ]]; then
  echo "[ERROR] SLA手动催办返回异常: $SLA_RUN_RESP"
  exit 1
fi

echo "[16/19] 审计链验签权限（admin 应 403）"
request_status GET '/api/device-flow/audit/verify?limit=200' 403 >/dev/null

echo "[17/19] Excel模板与导出可用"
request_code GET '/api/device-flow/templates/jobs-import.xlsx' 200
request_code GET '/api/device-flow/reports/jobs.xlsx?keyword=SN-REG-001' 200

echo "[18/19] 批量阶段推进可用"
BATCH_CREATE="$(request_json POST /api/device-flow/jobs '{"device_sn":"SN-REG-BATCH-001","customer_name":"RegressionBatch","remark":"batch-stage"}')"
BATCH_JOB_ID="$(printf '%s' "$BATCH_CREATE" | extract_json_field id)"
if [[ -z "$BATCH_JOB_ID" ]]; then
  echo "[ERROR] 批量测试流转单创建失败: $BATCH_CREATE"
  exit 1
fi
BATCH_STAGE_RESP="$(request_status POST '/api/device-flow/jobs/batch/stage' 200 "{\"action\":\"receive\",\"job_ids\":[${BATCH_JOB_ID}],\"remark\":\"batch receive\",\"stage_payload\":{\"receive_note\":\"batch receive\"}}")"
BATCH_SUCCESS="$(printf '%s' "$BATCH_STAGE_RESP" | extract_json_field success_count)"
if [[ "$BATCH_SUCCESS" != "1" ]]; then
  echo "[ERROR] 批量推进返回异常: $BATCH_STAGE_RESP"
  exit 1
fi

echo "[19/19] 批量推进后阶段校验"
BATCH_DETAIL="$(request_status GET "/api/device-flow/jobs/$BATCH_JOB_ID" 200)"
BATCH_STAGE="$(printf '%s' "$BATCH_DETAIL" | extract_json_field current_stage)"
if [[ "$BATCH_STAGE" != "RECEIVED" ]]; then
  echo "[ERROR] 批量推进后阶段异常，期望 RECEIVED，实际: $BATCH_STAGE"
  exit 1
fi

echo "[20/27] 扫码解析接口可用"
SCAN_RESP="$(request_status POST '/api/device-flow/scan/parse' 200 '{"scan_input":"SN:SN-SCAN-001;IN:IN-SCAN-001;OUT:OUT-SCAN-001"}')"
SCAN_RAW="$(printf '%s' "$SCAN_RESP" | extract_json_field raw)"
if [[ -z "$SCAN_RAW" ]]; then
  echo "[ERROR] 扫码解析返回异常: $SCAN_RESP"
  exit 1
fi

echo "[21/27] 导入预校验模式可用"
TMP_IMPORT_FILE="$(mktemp /tmp/device-flow-import-XXXXXX.csv)"
trap 'rm -f "$TMP_HW_FILE" "$TMP_TEST_FILE1" "$TMP_TEST_FILE2" "$TMP_IMPORT_FILE"' EXIT
cat > "$TMP_IMPORT_FILE" <<'EOF'
device_sn,device_model,customer_name,sales_order_no,inbound_tracking_no,remark
SN-PRECHECK-001,NSG-1000,预校验客户,SO-PC-001,IN-PC-001,ok
EOF
PRECHECK_HTTP="$(curl -sS -o /tmp/device-flow-precheck.json -w '%{http_code}' -X POST "$API_BASE/api/device-flow/import/jobs.xlsx?dry_run=true" -H "Authorization: Bearer $AUTH_TOKEN" -F "file=@${TMP_IMPORT_FILE}")"
if [[ "$PRECHECK_HTTP" != "200" ]]; then
  echo "[ERROR] 导入预校验失败，HTTP=${PRECHECK_HTTP}"
  cat /tmp/device-flow-precheck.json
  exit 1
fi
rm -f /tmp/device-flow-precheck.json

echo "[22/27] 版本冲突保护（应 409）"
VERSION_JOB="$(request_json POST /api/device-flow/jobs '{"device_sn":"SN-VER-001","customer_name":"VersionCheck","remark":"version test"}')"
VERSION_JOB_ID="$(printf '%s' "$VERSION_JOB" | extract_json_field id)"
if [[ -z "$VERSION_JOB_ID" ]]; then
  echo "[ERROR] 版本测试流转单创建失败: $VERSION_JOB"
  exit 1
fi
request_status POST "/api/device-flow/jobs/$VERSION_JOB_ID/stages/receive" 409 '{"expected_version":99999,"remark":"bad version"}' >/dev/null

echo "[23/27] 审批作废流程可用"
CR_JOB="$(request_json POST /api/device-flow/jobs '{"device_sn":"SN-CR-001","customer_name":"ChangeRequestCustomer","remark":"cr test"}')"
CR_JOB_ID="$(printf '%s' "$CR_JOB" | extract_json_field id)"
if [[ -z "$CR_JOB_ID" ]]; then
  echo "[ERROR] 审批测试流转单创建失败: $CR_JOB"
  exit 1
fi
CR_REQ_RESP="$(request_status POST "/api/device-flow/jobs/$CR_JOB_ID/change-requests" 201 '{"request_type":"CANCEL","request_reason":"客户取消订单","request_payload":{"remark":"取消出货"}}')"
CR_REQ_ID="$(printf '%s' "$CR_REQ_RESP" | extract_json_field id)"
if [[ -z "$CR_REQ_ID" ]]; then
  echo "[ERROR] 作废审批单创建失败: $CR_REQ_RESP"
  exit 1
fi
request_status POST "/api/device-flow/change-requests/$CR_REQ_ID/approve" 200 '{"approve_comment":"同意作废"}' >/dev/null
CR_JOB_DETAIL="$(request_status GET "/api/device-flow/jobs/$CR_JOB_ID" 200)"
CR_STATUS="$(printf '%s' "$CR_JOB_DETAIL" | extract_json_field status)"
if [[ "$CR_STATUS" != "VOIDED" ]]; then
  echo "[ERROR] 作废审批后状态异常，期望 VOIDED，实际: $CR_STATUS"
  exit 1
fi

echo "[24/27] 标签打印JSON可用"
LABEL_JSON="$(request_status GET "/api/device-flow/jobs/$JOB_ID/labels/device?format=json" 200)"
TRACK_URL="$(printf '%s' "$LABEL_JSON" | extract_json_field track_url)"
if [[ -z "$TRACK_URL" ]]; then
  echo "[ERROR] 标签打印JSON返回异常: $LABEL_JSON"
  exit 1
fi

echo "[25/27] 交付周期报表可用"
CYCLE_RESP="$(request_status GET '/api/device-flow/reports/cycle' 200)"
CYCLE_TS="$(printf '%s' "$CYCLE_RESP" | extract_json_field generated_at)"
if [[ -z "$CYCLE_TS" ]]; then
  echo "[ERROR] 周期报表返回异常: $CYCLE_RESP"
  exit 1
fi

echo "[26/27] 系统操作看板可用"
OPS_RESP="$(request_status GET '/api/device-flow/ops/dashboard' 200)"
OPS_TS="$(printf '%s' "$OPS_RESP" | extract_json_field generated_at)"
if [[ -z "$OPS_TS" ]]; then
  echo "[ERROR] 运维看板返回异常: $OPS_RESP"
  exit 1
fi

echo "[27/27] 数据保留 dry-run 可用"
RETENTION_RESP="$(request_status POST '/api/device-flow/retention/run?dry_run=true' 200 '{}')"
RETENTION_SCANNED="$(printf '%s' "$RETENTION_RESP" | extract_json_field scanned)"
if [[ -z "$RETENTION_SCANNED" ]]; then
  echo "[ERROR] 保留策略执行返回异常: $RETENTION_RESP"
  exit 1
fi

echo "[OK] 回归校验通过，JOB_ID=$JOB_ID"
