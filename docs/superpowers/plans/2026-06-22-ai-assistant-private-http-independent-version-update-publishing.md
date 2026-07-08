# 聚信 AI 助手内网调试、独立版本与更新发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面 Agent 从 `1.0.0` 开始独立升版，提供受控局域网 HTTP 测试构建，并让管理员上传、发布预构建的 Tauri 签名更新产物，使客户端可自动升级并重启。

**Architecture:** 桌面端把构建渠道固化为 Rust/前端可读的编译期策略，production 只接受 HTTPS，development/lan-test 仅额外接受 loopback 与 RFC1918 IPv4 HTTP。Agent 版本由桌面包独立脚本同步，不再进入平台版本钩子。FastAPI 保存不可变更新产物和发布元数据，管理员只上传及发布 CI 已签名的 `.app.tar.gz`/`.nsis.zip`，客户端从固定 channel 清单下载并由内置公钥验证。

**Tech Stack:** React 19、TypeScript 6、Vitest、Playwright、Tauri 2、Rust、Node.js、FastAPI、SQLAlchemy、Alembic、MySQL、pytest。

实施任务使用 `CODEX_VERSIONING_BYPASS=1` 创建阶段提交，禁止平台版本钩子改动 Agent 版本。最终 Agent 发布提交使用 `[agent-v1.0.0]` 前缀；推送仍需具备 GitHub `workflow` 权限的凭据。

---

## 文件结构

- `scripts/versioning/automation.js`：平台版本同步时明确跳过桌面 Agent 目录。
- `tests/versioning-automation.test.js`：证明平台升级不改变 Agent 版本。
- `juxin-ai-assistant/apps/desktop/scripts/agent-version.mjs`：独立计算并同步 Agent SemVer。
- `juxin-ai-assistant/apps/desktop/scripts/build-mode.mjs`：Node 构建脚本共享的渠道与 Origin 规则。
- `juxin-ai-assistant/apps/desktop/src/buildMode.ts`：前端展示渠道和 HTTP 警告。
- `juxin-ai-assistant/apps/desktop/src-tauri/src/build_mode.rs`：Rust 运行时可信地址策略。
- `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/workspace-private-http.json`：仅测试构建加入的 HTTP 候选权限。
- `juxin-ai-assistant/server/alembic/versions/0004_desktop_updates.py`：更新发布与产物表。
- `juxin-ai-assistant/server/app/desktop_update_models.py`：SQLAlchemy 更新模型。
- `juxin-ai-assistant/server/app/admin/desktop_update_service.py`：版本、上传、发布、撤回领域规则。
- `juxin-ai-assistant/server/app/admin/desktop_update_routes.py`：管理员更新接口。
- `juxin-ai-assistant/server/app/desktop_update_public.py`：公开 Tauri 清单和文件下载。
- `juxin-ai-assistant/apps/desktop/src/pages/admin/DesktopUpdatesPage.tsx`：治理中心更新发布页面。
- `juxin-ai-assistant/apps/desktop/src/api/governance.ts`：更新管理 API client。
- `juxin-ai-assistant/scripts/create-updater-manifest.mjs`：收集 Tauri 更新产物、签名和审计元数据。

### Task 1: Agent 版本与平台版本彻底解耦

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/scripts/agent-version.mjs`
- Create: `juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/package.json`
- Modify: `scripts/versioning/automation.js`
- Modify: `scripts/versioning/commit-msg.js`
- Modify: `tests/versioning-automation.test.js`
- Modify: `juxin-ai-assistant/apps/desktop/package-lock.json`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: 写平台升版不得修改 Agent 的失败测试**

在 `tests/versioning-automation.test.js` 新增：

```js
test('syncRepositoryVersion preserves the independent desktop agent version', () => {
  const rootDir = makeFixture();
  writeJson(path.join(rootDir, 'package.json'), { version: '5.89.0' });
  writeJson(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/package.json'), {
    name: 'juxin-ai-assistant-desktop',
    version: '1.0.0',
  });
  writeJson(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/package-lock.json'), {
    version: '1.0.0',
    packages: { '': { version: '1.0.0' } },
  });

  syncRepositoryVersion({
    rootDir,
    currentVersion: '5.89.0',
    nextVersion: '5.90.0',
  });

  assert.equal(
    readJson(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/package.json')).version,
    '1.0.0',
  );
  assert.equal(
    readJson(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/package-lock.json')).version,
    '1.0.0',
  );
});
```

- [ ] **Step 2: 运行平台版本测试并确认失败**

Run:

```bash
node --test tests/versioning-automation.test.js
```

Expected: FAIL，桌面 package 被平台同步逻辑改为 `5.90.0`。

- [ ] **Step 3: 从平台 package 遍历中排除 Agent 目录**

在 `scripts/versioning/automation.js` 增加：

```js
const INDEPENDENT_VERSION_DIRS = new Set([
  'juxin-ai-assistant/apps/desktop',
]);

const isIndependentVersionPath = (rootDir, filePath) => {
  const relative = toPosixRelative(rootDir, path.dirname(filePath));
  return Array.from(INDEPENDENT_VERSION_DIRS)
    .some((directory) => relative === directory || relative.startsWith(`${directory}/`));
};
```

在 `syncRepositoryVersion` 遍历中遇到独立目录时 `continue`。不要依靠当前版本恰好不同来跳过。

- [ ] **Step 4: 写 Agent 独立升版脚本失败测试**

`scripts/tests/agent-version.test.mjs` 覆盖：

```js
test("agent patch bump updates only five desktop version locations", async () => {
  const fixture = await makeDesktopFixture("1.0.0", "5.89.0");
  const changed = await bumpAgentVersion(fixture.desktop, "patch");

  assert.equal(await readVersion(fixture.desktop, "package.json"), "1.0.1");
  assert.equal(await readVersion(fixture.desktop, "package-lock.json"), "1.0.1");
  assert.match(await readText(fixture.desktop, "src-tauri/Cargo.toml"), /version = "1\.0\.1"/);
  assert.match(await readText(fixture.desktop, "src-tauri/Cargo.lock"), /name = "juxin-ai-assistant"[\s\S]*version = "1\.0\.1"/);
  assert.equal(await readVersion(fixture.desktop, "src-tauri/tauri.conf.json"), "1.0.1");
  assert.equal(await readVersion(fixture.root, "package.json"), "5.89.0");
  assert.deepEqual(changed.sort(), EXPECTED_DESKTOP_VERSION_FILES);
});
```

另测 `major`、`minor`、非法级别、版本不一致时拒绝执行。

- [ ] **Step 5: 运行 Agent 版本测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/agent-version.test.mjs
```

