#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STARTER="${ROOT_DIR}/scripts/dev/start-local-https.sh"

test -x "$STARTER"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

output=$("$STARTER" \
  --host 192.168.3.33 \
  --cert-dir "$tmp_dir/certs" \
  --dry-run)

grep -Fq 'docker compose' <<<"$output"
grep -Fq 'docker-compose.all-systems-https.yml' <<<"$output"
grep -Fq 'https://192.168.3.33:5180' <<<"$output"
grep -Fq 'https://192.168.3.33:8090' <<<"$output"
grep -Fq 'https://192.168.3.33:18080' <<<"$output"
grep -Fq 'https://192.168.3.33:18093' <<<"$output"
grep -Fq 'https://192.168.3.33' <<<"$output"
grep -Fq 'ALL_SYSTEMS_TLS_CERT=' <<<"$output"
grep -Fq 'ALL_SYSTEMS_TLS_KEY=' <<<"$output"

test -f "$tmp_dir/certs/local-ca.pem"
test -f "$tmp_dir/certs/server.pem"
test -f "$tmp_dir/certs/server-key.pem"

echo "start local HTTPS: ok"
