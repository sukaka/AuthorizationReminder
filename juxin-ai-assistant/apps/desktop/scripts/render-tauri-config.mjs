#!/usr/bin/env node
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'";

function validateDefaultServerOrigin(raw, buildMode) {
  if (raw === "") return;
  const url = new URL(raw);
  const isLanTest = buildMode === "lan-test";
  const isDevelopment = buildMode === "development";
  const allowsHttp = isLanTest || isDevelopment;

  const protocolOk = allowsHttp
    ? (url.protocol === "https:" || url.protocol === "http:")
    : url.protocol === "https:";

  const isExactOrigin = /^https?:\/\/[^/?#]+\/?$/u.test(raw)
    && protocolOk
    && url.username === ""
    && url.password === ""
    && url.pathname === "/"
    && url.search === ""
    && url.hash === ""
    && !url.hostname.includes("*");
  if (!isExactOrigin) {
    const protocolWord = allowsHttp ? "无路径、无凭据、无 wildcard 的 HTTP/HTTPS origin" : "无路径、无凭据、无 wildcard 的 HTTPS origin";
    throw new Error(`AI_ASSISTANT_DEFAULT_SERVER_ORIGIN 必须是${protocolWord}`);
  }
}

function validateUpdaterEndpoint(raw, buildMode) {
  const url = new URL(raw);
  const isLanTest = buildMode === "lan-test";
  const isDevelopment = buildMode === "development";
  const allowsHttp = isLanTest || isDevelopment;
  const protocolOk = allowsHttp
    ? (url.protocol === "https:" || url.protocol === "http:")
    : url.protocol === "https:";
  const isSecure = protocolOk
    && url.hostname !== ""
    && url.username === ""
    && url.password === ""
    && url.hash === ""
    && !raw.includes("*");
  if (!isSecure) {
    const protocolWord = allowsHttp ? "无凭据、无 wildcard 的 HTTP/HTTPS 地址" : "无凭据、无 wildcard 的 HTTPS 地址";
    throw new Error(`AI_UPDATER_URL 必须是${protocolWord}`);
  }
}

export function buildReleaseConfig(baseConfig, inputs) {
  const buildMode = inputs.buildMode ?? "production";
  if (!["development", "lan-test", "production"].includes(buildMode)) {
    throw new Error("buildMode 必须是 development、lan-test 或 production");
  }
  const isLanTest = buildMode === "lan-test";
  const isDevelopment = buildMode === "development";
  const allowsPrivateHttp = isLanTest || isDevelopment;

  validateDefaultServerOrigin(inputs.defaultServerOrigin, buildMode);
  if (inputs.updaterEnabled !== "true" && inputs.updaterEnabled !== "false") {
    throw new Error("AI_UPDATER_ENABLED 只能为 true 或 false");
  }

  const config = structuredClone(baseConfig);
  config.app.windows = [{
    ...config.app.windows[0],
    label: "launcher",
    url: "index.html",
  }];

  // Capabilities: production gets launcher+workspace only; test/dev also get private HTTP
  config.app.security.capabilities = allowsPrivateHttp
    ? ["launcher", "workspace", "workspace-private-http"]
    : ["launcher", "workspace"];
  config.app.security.csp = LOCAL_CSP;
  if (!config.bundle.macOS) config.bundle.macOS = {};
  if (allowsPrivateHttp) {
    config.bundle.macOS.infoPlist = "Info.lan-test.plist";
  } else {
    delete config.bundle.macOS.infoPlist;
  }
  config.bundle.createUpdaterArtifacts = inputs.updaterEnabled === "true";

  if (inputs.updaterEnabled === "true") {
    validateUpdaterEndpoint(inputs.updaterEndpoint, buildMode);
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
    const buildMode = process.env.AI_ASSISTANT_BUILD_MODE ?? "production";
    const generated = buildReleaseConfig(baseConfig, {
      buildMode,
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
