import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bumpAgentVersion,
  parseAgentVersionArgs,
  syncAgentVersion,
} from "../agent-version.mjs";

const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const createDesktopFixture = async (version = "1.0.0") => {
  const desktopDir = await mkdtemp(path.join(os.tmpdir(), "agent-version-"));
  await mkdir(path.join(desktopDir, "src-tauri"), { recursive: true });
  await writeJson(path.join(desktopDir, "package.json"), {
    name: "juxin-ai-assistant-desktop",
    version,
  });
  await writeJson(path.join(desktopDir, "package-lock.json"), {
    name: "juxin-ai-assistant-desktop",
    version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: "juxin-ai-assistant-desktop",
        version,
      },
    },
  });
  await writeFile(
    path.join(desktopDir, "src-tauri/Cargo.toml"),
    `[package]\nname = "juxin-ai-assistant"\nversion = "${version}"\nedition = "2021"\n`,
  );
  await writeFile(
    path.join(desktopDir, "src-tauri/Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "dependency"\nversion = "9.9.9"\n\n[[package]]\nname = "juxin-ai-assistant"\nversion = "${version}"\ndependencies = []\n`,
  );
  await writeJson(path.join(desktopDir, "src-tauri/tauri.conf.json"), {
    productName: "聚信 AI 助手",
    version,
  });
  return desktopDir;
};

const readVersions = async (desktopDir) => {
  const packageJson = await readJson(path.join(desktopDir, "package.json"));
  const packageLock = await readJson(path.join(desktopDir, "package-lock.json"));
  const cargoToml = await readFile(path.join(desktopDir, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = await readFile(path.join(desktopDir, "src-tauri/Cargo.lock"), "utf8");
  const tauri = await readJson(path.join(desktopDir, "src-tauri/tauri.conf.json"));
  return {
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages[""].version,
    cargoToml: cargoToml.match(/^version = "([^"]+)"/m)?.[1],
    cargoLock: cargoLock.match(
      /\[\[package\]\]\nname = "juxin-ai-assistant"\nversion = "([^"]+)"/,
    )?.[1],
    tauri: tauri.version,
    cargoLockText: cargoLock,
  };
};

test("standard stable SemVer bump and --set arguments are supported", () => {
  assert.equal(bumpAgentVersion("1.2.3", "major"), "2.0.0");
  assert.equal(bumpAgentVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpAgentVersion("1.2.3", "patch"), "1.2.4");
  assert.deepEqual(parseAgentVersionArgs(["--set", "3.4.5"]), { setVersion: "3.4.5" });
  assert.throws(() => parseAgentVersionArgs(["--set", "1.0.0-beta.1"]), /稳定三段 SemVer/);
  assert.throws(() => parseAgentVersionArgs(["--set", "01.0.0"]), /稳定三段 SemVer/);
});

test("package.json is the source used to atomically synchronize all five agent version files", async () => {
  const desktopDir = await createDesktopFixture("1.2.3");

  const result = await syncAgentVersion({ desktopDir, bumpType: "minor" });
  const versions = await readVersions(desktopDir);

  assert.equal(result.currentVersion, "1.2.3");
  assert.equal(result.nextVersion, "1.3.0");
  assert.deepEqual(
    {
      packageJson: versions.packageJson,
      packageLock: versions.packageLock,
      packageLockRoot: versions.packageLockRoot,
      cargoToml: versions.cargoToml,
      cargoLock: versions.cargoLock,
      tauri: versions.tauri,
    },
    {
      packageJson: "1.3.0",
      packageLock: "1.3.0",
      packageLockRoot: "1.3.0",
      cargoToml: "1.3.0",
      cargoLock: "1.3.0",
      tauri: "1.3.0",
    },
  );
  assert.match(versions.cargoLockText, /name = "dependency"\nversion = "9\.9\.9"/);
});

test("inconsistent input aborts before any version file is changed", async () => {
  const desktopDir = await createDesktopFixture("1.2.3");
  const tauriPath = path.join(desktopDir, "src-tauri/tauri.conf.json");
  const tauri = await readJson(tauriPath);
  tauri.version = "1.2.2";
  await writeJson(tauriPath, tauri);
  const before = await Promise.all([
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ].map((relativePath) => readFile(path.join(desktopDir, relativePath), "utf8")));

  await assert.rejects(
    syncAgentVersion({ desktopDir, bumpType: "patch" }),
    /版本不一致/,
  );

  const after = await Promise.all([
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ].map((relativePath) => readFile(path.join(desktopDir, relativePath), "utf8")));
  assert.deepEqual(after, before);
});
