# 聚信 AI 助手本地启动页与自动更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面应用在远程服务不可达时仍显示本地欢迎页，支持登录前配置和检测远程地址，并通过受信任更新服务提示、下载和安装签名更新。

**Architecture:** Tauri 默认只创建本地 `launcher` 窗口；Rust 保存并检测业务 Origin，验证后创建独立 `workspace` 远程窗口。所有远程 IPC 同时校验窗口、当前 Origin 和已绑定 SSO 用户；更新地址和公钥保持编译期固定，通过 Tauri updater 命令向本地启动页暴露状态机。

**Tech Stack:** React 19、TypeScript 6、Vitest、Playwright、Tauri 2、Rust、reqwest、serde、thiserror、FastAPI、pytest、Tauri updater。

实施任务 1–7 使用 `CODEX_VERSIONING_BYPASS=1` 创建可审查的阶段提交，避免每个内部检查点重复升版；Task 8 的最终 `feat` 提交由版本钩子执行唯一一次功能次版本升级并推送全部提交。

---

## 文件结构

- `server/app/desktop_bootstrap.py`：桌面能力发现响应和公开 URL 推导。
- `server/app/main.py`：注册无认证桌面 bootstrap 路由。
- `server/tests/test_desktop_bootstrap.py`：bootstrap 协议和安全测试。
- `apps/desktop/src/launcher/`：本地启动状态、页面、连接和更新 UI。
- `apps/desktop/src/remote/`：本地壳调用的 Tauri 命令适配器。
- `apps/desktop/src-tauri/src/server_config.rs`：Origin 解析、持久化和连接检测。
- `apps/desktop/src-tauri/src/window_manager.rs`：`launcher`/`workspace` 生命周期。
- `apps/desktop/src-tauri/src/command_origin.rs`：IPC 调用来源校验。
- `apps/desktop/src-tauri/src/update_manager.rs`：更新检查、下载、安装状态。
- `apps/desktop/src-tauri/src/local_queue.rs`：按用户和业务 Origin 隔离待同步数据。
- `apps/desktop/src-tauri/capabilities/launcher.json`：本地启动页最小权限。
- `apps/desktop/src-tauri/capabilities/workspace.json`：远程工作台候选权限。
- `apps/desktop/e2e/launcher-flow.spec.ts`：断网启动、地址配置和更新提示。

### Task 1: 服务端桌面能力发现接口

**Files:**
- Create: `juxin-ai-assistant/server/app/desktop_bootstrap.py`
- Modify: `juxin-ai-assistant/server/app/main.py`
- Test: `juxin-ai-assistant/server/tests/test_desktop_bootstrap.py`

- [ ] **Step 1: 写失败测试**

```python
def test_desktop_bootstrap_requires_no_session(client):
    response = client.get("/api/ai/desktop/bootstrap")
    assert response.status_code == 200
    assert response.json() == {
        "product": "juxin-ai-assistant",
        "protocolVersion": 1,
        "authPortalUrl": "https://auth.example.test/portal?system=ai-assistant",
    }


def test_desktop_bootstrap_never_accepts_forwarded_http(client):
    response = client.get(
        "/api/ai/desktop/bootstrap",
        headers={"x-forwarded-proto": "http", "x-forwarded-host": "evil.test"},
    )
    assert response.status_code == 200
    assert response.json()["authPortalUrl"].startswith("https://auth.example.test/")
```

- [ ] **Step 2: 确认测试按预期失败**

Run:

```bash
docker compose run --rm ai-assistant-api pytest -q server/tests/test_desktop_bootstrap.py
```

Expected: FAIL，路由返回 404。

- [ ] **Step 3: 实现固定协议响应**

```python
from pydantic import BaseModel, ConfigDict, HttpUrl


class DesktopBootstrap(BaseModel):
    model_config = ConfigDict(alias_generator=lambda name: {
        "protocol_version": "protocolVersion",
        "auth_portal_url": "authPortalUrl",
    }.get(name, name), populate_by_name=True)

    product: str = "juxin-ai-assistant"
    protocol_version: int = 1
    auth_portal_url: HttpUrl
```

