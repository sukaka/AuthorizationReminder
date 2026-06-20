import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDesktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export async function readDesktopReleaseMetadata(desktopDirectory = defaultDesktopDirectory) {
  const [tauriSource, cargoSource, packageSource, repositoryPackageSource] = await Promise.all([
    readFile(resolve(desktopDirectory, "src-tauri/tauri.conf.json"), "utf8"),
    readFile(resolve(desktopDirectory, "src-tauri/Cargo.toml"), "utf8"),
    readFile(resolve(desktopDirectory, "package.json"), "utf8"),
    readFile(resolve(desktopDirectory, "../../../package.json"), "utf8"),
  ]);
  const tauriVersion = JSON.parse(tauriSource).version;
  const cargoVersion = cargoSource.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const packageVersion = JSON.parse(packageSource).version;
  const platformVersion = JSON.parse(repositoryPackageSource).version;
  if (!SEMVER_PATTERN.test(tauriVersion ?? "")) {
    throw new Error("Tauri desktop version must be semantic versioning");
  }
  if (cargoVersion !== tauriVersion || packageVersion !== tauriVersion) {
    throw new Error(
      `desktop version mismatch: tauri=${tauriVersion}, cargo=${cargoVersion}, npm=${packageVersion}`,
    );
  }
  if (!SEMVER_PATTERN.test(platformVersion ?? "")) {
    throw new Error("repository platform version must be semantic versioning");
  }
  return { version: tauriVersion, platformVersion };
}
