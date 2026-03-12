#!/usr/bin/env bash
set -euo pipefail

files=(
  "web/nginx.conf"
  "ticketing/web/nginx.conf"
  "cmdb/web/nginx.conf"
  "inventory-system/frontend/nginx.conf"
  "device-flow/frontend/nginx.conf"
  "sec-impl/frontend/nginx.conf"
  "faq/frontend/nginx.conf"
  "tender/frontend/nginx.conf"
)

for file in "${files[@]}"; do
  if rg -n 'X-Frame-Options' "$file" >/dev/null; then
    echo "unexpected X-Frame-Options header in $file" >&2
    exit 1
  fi

  if ! rg -n "frame-ancestors 'self'.*localhost:5180.*127.0.0.1:5180" "$file" >/dev/null; then
    echo "missing portal frame-ancestors allowlist in $file" >&2
    exit 1
  fi
done

echo "portal frame ancestor config: ok"