`auth_portal_url` 只从现有可信服务配置生成，不读取请求头中的 Host 或 Forwarded 值。

- [ ] **Step 4: 运行测试**

Run:

```bash
docker compose run --rm ai-assistant-api pytest -q server/tests/test_desktop_bootstrap.py server/tests/test_auth.py
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add juxin-ai-assistant/server/app/desktop_bootstrap.py \
  juxin-ai-assistant/server/app/main.py \
  juxin-ai-assistant/server/tests/test_desktop_bootstrap.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): expose desktop bootstrap contract"
```

### Task 2: Rust 业务 Origin 配置和连接检测

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/server_config.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/server_config.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: 写 Origin 解析失败测试**

```rust
#[test]
fn production_origin_rejects_http_path_and_credentials() {
    assert!(ServerOrigin::parse("http://ai.example.com", false).is_err());
    assert!(ServerOrigin::parse("https://ai.example.com/path", false).is_err());
    assert!(ServerOrigin::parse("https://user:pass@ai.example.com", false).is_err());
}

#[test]
fn production_origin_normalizes_https_default_port() {
    let origin = ServerOrigin::parse("https://AI.Example.com:443/", false).unwrap();
    assert_eq!(origin.as_str(), "https://ai.example.com");
}

#[test]
fn development_origin_allows_only_loopback_http() {
    assert!(ServerOrigin::parse("http://127.0.0.1:18093", true).is_ok());
    assert!(ServerOrigin::parse("http://192.168.1.8:18093", true).is_err());
}
```

- [ ] **Step 2: 确认测试失败**

Run:

```bash
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --test server_config --locked
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现类型和原子配置存储**

```rust
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u8,
    #[serde(rename = "serverOrigin")]
    pub server_origin: ServerOrigin,
    #[serde(rename = "lastSuccessfulCheckAt")]
    pub last_successful_check_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerOrigin(Url);
```

保存时写入同目录临时文件并 `rename`；损坏文件返回类型化错误，不静默覆盖。`ServerOrigin` 的 `Deserialize` 必须重新走安全解析。

- [ ] **Step 4: 写连接检测失败测试**

使用本地 HTTP 测试服务覆盖：200 正确协议、DNS/连接失败、超时、TLS、非 200、产品不匹配、协议版本不支持、认证门户 URL 不安全。

```rust
assert_eq!(
    probe.probe(&origin).await.unwrap_err().kind(),
    ProbeFailureKind::ProductMismatch
);
```

- [ ] **Step 5: 实现连接检测**

使用现有 Rust HTTP 栈或 `reqwest`，固定请求：

```text
GET {origin}/api/ai/desktop/bootstrap
```

配置 5 秒连接超时和 10 秒总超时，不带 Cookie、不跟随跨 Origin 重定向，只解析最大 16 KiB JSON 响应。

- [ ] **Step 6: 运行 Rust 测试和 Clippy**

```bash
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml --locked
/Users/zhanglei/.cargo/bin/cargo clippy \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --all-targets --all-features --locked -- -D warnings
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock \
  juxin-ai-assistant/apps/desktop/src-tauri/src/server_config.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/tests/server_config.rs
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): manage desktop server origins"
```

### Task 3: 本地启动页 UI 和状态机

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src/launcher/LauncherPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/src/launcher/launcherState.ts`
- Create: `juxin-ai-assistant/apps/desktop/src/launcher/launcher.css`
- Create: `juxin-ai-assistant/apps/desktop/src/remote/desktopBridge.ts`
- Create: `juxin-ai-assistant/apps/desktop/tests/launcher-page.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/App.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/theme/tokens.css`

- [ ] **Step 1: 写本地欢迎页失败测试**

