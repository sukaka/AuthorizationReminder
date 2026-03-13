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
if grep -q '^NPM_REGISTRY=' "$TMP_ENV"; then
  sed -i.bak 's|^NPM_REGISTRY=.*|NPM_REGISTRY=https://registry.npmmirror.com|' "$TMP_ENV"
  rm -f "${TMP_ENV}.bak"
else
  echo 'NPM_REGISTRY=https://registry.npmmirror.com' >> "$TMP_ENV"
fi

docker compose --env-file "$TMP_ENV" -f "${ROOT_DIR}/docker-compose.yml" config > "$TMP_OUT"

grep -q 'NPM_REGISTRY: https://registry.npmmirror.com' "$TMP_OUT"

echo 'npm registry build config: ok'