Expected: FAIL，`agent-version.mjs` 不存在。

- [ ] **Step 6: 实现独立 Agent 版本脚本**

导出：

```js
export const DESKTOP_VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];

export function bumpSemver(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`非法 Agent 版本：${version}`);
  const [, major, minor, patch] = match.map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error("Agent 升版级别必须是 major、minor 或 patch");
}
```

`bumpAgentVersion()` 必须先验证五处当前版本一致，再原子写入临时文件并 rename。
`package.json` 增加：

```json
"agent:version": "node scripts/agent-version.mjs"
```

- [ ] **Step 7: 允许 `[agent-vX.Y.Z]` 提交前缀且跳过平台自动升版**

在 commit message 校验中增加：

```js
const AGENT_VERSION_PREFIX_RE = /^\[agent-v\d+\.\d+\.\d+\]\s+/i;
```

校验前去掉该前缀；post-commit 检测到 Agent 前缀时不调用
`applyVersioningToHeadCommit`，也不切平台版本分支。

测试必须证明：

```js
assert.equal(validateCommitMessage(
  '[agent-v1.0.1] fix(ai-assistant): repair updater',
), 'patch');
```

并证明该提交不改变根版本。

- [ ] **Step 8: 把当前 Agent 五处版本重置为 1.0.0**

直接运行同步模式：

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node scripts/agent-version.mjs --set 1.0.0
```

脚本的 `--set` 仅允许明确 SemVer，并仍验证所有目标文件。

- [ ] **Step 9: 运行版本全套测试**

Run:

```bash
node --test tests/versioning-automation.test.js
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/agent-version.test.mjs scripts/tests/delivery-contract.test.mjs
/opt/homebrew/bin/node scripts/release-metadata.mjs
```

Expected: PASS，根版本保持 `5.89.0`，Agent 五处为 `1.0.0`。

- [ ] **Step 10: 阶段提交**

```bash
git add scripts/versioning tests/versioning-automation.test.js \
  juxin-ai-assistant/apps/desktop/package.json \
  juxin-ai-assistant/apps/desktop/package-lock.json \
  juxin-ai-assistant/apps/desktop/scripts/agent-version.mjs \
  juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs \
  juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock \
  juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json
CODEX_VERSIONING_BYPASS=1 git commit -m "build(ai-assistant): separate agent versioning"
```

### Task 2: 建立共享构建渠道与私有网络 Origin 策略

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/scripts/build-mode.mjs`
- Create: `juxin-ai-assistant/apps/desktop/src/buildMode.ts`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/src/build_mode.rs`
- Create: `juxin-ai-assistant/apps/desktop/scripts/tests/build-mode.test.mjs`
- Create: `juxin-ai-assistant/apps/desktop/tests/build-mode.test.ts`
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/tests/build_mode.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/server_config.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/server_probe.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/src/local_binding.rs`
- Modify: `juxin-ai-assistant/apps/desktop/src/launcher/launcherState.ts`

- [ ] **Step 1: 写私有 HTTP 地址矩阵失败测试**

Rust 表驱动测试：

```rust
#[test]
fn lan_test_accepts_only_loopback_and_rfc1918_http() {
    let policy = BuildMode::LanTest;
    for allowed in [
        "http://localhost:5193",
        "http://127.8.9.10:5193",
        "http://10.2.3.4:5193",
        "http://172.16.0.1:5193",
        "http://172.31.255.254:5193",
        "http://192.168.20.15:5193",
    ] {
        assert!(ServerOrigin::parse_for_mode(allowed, policy).is_ok(), "{allowed}");
    }
    for rejected in [
        "http://172.32.0.1:5193",
        "http://100.64.0.1:5193",
        "http://169.254.1.1:5193",
        "http://8.8.8.8:5193",
        "http://intranet.local:5193",
        "http://192.168.1.20:5193/path",
    ] {
        assert!(ServerOrigin::parse_for_mode(rejected, policy).is_err(), "{rejected}");
    }
}
```

另测 `Production` 拒绝全部 HTTP，三种模式均接受安全 HTTPS。

- [ ] **Step 2: 运行 Rust 测试并确认失败**

Run:

```bash
cargo test --manifest-path juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml \
  --test build_mode --locked
```

Expected: FAIL，`BuildMode`/`parse_for_mode` 不存在。

- [ ] **Step 3: 实现 Rust 构建模式**

`build_mode.rs`：

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuildMode {
    Development,
    LanTest,
    Production,
}

impl BuildMode {
    pub fn from_build() -> Self {
        match option_env!("AI_ASSISTANT_BUILD_MODE").unwrap_or("production") {
            "development" => Self::Development,
            "lan-test" => Self::LanTest,
            _ => Self::Production,
        }
    }

    pub const fn allows_private_http(self) -> bool {
        matches!(self, Self::Development | Self::LanTest)
    }
}
```

私有 IPv4 判断只允许：

```rust
ip.is_loopback()
    || ip.octets()[0] == 10
    || (ip.octets()[0] == 172 && (16..=31).contains(&ip.octets()[1]))
    || (ip.octets()[0] == 192 && ip.octets()[1] == 168)
