#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function buildRemoteConfig(raw) {
  const url = new URL(raw);
  const isExactOrigin = url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.pathname === "/"
    && url.search === ""
    && url.hash === ""
    && !url.hostname.includes("*");
  if (!isExactOrigin) {
    throw new Error("AI_ASSISTANT_PUBLIC_URL 必须是无路径、无凭据、无 wildcard 的 HTTPS origin");
  }
  return {
    windowUrl: url.origin,
    remoteUrls: [`${url.origin}/*`],
    csp: `default-src 'self'; connect-src 'self' ${url.origin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const generated = buildRemoteConfig(process.env.AI_ASSISTANT_PUBLIC_URL ?? "");
    const tauriDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri");
    const tauri = JSON.parse(readFileSync(join(tauriDirectory, "tauri.conf.json"), "utf8"));
    const capability = JSON.parse(readFileSync(join(tauriDirectory, "capabilities/remote-main.json"), "utf8"));
    tauri.app.windows[0].url = generated.windowUrl;
    tauri.app.security.capabilities = ["remote-main-generated"];
    tauri.app.security.csp = generated.csp;
    capability.identifier = "remote-main-generated";
    capability.remote = { urls: generated.remoteUrls };
    writeFileSync(join(tauriDirectory, "tauri.generated.conf.json"), `${JSON.stringify(tauri, null, 2)}\n`);
    writeFileSync(
      join(tauriDirectory, "capabilities/remote-main.generated.json"),
      `${JSON.stringify(capability, null, 2)}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