```tsx
it('shows product introduction before any network request', async () => {
  render(<LauncherPage bridge={fakeBridge({ savedOrigin: null })} />);
  expect(screen.getByRole('heading', { name: '让日常工作更高效' })).toBeVisible();
  expect(screen.getByLabelText('远程服务地址')).toBeVisible();
  expect(screen.getByRole('button', { name: '使用统一登录' })).toBeDisabled();
  expect(global.fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/launcher-page.test.tsx
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现显式状态机**

```ts
export type LauncherState =
  | { readonly kind: 'booting' }
  | { readonly kind: 'needs-server'; readonly origin: string }
  | { readonly kind: 'checking'; readonly origin: string }
  | { readonly kind: 'server-ready'; readonly origin: string }
  | { readonly kind: 'server-unreachable'; readonly origin: string; readonly reason: ProbeFailure }
  | { readonly kind: 'authenticating'; readonly origin: string }
  | { readonly kind: 'update-available'; readonly origin: string; readonly update: UpdateInfo }
  | { readonly kind: 'updating'; readonly origin: string; readonly progress: number }
  | { readonly kind: 'update-failed'; readonly origin: string; readonly message: string };
```

使用穷尽 `switch` 渲染，不用互相矛盾的布尔值。

- [ ] **Step 4: 实现已确认原型**

页面包含产品简介、三项安全价值、地址输入、连接状态、测试连接、统一登录、本机草稿入口、版本和检查更新。浅色/深色 token 复用现有设计系统；错误信息提供重试和修改地址。

- [ ] **Step 5: 补齐交互测试**

覆盖：

- 非 HTTPS 正式地址不允许测试。
- 测试成功后允许登录。
- DNS、TLS、超时、产品不匹配和协议不兼容显示对应中文文案。
- 修改已保存主机显示二次确认。
- 键盘 Tab 顺序和可见焦点。

- [ ] **Step 6: 运行前端测试和构建**

```bash
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vite/bin/vite.js build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/src/launcher \
  juxin-ai-assistant/apps/desktop/src/remote \
  juxin-ai-assistant/apps/desktop/src/App.tsx \
  juxin-ai-assistant/apps/desktop/src/theme/tokens.css \
  juxin-ai-assistant/apps/desktop/tests/launcher-page.test.tsx
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): add resilient local launcher"
```

### Task 4: 双窗口生命周期和远程 IPC 来源校验

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/window_manager.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/command_origin.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/window_security.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/launcher.json`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/workspace.json`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/commands.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_commands.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: 写窗口安全失败测试**

```rust
#[test]
fn exact_origin_rejects_prefix_and_port_confusion() {
    let trusted = ServerOrigin::parse("https://ai.example.com", false).unwrap();
    assert!(!trusted.matches("https://ai.example.com.evil.test/task"));
    assert!(!trusted.matches("https://ai.example.com:444/task"));
    assert!(trusted.matches("https://AI.example.com:443/task"));
}

