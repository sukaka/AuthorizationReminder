#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

check_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$file"; then
    echo "expected ${file} to contain pattern: ${pattern}" >&2
    exit 1
  fi
}

for file in \
  "${ROOT_DIR}/train-exam/backend/Dockerfile" \
  "${ROOT_DIR}/faq/backend/Dockerfile" \
  "${ROOT_DIR}/tender/backend/Dockerfile"; do
  check_contains "$file" 'mirrors.aliyun.com/debian'
  check_contains "$file" 'deb.debian.org/debian'
done

for file in \
  "${ROOT_DIR}/faq/onlyoffice-fonts/Dockerfile" \
  "${ROOT_DIR}/faq/onlyoffice-fonts/Dockerfile.ecs"; do
  check_contains "$file" 'mirrors.aliyun.com/ubuntu'
  check_contains "$file" 'archive.ubuntu.com/ubuntu'
done

for file in \
  "${ROOT_DIR}/train-exam/backend/Dockerfile" \
  "${ROOT_DIR}/faq/backend/Dockerfile" \
  "${ROOT_DIR}/tender/backend/Dockerfile"; do
  check_contains "$file" 'registry.npmmirror.com'
done

for file in \
  "${ROOT_DIR}/juxin-ai-assistant/server/Dockerfile" \
  "${ROOT_DIR}/sca-platform/backend/Dockerfile" \
  "${ROOT_DIR}/sca-platform/backend/Dockerfile.scanner"; do
  check_contains "$file" 'PYTHON_BASE_IMAGE'
  check_contains "$file" 'DEBIAN_APT_MIRROR'
  check_contains "$file" 'mirrors.aliyun.com/debian'
done

check_contains "${ROOT_DIR}/docker-compose.yml" 'build_args_python_slim'
check_contains "${ROOT_DIR}/docker-compose.yml" 'args: *build_args_python_slim'
check_contains "${ROOT_DIR}/sca-platform/docker-compose.yml" 'build_args_python_slim'
check_contains "${ROOT_DIR}/sca-platform/docker-compose.yml" 'args: *build_args_python_slim'

echo 'dockerfile mirror alignment: ok'
