param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ROOT_DIR = Resolve-Path "$PSScriptRoot/.."
$DESKTOP_DIR = "$ROOT_DIR/apps/desktop"
$TARGET = "x86_64-pc-windows-msvc"

$env:AI_ASSISTANT_BUILD_MODE = if ($env:AI_ASSISTANT_BUILD_MODE) { $env:AI_ASSISTANT_BUILD_MODE } else { "lan-test" }
$env:VITE_AI_ASSISTANT_BUILD_MODE = $env:AI_ASSISTANT_BUILD_MODE

$DEFAULT_SERVER_ORIGIN = if ($env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN) { $env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN } else { "" }
$UPDATER_ENABLED = if ($env:AI_UPDATER_ENABLED) { $env:AI_UPDATER_ENABLED } else { "false" }
$UPDATER_URL = if ($env:AI_UPDATER_URL) { $env:AI_UPDATER_URL } else { "" }
$UPDATER_PUBLIC_KEY = if ($env:AI_UPDATER_PUBLIC_KEY) { $env:AI_UPDATER_PUBLIC_KEY } else { "" }

if (-not [Environment]::HasShutdownStarted -and -not $env:CI -and (-not [Console]::IsInputRedirected)) {
  # interactive
}

function Validate-LanUrl {
  param([string]$VariableName, [string]$Raw, [bool]$ExactOrigin)
  if ([string]::IsNullOrEmpty($Raw)) { return }
  $url = [System.Uri]$Raw
  $allowsHttp = $env:AI_ASSISTANT_BUILD_MODE -eq "lan-test" -or $env:AI_ASSISTANT_BUILD_MODE -eq "development"
  $protocolOk = if ($allowsHttp) {
    $url.Scheme -eq "https" -or $url.Scheme -eq "http"
  } else {
    $url.Scheme -eq "https"
  }
  $hasUserInfo = -not [string]::IsNullOrEmpty($url.UserInfo)
  if (-not $protocolOk -or $hasUserInfo -or $Raw.Contains("*")) {
    $label = if ($allowsHttp) { "HTTP/HTTPS" } else { "HTTPS" }
    throw "$VariableName 必须是合法、无凭据的 $label 地址"
  }
}

if ($DEFAULT_SERVER_ORIGIN) {
  Validate-LanUrl "AI_ASSISTANT_DEFAULT_SERVER_ORIGIN" $DEFAULT_SERVER_ORIGIN $true
  $env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN = $DEFAULT_SERVER_ORIGIN
}

switch ($UPDATER_ENABLED) {
  "true" {
    Validate-LanUrl "AI_UPDATER_URL" $UPDATER_URL $false
    if ([string]::IsNullOrWhiteSpace($UPDATER_PUBLIC_KEY)) {
      throw "AI_UPDATER_PUBLIC_KEY 在启用自动更新时不能为空"
    }
    $env:AI_UPDATER_URL = $UPDATER_URL
    $env:AI_UPDATER_PUBLIC_KEY = $UPDATER_PUBLIC_KEY
  }
  "false" {
    Remove-Item Env:AI_UPDATER_URL -ErrorAction SilentlyContinue
    Remove-Item Env:AI_UPDATER_PUBLIC_KEY -ErrorAction SilentlyContinue
  }
  default {
    throw "AI_UPDATER_ENABLED 只能为 true 或 false"
  }
}
$env:AI_UPDATER_ENABLED = $UPDATER_ENABLED

$commands = @(
  "rustup target add $TARGET",
  "npm --prefix $DESKTOP_DIR ci",
  "npm --prefix $DESKTOP_DIR test",
  "npm --prefix $DESKTOP_DIR run build",
  "npm --prefix $DESKTOP_DIR run config:render",
  "npm --prefix $DESKTOP_DIR run tauri build -- --target $TARGET --config src-tauri/tauri.generated.conf.json -- --locked"
)

if ($DryRun) {
  Write-Output "=== Dry Run: 聚信 AI 助手 内网测试版构建 (x64) ==="
  Write-Output "构建渠道: $env:AI_ASSISTANT_BUILD_MODE"
  $commands | ForEach-Object { Write-Output $_ }
  exit 0
}

Write-Output "=== 聚信 AI 助手 内网测试版构建 (x64) ==="
Write-Output "构建渠道: $env:AI_ASSISTANT_BUILD_MODE"

rustup target add $TARGET
npm --prefix $DESKTOP_DIR ci
npm --prefix $DESKTOP_DIR test
npm --prefix $DESKTOP_DIR run build
npm --prefix $DESKTOP_DIR run config:render
npm --prefix $DESKTOP_DIR run tauri build -- --target $TARGET --config src-tauri/tauri.generated.conf.json -- --locked

$bundle = "$DESKTOP_DIR/src-tauri/target/$TARGET/release/bundle"
Write-Output "内网测试版安装包目录: $bundle"
