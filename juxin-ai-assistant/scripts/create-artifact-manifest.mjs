#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readDesktopReleaseMetadata } from "../apps/desktop/scripts/release-metadata.mjs";

const RELEASE_EXTENSIONS = new Set([".dmg", ".exe", ".msi"]);

export async function createArtifactManifest(directory, platform, requestedArchitectureFile) {
  if (platform !== "macos" && platform !== "windows") {
    throw new Error("platform must be macos or windows");
  }
  const names = await readdir(directory);
  const files = names.filter((name) => {
    const dot = name.lastIndexOf(".");
    return dot >= 0 && RELEASE_EXTENSIONS.has(name.slice(dot));
  });
  if (files.length === 0) throw new Error("no release artifacts found");
  const architectureFile = requestedArchitectureFile
    ?? (platform === "macos"
      ? names.find((name) => name.endsWith(".macho"))
      : names.find((name) => name.endsWith(".exe")));
  if (!architectureFile || architectureFile !== architectureFile.split(/[\\/]/).pop()) {
    throw new Error("a flat Mach-O/PE architecture evidence file is required");
  }
  const architectureBytes = await readFile(join(directory, architectureFile));
  const architectureSha256 = createHash("sha256").update(architectureBytes).digest("hex");
  const { version, platformVersion } = await readDesktopReleaseMetadata();
  const artifacts = await Promise.all(files.map(async (file) => ({
    file,
    platform,
    arch: platform === "macos" ? "arm64" : "x64",
    architectureFile,
    architectureSha256,
    sha256: createHash("sha256").update(await readFile(join(directory, file))).digest("hex"),
  })));
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({ platformVersion, version, artifacts }, null, 2)}\n`);
  return manifestPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifestPath = await createArtifactManifest(
      resolve(process.argv[2]),
      process.argv[3],
      process.argv[4],
    );
    console.log(manifestPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
