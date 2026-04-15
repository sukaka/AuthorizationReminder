#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

extract_env_value() {
  local service_name="$1"
  local env_key="$2"
  awk -v service="${service_name}:" -v key="${env_key}:" '
    $1 == service { in_service=1; next }
    in_service && /^[^[:space:]]/ { in_service=0 }
    in_service && $1 == key { print substr($0, index($0, ":") + 1); exit }
  ' "${COMPOSE_FILE}" | xargs
}

api_jwt=$(extract_env_value api JWT_SECRET)
api_audit=$(extract_env_value api AUDIT_SIGNING_KEY)
api_config=$(extract_env_value api CONFIG_SECRET_KEY)
api_builtin=$(extract_env_value api BUILTIN_ACCOUNT_DEFAULT_PASSWORD)

if [ "${api_jwt}" != '${AUTH_JWT_SECRET}' ]; then
  echo "expected api JWT_SECRET to use \${AUTH_JWT_SECRET}, got: ${api_jwt}" >&2
  exit 1
fi

if [ "${api_audit}" != '${AUTH_AUDIT_SIGNING_KEY}' ]; then
  echo "expected api AUDIT_SIGNING_KEY to use \${AUTH_AUDIT_SIGNING_KEY}, got: ${api_audit}" >&2
  exit 1
fi

if [ "${api_config}" != '${AUTH_CONFIG_SECRET_KEY}' ]; then
  echo "expected api CONFIG_SECRET_KEY to use \${AUTH_CONFIG_SECRET_KEY}, got: ${api_config}" >&2
  exit 1
fi

if [ "${api_builtin}" != '${AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD}' ]; then
  echo "expected api BUILTIN_ACCOUNT_DEFAULT_PASSWORD to use \${AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD}, got: ${api_builtin}" >&2
  exit 1
fi

echo 'auth/api shared secrets alignment: ok'
