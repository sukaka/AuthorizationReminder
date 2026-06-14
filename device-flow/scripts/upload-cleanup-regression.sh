#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5184}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[ERROR] 请先设置 AUTH_TOKEN"
  exit 1
fi

count_upload_files() {
  (
    cd "$ROOT_DIR"
    docker compose exec -T device-flow-api sh -c \
      'find /tmp/device-flow/uploads -maxdepth 1 -type f 2>/dev/null | wc -l'
  ) | tr -d '[:space:]'
}

tmp_file="$(mktemp /tmp/device-flow-orphan-XXXXXX.txt)"
trap 'rm -f "$tmp_file"' EXIT
printf 'orphan cleanup regression\n' > "$tmp_file"

before_count="$(count_upload_files)"
http_code="$(
  curl -sS -o /tmp/device-flow-upload-cleanup.json -w '%{http_code}' \
    -X POST "$API_BASE/api/device-flow/jobs/999999999/attachments" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -F "file=@${tmp_file}" \
    -F "stage_code=CREATED"
)"
rm -f /tmp/device-flow-upload-cleanup.json

if [[ "$http_code" != "404" ]]; then
  echo "[ERROR] 无效流转单上传期望 HTTP 404，实际 ${http_code}"
  exit 1
fi

after_count="$(count_upload_files)"
if [[ "$after_count" != "$before_count" ]]; then
  echo "[ERROR] 上传失败遗留孤儿文件：before=${before_count}, after=${after_count}"
  exit 1
fi

echo "[OK] 上传失败未遗留孤儿文件"
