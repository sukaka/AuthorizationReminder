import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createArtifactManifest } from "../../../../scripts/create-artifact-manifest.mjs";
import { readDesktopReleaseMetadata } from "../release-metadata.mjs";

const releaseMetadata = await readDesktopReleaseMetadata();

test("manifest generator records version architecture and SHA256 without secrets", async () => {
  // Given: a flat directory containing one macOS arm64 release artifact.
  const directory = await mkdtemp(join(tmpdir(), "juxin-manifest-"));
  await writeFile(
    join(directory, `聚信 AI 助手_${releaseMetadata.version}_aarch64.dmg`),
    "artifact",
  );
  const executable = Buffer.alloc(32);
  executable.writeUInt32LE(0xfeedfacf, 0);
  executable.writeUInt32LE(0x0100000c, 4);
  await writeFile(join(directory, "juxin-ai-assistant-arm64.macho"), executable);

  // When: a manifest is generated for the macOS release.
  const manifestPath = await createArtifactManifest(directory, "macos");

  // Then: the manifest is complete, publishable, and contains no signing input.
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, releaseMetadata.version);
  assert.equal(manifest.platformVersion, releaseMetadata.platformVersion);
  assert.equal(manifest.artifacts[0].platform, "macos");
  assert.equal(manifest.artifacts[0].arch, "arm64");
  assert.equal(manifest.artifacts[0].architectureFile, "juxin-ai-assistant-arm64.macho");
  assert.match(manifest.artifacts[0].architectureSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(manifest), /secret|private.?key|token/i);
});
