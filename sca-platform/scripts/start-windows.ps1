Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}
$passwordLine = Get-Content ".env" | Where-Object { $_ -match "^POSTGRES_PASSWORD=" } | Select-Object -First 1
$password = if ($env:POSTGRES_PASSWORD) {
  $env:POSTGRES_PASSWORD
} elseif ($passwordLine) {
  ($passwordLine -split "=", 2)[1].Trim()
} else {
  ""
}
if ($password.Length -lt 16 -or $password.StartsWith("change_me_") -or $password.StartsWith("replace_with_")) {
  throw "POSTGRES_PASSWORD must be replaced with a strong value of at least 16 characters."
}
$env:POSTGRES_PASSWORD = $password
docker compose up -d --build
