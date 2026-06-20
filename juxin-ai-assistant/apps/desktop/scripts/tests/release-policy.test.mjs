import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUpdatePolicy,
  validateArtifactManifest,
} from "../release-policy.mjs";

test("update policy remains disabled when every setting is absent", () => {
  // Given: the default packaged application has no updater settings.
  const input = {};

  // When: the effective policy is resolved.
  const policy = resolveUpdatePolicy(input);

  // Then: no update request is permitted.
  assert.deepEqual(policy, { enabled: false, mayRequestUpdates: false });
});

test("update policy permits requests only with enabled HTTPS endpoint and public key", () => {
  // Given: all required updater settings are present.
  const input = {
    enabled: true,
    endpoint: "https://updates.example.com/juxin/{{target}}/{{arch}}/latest.json",
    publicKey: "PUBLIC-KEY",
  };

  // When: the effective policy is resolved.
  const policy = resolveUpdatePolicy(input);

  // Then: update requests are permitted.
  assert.deepEqual(policy, {
    enabled: true,
    mayRequestUpdates: true,
    endpoint: input.endpoint,
    publicKey: input.publicKey,
  });
});

for (const invalid of [
  { enabled: true },
  { enabled: true, endpoint: "http://updates.example.com/latest.json", publicKey: "key" },
  { enabled: true, endpoint: "https://updates.example.com/latest.json" },
]) {
  test(`update policy rejects incomplete enabled settings: ${JSON.stringify(invalid)}`, () => {
    // Given: updater was enabled without a complete secure configuration.
    // When / Then: policy parsing rejects the invalid state.
    assert.throws(() => resolveUpdatePolicy(invalid), /enabled updater requires/i);
  });
}

test("artifact manifest accepts arm64 macOS and x64 Windows release files", () => {
  // Given: a complete cross-platform release manifest.
  const manifest = {
    platformVersion: "5.87.0",
    version: "1.0.0",
    artifacts: [
      {
        file: "Juxin.AI.Assistant_1.0.0_aarch64.dmg",
        platform: "macos",
        arch: "arm64",
        architectureFile: "juxin-ai-assistant-arm64.macho",
        architectureSha256: "c".repeat(64),
        sha256: "a".repeat(64),
      },
      {
        file: "Juxin.AI.Assistant_1.0.0_x64-setup.exe",
        platform: "windows",
        arch: "x64",
        architectureFile: "Juxin.AI.Assistant_1.0.0_x64-setup.exe",
        architectureSha256: "d".repeat(64),
        sha256: "b".repeat(64),
      },
    ],
  };

  // When / Then: the manifest satisfies the release contract.
  assert.doesNotThrow(() => validateArtifactManifest(manifest));
});

const architectureEvidence = {
  architectureFile: "architecture-evidence.bin",
  architectureSha256: "c".repeat(64),
};

for (const [description, artifact, expected] of [
  ["Intel macOS", { ...architectureEvidence, file: "Juxin.AI.Assistant_1.0.0_x64.dmg", platform: "macos", arch: "x64", sha256: "a".repeat(64) }, /macOS.*arm64/i],
  ["universal macOS", { ...architectureEvidence, file: "Juxin.AI.Assistant_1.0.0_universal.dmg", platform: "macos", arch: "universal", sha256: "a".repeat(64) }, /macOS.*arm64/i],
  ["arm Windows", { ...architectureEvidence, file: "Juxin.AI.Assistant_1.0.0_arm64-setup.exe", platform: "windows", arch: "arm64", sha256: "a".repeat(64) }, /Windows.*x64/i],
  ["unexpected extension", { ...architectureEvidence, file: "Juxin.AI.Assistant_1.0.0_aarch64.zip", platform: "macos", arch: "arm64", sha256: "a".repeat(64) }, /extension/i],
  ["missing checksum", { ...architectureEvidence, file: "Juxin.AI.Assistant_1.0.0_aarch64.dmg", platform: "macos", arch: "arm64" }, /SHA256/i],
]) {
  test(`artifact manifest rejects ${description}`, () => {
    // Given: a manifest with one forbidden artifact.
    const manifest = { platformVersion: "5.87.0", version: "1.0.0", artifacts: [artifact] };

    // When / Then: validation rejects it with the relevant reason.
    assert.throws(() => validateArtifactManifest(manifest), expected);
  });
}

test("artifact manifest rejects secret-like fields", () => {
  // Given: a manifest accidentally containing signing material.
  const manifest = {
    platformVersion: "5.87.0",
    version: "1.0.0",
    token: "must-not-leak",
    artifacts: [],
  };

  // When / Then: validation blocks publication.
  assert.throws(() => validateArtifactManifest(manifest), /secret-like field/i);
});
