#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)

TMP_ENV=$(mktemp)
TMP_OUT=$(mktemp)
cleanup() {
  rm -f "$TMP_ENV" "$TMP_OUT"
}
trap cleanup EXIT

cp "${ROOT_DIR}/.env.example" "$TMP_ENV"

set_kv() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$TMP_ENV"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$TMP_ENV"
    rm -f "${TMP_ENV}.bak"
  else
    echo "${key}=${value}" >> "$TMP_ENV"
  fi
}

set_kv AUTH_COOKIE_SECURE true
set_kv AUTH_SECURITY_STRICT_MODE true

docker compose --env-file "$TMP_ENV" -f "${ROOT_DIR}/docker-compose.yml" config > "$TMP_OUT"

grep -q 'AUTH_COOKIE_SECURE: "true"' "$TMP_OUT"
grep -q 'SECURITY_STRICT_MODE: "true"' "$TMP_OUT"

echo 'auth security config: ok'