```

不使用 `Ipv4Addr::is_private()` 作为唯一规则，避免未来标准库范围变化。

- [ ] **Step 4: 把 Origin、bootstrap SSO Portal 和本地绑定统一到 BuildMode**

替换 `cfg!(debug_assertions)`：

```rust
ServerOrigin::parse_for_mode(&origin, BuildMode::from_build())
```

`server_probe` 的 auth portal 校验和 `local_binding` 的验证均接收同一
`BuildMode`。production 不得因 debug 编译而自动允许私有 HTTP。

- [ ] **Step 5: 写前端地址策略失败测试**

```ts
it.each([
  ['http://10.2.3.4:5193', 'lan-test', true],
  ['http://192.168.1.20:5193', 'development', true],
  ['http://8.8.8.8:5193', 'lan-test', false],
  ['http://10.2.3.4:5193', 'production', false],
])('validates %s in %s mode', (raw, mode, valid) => {
  expect(validateServerOrigin(raw, mode).kind === 'valid').toBe(valid);
});
```

- [ ] **Step 6: 实现前端 BuildMode 和固定警告**

```ts
export type BuildMode = 'development' | 'lan-test' | 'production';

export const buildMode =
  (import.meta.env.VITE_AI_ASSISTANT_BUILD_MODE as BuildMode | undefined)
  ?? (import.meta.env.DEV ? 'development' : 'production');

export const buildChannelLabel = buildMode === 'lan-test'
  ? '内网测试版'
  : buildMode === 'development'
    ? '开发版'
    : '正式版';
```

`validateServerOrigin(raw, mode)` 使用数值 IPv4 解析，不允许 HTTP 域名。

- [ ] **Step 7: 实现 Node 构建输入校验**

`scripts/build-mode.mjs` 导出 `parseBuildMode`、`validateBusinessOrigin`、
`validateUpdateEndpoint`。`lan-test` 更新源允许私有 IP HTTP；production 更新源只
允许 HTTPS。所有 URL 继续拒绝 userinfo、wildcard 和 fragment。

- [ ] **Step 8: 运行三层策略测试**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/build-mode.test.mjs
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/build-mode.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --test build_mode --locked
```

Expected: PASS，Node/TS/Rust 的允许与拒绝矩阵一致。

- [ ] **Step 9: 阶段提交**

```bash
git add juxin-ai-assistant/apps/desktop/scripts/build-mode.mjs \
  juxin-ai-assistant/apps/desktop/scripts/tests/build-mode.test.mjs \
  juxin-ai-assistant/apps/desktop/src/buildMode.ts \
  juxin-ai-assistant/apps/desktop/src/launcher/launcherState.ts \
  juxin-ai-assistant/apps/desktop/src-tauri/src/build_mode.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/lib.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/server_config.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/server_probe.rs \
  juxin-ai-assistant/apps/desktop/src-tauri/src/local_binding.rs \
  juxin-ai-assistant/apps/desktop/tests/build-mode.test.ts \
  juxin-ai-assistant/apps/desktop/src-tauri/tests/build_mode.rs
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): add private network test mode"
```

### Task 3: 生成渠道锁定的 Tauri 配置与内网测试包

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/workspace-private-http.json`
- Create: `juxin-ai-assistant/scripts/build-macos-lan-test-arm64.sh`
- Create: `juxin-ai-assistant/scripts/build-windows-lan-test-x64.ps1`
- Modify: `juxin-ai-assistant/apps/desktop/scripts/render-tauri-config.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/scripts/tests/render-tauri-config.test.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/capabilities/workspace.json`
- Modify: `juxin-ai-assistant/scripts/build-macos-arm64.sh`
- Modify: `juxin-ai-assistant/scripts/build-windows.ps1`
- Modify: `juxin-ai-assistant/apps/desktop/src/launcher/LauncherPage.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/tests/launcher-page.test.tsx`

- [ ] **Step 1: 写生成配置失败测试**

覆盖：

```js
const lan = buildReleaseConfig(base, {
  buildMode: "lan-test",
  defaultServerOrigin: "http://192.168.20.15:5193",
  updaterEnabled: "true",
  updaterEndpoint: "http://192.168.20.15:5193/api/ai/desktop/updates/lan-test/{{target}}/{{arch}}/latest.json",
  updaterPublicKey: "PUBLIC-KEY",
});
assert.deepEqual(lan.app.security.capabilities, [
  "launcher",
  "workspace",
  "workspace-private-http",
]);
assert.equal(lan.bundle.createUpdaterArtifacts, true);

assert.throws(() => buildReleaseConfig(base, {
  buildMode: "production",
  defaultServerOrigin: "http://192.168.20.15:5193",
  updaterEnabled: "false",
}), /production.*HTTPS/i);
```

- [ ] **Step 2: 运行配置测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/render-tauri-config.test.mjs
```

Expected: FAIL，当前 renderer 不识别 `buildMode` 和私有 HTTP capability。

- [ ] **Step 3: 新增最小候选 capability**

`workspace-private-http.json` 只包含：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "workspace-private-http",
  "description": "仅内网测试构建允许私有 HTTP 页面成为候选工作台",
  "windows": ["workspace"],
  "remote": { "urls": ["http://*:*/*"] },
  "permissions": []
}
```

该 capability 只解决 Tauri 静态候选 URL；实际命令仍由 Rust
`guard_business` 精确校验已保存 Origin 和绑定用户。

- [ ] **Step 4: 让 renderer 固化 build mode**

生成配置时同时设置编译环境：

```js
config.app.security.capabilities = inputs.buildMode === "production"
  ? ["launcher", "workspace"]
  : ["launcher", "workspace", "workspace-private-http"];
```

脚本入口读取：

```js
buildMode: process.env.AI_ASSISTANT_BUILD_MODE ?? "production"
```

并要求 `VITE_AI_ASSISTANT_BUILD_MODE` 与 Rust `AI_ASSISTANT_BUILD_MODE` 同值。

- [ ] **Step 5: 实现独立 lan-test 构建脚本**

macOS 脚本必须显式：

```bash
export AI_ASSISTANT_BUILD_MODE=lan-test
export VITE_AI_ASSISTANT_BUILD_MODE=lan-test
export AI_UPDATER_ENABLED=true
```

Windows 脚本使用相同变量。production 脚本显式设置 `production`，不能继承 shell 中
残留的 `lan-test`。

- [ ] **Step 6: 在启动页显示渠道和 HTTP 警告**

当验证后的 origin 使用 HTTP：

```tsx
<p className="launcher-insecure-warning" role="alert">
  内网 HTTP 测试模式：通信未加密，仅用于受控局域网。
