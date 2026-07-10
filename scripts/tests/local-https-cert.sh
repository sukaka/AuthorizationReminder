#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GENERATOR="${ROOT_DIR}/scripts/dev/generate-local-https-cert.sh"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

test -x "$GENERATOR"

if "$GENERATOR" --host 'https://localhost' --output-dir "$tmp_dir/invalid" 2>/dev/null; then
  echo "certificate generator accepted a URL instead of a host" >&2
  exit 1
fi

"$GENERATOR" --host 192.168.3.33 --output-dir "$tmp_dir/certs"

ca_cert="$tmp_dir/certs/local-ca.pem"
ca_key="$tmp_dir/certs/local-ca-key.pem"
server_cert="$tmp_dir/certs/server.pem"
server_key="$tmp_dir/certs/server-key.pem"

test -f "$ca_cert"
test -f "$ca_key"
test -f "$server_cert"
test -f "$server_key"

openssl verify -CAfile "$ca_cert" "$server_cert" | grep -Fq ': OK'
openssl x509 -in "$server_cert" -noout -ext subjectAltName | grep -Fq 'DNS:localhost'
openssl x509 -in "$server_cert" -noout -ext subjectAltName | grep -Fq 'IP Address:127.0.0.1'
openssl x509 -in "$server_cert" -noout -ext subjectAltName | grep -Fq 'IP Address:0:0:0:0:0:0:0:1'
openssl x509 -in "$server_cert" -noout -ext subjectAltName | grep -Fq 'IP Address:192.168.3.33'

[ "$(stat -f '%Lp' "$ca_key" 2>/dev/null || stat -c '%a' "$ca_key")" = "600" ]
[ "$(stat -f '%Lp' "$server_key" 2>/dev/null || stat -c '%a' "$server_key")" = "600" ]

fingerprint_before=$(openssl x509 -in "$server_cert" -noout -fingerprint -sha256)
"$GENERATOR" --host 192.168.3.33 --output-dir "$tmp_dir/certs"
fingerprint_after=$(openssl x509 -in "$server_cert" -noout -fingerprint -sha256)
[ "$fingerprint_before" = "$fingerprint_after" ]

echo "local HTTPS certificate: ok"
