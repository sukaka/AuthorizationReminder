import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseBuildMode,
  validateBusinessOrigin,
  validateUpdateEndpoint,
} from "../build-mode.mjs";
import { buildReleaseConfig } from "../render-tauri-config.mjs";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("parseBuildMode accepts only the three fixed build modes", () => {
  assert.equal(parseBuildMode("development"), "development");
  assert.equal(parseBuildMode("lan-test"), "lan-test");
  assert.equal(parseBuildMode("production"), "production");
  assert.throws(() => parseBuildMode("preview"), /build mode/i);
});

test("lan-test package build is a dedicated cross-platform Tauri script", () => {
  assert.equal(
    packageJson.scripts["tauri:build:lan-test"],
    "node scripts/tauri-build.mjs lan-test",
  );
  assert.equal(
    packageJson.scripts["tauri:build:production"],
    "node scripts/tauri-build.mjs production",
  );
});

test("private HTTP builds merge the macOS WebView ATS exception plist only outside production", () => {
  const baseConfig = {
    app: {
      windows: [{ label: "launcher", url: "index.html" }],
      security: {
        capabilities: ["launcher", "workspace"],
        csp: "",
      },
    },
    bundle: {
      macOS: {
        minimumSystemVersion: "11.0",
      },
    },
  };

  const lanTest = buildReleaseConfig(baseConfig, {
    buildMode: "lan-test",
    defaultServerOrigin: "",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });
  assert.equal(lanTest.bundle.macOS.infoPlist, "Info.lan-test.plist");

  const production = buildReleaseConfig(baseConfig, {
    buildMode: "production",
    defaultServerOrigin: "",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });
  assert.equal(production.bundle.macOS.infoPlist, undefined);
});

test("private HTTP business origins are limited to non-production builds", () => {
  for (const origin of [
    "http://localhost:5193",
    "http://127.8.9.10:5193",
    "http://10.2.3.4:5193",
    "http://172.16.0.1:5193",
    "http://172.31.255.254:5193",
    "http://192.168.20.15:5193",
  ]) {
    assert.equal(validateBusinessOrigin(origin, "development"), origin);
    assert.equal(validateBusinessOrigin(origin, "lan-test"), origin);
    assert.throws(() => validateBusinessOrigin(origin, "production"), /HTTPS/i);
  }
});

test("business origins reject unsafe HTTP hosts and non-origin components", () => {
  for (const origin of [
    "http://172.32.0.1:5193",
    "http://100.64.0.1:5193",
    "http://169.254.1.1:5193",
    "http://8.8.8.8:5193",
    "http://127.1:5193",
    "http://2130706433:5193",
    "http://0x7f000001:5193",
    "http://intranet.local:5193",
    "http://192.168.1.20:5193/path",
    "http://192.168.1.20:5193/%2e",
    "http://192.168.1.20:5193/a/..",
    "http://user@192.168.1.20:5193",
    "http://192.168.1.20:5193?tenant=one",
    "http://192.168.1.20:5193#fragment",
    "http://*.example.com:5193",
  ]) {
    assert.throws(() => validateBusinessOrigin(origin, "lan-test"));
  }
});

test("all build modes accept exact HTTPS business origins", () => {
  for (const mode of ["development", "lan-test", "production"]) {
    assert.equal(
      validateBusinessOrigin("https://ai.example.com", mode),
      "https://ai.example.com",
    );
  }
});

test("update endpoints follow the same scheme policy while allowing a file path", () => {
  const privateEndpoint = "http://192.168.20.15:5193/updates/latest.json";
  assert.equal(
    validateUpdateEndpoint(privateEndpoint, "lan-test"),
    privateEndpoint,
  );
  const templatedEndpoint =
    "http://192.168.20.15:5193/updates/{{target}}/{{arch}}/latest.json";
  assert.equal(
    validateUpdateEndpoint(templatedEndpoint, "lan-test"),
    templatedEndpoint,
  );
  assert.throws(
    () => validateUpdateEndpoint(privateEndpoint, "production"),
    /HTTPS/i,
  );
  assert.equal(
    validateUpdateEndpoint(
      "https://updates.example.com/latest.json",
      "production",
    ),
    "https://updates.example.com/latest.json",
  );
  for (const unsafe of [
    "http://updates.local/latest.json",
    "https://user@updates.example.com/latest.json",
    "https://updates.example.com/*.json",
    "https://updates.example.com/latest.json#fragment",
  ]) {
    assert.throws(() => validateUpdateEndpoint(unsafe, "lan-test"));
  }
});
