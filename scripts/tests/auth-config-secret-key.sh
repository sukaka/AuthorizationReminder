#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

api_key=$(awk '
  $1 == "api:" { in_api=1; next }
  in_api && $1 == "auth:" { in_api=0 }
  in_api && $1 == "CONFIG_SECRET_KEY:" { print substr($0, index($0, ":") + 1); exit }
' "${COMPOSE_FILE}" | xargs)

auth_key=$(awk '
  $1 == "auth:" { in_auth=1; next }
  in_auth && /^[^[:space:]]/ { in_auth=0 }
  in_auth && $1 == "CONFIG_SECRET_KEY:" { print substr($0, index($0, ":") + 1); exit }
' "${COMPOSE_FILE}" | xargs)

if [ "${api_key}" != '${AUTH_CONFIG_SECRET_KEY}' ]; then
  echo "expected api CONFIG_SECRET_KEY to use \${AUTH_CONFIG_SECRET_KEY}, got: ${api_key}" >&2
  exit 1
fi

if [ "${auth_key}" != '${AUTH_CONFIG_SECRET_KEY}' ]; then
  echo "expected auth CONFIG_SECRET_KEY to use \${AUTH_CONFIG_SECRET_KEY}, got: ${auth_key}" >&2
  exit 1
fi

echo 'auth/api config secret key alignment: ok'