</p>
```

版本旁显示 `Agent 1.0.0 · 内网测试版`。警告不因 probe 成功或登录可用而消失。

- [ ] **Step 7: 运行 UI、配置与 dry-run 测试**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/launcher-page.test.tsx
/opt/homebrew/bin/node --test scripts/tests/render-tauri-config.test.mjs
cd ../../
bash scripts/build-macos-lan-test-arm64.sh --dry-run
pwsh -File scripts/build-windows-lan-test-x64.ps1 -DryRun
```

Expected: PASS；production 配置没有 `workspace-private-http`。

- [ ] **Step 8: 阶段提交**

```bash
git add juxin-ai-assistant/apps/desktop/scripts/render-tauri-config.mjs \
  juxin-ai-assistant/apps/desktop/scripts/tests/render-tauri-config.test.mjs \
  juxin-ai-assistant/apps/desktop/src-tauri/capabilities \
  juxin-ai-assistant/apps/desktop/src/launcher/LauncherPage.tsx \
  juxin-ai-assistant/apps/desktop/tests/launcher-page.test.tsx \
  juxin-ai-assistant/scripts/build-*
CODEX_VERSIONING_BYPASS=1 git commit -m "build(ai-assistant): package private network test channel"
```

### Task 4: 增加更新发布数据库模型与安全存储配置

**Files:**
- Create: `juxin-ai-assistant/server/alembic/versions/0004_desktop_updates.py`
- Create: `juxin-ai-assistant/server/app/desktop_update_models.py`
- Create: `juxin-ai-assistant/server/tests/test_desktop_update_models.py`
- Modify: `juxin-ai-assistant/server/app/config.py`
- Modify: `juxin-ai-assistant/server/alembic/env.py`
- Modify: `juxin-ai-assistant/server/tests/test_config.py`
- Modify: `juxin-ai-assistant/server/requirements.txt`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: 写模型和设置失败测试**

```python
def test_desktop_update_tables_enforce_unique_channel_version_target(generation_db):
    release = DesktopUpdateRelease(
        agent_version="1.0.1",
        channel="lan-test",
        status="DRAFT",
        release_notes="测试更新",
        created_by="admin",
    )
    generation_db.add(release)
    generation_db.flush()
    generation_db.add_all([
        DesktopUpdateArtifact(
            release_id=release.id,
            target="darwin-aarch64",
            file_name="聚信 AI 助手.app.tar.gz",
            storage_key="one",
            content_type="application/gzip",
            size_bytes=12,
            sha256="a" * 64,
            tauri_signature="sig",
        ),
        DesktopUpdateArtifact(
            release_id=release.id,
            target="darwin-aarch64",
            file_name="duplicate.app.tar.gz",
            storage_key="two",
            content_type="application/gzip",
            size_bytes=12,
            sha256="b" * 64,
            tauri_signature="sig",
        ),
    ])
    with pytest.raises(IntegrityError):
        generation_db.flush()
```

设置测试要求 storage root 为绝对路径、最大文件大小在 1 MiB–2 GiB 之间。

- [ ] **Step 2: 运行模型测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/server
python -m pytest tests/test_desktop_update_models.py tests/test_config.py -q
```

Expected: FAIL，模型和配置不存在。

- [ ] **Step 3: 实现模型与 0004 迁移**

模型字段严格对应规格，增加：

```python
UniqueConstraint(
    "channel",
    "agent_version",
    name="uq_desktop_update_release_channel_version",
)
UniqueConstraint(
    "release_id",
    "target",
    name="uq_desktop_update_artifact_release_target",
)
```

artifact 的 `storage_key` 和 `sha256` 均唯一；状态和 channel 使用 CheckConstraint。

- [ ] **Step 4: 增加存储配置**

```python
desktop_update_storage_dir: str = "/var/lib/juxin-ai-assistant/desktop-updates"
desktop_update_max_bytes: int = Field(
    default=1_073_741_824,
    ge=1_048_576,
    le=2_147_483_648,
)
desktop_update_public_base_url: str = ""
```

生产环境 public base URL 仅允许 HTTPS；`AUTH_DEV_BYPASS=true` 时允许 loopback/RFC1918
HTTP。路径必须是绝对路径。

- [ ] **Step 5: 注册迁移模型并挂载不可变存储卷**

`alembic/env.py` 显式导入：

```python
from app import desktop_update_models  # noqa: F401
```

`docker-compose.yml` 的 `ai-assistant-api` 增加：

```yaml
environment:
  DESKTOP_UPDATE_STORAGE_DIR: /data/ai-assistant/desktop-updates
  DESKTOP_UPDATE_MAX_BYTES: ${AI_DESKTOP_UPDATE_MAX_BYTES:-1073741824}
  DESKTOP_UPDATE_PUBLIC_BASE_URL: ${AI_DESKTOP_UPDATE_PUBLIC_BASE_URL:-}
volumes:
  - ai-assistant-updates:/data/ai-assistant/desktop-updates
```

并在顶层 `volumes` 声明 `ai-assistant-updates:`。`.env.example` 只记录 public base URL
和大小限制，不增加任何签名私钥变量。

- [ ] **Step 6: 增加 multipart 依赖**

`requirements.txt` 固定加入与 FastAPI 兼容的：

```text
python-multipart==0.0.22
```

- [ ] **Step 7: 运行模型、迁移与配置测试**

Run:

```bash
python -m pytest \
  tests/test_desktop_update_models.py \
  tests/test_migrations.py \
  tests/test_config.py -q
