#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose build sca-api sca-worker sca-beat web-sca
docker compose run --rm --no-deps \
  -e PYTHONPATH=/app \
  -e DATABASE_URL=sqlite:////tmp/sca-test.db \
  -e AUTH_DEV_BYPASS=true \
  -e CELERY_TASK_ALWAYS_EAGER=true \
  -v "$(pwd)/backend/tests:/app/tests:ro" \
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests
