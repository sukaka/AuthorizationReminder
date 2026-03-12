#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

check_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -q "$pattern" "$file"; then
    echo "expected ${file} to contain pattern: ${pattern}" >&2
    exit 1
  fi
}

for file in \
  "${ROOT_DIR}/train-exam/backend/Dockerfile" \
  "${ROOT_DIR}/faq/backend/Dockerfile" \
  "${ROOT_DIR}/tender/backend/Dockerfile" \
  "${ROOT_DIR}/faq/onlyoffice-fonts/Dockerfile"; do
  check_contains "$file" 'mirrors.cloud.aliyuncs.com/debian'
  check_contains "$file" 'deb.debian.org/debian'
done

for file in \
  "${ROOT_DIR}/train-exam/backend/Dockerfile" \
  "${ROOT_DIR}/faq/backend/Dockerfile" \
  "${ROOT_DIR}/tender/backend/Dockerfile"; do
  check_contains "$file" 'registry.npmmirror.com'
done

echo 'dockerfile mirror alignment: ok'
