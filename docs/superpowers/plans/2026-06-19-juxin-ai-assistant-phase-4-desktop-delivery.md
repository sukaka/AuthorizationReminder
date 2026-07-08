# 聚信 AI 助手阶段 4：桌面交付与加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已完成的员工与管理能力交付为可靠的 Windows 10/11 x64 和 macOS Apple Silicon 桌面应用，完成托盘、单实例、本地安全、双主题精修、构建脚本、安装包、文档和发布审计。

**Architecture:** Tauri 壳保持窄权限：固定远程工作台来源、有限本地命令、系统钥匙串和设备队列。平台服务继续由 Compose 部署；桌面安装包不内置服务端秘密。自动更新只保留关闭状态的可验证配置，待公司提供签名和 HTTPS 更新源后再启用。

**Tech Stack:** Tauri 2、Rust、Windows MSVC/WebView2、macOS aarch64、React 19、Playwright、Shell/PowerShell、GitHub Actions 或公司等价 CI runner、Docker Compose。

---

## 文件职责

- `src-tauri/src/tray.rs`：托盘菜单和关闭行为。
- `src-tauri/src/local_queue.rs`：设备加密待同步队列。
- `src-tauri/capabilities/remote-main.json`：唯一受信任远程来源和命令权限。
- `src-tauri/tauri.conf.json`：通用应用标识、窗口和 bundle 配置。
- `src-tauri/tauri.windows.conf.json`：Windows x64 安装配置。
- `src-tauri/tauri.macos.conf.json`：macOS arm64 配置。
- `scripts/render-tauri-config.mjs`：把受信任 URL 编译进配置，拒绝 wildcard。
- `scripts/build-windows.ps1`：Windows x64 可重复构建。
- `scripts/build-macos-arm64.sh`：Apple Silicon 专用构建。
- `.github/workflows/ai-assistant-desktop.yml`：双平台构建和产物校验；若仓库使用公司 CI，则以相同命令迁移。

---

### Task 1: 固化远程工作台来源和 Tauri 能力最小化

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/scripts/render-tauri-config.mjs`
- Create: `juxin-ai-assistant/apps/desktop/tests/tauri-config.test.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/remote-main.json`
- Modify: `juxin-ai-assistant/apps/desktop/package.json`
- Modify: `juxin-ai-assistant/apps/desktop/.gitignore`

- [ ] **Step 1: 写 HTTPS、精确来源和禁止 wildcard 测试**

```typescript
// tests/tauri-config.test.ts
import { describe, expect, it } from 'vitest';
import { buildRemoteConfig } from '../scripts/render-tauri-config.mjs';

describe('Tauri remote config', () => {
  it('accepts one exact HTTPS origin', () => {
    const config = buildRemoteConfig('https://ai.internal.example.com');
    expect(config.windowUrl).toBe('https://ai.internal.example.com');
    expect(config.remoteUrls).toEqual(['https://ai.internal.example.com/*']);
  });

  it.each(['https://*', 'http://ai.example.com', 'file:///tmp/app', 'https://user:pass@ai.example.com'])(
    'rejects unsafe value %s',
    (value) => expect(() => buildRemoteConfig(value)).toThrow(),
  );
});
```

- [ ] **Step 2: 运行并确认生成器缺失**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test -- tauri-config.test.ts`

Expected: FAIL because module is missing.

- [ ] **Step 3: 实现只接受单一 HTTPS origin 的生成器**

