#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { parseBuildMode } from "./build-mode.mjs";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: desktopDirectory,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function maybeReexecNativeArm64(mode, rest, env) {
  if (
    process.platform !== "darwin" ||
    process.arch === "arm64" ||
    env.JUXIN_TAURI_BUILD_REEXEC === "1"
  ) {
    return;
  }
  let isArm64Mac = false;
  try {
    isArm64Mac =
      execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], {
        encoding: "utf8",
      }).trim() === "1";
  } catch {
    return;
  }
  const homebrewNode = "/opt/homebrew/bin/node";
  if (isArm64Mac && existsSync(homebrewNode)) {
    run(
      "/usr/bin/arch",
      [
        "-arm64",
        homebrewNode,
        fileURLToPath(import.meta.url),
        mode,
        ...rest,
      ],
      { ...env, JUXIN_TAURI_BUILD_REEXEC: "1" },
    );
  }
}

const [rawMode, ...rest] = process.argv.slice(2);
const mode = parseBuildMode(rawMode ?? "production");
const env = {
  ...process.env,
  AI_ASSISTANT_BUILD_MODE: mode,
  VITE_AI_ASSISTANT_BUILD_MODE: mode,
};

maybeReexecNativeArm64(mode, rest, env);

const renderConfig = spawnSync(
  process.execPath,
  [join("scripts", "render-tauri-config.mjs")],
  {
    cwd: desktopDirectory,
    env,
    stdio: "inherit",
  },
);
if (renderConfig.error) throw renderConfig.error;
if (renderConfig.status !== 0) process.exit(renderConfig.status ?? 1);

run(
  process.execPath,
  [
    join("node_modules", "@tauri-apps", "cli", "tauri.js"),
    "build",
    "--config",
    join("src-tauri", "tauri.generated.conf.json"),
    ...rest,
  ],
  env,
);
