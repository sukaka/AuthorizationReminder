#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-sca_test_only_password_5_68_0}"
docker compose build sca-api sca-worker sca-beat web-sca
docker compose run --rm --no-deps \
  -e PYTHONPATH=/app \
  -e DATABASE_URL=sqlite:////tmp/sca-test.db \
  -e AUTH_DEV_BYPASS=true \
  -e CELERY_TASK_ALWAYS_EAGER=true \
  -v "$(pwd)/backend/tests:/app/tests:ro" \
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests

docker run --rm \
  -v "$(pwd):/workspace" \
  -w /workspace/frontend \
  node:20-alpine \
  sh -lc 'npm ci && node --test tests/*.test.mjs && npm run build && npm audit --omit=dev'

docker compose run --rm --no-deps sca-api \
  sh -lc 'pip install --no-cache-dir pip-audit==2.9.0 >/tmp/pip-audit-install.log && python -m pip_audit -r requirements.txt'
