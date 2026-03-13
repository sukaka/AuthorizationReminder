#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

grep -q 'COPY ticketing/package-lock.json ./ticketing/package-lock.json' "${ROOT_DIR}/ticketing/Dockerfile"
grep -q "npm ci --omit=dev" "${ROOT_DIR}/ticketing/Dockerfile"

grep -q 'COPY package-lock.json \./' "${ROOT_DIR}/ticketing/web/Dockerfile"
grep -q "npm ci --no-audit --no-fund --foreground-scripts" "${ROOT_DIR}/ticketing/web/Dockerfile"

echo 'ticketing lockfile build config: ok'
