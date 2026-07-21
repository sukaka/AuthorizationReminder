#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
DOCKERFILE="${ROOT_DIR}/juxin-ai-assistant/server/Dockerfile"

expected_compose='PYTHON_BASE_IMAGE: ${PYTHON_BASE_IMAGE:-python:3.12-slim}'
expected_dockerfile='ARG PYTHON_BASE_IMAGE=python:3.12-slim'

if ! grep -Fq "${expected_compose}" "${COMPOSE_FILE}"; then
  echo "expected public Python base image default in docker-compose.yml" >&2
  exit 1
fi

if ! grep -Fq "${expected_dockerfile}" "${DOCKERFILE}"; then
  echo "expected public Python base image default in AI assistant Dockerfile" >&2
  exit 1
fi

if grep -F 'PYTHON_BASE_IMAGE' "${COMPOSE_FILE}" "${DOCKERFILE}" | grep -Fq 'ccr.ccs.tencentyun.com'; then
  echo "AI assistant Python base image must not default to an authenticated registry" >&2
  exit 1
fi

echo "ai assistant public Python base image: ok"
