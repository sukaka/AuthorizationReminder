#!/usr/bin/env node
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

function validateDefaultServerOrigin(raw) {
  if (raw === "") return;
  const url = new URL(raw);
  const isExactOrigin = /^https:\/\/[^/?#]+\/?$/u.test(raw)
    && url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.pathname === "/"
    && url.search === ""
    && url.hash === ""
    && !url.hostname.includes("*");
  if (!isExactOrigin) {
    throw new Error("AI_ASSISTANT_DEFAULT_SERVER_ORIGIN 必须是无路径、无凭据、无 wildcard 的 HTTPS origin");
  }
}

function validateUpdaterEndpoint(raw) {
  const url = new URL(raw);
  const isSecure = url.protocol === "https:"
    && url.hostname !== ""
    && url.username === ""
    && url.password === ""
    && url.hash === ""
    && !raw.includes("*");
  if (!isSecure) {
    throw new Error("AI_UPDATER_URL 必须是无凭据、无 wildcard 的 HTTPS 地址");
  }
}

export function buildReleaseConfig(baseConfig, inputs) {
  validateDefaultServerOrigin(inputs.defaultServerOrigin);
  if (inputs.updaterEnabled !== "true" && inputs.updaterEnabled !== "false") {
    throw new Error("AI_UPDATER_ENABLED 只能为 true 或 false");
  }

  const config = structuredClone(baseConfig);
  config.app.windows = [{
    ...config.app.windows[0],
    label: "launcher",
    url: "index.html",
  }];
  config.app.security.capabilities = ["launcher", "workspace"];
  config.app.security.csp = LOCAL_CSP;
  config.bundle.createUpdaterArtifacts = inputs.updaterEnabled === "true";

  if (inputs.updaterEnabled === "true") {
    validateUpdaterEndpoint(inputs.updaterEndpoint);
    if (inputs.updaterPublicKey.trim() === "") {
      throw new Error("AI_UPDATER_PUBLIC_KEY 不能为空");
    }
    config.plugins = {
      ...config.plugins,
      updater: {
        endpoints: [inputs.updaterEndpoint],
        pubkey: inputs.updaterPublicKey,
      },
    };
  } else if (config.plugins) {
    delete config.plugins.updater;
    if (Object.keys(config.plugins).length === 0) delete config.plugins;
  }

  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tauriDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri");
    const baseConfig = JSON.parse(readFileSync(join(tauriDirectory, "tauri.conf.json"), "utf8"));
    const generated = buildReleaseConfig(baseConfig, {
      defaultServerOrigin: process.env.AI_ASSISTANT_DEFAULT_SERVER_ORIGIN ?? "",
      updaterEnabled: process.env.AI_UPDATER_ENABLED ?? "false",
      updaterEndpoint: process.env.AI_UPDATER_URL ?? "",
      updaterPublicKey: process.env.AI_UPDATER_PUBLIC_KEY ?? "",
    });
    rmSync(
      join(tauriDirectory, "capabilities/remote-main.generated.json"),
      { force: true },
    );
    writeFileSync(
      join(tauriDirectory, "tauri.generated.conf.json"),
      `${JSON.stringify(generated, null, 2)}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
