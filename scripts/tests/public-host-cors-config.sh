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
if grep -q '^PUBLIC_HOST=' "$TMP_ENV"; then
  sed -i.bak 's/^PUBLIC_HOST=.*/PUBLIC_HOST=8.141.81.201/' "$TMP_ENV"
  rm -f "${TMP_ENV}.bak"
else
  echo 'PUBLIC_HOST=8.141.81.201' >> "$TMP_ENV"
fi

docker compose --env-file "$TMP_ENV" -f "${ROOT_DIR}/docker-compose.yml" config > "$TMP_OUT"

grep -q 'http://8.141.81.201:5180' "$TMP_OUT"
grep -q 'http://8.141.81.201:18087' "$TMP_OUT"
grep -q 'AUTH_PUBLIC_URL: http://8.141.81.201:5180' "$TMP_OUT"
if grep -q 'AUTH_PUBLIC_URL: http://localhost:5180' "$TMP_OUT"; then
  echo 'remote compose must not publish a localhost auth portal' >&2
  exit 1
fi
if grep -q 'http://:18087' "$TMP_OUT"; then
  echo 'rendered compose contains invalid PUBLIC_HOST expansion' >&2
  exit 1
fi

echo 'public host cors config: ok'
