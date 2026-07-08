Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
$env:POSTGRES_PASSWORD = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "sca_test_only_password_5_68_0" }
docker compose build sca-api sca-worker sca-beat web-sca
$testsPath = (Resolve-Path "backend/tests").Path
docker compose run --rm --no-deps `
  -e PYTHONPATH=/app `
  -e DATABASE_URL=sqlite:////tmp/sca-test.db `
  -e AUTH_DEV_BYPASS=true `
  -e CELERY_TASK_ALWAYS_EAGER=true `
  -v "${testsPath}:/app/tests:ro" `
  sca-api pytest -o cache_dir=/tmp/.pytest_cache -o asyncio_default_fixture_loop_scope=function tests

$workspacePath = (Resolve-Path ".").Path
docker run --rm -v "${workspacePath}:/workspace" -w /workspace/frontend node:20-alpine `
  sh -lc "npm ci && node --test tests/*.test.mjs && npm run build && npm audit --omit=dev"

docker compose run --rm --no-deps sca-api `
  sh -lc "pip install --no-cache-dir pip-audit==2.9.0 >/tmp/pip-audit-install.log && python -m pip_audit -r requirements.txt"