#[test]
fn auth_portal_cannot_call_business_commands() {
    let caller = CallerContext::remote("workspace", "https://auth.example.com/portal");
    assert_eq!(
        authorize_business_command(&caller, &trusted_origin).unwrap_err(),
        CommandOriginError::OriginMismatch
    );
}
```

- [ ] **Step 2: 确认测试失败**

```bash
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --test window_security --locked
```

Expected: FAIL。

- [ ] **Step 3: 实现 `launcher` 与 `workspace` 生命周期**

`tauri.conf.json` 默认窗口改为：

```json
{
  "label": "launcher",
  "title": "聚信 AI 助手",
  "url": "index.html",
  "width": 1120,
  "height": 720
}
```

新增命令：

- `server_config_get`
- `server_probe`
- `server_config_save`
- `workspace_open`
- `workspace_close`
- `launcher_show`

`workspace_open` 只接受已经成功 probe 且保存的 `ServerOrigin`，使用 `WebviewWindowBuilder` 创建远程窗口。导航失败、窗口关闭和退出登录时恢复 `launcher`。

- [ ] **Step 4: 给每个远程业务命令加来源守卫**

```rust
pub fn require_workspace_origin(
    window: &WebviewWindow,
    trusted: &ServerOrigin,
) -> Result<(), CommandOriginError> {
    if window.label() != "workspace" {
        return Err(CommandOriginError::WindowMismatch);
    }
    trusted.require_match(window.url()?)
}
```

模型、草稿、队列和本地绑定命令必须先调用守卫；更新和服务器设置命令只允许 `launcher` 本地 Origin。

- [ ] **Step 5: 收窄 capability**

`launcher.json` 只授予服务器配置、窗口和更新命令；`workspace.json` 只授予现有业务命令，不授予更新源修改、shell、任意文件系统或任意 HTTP。

- [ ] **Step 6: 运行 Rust 测试**

```bash
/Users/zhanglei/.cargo/bin/cargo fmt \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml --check
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml --locked
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): isolate launcher and workspace windows"
```

### Task 5: 按业务 Origin 隔离本地队列

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_types.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_queue.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_commands.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src/local/drafts.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src/local/syncQueue.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tests/local_security.rs`
- Modify: `juxin-ai-assistant/apps/desktop/tests/local-state.test.ts`

- [ ] **Step 1: 写跨服务器隔离失败测试**

```rust
#[test]
fn pending_results_never_cross_server_origins() {
    queue.push(user("42"), origin("https://a.example"), pending("one")).unwrap();
    assert!(queue.list(user("42"), origin("https://b.example")).unwrap().is_empty());
    assert_eq!(queue.list(user("42"), origin("https://a.example")).unwrap().len(), 1);
}
```

- [ ] **Step 2: 确认测试失败**

Run:

```bash
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --test local_security pending_results_never_cross_server_origins --locked
```

Expected: FAIL，队列没有 Origin 维度。

- [ ] **Step 3: 修改设备数据 AAD 和存储键**

草稿和队列键使用：

```text
user_id + "\0" + canonical_server_origin + "\0" + record_id
```

地址切换只清当前用户草稿和本地绑定，保留旧 Origin 待同步结果；新 Origin 永远看不到旧 Origin 数据。

- [ ] **Step 4: 实现旧数据迁移**

旧记录首次读取时归属到迁移前保存的编译期 Origin；无法确定来源时标记 `legacy-unassigned`，只允许用户删除或导出，不自动同步。

- [ ] **Step 5: 运行前端和 Rust 本地状态测试**

```bash
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/local-state.test.ts
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path src-tauri/Cargo.toml --test local_security --locked
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/src/local \
  juxin-ai-assistant/apps/desktop/tests/local-state.test.ts \
  juxin-ai-assistant/apps/desktop/src-tauri/src/local_types.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/local_queue.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/local_commands.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/tests/local_security.rs
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): isolate local data by server"
```

### Task 6: 更新状态机、提示和安装

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/update_manager.rs`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/update_manager.rs`
- Create: `juxin-ai-assistant/apps/desktop/src/launcher/UpdateDialog.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/update-dialog.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/updater_policy.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src/remote/desktopBridge.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src/launcher/LauncherPage.tsx`

- [ ] **Step 1: 写更新策略失败测试**

```rust
#[test]
fn business_server_cannot_override_update_trust() {
    let policy = UpdatePolicy::from_build(
        "https://updates.example.com/latest.json",
        "trusted-public-key",
    ).unwrap();
    let config = ServerConfig::new(origin("https://business.example.com"));
    assert_eq!(policy.endpoint().as_str(), "https://updates.example.com/latest.json");
    assert_eq!(policy.public_key(), "trusted-public-key");
    assert_ne!(config.server_origin().host(), policy.endpoint().host_str().unwrap());
}
```

