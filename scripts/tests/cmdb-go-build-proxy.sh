#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
OUT_FILE=$(mktemp)
trap 'rm -f "${OUT_FILE}"' EXIT

cd "${ROOT_DIR}"
./scripts/deploy/docker-compose-aliyun.sh config > "${OUT_FILE}"

if ! grep -q 'GOPROXY: https://mirrors.aliyun.com/goproxy/,direct' "${OUT_FILE}"; then
  echo 'expected cmdb build args to include default GOPROXY' >&2
  exit 1
fi

if ! grep -q 'GOSUMDB: sum.golang.google.cn' "${OUT_FILE}"; then
  echo 'expected cmdb build args to include default GOSUMDB' >&2
  exit 1
fi

echo 'cmdb go build proxy: ok'