```

Expected: PASS。

- [ ] **Step 8: 阶段提交**

```bash
git add juxin-ai-assistant/server/alembic/versions/0004_desktop_updates.py \
  juxin-ai-assistant/server/app/desktop_update_models.py \
  juxin-ai-assistant/server/app/config.py \
  juxin-ai-assistant/server/alembic/env.py \
  juxin-ai-assistant/server/requirements.txt \
  docker-compose.yml .env.example \
  juxin-ai-assistant/server/tests/test_desktop_update_models.py \
  juxin-ai-assistant/server/tests/test_config.py \
  juxin-ai-assistant/server/tests/test_migrations.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): store desktop update releases"
```

### Task 5: 实现不可变更新产物上传与发布领域服务

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/desktop_update_service.py`
- Create: `juxin-ai-assistant/server/tests/test_desktop_update_service.py`
- Modify: `juxin-ai-assistant/server/app/admin/schemas.py`

- [ ] **Step 1: 写版本与 secret 边界失败测试**

覆盖：

```python
def test_create_release_rejects_same_or_lower_published_version(db):
    published(db, "1.0.1", channel="lan-test")
    with pytest.raises(GovernanceError, match="必须高于"):
        create_release(db, DesktopUpdateCreateIn(
            agent_version="1.0.1",
            channel="lan-test",
            release_notes="重复",
        ), actor_id="admin")

def test_create_release_rejects_secret_like_input():
    with pytest.raises(ValidationError):
        DesktopUpdateCreateIn.model_validate({
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "测试",
            "private_key": "forbidden",
        })
```

- [ ] **Step 2: 写流式上传失败测试**

使用小 chunk fake upload，验证：

- 请求 SHA 与服务端复算 SHA 不一致会删除临时文件。
- 超限上传会中止并清理。
- macOS 只接受 `.app.tar.gz`，Windows 只接受 `.nsis.zip`。
- 文件名不得包含 `/`、`\`、NUL 或 `..`。
- storage key 是服务端生成 UUID，不来自用户。
- 已发布 release 不允许替换产物。

- [ ] **Step 3: 运行 service 测试并确认失败**

Run:

```bash
python -m pytest tests/test_desktop_update_service.py -q
```

Expected: FAIL，service 不存在。

- [ ] **Step 4: 实现 SemVer 与 release 状态机**

只接受稳定三段 SemVer：

```python
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

def semver_key(value: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(value)
    if not match:
        raise GovernanceError(422, "INVALID_AGENT_VERSION", "Agent 版本必须是三段 SemVer")
    return tuple(int(part) for part in match.groups())
```

发布时用 `SELECT ... FOR UPDATE` 锁定同 channel 发布记录，再比较版本。

- [ ] **Step 5: 实现流式不可变存储**

接口：

```python
async def store_artifact(
    db: Session,
    release_uuid: str,
    *,
    target: DesktopUpdateTarget,
    expected_sha256: str,
    tauri_signature: str,
    upload: UploadFile,
    settings: Settings,
) -> DesktopUpdateArtifact:
```

每次读取最多 1 MiB：

```python
while chunk := await upload.read(1024 * 1024):
    size += len(chunk)
    if size > settings.desktop_update_max_bytes:
        raise GovernanceError(413, "ARTIFACT_TOO_LARGE", "升级包超过大小限制")
    digest.update(chunk)
    temporary.write(chunk)
```

临时文件与最终目录在同一 storage root，`os.replace()` 原子提交。任何异常在
`finally` 删除临时文件。

- [ ] **Step 6: 实现发布与撤回**

`lan-test` 至少要求 `darwin-aarch64` 或 `windows-x86_64` 任一目标；
`production` 必须两者齐全。发布后文件和 release notes 都不可修改。

撤回：

```python
release.status = "WITHDRAWN"
```

不得删除 artifact 行或物理文件。

- [ ] **Step 7: 运行 service 测试**

Run:

```bash
python -m pytest tests/test_desktop_update_service.py -q
```

Expected: PASS。

- [ ] **Step 8: 阶段提交**

```bash
git add juxin-ai-assistant/server/app/admin/desktop_update_service.py \
  juxin-ai-assistant/server/app/admin/schemas.py \
  juxin-ai-assistant/server/tests/test_desktop_update_service.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): validate immutable update artifacts"
```

### Task 6: 暴露管理员发布接口和公开 Tauri 更新接口

**Files:**
- Create: `juxin-ai-assistant/server/app/admin/desktop_update_routes.py`
- Create: `juxin-ai-assistant/server/app/desktop_update_public.py`
- Create: `juxin-ai-assistant/server/tests/test_desktop_update_api.py`
- Modify: `juxin-ai-assistant/server/app/admin/router.py`
- Modify: `juxin-ai-assistant/server/app/main.py`

- [ ] **Step 1: 写管理员权限与发布 API 失败测试**

测试以下完整流程：

```python
create = admin.post("/api/ai/admin/desktop-updates", json={
    "agent_version": "1.0.1",
    "channel": "lan-test",
    "release_notes": "测试自动更新",
})
assert create.status_code == 201

upload = admin.post(
    f"/api/ai/admin/desktop-updates/{create.json()['uuid']}/artifacts",
    data={
        "target": "darwin-aarch64",
        "sha256": sha256(payload).hexdigest(),
        "signature": "tauri-public-signature",
    },
    files={"file": ("聚信 AI 助手.app.tar.gz", payload, "application/gzip")},
)
assert upload.status_code == 201

publish = admin.post(
    f"/api/ai/admin/desktop-updates/{create.json()['uuid']}/publish",
)
assert publish.json()["status"] == "PUBLISHED"
```

employee 对四个写接口均为 403。

- [ ] **Step 2: 写公开清单和下载失败测试**

断言：

```python
latest = client.get(
    "/api/ai/desktop/updates/lan-test/darwin/aarch64/latest.json",
)
payload = latest.json()
assert payload["version"] == "1.0.1"
assert payload["notes"] == "测试自动更新"
assert datetime.fromisoformat(payload["pub_date"].replace("Z", "+00:00"))
assert payload["platforms"]["darwin-aarch64"]["signature"] == \
    "tauri-public-signature"
