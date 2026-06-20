#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifactManifest } from "./release-policy.mjs";
import { readDesktopReleaseMetadata } from "./release-metadata.mjs";

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const PE_MACHINE_X64 = 0x8664;
const PE_MACHINE_ARM64 = 0xaa64;
const PE_MACHINE_X86 = 0x014c;

function cpuName(cpuType) {
  if (cpuType === CPU_TYPE_ARM64) return "arm64";
  if (cpuType === CPU_TYPE_X86_64) return "x86_64";
  return `unknown(0x${cpuType.toString(16)})`;
}

export function inspectExecutableArchitecture(bytes) {
  if (bytes.length < 8) throw new Error("architecture evidence is too small");
  const magicBe = bytes.readUInt32BE(0);
  if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magicBe)) {
    throw new Error("Mach-O universal/fat architecture evidence is forbidden");
  }
  const magicLe = bytes.readUInt32LE(0);
  if (magicLe === 0xfeedface || magicLe === 0xfeedfacf) {
    return { format: "Mach-O", arch: cpuName(bytes.readUInt32LE(4)) };
  }
  if (magicBe === 0xfeedface || magicBe === 0xfeedfacf) {
    return { format: "Mach-O", arch: cpuName(bytes.readUInt32BE(4)) };
  }
  if (bytes.subarray(0, 2).toString("ascii") === "MZ") {
    if (bytes.length < 0x40) throw new Error("invalid PE architecture evidence");
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 > bytes.length || bytes.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0") {
      throw new Error("invalid PE architecture evidence");
    }
    const machine = bytes.readUInt16LE(peOffset + 4);
    const arch = machine === PE_MACHINE_X64
      ? "x64"
      : machine === PE_MACHINE_ARM64
        ? "arm64"
        : machine === PE_MACHINE_X86
          ? "x86"
          : `unknown(0x${machine.toString(16)})`;
    return { format: "PE", arch };
  }
  throw new Error("architecture evidence is neither a Mach-O nor PE executable");
}

export async function verifyArtifacts(manifestPath) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const { version, platformVersion } = await readDesktopReleaseMetadata();
  validateArtifactManifest(manifest, {
    expectedVersion: version,
    expectedPlatformVersion: platformVersion,
  });
  const verified = [];
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(dirname(manifestPath), artifact.file));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.sha256) {
      throw new Error(`checksum mismatch for ${artifact.file}`);
    }
    const architectureBytes = await readFile(join(dirname(manifestPath), artifact.architectureFile));
    const architectureDigest = createHash("sha256").update(architectureBytes).digest("hex");
    if (architectureDigest !== artifact.architectureSha256) {
      throw new Error(`architecture evidence checksum mismatch for ${artifact.file}`);
    }
    const actual = inspectExecutableArchitecture(architectureBytes);
    const expectedFormat = artifact.platform === "macos" ? "Mach-O" : "PE";
    if (actual.format !== expectedFormat || actual.arch !== artifact.arch) {
      throw new Error(
        `${expectedFormat} architecture ${actual.arch} does not match required ${artifact.arch} for ${artifact.file}`,
      );
    }
    verified.push(artifact.file);
  }
  return verified;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("Usage: node verify-artifacts.mjs <manifest.json>");
    process.exitCode = 2;
  } else {
    try {
      const verified = await verifyArtifacts(resolve(manifestPath));
      console.log(`Verified ${verified.length} release artifact(s).`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
