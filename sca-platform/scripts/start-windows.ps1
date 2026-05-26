Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}
docker compose up -d --build
