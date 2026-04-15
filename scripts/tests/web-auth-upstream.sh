#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CONF_FILE="${ROOT_DIR}/web/nginx.conf"

auth_block=$(awk '
  /location \/api\/auth\// { in_block=1; print; next }
  in_block { print }
  in_block && /}/ { exit }
' "${CONF_FILE}")

if ! grep -q 'set \$auth_upstream http://auth:5180;' "${CONF_FILE}"; then
  echo 'expected web nginx to define auth upstream as auth:5180' >&2
  exit 1
fi

if ! printf '%s\n' "${auth_block}" | grep -q 'proxy_pass \$auth_upstream;'; then
  echo 'expected web /api/auth/ location to proxy to $auth_upstream' >&2
  exit 1
fi

if printf '%s\n' "${auth_block}" | grep -q 'api:5179'; then
  echo 'web /api/auth/ location must not proxy to api:5179' >&2
  exit 1
fi

echo 'web auth upstream: ok'
