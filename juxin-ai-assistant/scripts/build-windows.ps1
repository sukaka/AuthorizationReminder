param(
  [Alias('PublicUrl')][string]$DefaultServerOrigin = $env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Assert-HttpsUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value,
    [switch]$ExactOrigin
  )

  $uri = $null
  $valid = [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) `
    -and $uri.Scheme -eq 'https' `
    -and -not $uri.UserInfo `
    -and -not $uri.Host.Contains('*') `
    -and -not $uri.Fragment
  if ($ExactOrigin) {
    $valid = $valid -and $uri.PathAndQuery -eq '/'
  }
  if (-not $valid) {
    throw "$Name 必须是合法、无凭据的 HTTPS $(if ($ExactOrigin) { 'origin' } else { 'URL' })"
  }
}

if ([string]::IsNullOrWhiteSpace($DefaultServerOrigin)) {
  Remove-Item Env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN -ErrorAction SilentlyContinue
} else {
  Assert-HttpsUrl -Name 'AI_ASSISTANT_DEFAULT_SERVER_ORIGIN' -Value $DefaultServerOrigin -ExactOrigin
  $env:AI_ASSISTANT_DEFAULT_SERVER_ORIGIN = ([Uri]$DefaultServerOrigin).GetLeftPart([UriPartial]::Authority)
}

$updaterEnabled = if ([string]::IsNullOrWhiteSpace($env:AI_UPDATER_ENABLED)) {
  'false'
} else {
  $env:AI_UPDATER_ENABLED
}
if ($updaterEnabled -notin @('true', 'false')) {
  throw 'AI_UPDATER_ENABLED 只能为 true 或 false'
}
$env:AI_UPDATER_ENABLED = $updaterEnabled
if ($updaterEnabled -eq 'true') {
  Assert-HttpsUrl -Name 'AI_UPDATER_URL' -Value $env:AI_UPDATER_URL
  if ([string]::IsNullOrWhiteSpace($env:AI_UPDATER_PUBLIC_KEY)) {
    throw 'AI_UPDATER_PUBLIC_KEY 在启用自动更新时不能为空'
  }
} else {
  Remove-Item Env:AI_UPDATER_URL -ErrorAction SilentlyContinue
  Remove-Item Env:AI_UPDATER_PUBLIC_KEY -ErrorAction SilentlyContinue
}

$target = 'x86_64-pc-windows-msvc'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'apps/desktop'
$commands = @(
  "rustup target add $target",
  "npm --prefix $desktop ci",
  "npm --prefix $desktop test",
  "npm --prefix $desktop run build",
  "npm --prefix $desktop run config:render",
  "npm --prefix $desktop run tauri build -- --target $target --config src-tauri/tauri.generated.conf.json -- --locked"
)
if ($DryRun) {
  $commands
  return
}

foreach ($commandName in @('node', 'npm', 'rustup', 'cargo', 'dumpbin')) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "缺少构建依赖: $commandName"
  }
}
if (-not (Get-Command 'cl.exe' -ErrorAction SilentlyContinue)) {
  throw '缺少 MSVC Build Tools；请安装 Visual Studio 2022 Desktop development with C++'
}

# 可选签名值只从 CI/当前进程环境读取，绝不写入文件：
$null = $env:TAURI_SIGNING_PRIVATE_KEY
$null = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
& rustup target add $target
if ($LASTEXITCODE -ne 0) { throw '安装 Rust Windows x64 target 失败' }
& npm --prefix $desktop ci
if ($LASTEXITCODE -ne 0) { throw '安装桌面依赖失败' }
& npm --prefix $desktop test
if ($LASTEXITCODE -ne 0) { throw '桌面测试失败' }
& npm --prefix $desktop run build
if ($LASTEXITCODE -ne 0) { throw '桌面前端构建失败' }
& npm --prefix $desktop run config:render
if ($LASTEXITCODE -ne 0) { throw '工作台配置生成失败' }
& npm --prefix $desktop run tauri build -- --target $target --config src-tauri/tauri.generated.conf.json -- --locked
if ($LASTEXITCODE -ne 0) { throw 'Tauri Windows x64 构建失败' }
$bundle = Join-Path $desktop "src-tauri/target/$target/release/bundle"
$msiInstallers = @(Get-ChildItem $bundle -Recurse -Filter *.msi)
$exeInstallers = @(Get-ChildItem $bundle -Recurse -Filter *.exe)
if ($msiInstallers.Count -eq 0 -or $exeInstallers.Count -eq 0) {
  throw '必须同时生成 Windows x64 MSI 和 NSIS EXE 安装包'
}
$headers = & dumpbin /headers $exeInstallers[0].FullName
if ($LASTEXITCODE -ne 0 -or $headers -notmatch 'machine \(x64\)') {
  throw 'Windows NSIS 安装器不是 x64 PE'
}
foreach ($installer in @($msiInstallers + $exeInstallers)) {
  $signature = Get-AuthenticodeSignature $installer.FullName
  Write-Host "签名状态 [$($installer.Name)]: $($signature.Status)"
}
Write-Host "安装包目录: $bundle"