assert payload["platforms"]["darwin-aarch64"]["url"].startswith(
    "http://testserver/api/ai/desktop/updates/files/"
)
```

无发布或撤回后返回 204；下载支持完整响应和单段 `Range: bytes=0-3`，非法多段
Range 返回 416。

- [ ] **Step 3: 运行 API 测试并确认失败**

Run:

```bash
python -m pytest tests/test_desktop_update_api.py -q
```

Expected: FAIL，路由不存在。

- [ ] **Step 4: 实现管理员 routes**

所有写路由先：

```python
await require_action("ai_assistant:admin", request, session, settings)
```

然后调用 service、写 `desktop_update.create/upload/publish/withdraw` 审计，再 commit。
上传审计只记录 release UUID、target、size、SHA，不记录签名全文或文件内容。

- [ ] **Step 5: 实现公开 routes**

清单 route 根据 `target/arch` 映射：

```python
TARGETS = {
    ("darwin", "aarch64"): "darwin-aarch64",
    ("windows", "x86_64"): "windows-x86_64",
}
```

只查询 `PUBLISHED`，按三段 SemVer 最大值选择，而不是字符串排序。

下载用数据库 storage key 拼接：

```python
path = (storage_root / artifact.storage_key).resolve()
if path.parent != storage_root.resolve():
    raise HTTPException(404)
```

不要接受文件名或用户路径作为磁盘路径。

- [ ] **Step 6: 注册路由并处理 GovernanceError**

`admin/router.py` include 管理 router；`main.py` include 公开 router。复用现有
GovernanceError handler，保持 `{code, message}` 错误格式。

- [ ] **Step 7: 运行 API、权限、审计测试**

Run:

```bash
python -m pytest \
  tests/test_desktop_update_api.py \
  tests/test_governance_authorization.py \
  tests/test_audit_api.py -q
```

Expected: PASS。

- [ ] **Step 8: 阶段提交**

```bash
git add juxin-ai-assistant/server/app/admin/desktop_update_routes.py \
  juxin-ai-assistant/server/app/desktop_update_public.py \
  juxin-ai-assistant/server/app/admin/router.py \
  juxin-ai-assistant/server/app/main.py \
  juxin-ai-assistant/server/tests/test_desktop_update_api.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): publish signed desktop updates"
```

### Task 7: 增加治理中心“桌面端更新”页面

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/src/pages/admin/DesktopUpdatesPage.tsx`
- Create: `juxin-ai-assistant/apps/desktop/tests/desktop-updates-page.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/api/governance.ts`
- Modify: `juxin-ai-assistant/apps/desktop/src/pages/admin/GovernanceCenter.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/theme/tokens.css`

- [ ] **Step 1: 写页面失败测试**

MSW 测试管理员流程：

```tsx
render(<DesktopUpdatesPage />);
await user.type(screen.getByLabelText('Agent 版本'), '1.0.1');
await user.selectOptions(screen.getByLabelText('发布渠道'), 'lan-test');
await user.type(screen.getByLabelText('更新说明'), '验证自动更新');
await user.click(screen.getByRole('button', { name: '创建更新草稿' }));

const file = new File(['signed-updater'], '聚信 AI 助手.app.tar.gz', {
  type: 'application/gzip',
});
await user.upload(screen.getByLabelText('macOS arm64 更新产物'), file);
await user.type(screen.getByLabelText('SHA-256'), 'a'.repeat(64));
await user.type(screen.getByLabelText('Tauri 签名'), 'public-signature');
await user.click(screen.getByRole('button', { name: '上传并校验' }));
await user.click(screen.getByRole('button', { name: '发布测试更新' }));

expect(await screen.findByText('1.0.1 已发布')).toBeVisible();
```

断言页面没有 `私钥`、`private key`、`token` 输入。

- [ ] **Step 2: 运行页面测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/desktop-updates-page.test.tsx
```

Expected: FAIL，页面不存在。

- [ ] **Step 3: 扩展 governance API**

增加类型和方法：

```ts
export type DesktopUpdateRelease = {
  uuid: string;
  agent_version: string;
  channel: 'lan-test' | 'production';
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  release_notes: string;
  artifacts: DesktopUpdateArtifact[];
};
```

上传必须使用 `FormData`，`request()` 只有 JSON body 时才设置 Content-Type，禁止手工
设置 multipart boundary。

- [ ] **Step 4: 实现页面状态机**

页面只允许：

- 创建草稿。
- 为明确 target 上传一个更新产物。
- 查看服务端复算 SHA 和大小。
- 二次确认发布/撤回。

`production` 缺任一 target 时禁用发布按钮并显示明确原因。

- [ ] **Step 5: 注册治理导航**

新增：

```ts
{ page: 'desktop-updates', label: '桌面端更新' }
```

仅 admin/sysadmin 可见；auditor 和普通员工无入口。

- [ ] **Step 6: 运行页面与治理回归**

Run:

```bash
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs \
  run tests/desktop-updates-page.test.tsx tests/governance-pages.test.tsx
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
```

Expected: PASS。

- [ ] **Step 7: 阶段提交**

```bash
git add juxin-ai-assistant/apps/desktop/src/api/governance.ts \
  juxin-ai-assistant/apps/desktop/src/pages/admin/DesktopUpdatesPage.tsx \
  juxin-ai-assistant/apps/desktop/src/pages/admin/GovernanceCenter.tsx \
  juxin-ai-assistant/apps/desktop/src/theme/tokens.css \
  juxin-ai-assistant/apps/desktop/tests/desktop-updates-page.test.tsx
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(ai-assistant): manage desktop update releases"
```

### Task 8: 生成并校验真正的 Tauri 更新产物

**Files:**
- Create: `juxin-ai-assistant/scripts/create-updater-manifest.mjs`
- Create: `juxin-ai-assistant/apps/desktop/scripts/tests/updater-artifacts.test.mjs`
- Modify: `juxin-ai-assistant/apps/desktop/scripts/release-policy.mjs`
- Modify: `juxin-ai-assistant/scripts/build-macos-lan-test-arm64.sh`
- Modify: `juxin-ai-assistant/scripts/build-windows-lan-test-x64.ps1`
- Modify: `.github/workflows/ai-assistant-desktop.yml`

- [ ] **Step 1: 写更新产物识别失败测试**

```js
test("collects signed Tauri updater artifacts, not first-install packages", async () => {
  await fixture.write("聚信 AI 助手.app.tar.gz", updaterBytes);
  await fixture.write("聚信 AI 助手.app.tar.gz.sig", "signature");
  await fixture.write("聚信 AI 助手_1.0.1_aarch64.dmg", dmgBytes);

  const manifest = await createUpdaterManifest(fixture.path, {
    version: "1.0.1",
    channel: "lan-test",
    target: "darwin-aarch64",
  });

  assert.equal(manifest.file, "聚信 AI 助手.app.tar.gz");
  assert.equal(manifest.signature, "signature");
  assert.ok(!manifest.file.endsWith(".dmg"));
});
```

Windows 测试只接受 `.nsis.zip` + `.sig`。

- [ ] **Step 2: 运行脚本测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/updater-artifacts.test.mjs
```

