import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReleaseConfig } from "../render-tauri-config.mjs";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("desktop runtime registers single-instance before lifecycle setup", async () => {
  // Given: the Tauri runtime source and dependency manifest.
  const source = await readFile(resolve(desktopDirectory, "src-tauri/src/lib.rs"), "utf8");
  const cargo = await readFile(resolve(desktopDirectory, "src-tauri/Cargo.toml"), "utf8");

  // When / Then: the official plugin is present and registered first.
  assert.match(cargo, /tauri-plugin-single-instance/);
  const plugin = source.indexOf("tauri_plugin_single_instance::init");
  const setup = source.indexOf(".setup(");
  assert.ok(plugin >= 0 && setup > plugin);
});

test("workspace capability contains only approved desktop commands", async () => {
  // Given: the tracked dynamic-workspace capability.
  const capability = JSON.parse(await readFile(
    resolve(desktopDirectory, "src-tauri/capabilities/workspace.json"),
    "utf8",
  ));

  // When / Then: broad system permissions cannot enter the remote workbench.
  const serialized = JSON.stringify(capability);
  assert.doesNotMatch(serialized, /shell:|fs:|process:|clipboard-read|updater:/);
  for (const permission of [
    "allow-workspace-ready",
    "allow-workspace-status",
    "allow-workspace-close",
    "allow-local-session-bind",
    "allow-local-draft-save",
    "allow-local-draft-load",
    "allow-local-draft-delete",
    "allow-local-queue-push",
    "allow-local-queue-list",
    "allow-local-queue-remove",
    "allow-local-cache-clear",
    "allow-local-logout",
    "allow-model-profile-list",
    "allow-model-profile-upsert",
    "allow-model-profile-delete",
    "allow-model-profile-set-default",
    "allow-model-profile-test",
    "allow-model-generate",
    "allow-model-cancel",
    "allow-update-status",
    "allow-update-check",
    "allow-update-download-and-install",
    "allow-update-cancel",
    "allow-update-defer",
  ]) {
    assert.ok(capability.permissions.includes(permission), permission);
  }
  assert.ok(!capability.permissions.includes("core:default"));

  const runtime = await readFile(resolve(desktopDirectory, "src-tauri/src/lib.rs"), "utf8");
  const localPermissions = await readFile(
    resolve(desktopDirectory, "src-tauri/permissions/local-storage.toml"),
    "utf8",
  );
  assert.doesNotMatch(runtime, /commands::device_store_(?:get|set|delete)/);
  assert.doesNotMatch(localPermissions, /allow-device-store-/);
});

test("generated release runtime never replaces the local launcher with business origin", async () => {
  // Given: the checked-in local runtime config and independent release inputs.
  const base = JSON.parse(await readFile(
    resolve(desktopDirectory, "src-tauri/tauri.conf.json"),
    "utf8",
  ));

  // When: a production release configuration is rendered.
  const config = buildReleaseConfig(base, {
    defaultServerOrigin: "https://business.example.com",
    updaterEnabled: "true",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  });

  // Then: the package opens local assets and updater trust cannot become business trust.
  assert.equal(config.app.windows.length, 1);
  assert.equal(config.app.windows[0].label, "launcher");
  assert.equal(config.app.windows[0].url, "index.html");
  assert.doesNotMatch(JSON.stringify(config.app), /business\.example\.com|updates\.example\.com/);
  assert.deepEqual(config.plugins.updater, {
    endpoints: ["https://updates.example.com/latest.json"],
    pubkey: "public-key",
  });
  assert.doesNotMatch(base.app.security.csp, /ai-assistant\.invalid|https?:\/\//);
});
