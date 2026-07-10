#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GENERATOR="${ROOT_DIR}/scripts/dev/generate-local-https-cert.sh"
host="localhost"
cert_dir="${ROOT_DIR}/.local/https"
dry_run=false
skip_build=false

usage() {
  cat >&2 <<EOF
Usage: $0 [--host hostname-or-ip] [--cert-dir path] [--dry-run] [--skip-build]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      host="${2:-}"
      shift 2
      ;;
    --cert-dir)
      cert_dir="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --skip-build)
      skip_build=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

"$GENERATOR" --host "$host" --output-dir "$cert_dir"
cert_dir=$(cd "$cert_dir" && pwd)

export HTTPS_PUBLIC_HOST="$host"
export ALL_SYSTEMS_TLS_CERT="${cert_dir}/server.pem"
export ALL_SYSTEMS_TLS_KEY="${cert_dir}/server-key.pem"

test -f "$ALL_SYSTEMS_TLS_CERT"
test -f "$ALL_SYSTEMS_TLS_KEY"

compose=(
  docker compose
  -f "${ROOT_DIR}/docker-compose.yml"
  -f "${ROOT_DIR}/docker-compose.all-systems-https.yml"
  up -d
)
if [ "$skip_build" = false ]; then
  compose+=(--build)
fi

if [ "$dry_run" = true ]; then
  printf 'HTTPS_PUBLIC_HOST=%q\n' "$HTTPS_PUBLIC_HOST"
  printf 'ALL_SYSTEMS_TLS_CERT=%q\n' "$ALL_SYSTEMS_TLS_CERT"
  printf 'ALL_SYSTEMS_TLS_KEY=%q\n' "$ALL_SYSTEMS_TLS_KEY"
  printf '%q ' "${compose[@]}"
  printf '\n'
else
  "${compose[@]}"
fi

cat <<EOF

HTTPS addresses:
  AI Assistant:     https://${host}
  Auth:             https://${host}:5180
  Reminder:         https://${host}:18080
  Ticketing:        https://${host}:18081
  Inventory:        https://${host}:18082
  Device Flow:      https://${host}:18083
  Delivery:         https://${host}:18084
  FAQ:              https://${host}:18085
  Tender:           https://${host}:18086
  Train Exam:       https://${host}:18087
  Prompt Center:    https://${host}:18088
  SCA:              https://${host}:18089
  Dependency Track: https://${host}:18091
  Big Screen:       https://${host}:18092
  AI Assistant Alt: https://${host}:18093
  CMDB:             https://${host}:8090

Trust this local CA before browser testing:
  ${cert_dir}/local-ca.pem
EOF
