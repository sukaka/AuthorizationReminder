#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if ! grep -q "fetch('/api/csrf'" "${ROOT_DIR}/web/src/App.jsx"; then
  echo "web refreshCsrf should request /api/csrf" >&2
  exit 1
fi

if ! grep -q "app.get('/api/csrf'" "${ROOT_DIR}/server/index.js"; then
  echo "server should expose /api/csrf" >&2
  exit 1
fi

echo "reminder csrf paths ok"
