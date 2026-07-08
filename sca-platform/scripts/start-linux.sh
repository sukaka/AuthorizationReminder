#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
test -f .env || cp .env.example .env

password_line="$(grep -m1 '^POSTGRES_PASSWORD=' .env || true)"
postgres_password="${POSTGRES_PASSWORD:-${password_line#POSTGRES_PASSWORD=}}"
postgres_password="${postgres_password%$'\r'}"

if [[ -z "$postgres_password" || "$postgres_password" == change_me_* || "$postgres_password" == replace_with_* || ${#postgres_password} -lt 16 ]]; then
  echo "POSTGRES_PASSWORD must be replaced with a strong value of at least 16 characters." >&2
  exit 1
fi

docker compose up -d --build