Expected: FAIL，collector 不存在。

- [ ] **Step 3: 实现 updater manifest**

输出：

```json
{
  "agentVersion": "1.0.1",
  "platformVersion": "5.89.0",
  "channel": "lan-test",
  "target": "darwin-aarch64",
  "file": "聚信 AI 助手.app.tar.gz",
  "sizeBytes": 123,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "signature": "tauri-public-signature"
}
```

拒绝 secret-like 字段、缺失 `.sig`、空签名、文件名路径和目标/扩展不匹配。

- [ ] **Step 4: 构建脚本只从环境读取私钥**

Tauri 官方环境变量：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

脚本只检查存在，不输出内容。`createUpdaterArtifacts=true` 后验证更新文件和 `.sig`
实际生成。lan-test update URL 固定为：

```text
http://192.168.20.15:5193/api/ai/desktop/updates/lan-test/{{target}}/{{arch}}/latest.json
```

- [ ] **Step 5: CI 分离无签名验证与受保护签名发布**

保留 PR 的 unsigned 构建；新增仅 `workflow_dispatch` 的 signed job，要求 GitHub
Environment `ai-assistant-release`，从 secrets 注入私钥。上传 artifact 前运行
`create-updater-manifest.mjs` 和 release-policy 校验。

CI 不自动调用业务服务发布接口；产物由管理员下载后上传，或未来由单独受保护 deploy
job 调用。

- [ ] **Step 6: 运行 Node 交付测试**

Run:

```bash
cd juxin-ai-assistant/apps/desktop
/opt/homebrew/bin/node --test scripts/tests/*.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 阶段提交**

```bash
git add .github/workflows/ai-assistant-desktop.yml \
  juxin-ai-assistant/scripts/create-updater-manifest.mjs \
  juxin-ai-assistant/scripts/build-*-lan-test-* \
  juxin-ai-assistant/apps/desktop/scripts/release-policy.mjs \
  juxin-ai-assistant/apps/desktop/scripts/tests/updater-artifacts.test.mjs
CODEX_VERSIONING_BYPASS=1 git commit -m "build(ai-assistant): produce signed updater artifacts"
```

### Task 9: 自动化管理发布与客户端发现闭环

**Files:**
- Create: `juxin-ai-assistant/apps/desktop/e2e/update-publishing-flow.spec.ts`
- Create: `juxin-ai-assistant/server/tests/test_desktop_update_concurrency.py`
- Modify: `juxin-ai-assistant/apps/desktop/e2e/launcher-flow.spec.ts`
- Modify: `juxin-ai-assistant/apps/desktop/playwright.config.ts`

- [ ] **Step 1: 写发布到客户端提示的失败 E2E**

测试流程：

```ts
test('publishing 1.0.1 makes it visible to a 1.0.0 lan-test client', async ({
  page,
  request,
}) => {
  const release = await createLanTestRelease(request, '1.0.1');
  await uploadSignedFixture(request, release.uuid, 'darwin-aarch64');
  await publishRelease(request, release.uuid);

  await openLanTestLauncher(page, { currentVersion: '1.0.0' });
  await page.getByRole('button', { name: '检查更新' }).click();

  await expect(
    page.getByRole('dialog', { name: '发现新版本 1.0.1' }),
  ).toBeVisible();
});
```

这里的浏览器 E2E mock 只验证发布清单到 UI；真实安装在 Task 10。

- [ ] **Step 2: 写并发发布失败测试**

两个数据库 session 同时发布 `1.0.1`/`1.0.2`，最终只能有一个同 channel 当前最高
published 选择；同版本重复发布必须冲突，不能覆盖 artifact。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```bash
cd juxin-ai-assistant/server
python -m pytest tests/test_desktop_update_concurrency.py -q
cd ../apps/desktop
PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/npm exec playwright test \
  e2e/update-publishing-flow.spec.ts
```

Expected: FAIL，E2E fixture/并发锁定尚不完整。

- [ ] **Step 4: 完成测试 fixture 和事务边界**

测试存储目录使用 pytest tmp_path；Playwright webServer 启动隔离 FastAPI 测试实例，
禁止连接共享生产数据库。并发测试在 MySQL 容器执行，SQLite 测试只覆盖普通流程。

- [ ] **Step 5: 运行发布闭环测试**

Run:

```bash
python -m pytest \
  tests/test_desktop_update_api.py \
  tests/test_desktop_update_concurrency.py -q
cd ../apps/desktop
PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/npm exec playwright test \
  e2e/update-publishing-flow.spec.ts e2e/launcher-flow.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 阶段提交**

```bash
git add juxin-ai-assistant/server/tests/test_desktop_update_concurrency.py \
  juxin-ai-assistant/apps/desktop/e2e/update-publishing-flow.spec.ts \
  juxin-ai-assistant/apps/desktop/e2e/launcher-flow.spec.ts \
  juxin-ai-assistant/apps/desktop/playwright.config.ts
CODEX_VERSIONING_BYPASS=1 git commit -m "test(ai-assistant): cover update publishing flow"
```