- [ ] **Step 2: 写更新弹窗失败测试**

```tsx
it('offers later and install actions for a newer signed release', async () => {
  render(<UpdateDialog update={{
    version: '1.1.0',
    notes: '优化启动速度',
    contentLength: 18_600_000,
  }} onLater={onLater} onInstall={onInstall} />);
  expect(screen.getByText('发现新版本 1.1.0')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下载并安装' }));
  expect(onInstall).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: 确认测试失败**

分别运行目标 Rust 和 Vitest 文件，预期模块不存在。

- [ ] **Step 4: 实现原生更新命令**

新增命令：

- `update_status`
- `update_check`
- `update_download_and_install`
- `update_cancel`
- `update_defer`

更新阶段使用：

```rust
pub enum UpdatePhase {
    Idle,
    Checking,
    Available(UpdateInfo),
    Downloading { received: u64, total: Option<u64> },
    Installing,
    Failed { message: String },
}
```

启动后延迟检查，每 6 小时检查；同版本“稍后提醒”24 小时内不自动弹窗。手动检查忽略延迟。下载事件通过 Tauri event 发送进度，安装完成调用应用重启。

- [ ] **Step 5: 实现更新弹窗**

显示版本、说明、大小、进度和错误。更新失败关闭弹窗后当前版本继续可用；下载期间允许取消，安装阶段不可取消。

- [ ] **Step 6: 运行更新相关测试**

```bash
/Users/zhanglei/.cargo/bin/cargo test \
  --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --test updater_policy --test update_manager --locked
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/update-dialog.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/src-tauri/src/update_manager.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/updater_policy.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/tests/update_manager.rs \
  juxin-ai-assistant/apps/desktop/src/launcher \
  juxin-ai-assistant/apps/desktop/src/remote/desktopBridge.ts \
  juxin-ai-assistant/apps/desktop/tests/update-dialog.test.tsx
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): prompt and install signed updates"
```

### Task 7: 构建配置、更新清单和 E2E

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/scripts/render-tauri-config.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/scripts/tests/render-tauri-config.test.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/scripts/tests/runtime-contract.test.mjs`
- Create: `juxin-ai-assistant/apps/desktop/e2e/launcher-flow.spec.ts`
- Modify: `juxin-ai-assistant/scripts/build-macos-arm64.sh`
- Modify: `juxin-ai-assistant/scripts/build-windows.ps1`
- Modify: `juxin-ai-assistant/apps/desktop/playwright.config.ts`

- [ ] **Step 1: 写配置契约失败测试**

```js
test("release config starts from local launcher and keeps updater trust separate", async () => {
  const config = await renderConfig({
    defaultServerOrigin: "https://ai.example.com",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  });
  assert.equal(config.app.windows[0].label, "launcher");
  assert.equal(config.app.windows[0].url, "index.html");
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://updates.example.com/latest.json",
  ]);
  assert.equal(config.plugins.updater.pubkey, "public-key");
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd juxin-ai-assistant/apps/desktop
node --test scripts/tests/render-tauri-config.test.mjs \
  scripts/tests/runtime-contract.test.mjs
```

Expected: FAIL，仍然直接使用远程 URL。

- [ ] **Step 3: 修改配置生成和构建输入**

构建参数拆分：

- `AI_ASSISTANT_DEFAULT_SERVER_ORIGIN`：可选预填业务地址。
- `AI_UPDATER_ENABLED`：正式发布为 `true`。
- `AI_UPDATER_URL`：固定 HTTPS 更新清单。
- `AI_UPDATER_PUBLIC_KEY`：Tauri 更新公钥。

不再把业务 Origin 写入主窗口 URL 或 CSP `connect-src`。构建脚本只检查默认业务地址合法性，不要求其存在。

- [ ] **Step 4: 写 E2E 场景**

覆盖：

