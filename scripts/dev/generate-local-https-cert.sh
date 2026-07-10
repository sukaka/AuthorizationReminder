#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
host="localhost"
output_dir="${ROOT_DIR}/.local/https"

usage() {
  echo "Usage: $0 [--host hostname-or-ip] [--output-dir path]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      host="${2:-}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ -z "$host" ] || [[ "$host" == *"://"* ]] || [[ "$host" == */* ]] || [[ "$host" =~ [[:space:]] ]]; then
  echo "--host must be a hostname or IP without protocol, path, or port" >&2
  exit 2
fi

mkdir -p "$output_dir"
chmod 700 "$output_dir"

ca_cert="${output_dir}/local-ca.pem"
ca_key="${output_dir}/local-ca-key.pem"
server_cert="${output_dir}/server.pem"
server_key="${output_dir}/server-key.pem"
host_marker="${output_dir}/server.host"

if [ ! -f "$ca_cert" ] || [ ! -f "$ca_key" ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes \
    -days 3650 \
    -subj "/CN=Juxin Local Test CA" \
    -keyout "$ca_key" \
    -out "$ca_cert" >/dev/null 2>&1
  chmod 600 "$ca_key"
  chmod 644 "$ca_cert"
fi

if [ -f "$server_cert" ] && [ -f "$server_key" ] && [ -f "$host_marker" ] \
  && [ "$(cat "$host_marker")" = "$host" ] \
  && openssl verify -CAfile "$ca_cert" "$server_cert" >/dev/null 2>&1; then
  chmod 600 "$ca_key" "$server_key"
  chmod 644 "$ca_cert" "$server_cert"
  echo "Local HTTPS certificate already valid: $server_cert"
  exit 0
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/extensions.cnf" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$host" == *:* ]]; then
  echo "IP.3 = $host" >>"$tmp_dir/extensions.cnf"
elif [ "$host" != "localhost" ]; then
  echo "DNS.2 = $host" >>"$tmp_dir/extensions.cnf"
fi

openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -subj "/CN=${host}" \
  -keyout "$server_key" \
  -out "$tmp_dir/server.csr" >/dev/null 2>&1

openssl x509 -req -sha256 \
  -in "$tmp_dir/server.csr" \
  -CA "$ca_cert" \
  -CAkey "$ca_key" \
  -CAcreateserial \
  -days 825 \
  -extfile "$tmp_dir/extensions.cnf" \
  -out "$server_cert" >/dev/null 2>&1

chmod 600 "$server_key"
chmod 644 "$server_cert"
printf '%s' "$host" >"$host_marker"

echo "Local CA: $ca_cert"
echo "Server certificate: $server_cert"
echo "Server key: $server_key"
