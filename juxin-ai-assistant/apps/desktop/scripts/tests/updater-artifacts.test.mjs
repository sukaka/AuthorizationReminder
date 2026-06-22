import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { collectUpdaterArtifact, createUpdaterManifest } from "../../../../scripts/create-updater-manifest.mjs";

function makeFixture() {
  const dir = join(tmpdir(), `updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return {
    path: dir,
    write: (name, content) => writeFileSync(join(dir, name), content),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("collects signed Tauri updater artifacts, not first-install packages", () => {
  const fixture = makeFixture();
  try {
    const updaterBytes = Buffer.from("signed-updater-bundle");
    const sigBytes = Buffer.from("tauri-signature-content");
    fixture.write("聚信 AI 助手.app.tar.gz", updaterBytes);
    fixture.write("聚信 AI 助手.app.tar.gz.sig", sigBytes);
    fixture.write("聚信 AI 助手_1.0.1_aarch64.dmg", Buffer.from("dmg-content"));

    const result = collectUpdaterArtifact(fixture.path, "darwin-aarch64");

    assert.equal(result.file, "聚信 AI 助手.app.tar.gz");
    assert.equal(result.signature, "tauri-signature-content");
    assert.equal(result.sizeBytes, updaterBytes.length);
    assert.equal(result.sha256.length, 64);
    assert.ok(!result.file.endsWith(".dmg"), "不应收集 DMG 首次安装包");
  } finally {
    fixture.cleanup();
  }
});

test("creates manifest with required fields", () => {
  const fixture = makeFixture();
  try {
    const updaterBytes = Buffer.from("updater-content");
    fixture.write("update.app.tar.gz", updaterBytes);
    fixture.write("update.app.tar.gz.sig", Buffer.from("signature"));

    const manifest = createUpdaterManifest({
      version: "1.0.1",
      channel: "lan-test",
      target: "darwin-aarch64",
      buildDir: fixture.path,
      platformVersion: "5.89.0",
    });

    assert.equal(manifest.agentVersion, "1.0.1");
    assert.equal(manifest.platformVersion, "5.89.0");
    assert.equal(manifest.channel, "lan-test");
    assert.equal(manifest.target, "darwin-aarch64");
    assert.equal(manifest.file, "update.app.tar.gz");
    assert.ok(manifest.sizeBytes > 0);
    assert.equal(manifest.sha256.length, 64);
    assert.equal(manifest.signature, "signature");
  } finally {
    fixture.cleanup();
  }
});

test("rejects missing .sig file", () => {
  const fixture = makeFixture();
  try {
    fixture.write("update.app.tar.gz", Buffer.from("content"));
    assert.throws(() => collectUpdaterArtifact(fixture.path, "darwin-aarch64"), /签名/);
  } finally {
    fixture.cleanup();
  }
});

test("rejects empty signature", () => {
  const fixture = makeFixture();
  try {
    fixture.write("update.app.tar.gz", Buffer.from("content"));
    fixture.write("update.app.tar.gz.sig", Buffer.from(""));
    assert.throws(() => createUpdaterManifest({
      version: "1.0.1",
      channel: "lan-test",
      target: "darwin-aarch64",
      buildDir: fixture.path,
    }), /签名/);
  } finally {
    fixture.cleanup();
  }
});

test("rejects secret-like fields in manifest inputs", () => {
  const fixture = makeFixture();
  try {
    fixture.write("update.app.tar.gz", Buffer.from("content"));
    fixture.write("update.app.tar.gz.sig", Buffer.from("sig"));
    assert.throws(() => createUpdaterManifest({
      version: "1.0.1",
      channel: "lan-test",
      target: "darwin-aarch64",
      buildDir: fixture.path,
      privateKey: "secret-value",
    }), /privateKey/);
  } finally {
    fixture.cleanup();
  }
});

test("rejects invalid SemVer", () => {
  assert.throws(() => createUpdaterManifest({
    version: "1.0",
    channel: "lan-test",
    target: "darwin-aarch64",
    buildDir: "/tmp",
  }), /SemVer/);
});