### Task 10: 真实 1.0.0 → 1.0.1 签名升级验收

**Files:**
- Create: `docs/releases/agent-1.0.0.md`
- Create: `docs/releases/agent-1.0.1-test-update.md`
- Modify: `docs/manuals/ai-assistant-user-manual.md`
- Modify: `juxin-ai-assistant/README.md`

- [ ] **Step 1: 生成一次性测试更新签名密钥**

仅用于受控测试环境：

```bash
npm --prefix juxin-ai-assistant/apps/desktop run tauri signer generate \
  -- -w "$HOME/.config/juxin-ai-assistant/lan-test-updater.key"
```

私钥不得进入仓库、日志或服务端；公钥写入 lan-test 构建变量。

- [ ] **Step 2: 构建并安装 Agent 1.0.0 lan-test 基线**

确认卸载旧 `5.89.0` 测试 App 但保留应用数据，再运行：

```bash
AI_ASSISTANT_BUILD_MODE=lan-test \
AI_ASSISTANT_DEFAULT_SERVER_ORIGIN="http://192.168.20.15:5193" \
AI_UPDATER_URL="http://192.168.20.15:5193/api/ai/desktop/updates/lan-test/{{target}}/{{arch}}/latest.json" \
AI_UPDATER_PUBLIC_KEY="$LAN_TEST_UPDATER_PUBLIC_KEY" \
bash juxin-ai-assistant/scripts/build-macos-lan-test-arm64.sh
```

验证 About 显示 `Agent 1.0.0 · 内网测试版`，通过私有 IP HTTP 完成 bootstrap 和 SSO。

- [ ] **Step 3: 升 Agent 到 1.0.1 并构建签名更新产物**

```bash
cd juxin-ai-assistant/apps/desktop
npm run agent:version -- patch
cd ../../
TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.config/juxin-ai-assistant/lan-test-updater.key")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$LAN_TEST_UPDATER_KEY_PASSWORD" \
bash scripts/build-macos-lan-test-arm64.sh
```

不得在命令历史中使用真实密码；实际执行时通过交互式 secret 环境注入。

- [ ] **Step 4: 上传并发布 1.0.1**

通过治理页面创建 `1.0.1 / lan-test`，上传 `.app.tar.gz`、SHA 和 `.sig` 内容，确认
服务端复算 SHA 后点击“发布测试更新”。

- [ ] **Step 5: 从 1.0.0 客户端执行真实更新**

验证：

1. 手动检查显示 1.0.1。
2. 下载进度可见且可取消。
3. 重新下载后签名通过。
4. 应用自动安装并重启。
5. 重启后 Agent 版本为 1.0.1。
6. 服务器 Origin、模型配置、Keychain 密钥、草稿和待同步队列保持不变。

- [ ] **Step 6: 负向签名与回滚测试**

在隔离 channel 上传篡改一字节的包并保留原签名，客户端必须显示签名失败且继续运行
1.0.0/1.0.1 当前版本。服务端撤回后 latest 返回 204。

- [ ] **Step 7: 记录真实证据**

发布文档记录：

- 构建渠道、Agent 版本、平台版本。
- 更新产物文件名、大小、SHA-256。
- Tauri 公钥指纹，不记录私钥。
- 安装前后版本和数据保留结果。
- macOS 平台签名/公证与 Windows 验收是否完成。

- [ ] **Step 8: 阶段提交**

```bash
git add docs/releases/agent-1.0.0.md \
  docs/releases/agent-1.0.1-test-update.md \
  docs/manuals/ai-assistant-user-manual.md \
  juxin-ai-assistant/README.md
CODEX_VERSIONING_BYPASS=1 git commit -m "docs(ai-assistant): verify signed agent update"
```

### Task 11: 全量验证、最终 Agent 提交和推送

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-ai-assistant-private-http-independent-version-update-publishing-design.md`
- Modify: `docs/superpowers/plans/2026-06-22-ai-assistant-private-http-independent-version-update-publishing.md`

- [ ] **Step 1: 运行后端全套测试**

Run:

```bash
cd juxin-ai-assistant/server
python -m pytest tests -q
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行前端与交付全套测试**

Run:

```bash
cd ../apps/desktop
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
/usr/bin/arch -arm64 /opt/homebrew/bin/node node_modules/vite/bin/vite.js build
/usr/bin/arch -arm64 /opt/homebrew/bin/node --test scripts/tests/*.test.mjs
PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/npm run test:e2e
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行 Rust 全套检查**

Run:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --locked
```

Expected: 全部 PASS。

- [ ] **Step 4: 运行安全与版本边界检查**

Run:

```bash
cd ../../../../
node --test tests/versioning-automation.test.js
npm --prefix juxin-ai-assistant/apps/desktop audit --omit=dev
/tmp/juxin-cargo-audit/bin/cargo-audit \
  --file juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock
git diff --check
```

确认：

- 根版本仍是平台版本，Agent 当前发布版本独立。
- 更新存储和提交中没有私钥、密码、token。
- production 产物不包含 private HTTP capability。
- lan-test 产物有明确渠道标识。

- [ ] **Step 5: 更新当日 memory**

更新：

```text
/Users/zhanglei/Documents/codex-new/memory/2026-06-22.md
```

记录 Agent 独立版本、lan-test HTTP 范围、更新发布接口、真实升级证据和仍存在的正式
签名/Windows 门槛。

- [ ] **Step 6: 最终 Agent 提交**

如果当前发布版本为 `1.0.1`：

```bash
git add .
CODEX_VERSIONING_BYPASS=1 git commit \
  -m "[agent-v1.0.1] feat(ai-assistant): publish independent signed updates"
```

提交后确认根版本未变化，Agent 五处版本一致。

- [ ] **Step 7: 推送并核验三方 SHA**

使用具备 GitHub `workflow` 权限的凭据：

```bash
git push origin codex/5.89.0
git rev-parse HEAD
git rev-parse '@{upstream}'
git ls-remote origin refs/heads/codex/5.89.0
```

Expected: 三个 SHA 完全一致；否则不得宣称交付完成。
