#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STABLE_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CARGO_PACKAGE_NAME = "juxin-ai-assistant";

const assertStableSemver = (version) => {
  if (!STABLE_SEMVER_RE.test(String(version ?? ""))) {
    throw new Error(`版本号必须是稳定三段 SemVer：${version}`);
  }
  return version;
};

export const bumpAgentVersion = (version, bumpType) => {
  assertStableSemver(version);
  const [major, minor, patchVersion] = version.split(".").map(Number);
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  if (bumpType === "patch") return `${major}.${minor}.${patchVersion + 1}`;
  throw new Error(`不支持的 Agent 版本升级级别：${bumpType}`);
};

export const parseAgentVersionArgs = (args) => {
  if (args.length === 1 && ["major", "minor", "patch"].includes(args[0])) {
    return { bumpType: args[0] };
  }
  if (args.length === 2 && args[0] === "--set") {
    assertStableSemver(args[1]);
    return { setVersion: args[1] };
  }
  throw new Error("用法：agent-version.mjs major|minor|patch，或 agent-version.mjs --set 1.2.3");
};

const parseJson = (text, relativePath) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${relativePath} 不是有效 JSON：${error.message}`);
  }
};

const findCargoLockPackage = (text) => {
  const sections = text.split(/(?=^\[\[package\]\]\s*$)/m);
  const index = sections.findIndex((section) => (
    new RegExp(`^name\\s*=\\s*"${CARGO_PACKAGE_NAME}"\\s*$`, "m").test(section)
  ));
  if (index < 0) {
    throw new Error(`Cargo.lock 缺少 ${CARGO_PACKAGE_NAME} package`);
  }
  const match = sections[index].match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error(`Cargo.lock 的 ${CARGO_PACKAGE_NAME} package 缺少 version`);
  }
  return { sections, index, version: match[1] };
};

const replaceManifestVersion = (text, nextVersion, relativePath) => {
  const match = text.match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) throw new Error(`${relativePath} 缺少 version`);
  return text.replace(
    /^version\s*=\s*"[^"]+"\s*$/m,
    `version = "${nextVersion}"`,
  );
};

const writeAtomically = async (updates) => {
  const temporaryFiles = [];
  const replacedFiles = [];
  try {
    for (const update of updates) {
      const temporaryPath = `${update.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(temporaryPath, update.content, "utf8");
      temporaryFiles.push({ ...update, temporaryPath });
    }
    for (const update of temporaryFiles) {
      await rename(update.temporaryPath, update.filePath);
      replacedFiles.push(update);
    }
  } catch (error) {
    try {
      for (const update of replacedFiles.reverse()) {
        const rollbackPath = `${update.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.rollback`;
        temporaryFiles.push({ temporaryPath: rollbackPath });
        await writeFile(rollbackPath, update.original, "utf8");
        await rename(rollbackPath, update.filePath);
      }
    } catch (rollbackError) {
      throw new Error(`${error.message}；回滚 Agent 版本文件失败：${rollbackError.message}`);
    }
    throw error;
  } finally {
    await Promise.all(temporaryFiles.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
  }
};

export const syncAgentVersion = async ({ desktopDir, bumpType, setVersion }) => {
  const relativePaths = [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ];
  const filePaths = relativePaths.map((relativePath) => path.join(desktopDir, relativePath));
  const originals = await Promise.all(filePaths.map((filePath) => readFile(filePath, "utf8")));

  const packageJson = parseJson(originals[0], relativePaths[0]);
  const packageLock = parseJson(originals[1], relativePaths[1]);
  const tauriConfig = parseJson(originals[4], relativePaths[4]);
  const cargoTomlVersion = originals[2].match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!cargoTomlVersion) throw new Error("src-tauri/Cargo.toml 缺少 version");
  const cargoLockPackage = findCargoLockPackage(originals[3]);

  const currentVersion = assertStableSemver(packageJson.version);
  const versions = {
    "package.json": currentVersion,
    "package-lock.json": packageLock.version,
    "package-lock.json packages root": packageLock.packages?.[""]?.version,
    "src-tauri/Cargo.toml": cargoTomlVersion,
    "src-tauri/Cargo.lock": cargoLockPackage.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
  };
  for (const [source, version] of Object.entries(versions)) {
    assertStableSemver(version);
    if (version !== currentVersion) {
      throw new Error(`Agent 版本不一致：${source}=${version}，package.json=${currentVersion}`);
    }
  }

  const nextVersion = setVersion
    ? assertStableSemver(setVersion)
    : bumpAgentVersion(currentVersion, bumpType);
  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  packageLock.packages[""].version = nextVersion;
  cargoLockPackage.sections[cargoLockPackage.index] = cargoLockPackage.sections[
    cargoLockPackage.index
  ].replace(/^version\s*=\s*"[^"]+"\s*$/m, `version = "${nextVersion}"`);

  const contents = [
    `${JSON.stringify(packageJson, null, 2)}\n`,
    `${JSON.stringify(packageLock, null, 2)}\n`,
    replaceManifestVersion(originals[2], nextVersion, relativePaths[2]),
    cargoLockPackage.sections.join(""),
    originals[4].replace(
      /("version"\s*:\s*")[^"]+(")/,
      `$1${nextVersion}$2`,
    ),
  ];
  const updates = filePaths
    .map((filePath, index) => ({
      filePath,
      content: contents[index],
      original: originals[index],
    }))
    .filter((update, index) => update.content !== originals[index]);
  await writeAtomically(updates);

  return {
    currentVersion,
    nextVersion,
    changedFiles: updates.map(({ filePath }) => path.relative(desktopDir, filePath)),
  };
};

const main = async () => {
  const options = parseAgentVersionArgs(process.argv.slice(2));
  const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await syncAgentVersion({ desktopDir, ...options });
  console.log(`[agent-version] ${result.currentVersion} -> ${result.nextVersion}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[agent-version] ${error.message}`);
    process.exitCode = 1;
  });
}
