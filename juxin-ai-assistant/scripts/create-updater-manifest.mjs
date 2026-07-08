#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const TARGET_EXTENSIONS = {
  "darwin-aarch64": ".app.tar.gz",
  "darwin-x86_64": ".app.tar.gz",
  "windows-x86_64": ".nsis.zip",
};

const SECRET_FIELD_NAMES = new Set([
  "privateKey",
  "private_key",
  "secret",
  "token",
  "password",
  "apiKey",
  "api_key",
]);

/**
 * Collect the latest signed Tauri updater artifact and its .sig file
 * from a build output directory.
 */
export function collectUpdaterArtifact(buildDir, target) {
  const expectedExt = TARGET_EXTENSIONS[target];
  if (!expectedExt) {
    throw new Error(`不支持的平台目标: ${target}`);
  }

  const files = readdirSync(buildDir).filter((name) => name.endsWith(expectedExt));
  if (files.length === 0) {
    throw new Error(`未找到 ${target} 更新产物（${expectedExt}）`);
  }

  // Find the first file that also has a .sig file
  for (const file of files) {
    const sigFile = `${file}.sig`;
    if (!files.includes(sigFile) && !readdirSync(buildDir).includes(sigFile)) {
      const sigPath = join(buildDir, sigFile);
      try {
        statSync(sigPath);
      } catch {
        continue;
      }
    }
    const filePath = join(buildDir, file);
    const sigPath = join(buildDir, `${file}.sig`);

    if (!file.endsWith(".dmg") && !file.endsWith(".msi")) {
      const fileBytes = readFileSync(filePath);
      const sigBytes = readFileSync(sigPath);
      const sha256 = createHash("sha256").update(fileBytes).digest("hex");

      return {
        file: file,
        sizeBytes: fileBytes.length,
        sha256,
        signature: sigBytes.toString("utf8").trim(),
      };
    }
  }

  throw new Error(`未找到带签名的 ${target} Tauri 更新产物`);
}

/**
 * Create an updater manifest for upload to the admin API.
 */
export function createUpdaterManifest(inputs) {
  const { version, channel, target, buildDir, platformVersion } = inputs;

  if (!version || !channel || !target || !buildDir) {
    throw new Error("version、channel、target 和 buildDir 均为必填项");
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("version 必须是三段 SemVer");
  }

  // Reject secret-like fields
  for (const key of Object.keys(inputs)) {
    if (SECRET_FIELD_NAMES.has(key)) {
      throw new Error(`清单不得包含 ${key} 字段`);
    }
  }

  const artifact = collectUpdaterArtifact(buildDir, target);

  if (!artifact.signature || artifact.signature.length === 0) {
    throw new Error("Tauri 更新签名不能为空");
  }

  return {
    agentVersion: version,
    platformVersion: platformVersion ?? "",
    channel,
    target,
    file: artifact.file,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    signature: artifact.signature,
  };
}

if (process.argv[1] && process.argv[1].endsWith("create-updater-manifest.mjs")) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error("用法: node create-updater-manifest.mjs <version> <channel> <target> <buildDir> [platformVersion]");
    process.exit(1);
  }
  try {
    const manifest = createUpdaterManifest({
      version: args[0],
      channel: args[1],
      target: args[2],
      buildDir: args[3],
      platformVersion: args[4] ?? "",
    });
    console.log(JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