```javascript
// scripts/render-tauri-config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildRemoteConfig(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AI_ASSISTANT_PUBLIC_URL 必须是无路径、无凭据的 HTTPS origin');
  }
  if (url.hostname.includes('*')) throw new Error('受信任来源不能包含 wildcard');
  const origin = url.origin;
  return { windowUrl: origin, remoteUrls: [`${origin}/*`] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const generated = buildRemoteConfig(process.env.AI_ASSISTANT_PUBLIC_URL || '');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
  const tauri = JSON.parse(fs.readFileSync(path.join(root, 'tauri.conf.json'), 'utf8'));
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'capabilities', 'remote-main.json'), 'utf8'));
  tauri.app.windows[0].url = generated.windowUrl;
  capability.remote = { urls: generated.remoteUrls };
  capability.identifier = 'remote-main-generated';
  tauri.app.security = { ...tauri.app.security, capabilities: ['remote-main-generated'] };
  fs.writeFileSync(path.join(root, 'tauri.generated.conf.json'), `${JSON.stringify(tauri, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'capabilities', 'remote-main.generated.json'), `${JSON.stringify(capability, null, 2)}\n`);
}
```

Ignore `src-tauri/tauri.generated.conf.json` and `src-tauri/capabilities/remote-main.generated.json`. The generated Tauri config explicitly selects only capability ID `remote-main-generated`, so the tracked template is never active in a production bundle.

- [ ] **Step 4: 把能力压缩到精确命令**

Capability grants core window/event basics and only: profile list/upsert/delete/set-default/test, model generate/cancel, draft store, sync queue and cache clear. It grants no generic shell, filesystem, HTTP, clipboard-read or process permission. Clipboard write remains in React Web API where supported and uses one explicit Tauri command fallback.

- [ ] **Step 5: 运行 schema、wildcard 和命令扫描**

Run:

```bash
AI_ASSISTANT_PUBLIC_URL=https://ai.internal.example.com npm --prefix juxin-ai-assistant/apps/desktop run config:render
cargo tauri build --debug --no-bundle --config src-tauri/tauri.generated.conf.json
! rg -n 'https://\*|http://\*|shell:|fs:allow|process:' juxin-ai-assistant/apps/desktop/src-tauri/capabilities
```

Expected: config validates, build succeeds and forbidden capability scan returns no matches.

- [ ] **Step 6: 提交能力加固**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 2: 实现单实例、托盘和关闭行为

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/tray.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/tray_state.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: 写纯状态机测试**

```rust
// src-tauri/tests/tray_state.rs
use juxin_ai_assistant_lib::tray::{CloseAction, TrayPreference};

#[test]
fn close_hides_when_tray_mode_is_enabled() {
    assert_eq!(TrayPreference { minimize_to_tray: true }.close_action(), CloseAction::Hide);
}

#[test]
fn explicit_quit_always_exits() {
    assert_eq!(TrayPreference { minimize_to_tray: true }.quit_action(), CloseAction::Exit);
}
```

- [ ] **Step 2: 增加 Tauri 官方单实例插件和托盘状态机**

Pin `tauri-plugin-single-instance = "2"`. Register it first so a second launch focuses and shows the existing `main` window. Tray menu contains `打开聚信 AI 助手`, `隐藏窗口`, separator, `退出`. Window close prevents exit and hides only when preference is enabled; explicit quit sets an atomic flag before `app.exit(0)`.

- [ ] **Step 3: 实现平台一致的窗口恢复**

Restore unminimizes, centers only on first launch, shows and focuses. macOS dock activation reopens hidden main window; Windows tray double-click reopens it. No menu item launches a second WebView.

- [ ] **Step 4: 运行 Rust 测试和手动冒烟脚本**

Run: `cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`

Expected: state and command tests PASS. Manual debug run: launch twice, verify one process/window; close, reopen from tray; quit, verify process exits.

- [ ] **Step 5: 提交桌面生命周期**

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 3: 加固系统钥匙串、设备草稿和待同步队列

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_queue.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/local_security.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/keychain.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/commands.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src/local/drafts.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src/local/syncQueue.ts`

- [ ] **Step 1: 写明文禁止和用户隔离测试**

```rust
// src-tauri/tests/local_security.rs
#[test]
fn encrypted_queue_file_does_not_contain_plain_output() {
    let temp = tempfile::tempdir().unwrap();
    let store = TestSecretStore::with_key([7_u8; 32]);
    let queue = LocalQueue::new(temp.path(), store);
    queue.push("user-1", PendingResult::fixture("客户敏感输出")).unwrap();
    let bytes = std::fs::read(temp.path().join("sync-queue.bin")).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("客户敏感输出"));
}

#[test]
fn user_cannot_read_another_users_drafts() {
    let queue = fixture_queue();
    queue.save_draft("user-1", "task-1", "内容").unwrap();
    assert_eq!(queue.load_draft("user-2", "task-1").unwrap(), None);
}
```

- [ ] **Step 2: 实现设备密钥和 AES-GCM 文件格式**

Use a random 32-byte device key stored in system keychain account `device-storage-key`. File format is version byte + 12-byte nonce + ciphertext; associated data includes app ID and SSO user ID. Queue writes use temp file + fsync + atomic rename. Enforce max 100 pending results, 20 MiB total and 7-day draft retention.

- [ ] **Step 3: 实现注销和清除缓存语义**

Logout clears drafts/session cache and hides pending results from the next user, but does not delete model profiles/API Keys unless the user chooses `删除本机全部模型配置`. `清除本地缓存` reports counts, asks confirmation, deletes drafts and completed queue items, preserves unsynced results unless a second explicit checkbox is selected.

- [ ] **Step 4: 运行测试和本地 secret scan**

Run: `cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml && ! rg -n 'sk-[A-Za-z0-9]{8}|Bearer [A-Za-z0-9]' "$HOME/Library/Application Support/com.juxin.ai-assistant" 2>/dev/null`

Expected: tests PASS and fixture secrets are absent from local files.

- [ ] **Step 5: 提交本地安全存储**

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 4: 完成 macOS 风格双主题、响应式和可访问性

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/src/theme/tokens.css`
- Modify: `juxin-ai-assistant/apps/desktop/src/theme/ThemeProvider.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/accessibility.test.tsx`
- Create: `juxin-ai-assistant/apps/desktop/e2e/visual-themes.spec.ts`
- Modify: `juxin-ai-assistant/apps/desktop/package.json`

- [ ] **Step 1: 写主题持久化、系统切换和 reduced motion 测试**

```tsx
// tests/accessibility.test.tsx
it('keeps visible focus and semantic navigation in both themes', async () => {
  const { container } = render(<App initialSession={userSession} />);
  expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  await userEvent.tab();
  expect(document.activeElement).toHaveAttribute('href');
  expect(container.querySelector('[data-theme]')).toBeTruthy();
});

it('uses reduced motion when requested', () => {
  matchMediaMock.set('(prefers-reduced-motion: reduce)', true);
  render(<ThemeProvider><div>内容</div></ThemeProvider>);
  expect(document.documentElement.dataset.motion).toBe('reduced');
});
```

- [ ] **Step 2: 完整化语义 token**

Define background/surface/elevated/sidebar/text/border/accent/success/warning/danger/focus/shadow tokens for light and dark. Never hard-code page colors outside tokens. `system` listens to OS scheme changes; manual light/dark ignores later OS changes. Use SF Pro system stack on macOS and Segoe UI system stack on Windows.

- [ ] **Step 3: 实现宽屏三栏和窄窗标签页**

At width >= 1180px task run uses 280px instructions, minmax(360px, 0.9fr) form and minmax(420px, 1.1fr) result. Below 980px it becomes accessible tabs preserving unsaved form state. Minimum supported window is 900x640; zoom and 200% text must not clip primary actions.

- [ ] **Step 4: 加入 axe 和截图测试**

Add `@axe-core/playwright` and `axe-core`. Test Home, Assistants, TaskRun, History, ModelProfiles and all admin pages in light/dark, plus reduced transparency. Fail on serious/critical violations. Store only deterministic screenshots under Playwright test artifacts, not Git.

- [ ] **Step 5: 运行测试和提交**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test && npm --prefix juxin-ai-assistant/apps/desktop run build && npm --prefix juxin-ai-assistant/apps/desktop run test:e2e -- visual-themes.spec.ts`

Expected: PASS in light and dark.

```bash
git add juxin-ai-assistant/apps/desktop
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 5: 创建品牌图标和平台 bundle 配置

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/icons/icon.png`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/icons/icon.icns`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/icons/icon.ico`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/icons/32x32.png`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/icons/128x128.png`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.windows.conf.json`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.macos.conf.json`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`
- Test: `juxin-ai-assistant/apps/desktop/tests/bundle-config.test.ts`

- [ ] **Step 1: 写应用 ID、版本和 target 测试**

```typescript
// tests/bundle-config.test.ts
import fs from 'node:fs';

const readJson = (path: string) => JSON.parse(fs.readFileSync(path, 'utf8'));

it('uses stable identity and platform-only targets', () => {
  const base = readJson('src-tauri/tauri.conf.json');
  const windows = readJson('src-tauri/tauri.windows.conf.json');
  const mac = readJson('src-tauri/tauri.macos.conf.json');
  expect(base.productName).toBe('聚信 AI 助手');
  expect(base.identifier).toBe('com.juxin.ai-assistant');
  expect(base.version).toBe('1.0.0');
  expect(windows.bundle.targets).toEqual(['msi', 'nsis']);
  expect(mac.bundle.targets).toEqual(['app', 'dmg']);
  expect(JSON.stringify(mac)).not.toContain('x86_64-apple-darwin');
  expect(JSON.stringify(mac)).not.toContain('universal-apple-darwin');
});
```

- [ ] **Step 2: 生成原创品牌图标**

Use an original, simple “聚合节点 + 对话光点” mark, not Apple or third-party artwork. Generate a 1024x1024 RGBA master, inspect at 16/32/128/256/512 sizes in light and dark surroundings, then run `npm run tauri icon src-tauri/icons/icon.png`. Verify no text becomes illegible at tray size.

- [ ] **Step 3: 配置 bundle**

Base: identifier `com.juxin.ai-assistant`, version `1.0.0`, product name/window title `聚信 AI 助手`, minimum window 900x640. Windows targets `msi,nsis`, WebView2 bootstrapper mode, x64 target only. macOS targets `app,dmg`, minimum supported version chosen from Tauri 2 support matrix, arm64 target only, hardened runtime/signing variables documented but not committed.

- [ ] **Step 4: 运行配置测试并提交**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test -- bundle-config.test.ts && cargo tauri info`

Expected: tests PASS and Tauri reports application version 1.0.0.

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri juxin-ai-assistant/apps/desktop/tests/bundle-config.test.ts
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 6: 提供 Windows 10/11 x64 构建脚本

**Files:**
- Create: `juxin-ai-assistant/scripts/build-windows.ps1`
- Create: `juxin-ai-assistant/scripts/Test-BuildWindows.ps1`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 写参数和前置依赖 Pester 测试**

```powershell
# scripts/Test-BuildWindows.ps1
Describe 'build-windows.ps1' {
  It 'requires an HTTPS AI assistant URL' {
    { & "$PSScriptRoot/build-windows.ps1" -PublicUrl 'http://example.com' -DryRun } | Should -Throw
  }
  It 'selects only the x86_64 MSVC target' {
    $result = & "$PSScriptRoot/build-windows.ps1" -PublicUrl 'https://ai.example.com' -DryRun
    $result | Should -Match 'x86_64-pc-windows-msvc'
    $result | Should -Not -Match 'aarch64-pc-windows'
  }
}
```

- [ ] **Step 2: 实现可重复构建脚本**

```powershell
param(
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$uri = [Uri]$PublicUrl
if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/') { throw 'PublicUrl 必须是 HTTPS origin' }
$target = 'x86_64-pc-windows-msvc'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'apps/desktop'
if ($DryRun) {
  @(
    "rustup target add $target",
    "npm --prefix $desktop ci",
    "npm --prefix $desktop test",
    "npm --prefix $desktop run build",
    "npm --prefix $desktop run config:render",
    "npm --prefix $desktop run tauri build -- --target $target --config src-tauri/tauri.windows.conf.json"
  )
  exit 0
}
$env:AI_ASSISTANT_PUBLIC_URL = $uri.GetLeftPart([UriPartial]::Authority)
& rustup target add $target
& npm --prefix $desktop ci
& npm --prefix $desktop test
& npm --prefix $desktop run build
& npm --prefix $desktop run config:render
& npm --prefix $desktop run tauri build -- --target $target --config src-tauri/tauri.windows.conf.json
if ($LASTEXITCODE -ne 0) { throw 'Tauri Windows 构建失败' }
Write-Host "安装包目录: $desktop/src-tauri/target/$target/release/bundle"
```

Before execution, check `node`, `npm`, `rustup`, `cargo`, MSVC Build Tools and WebView2 requirements with actionable Chinese errors. Keep direct argument invocation; do not introduce `Invoke-Expression`.

- [ ] **Step 3: 在 Windows runner 构建并验证 MSI/EXE**

Run: `pwsh -File juxin-ai-assistant/scripts/build-windows.ps1 -PublicUrl https://ai.internal.example.com`

Expected: x64 `.msi` and/or NSIS `.exe` exists; filename includes app version; install, launch, unified-login redirect, tray and uninstall smoke pass on Windows 10 and Windows 11 runners or test VMs.

- [ ] **Step 4: 提交 Windows 交付**

```bash
git add juxin-ai-assistant/scripts juxin-ai-assistant/README.md
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 7: 提供 macOS Apple Silicon 构建脚本

**Files:**
- Create: `juxin-ai-assistant/scripts/build-macos-arm64.sh`
- Create: `juxin-ai-assistant/scripts/test-build-macos-arm64.sh`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 写 target 和 URL 安全测试**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="$(AI_ASSISTANT_PUBLIC_URL=https://ai.example.com "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run)"
grep -q 'aarch64-apple-darwin' <<<"$output"
! grep -q 'x86_64-apple-darwin' <<<"$output"
! grep -q 'universal-apple-darwin' <<<"$output"
if AI_ASSISTANT_PUBLIC_URL=http://ai.example.com "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'HTTP URL should fail' >&2
  exit 1
fi
```

- [ ] **Step 2: 实现 arm64-only 构建脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TARGET="aarch64-apple-darwin"
PUBLIC_URL="${AI_ASSISTANT_PUBLIC_URL:-}"
DRY_RUN="${1:-}"
[[ "$PUBLIC_URL" =~ ^https://[^/]+$ ]] || { echo 'AI_ASSISTANT_PUBLIC_URL 必须是 HTTPS origin' >&2; exit 1; }
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  printf '%s\n' \
    "rustup target add $TARGET" \
    "npm --prefix $DESKTOP_DIR ci" \
    "npm --prefix $DESKTOP_DIR test" \
    "npm --prefix $DESKTOP_DIR run build" \
    "npm --prefix $DESKTOP_DIR run config:render" \
    "npm --prefix $DESKTOP_DIR run tauri build -- --target $TARGET --config src-tauri/tauri.macos.conf.json"
  exit 0
fi
command -v xcodebuild >/dev/null || { echo '缺少 Xcode Command Line Tools' >&2; exit 1; }
rustup target add "$TARGET"
npm --prefix "$DESKTOP_DIR" ci
npm --prefix "$DESKTOP_DIR" test
npm --prefix "$DESKTOP_DIR" run build
npm --prefix "$DESKTOP_DIR" run config:render
npm --prefix "$DESKTOP_DIR" run tauri build -- --target "$TARGET" --config src-tauri/tauri.macos.conf.json
echo "安装包目录: $DESKTOP_DIR/src-tauri/target/$TARGET/release/bundle"
```

Signing identity and notarization credentials are read from environment/keychain only.

- [ ] **Step 3: 本机构建和架构验证**

Run:

```bash
AI_ASSISTANT_PUBLIC_URL=https://ai.internal.example.com juxin-ai-assistant/scripts/build-macos-arm64.sh
lipo -archs juxin-ai-assistant/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/聚信\ AI\ 助手.app/Contents/MacOS/聚信\ AI\ 助手
```

Expected: output is exactly `arm64`; App and DMG exist; Gatekeeper/signing status is reported, never faked when credentials are absent.

- [ ] **Step 4: 提交 macOS 交付**

```bash
git add juxin-ai-assistant/scripts juxin-ai-assistant/README.md
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 8: 预留但默认关闭自动更新

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/updater_policy.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/updater_policy.rs`
- Create: `juxin-ai-assistant/scripts/assert-no-update-requests.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 写默认关闭和缺配置拒绝测试**

```rust
#[test]
fn updater_is_disabled_without_complete_signed_configuration() {
    let policy = UpdaterPolicy::from_env(|_| None);
    assert!(!policy.enabled());
}

#[test]
fn updater_requires_https_endpoint_and_public_key() {
    let values = maplit::hashmap! { "UPDATER_URL" => "http://updates.example.com", "UPDATER_PUBLIC_KEY" => "key" };
    assert!(UpdaterPolicy::from_map(values).is_err());
}
```

- [ ] **Step 2: 实现三条件启用策略**

Updater is enabled only when `AI_UPDATER_ENABLED=true`, HTTPS endpoint exists and non-empty signing public key exists. Private signing key is never read by the application. Settings page shows `自动更新：未启用` in phase 4 unless the build explicitly meets all conditions.

- [ ] **Step 3: 验证默认包不发更新请求**

Run the app behind a recording proxy with default config for five minutes and assert zero requests to an update endpoint. Unit tests must prove malformed/HTTP endpoints fail build configuration.

```javascript
// scripts/assert-no-update-requests.mjs
import fs from 'node:fs';
const entries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const updates = entries.filter((item) => /update|latest\.json/i.test(String(item.url || '')));
if (updates.length) {
  console.error(`检测到 ${updates.length} 个更新请求`);
  process.exit(1);
}
console.log('update requests: 0');
```

Run: `cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml updater_policy && node juxin-ai-assistant/scripts/assert-no-update-requests.mjs test-results/updater-network.json`

Expected: updater policy tests PASS and the recorded default-session request count for update endpoints is `0`.

- [ ] **Step 4: 提交更新预留**

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri juxin-ai-assistant/README.md
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 9: 建立双平台 CI 和产物完整性校验

**Files:**
- Create: `.github/workflows/ai-assistant-desktop.yml`
- Create: `juxin-ai-assistant/scripts/verify-artifacts.mjs`
- Create: `juxin-ai-assistant/apps/desktop/tests/artifacts.test.ts`

- [ ] **Step 1: 写文件名、版本和架构 verifier 测试**

```typescript
it('rejects mismatched product versions and architectures', () => {
  expect(() => verifyArtifacts({ platform: 'macos', appVersion: '1.0.0', files: ['assistant-universal.dmg'], architectures: ['arm64', 'x86_64'] })).toThrow();
  expect(() => verifyArtifacts({ platform: 'windows', appVersion: '1.0.0', files: ['juxin-ai-assistant_0.9.0_x64.msi'], architectures: ['x64'] })).toThrow();
});
```

- [ ] **Step 2: 配置最小权限矩阵**

CI matrix uses `windows-latest` x64 and `macos-14` arm64 (or company equivalents). Permissions are `contents: read`; no pull-request secret exposure. Steps: checkout, setup Node/Rust target, npm ci/test/build, cargo test, render exact test origin, Tauri bundle, verify architecture/version, upload unsigned internal artifact. Production signing is a separate protected environment job.

- [ ] **Step 3: 实现产物 verifier**

Verifier reads root platform version `5.87.0`, Tauri app version `1.0.0`, artifact manifest and architecture command output. It rejects universal/Intel macOS artifacts, non-x64 Windows artifacts, unexpected file extensions, missing checksums and secrets in manifest.

- [ ] **Step 4: 运行 workflow lint/本地 verifier 并提交**

Run: `npm --prefix juxin-ai-assistant/apps/desktop test -- artifacts.test.ts && node juxin-ai-assistant/scripts/verify-artifacts.mjs --fixtures`

Expected: PASS.

```bash
git add .github/workflows/ai-assistant-desktop.yml juxin-ai-assistant/scripts juxin-ai-assistant/apps/desktop/tests
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

---

### Task 10: 最终安全、性能、文档和发布审计

**Files:**
- Create: `juxin-ai-assistant/docs/product-design.md`
- Create: `juxin-ai-assistant/docs/architecture.md`
- Create: `juxin-ai-assistant/docs/api-design.md`
- Create: `juxin-ai-assistant/docs/database-design.md`
- Create: `juxin-ai-assistant/docs/deployment.md`
- Create: `juxin-ai-assistant/docs/build-guide.md`
- Create: `juxin-ai-assistant/docs/security-boundaries.md`
- Create: `juxin-ai-assistant/docs/release-checklist.md`
- Modify: `juxin-ai-assistant/README.md`
- Modify: `README.md`
- Modify: `scripts/tests/run-all.sh`

- [ ] **Step 1: 生成需求到证据矩阵**

`release-checklist.md` lists every numbered requirement from the approved design and attachment, its authoritative file/test/artifact evidence, status and command. Explicitly mark superseded requirements: independent login/JWT/admin account, SQLite and server/admin model config are replaced by the user's later confirmed constraints.

- [ ] **Step 2: 运行 secret、依赖和许可检查**

Run:

```bash
rg -n --hidden -g '!node_modules/**' -g '!target/**' '(sk-[A-Za-z0-9]{12,}|BEGIN .*PRIVATE KEY|api[_-]?key\s*[:=]\s*[^$<{])' juxin-ai-assistant
npm --prefix juxin-ai-assistant/apps/desktop audit --audit-level=high
cargo audit --file juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock
python3 -m pip_audit -r juxin-ai-assistant/server/requirements.txt
```

Expected: secret scan has no true positives; no unaccepted high/critical runtime vulnerability. Any exception includes package, advisory, reachability, owner and expiry in the release checklist.

- [ ] **Step 3: 运行完整测试矩阵**

Run:

```bash
npm run test:versioning
node --test auth/tests/*.test.js tests/*.test.js
npm --prefix prompt-center/backend test
python3 -m pytest juxin-ai-assistant/server/tests -q
npm --prefix juxin-ai-assistant/apps/desktop test
npm --prefix juxin-ai-assistant/apps/desktop run build
cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml
npm --prefix juxin-ai-assistant/apps/desktop run test:e2e
bash scripts/tests/ai-assistant.sh
```

Expected: all checks PASS. Do not claim complete if any mandatory check is skipped without evidence from the target platform.

- [ ] **Step 4: 验证真实平台产物**

Windows: install MSI/EXE on Windows 10 and 11 x64, SSO, model keychain, generation, tray, restart and uninstall. macOS: install DMG/App on Apple Silicon, verify `arm64`, SSO, Keychain prompt, generation, tray/menu, restart and removal. Record artifact SHA-256 and screenshots/logs without secrets.

- [ ] **Step 5: 核对 Git/版本/远端**

Run:

```bash
git status --short --branch
git log -1 --oneline --decorate
node -p "require('./package.json').version"
node -p "require('./juxin-ai-assistant/apps/desktop/package.json').version"
git rev-parse HEAD
git rev-parse '@{upstream}'
```

Expected: clean branch `codex/5.87.0`; platform version `5.87.0`; desktop version `1.0.0`; local HEAD equals upstream.

- [ ] **Step 6: 提交最终文档和验证证据**

```bash
git add README.md scripts/tests/run-all.sh juxin-ai-assistant
git commit -m "fixup! feat(ai-assistant): define desktop assistant architecture"
```

The post-commit hook must push the branch and keep platform version `5.87.0`. Do not commit installers, signing keys, test cookies, `.env`, runtime databases or user content unless the repository's release policy explicitly tracks binary assets.

---

## 阶段 4 完成定义

- Tauri 只信任一个精确 HTTPS 工作台来源，能力无 wildcard 或通用 shell/filesystem 权限。
- 多模型密钥在 macOS Keychain / Windows Credential Manager，本地文件无明文。
- 单实例、托盘、草稿、待同步、清缓存和注销语义通过测试。
- 浅色/深色、跟随系统、窄窗、键盘和可访问性验证通过。
- Windows 10/11 x64 与 macOS arm64 真实安装包完成目标机冒烟。
- 自动更新默认关闭且不产生网络请求。
- 设计要求、测试、产物、版本、Git 和远端均有逐项证据。
