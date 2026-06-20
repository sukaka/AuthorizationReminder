import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("remote capability contains only approved desktop commands", async () => {
  // Given: the tracked capability template.
  const capability = JSON.parse(await readFile(
    resolve(desktopDirectory, "src-tauri/capabilities/remote-main.json"),
    "utf8",
  ));

  // When / Then: broad system permissions cannot enter the remote workbench.
  const serialized = JSON.stringify(capability);
  assert.doesNotMatch(serialized, /shell:|fs:|http:|process:|clipboard-read|https:\/\/\*|http:\/\/\*/);
  assert.deepEqual(capability.permissions, [
    "core:default",
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
  ]);

  const runtime = await readFile(resolve(desktopDirectory, "src-tauri/src/lib.rs"), "utf8");
  const localPermissions = await readFile(
    resolve(desktopDirectory, "src-tauri/permissions/local-storage.toml"),
    "utf8",
  );
  assert.doesNotMatch(runtime, /commands::device_store_(?:get|set|delete)/);
  assert.doesNotMatch(localPermissions, /allow-device-store-/);
});
