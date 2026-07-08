import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readDesktopReleaseMetadata } from "../release-metadata.mjs";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const deliveryScriptsDirectory = resolve(desktopDirectory, "../../scripts");
const repositoryRoot = resolve(desktopDirectory, "../../..");

test("Tauri bundle identifies a semantic-versioned desktop product and is active", async () => {
  // Given: the packaged desktop configuration.
  const config = JSON.parse(await readFile(resolve(desktopDirectory, "src-tauri/tauri.conf.json"), "utf8"));

  // When / Then: release identity is stable and bundling is enabled.
  assert.equal(config.productName, "聚信 AI 助手");
  assert.equal(config.identifier, "com.juxin.ai-assistant");
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(config.bundle.active, true);
});

test("desktop release version has one authoritative value across Tauri, Cargo and npm", async () => {
  const tauri = JSON.parse(await readFile(resolve(desktopDirectory, "src-tauri/tauri.conf.json"), "utf8"));
  const npm = JSON.parse(await readFile(resolve(desktopDirectory, "package.json"), "utf8"));
  const cargo = await readFile(resolve(desktopDirectory, "src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  assert.equal(tauri.version, cargoVersion);
  assert.equal(tauri.version, npm.version);
  const manifestScript = await readFile(resolve(deliveryScriptsDirectory, "create-artifact-manifest.mjs"), "utf8");
  assert.doesNotMatch(manifestScript, /version:\s*"1\.0\.0"/);
});

test("release metadata reads the platform version from the repository package", async () => {
  const repositoryPackage = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));

  assert.equal((await readDesktopReleaseMetadata()).platformVersion, repositoryPackage.version);
});

test("platform bundle targets exclude unsupported architectures", async () => {
  // Given: the Windows and macOS platform overlays.
  const windows = JSON.parse(await readFile(resolve(desktopDirectory, "src-tauri/tauri.windows.conf.json"), "utf8"));
  const macos = JSON.parse(await readFile(resolve(desktopDirectory, "src-tauri/tauri.macos.conf.json"), "utf8"));

  // When / Then: each platform produces only its approved installer formats.
  assert.deepEqual(windows.bundle.targets, ["msi", "nsis"]);
  assert.deepEqual(macos.bundle.targets, ["app", "dmg"]);
  assert.equal(macos.bundle.macOS.minimumSystemVersion, "11.0");
  assert.doesNotMatch(JSON.stringify(macos), /x86_64-apple-darwin|universal-apple-darwin/);
});

test("brand icon keeps a 1024 by 1024 RGBA master", async () => {
  const icon = await readFile(resolve(desktopDirectory, "src-tauri/icons/icon.png"));
  assert.deepEqual([...icon.subarray(1, 4)], [...Buffer.from("PNG")]);
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 6, "PNG color type must be RGBA");
});

test("default update policy cannot make update requests", async () => {
  // Given: the checked-in updater policy.
  const policy = JSON.parse(await readFile(resolve(desktopDirectory, "src-tauri/update-policy.json"), "utf8"));

  // When / Then: the default package is explicitly offline for updates.
  assert.deepEqual(policy, { enabled: false });
});

test("macOS build is arm64-only and separates optional server and updater trust", async () => {
  // Given: the macOS release script.
  const script = await readFile(resolve(deliveryScriptsDirectory, "build-macos-arm64.sh"), "utf8");

  // When / Then: architecture and remote URL are guarded before packaging.
  assert.match(script, /aarch64-apple-darwin/);
  assert.match(script, /AI_ASSISTANT_DEFAULT_SERVER_ORIGIN/);
  assert.match(script, /AI_UPDATER_ENABLED/);
  assert.match(script, /AI_UPDATER_URL/);
  assert.match(script, /AI_UPDATER_PUBLIC_KEY/);
  assert.doesNotMatch(script, /AI_ASSISTANT_PUBLIC_URL/);
  assert.match(script, /--config src-tauri\/tauri\.generated\.conf\.json -- --locked/);
  assert.match(script, /lipo -archs/);
  assert.match(script, /codesign --verify/);
  assert.match(script, /spctl --assess/);
  assert.match(script, /!\s+-t 0[\s\S]*export CI=true/);
  assert.match(script, /\.dmg/);
  assert.doesNotMatch(script, /universal-apple-darwin|x86_64-apple-darwin/);
});

test("Windows build is x64-only and keeps signing secrets in environment variables", async () => {
  // Given: the Windows release script.
  const script = await readFile(resolve(deliveryScriptsDirectory, "build-windows.ps1"), "utf8");

  // When / Then: the fixed target and environment-only signing inputs are explicit.
  assert.match(script, /x86_64-pc-windows-msvc/);
  assert.match(script, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(script, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(script, /AI_ASSISTANT_DEFAULT_SERVER_ORIGIN/);
  assert.match(script, /AI_UPDATER_ENABLED/);
  assert.match(script, /AI_UPDATER_URL/);
  assert.match(script, /AI_UPDATER_PUBLIC_KEY/);
  assert.doesNotMatch(script, /AI_ASSISTANT_PUBLIC_URL/);
  assert.match(script, /--config src-tauri\/tauri\.generated\.conf\.json -- --locked/);
  assert.match(script, /dumpbin/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /\.msi/);
  assert.match(script, /\.exe/);
  assert.doesNotMatch(script, /Set-Content|Out-File/);
});

test("desktop CI keeps Cargo dependencies locked while bundling", async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/ai-assistant-desktop.yml"),
    "utf8",
  );

  assert.equal(
    workflow.match(/--config src-tauri\/tauri\.generated\.conf\.json -- --locked/g)?.length,
    2,
  );
  assert.doesNotMatch(workflow, /uses:\s*[^\s@]+@v\d+/);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(workflow, /npm exec playwright install chromium/);
  assert.match(workflow, /npm run test:e2e -- e2e\/launcher-flow\.spec\.ts/);
});
