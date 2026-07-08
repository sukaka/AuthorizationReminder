import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyArtifacts } from "../verify-artifacts.mjs";
import { readDesktopReleaseMetadata } from "../release-metadata.mjs";

const releaseMetadata = await readDesktopReleaseMetadata();

function machO64(cpuType) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpuType, 4);
  return bytes;
}

function pe64(machine) {
  const bytes = Buffer.alloc(0x90);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "binary");
  bytes.writeUInt16LE(machine, 0x84);
  return bytes;
}

test("artifact verifier checks manifest files and SHA256 digests", async () => {
  // Given: an artifact and a matching manifest in a temporary release directory.
  const directory = await mkdtemp(join(tmpdir(), "juxin-release-"));
  const file = `Juxin.AI.Assistant_${releaseMetadata.version}_aarch64.dmg`;
  const architectureFile = "juxin-ai-assistant-macos";
  const bytes = Buffer.from("release-artifact");
  const architectureBytes = machO64(0x0100000c);
  await writeFile(join(directory, file), bytes);
  await writeFile(join(directory, architectureFile), architectureBytes);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    platformVersion: releaseMetadata.platformVersion,
    version: releaseMetadata.version,
    artifacts: [{
      file,
      platform: "macos",
      arch: "arm64",
      architectureFile,
      architectureSha256: createHash("sha256").update(architectureBytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
  }));

  // When: the release directory is verified.
  const verified = await verifyArtifacts(join(directory, "manifest.json"));

  // Then: the verifier reports the checked artifact.
  assert.deepEqual(verified, [file]);
});

test("artifact verifier rejects a checksum mismatch", async () => {
  // Given: an artifact whose manifest digest is incorrect.
  const directory = await mkdtemp(join(tmpdir(), "juxin-release-"));
  const file = `Juxin.AI.Assistant_${releaseMetadata.version}_x64-setup.exe`;
  const bytes = pe64(0x8664);
  await writeFile(join(directory, file), bytes);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    platformVersion: releaseMetadata.platformVersion,
    version: releaseMetadata.version,
    artifacts: [{
      file,
      platform: "windows",
      arch: "x64",
      architectureFile: file,
      architectureSha256: createHash("sha256").update(bytes).digest("hex"),
      sha256: "a".repeat(64),
    }],
  }));

  // When / Then: verification blocks the release.
  await assert.rejects(() => verifyArtifacts(join(directory, "manifest.json")), /checksum mismatch/i);
});

test("artifact verifier rejects a manifest that lies about a Mach-O architecture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "juxin-release-"));
  const file = `Juxin.AI.Assistant_${releaseMetadata.version}_aarch64.dmg`;
  const architectureFile = "juxin-ai-assistant-macos";
  const bytes = Buffer.from("release-artifact");
  const architectureBytes = machO64(0x01000007);
  await writeFile(join(directory, file), bytes);
  await writeFile(join(directory, architectureFile), architectureBytes);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    platformVersion: releaseMetadata.platformVersion,
    version: releaseMetadata.version,
    artifacts: [{
      file,
      platform: "macos",
      arch: "arm64",
      architectureFile,
      architectureSha256: createHash("sha256").update(architectureBytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
  }));

  await assert.rejects(() => verifyArtifacts(join(directory, "manifest.json")), /Mach-O.*x86_64.*arm64/i);
});

test("artifact verifier rejects a manifest that lies about a PE architecture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "juxin-release-"));
  const file = `Juxin.AI.Assistant_${releaseMetadata.version}_x64-setup.exe`;
  const bytes = pe64(0xaa64);
  await writeFile(join(directory, file), bytes);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    platformVersion: releaseMetadata.platformVersion,
    version: releaseMetadata.version,
    artifacts: [{
      file,
      platform: "windows",
      arch: "x64",
      architectureFile: file,
      architectureSha256: createHash("sha256").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
  }));

  await assert.rejects(() => verifyArtifacts(join(directory, "manifest.json")), /PE.*arm64.*x64/i);
});
