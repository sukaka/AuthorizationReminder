Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
docker compose build sca-api sca-worker sca-beat web-sca
$testsPath = (Resolve-Path "backend/tests").Path
docker compose run --rm --no-deps `
  -e PYTHONPATH=/app `
  -e DATABASE_URL=sqlite:////tmp/sca-test.db `
  -e AUTH_DEV_BYPASS=true `
  -e CELERY_TASK_ALWAYS_EAGER=true `
  -v "${testsPath}:/app/tests:ro" `
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests
