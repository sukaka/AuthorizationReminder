import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseConfig } from "../render-tauri-config.mjs";

function baseConfig() {
  return {
    app: {
      windows: [{
        label: "launcher",
        url: "index.html",
      }],
      security: {
        capabilities: ["launcher", "workspace"],
        csp: "default-src 'self'; connect-src 'self' https://old-business.example.com",
      },
    },
    bundle: {
      active: true,
    },
  };
}

test("release config starts locally and keeps updater trust separate", () => {
  // Given: independent optional business and mandatory signed-updater build inputs.
  const businessOrigin = "https://ai.example.com";

  // When: the release configuration is generated.
  const config = buildReleaseConfig(baseConfig(), {
    defaultServerOrigin: businessOrigin,
    updaterEnabled: "true",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  });

  // Then: startup remains local and only the updater trust enters Tauri config.
  assert.equal(config.app.windows[0].label, "launcher");
  assert.equal(config.app.windows[0].url, "index.html");
  assert.deepEqual(config.app.security.capabilities, ["launcher", "workspace"]);
  assert.doesNotMatch(config.app.security.csp, /ai\.example\.com|old-business/);
  assert.doesNotMatch(JSON.stringify(config), /https:\/\/ai\.example\.com/);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://updates.example.com/latest.json",
  ]);
  assert.equal(config.plugins.updater.pubkey, "public-key");
  assert.equal(config.bundle.createUpdaterArtifacts, true);
});

test("default business origin is optional when updater is disabled", () => {
  // Given / When: a development or unsigned package has no remote defaults.
  const config = buildReleaseConfig(baseConfig(), {
    defaultServerOrigin: "",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });

  // Then: the local launcher still builds without updater network trust.
  assert.equal(config.app.windows[0].url, "index.html");
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.plugins?.updater, undefined);
});

for (const unsafe of [
  "https://*",
  "http://ai.example.com",
  "file:///tmp/app",
  "https://user:pass@ai.example.com",
  "https://ai.example.com/path",
  "https://ai.example.com/%2e",
]) {
  test(`release config rejects unsafe default business origin ${unsafe}`, () => {
    assert.throws(() => buildReleaseConfig(baseConfig(), {
      defaultServerOrigin: unsafe,
      updaterEnabled: "false",
      updaterEndpoint: "",
      updaterPublicKey: "",
    }), /AI_ASSISTANT_DEFAULT_SERVER_ORIGIN/);
  });
}

for (const inputs of [
  {
    updaterEnabled: "true",
    updaterEndpoint: "http://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  },
  {
    updaterEnabled: "true",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "",
  },
  {
    updaterEnabled: "sometimes",
    updaterEndpoint: "",
    updaterPublicKey: "",
  },
]) {
  test(`release config rejects unsafe updater inputs ${JSON.stringify(inputs)}`, () => {
    assert.throws(() => buildReleaseConfig(baseConfig(), {
      defaultServerOrigin: "",
      ...inputs,
    }), /AI_UPDATER_/);
  });
}