```ts
test('offline startup still shows the local launcher', async ({ page }) => {
  await page.route('**/*', route => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让日常工作更高效' })).toBeVisible();
  await expect(page.getByLabel('远程服务地址')).toBeEditable();
});
```

以及连接成功、TLS/超时中文错误、更新提示、稍后提醒和手动检查。

- [ ] **Step 5: 运行交付和 E2E 测试**

```bash
cd juxin-ai-assistant/apps/desktop
node --test scripts/tests/*.test.mjs
npm run test:e2e -- e2e/launcher-flow.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add juxin-ai-assistant/apps/desktop/scripts \
  juxin-ai-assistant/apps/desktop/e2e/launcher-flow.spec.ts \
  juxin-ai-assistant/apps/desktop/playwright.config.ts \
  juxin-ai-assistant/scripts/build-macos-arm64.sh \
  juxin-ai-assistant/scripts/build-windows.ps1
CODEX_VERSIONING_BYPASS=1 git commit -m "build(ai-assistant): package launcher and signed updates"
```

### Task 8: 全量验证、真实 macOS 构建与交付文档

**Files:**
- Modify: `docs/manuals/ai-assistant-user-manual.md`
- Create: `docs/releases/5.89.0.md`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 更新用户手册**

记录首次启动、填写地址、连接错误、统一登录、检查更新、稍后提醒、更新重启和本机数据保留行为。明确 HTTP 只用于开发回环地址，正式环境必须 HTTPS。

- [ ] **Step 2: 运行全量验证**

```bash
docker compose run --rm ai-assistant-api pytest -q
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vite/bin/vite.js build
node --test scripts/tests/*.test.mjs
npm run test:e2e
/Users/zhanglei/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml --check
/Users/zhanglei/.cargo/bin/cargo clippy \
  --manifest-path src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings
/Users/zhanglei/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Expected: 全部 PASS。

- [ ] **Step 3: 验证无网络启动**

用真实 Tauri 构建运行，断开远程服务后启动应用，3 秒内确认欢迎页可见、地址可编辑、没有白屏。保存截图到：

```text
juxin-ai-assistant/apps/desktop/output/playwright/launcher-offline-macos.png
```

- [ ] **Step 4: 构建 macOS arm64 包**

```bash
AI_ASSISTANT_DEFAULT_SERVER_ORIGIN=https://ai.example.com \
AI_UPDATER_ENABLED=false \
bash juxin-ai-assistant/scripts/build-macos-arm64.sh
```

验证 DMG、纯 arm64、启动和本地欢迎页。正式签名更新包需要在具备 Developer ID 和更新私钥的发布环境另行执行。

- [ ] **Step 5: 生成发布证据**

`docs/releases/5.89.0.md` 逐项记录：

- 本地欢迎页和故障恢复。
- 地址规则和来源安全。
- 更新检查/提示/安装自动化证据。
- macOS 实际构建证据。
- Windows、正式签名、公证和真实更新服务的剩余门槛。

- [ ] **Step 6: secret 与依赖审计**

```bash
docker run --rm -v "$PWD:/repo:ro" zricethezav/gitleaks:latest \
  detect --source=/repo --no-git --redact --no-banner --exit-code=1
npm --prefix juxin-ai-assistant/apps/desktop audit --omit=dev
/tmp/juxin-cargo-audit/bin/cargo-audit audit \
  --file juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock
```

记录候选项复核，不把测试占位值误判为真实凭据。

- [ ] **Step 7: 最终功能提交和推送**

```bash
git add docs/manuals/ai-assistant-user-manual.md \
  docs/releases/5.89.0.md \
  juxin-ai-assistant/README.md \
  juxin-ai-assistant/apps/desktop/output/playwright/launcher-offline-macos.png
git commit -m "feat(ai-assistant): ship local launcher and updater"
git push origin codex/5.89.0
```

版本钩子应按功能优化规则把根仓库次版本提升到目标版本；提交后核验本地 HEAD、upstream 和远端 SHA 一致。
