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
  const businessOrigin = "https://ai.example.com";
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "production",
    defaultServerOrigin: businessOrigin,
    updaterEnabled: "true",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  });

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
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "production",
    defaultServerOrigin: "",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });

  assert.equal(config.app.windows[0].url, "index.html");
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.plugins?.updater, undefined);
});

// Lan-test build mode tests
test("lan-test build includes workspace-private-http capability", () => {
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "lan-test",
    defaultServerOrigin: "http://192.168.20.15:5193",
    updaterEnabled: "true",
    updaterEndpoint: "http://192.168.20.15:5193/api/ai/desktop/updates/lan-test/{{target}}/{{arch}}/latest.json",
    updaterPublicKey: "PUBLIC-KEY",
  });

  assert.deepEqual(config.app.security.capabilities, [
    "launcher",
    "workspace",
    "workspace-private-http",
  ]);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
});

test("development build also includes workspace-private-http", () => {
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "development",
    defaultServerOrigin: "http://localhost:5193",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });

  assert.deepEqual(config.app.security.capabilities, [
    "launcher",
    "workspace",
    "workspace-private-http",
  ]);
});

test("production rejects HTTP default server origin", () => {
  assert.throws(() => buildReleaseConfig(baseConfig(), {
    buildMode: "production",
    defaultServerOrigin: "http://192.168.20.15:5193",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  }), /AI_ASSISTANT_DEFAULT_SERVER_ORIGIN/);
});

test("lan-test accepts private HTTP origin", () => {
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "lan-test",
    defaultServerOrigin: "http://192.168.20.15:5193",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });
  assert.equal(config.app.security.capabilities.length, 3);
});

test("lan-test accepts HTTPS origin", () => {
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "lan-test",
    defaultServerOrigin: "https://ai.intranet.local",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  });
  assert.equal(config.app.security.capabilities.length, 3);
});

test("lan-test accepts HTTP updater endpoint", () => {
  const config = buildReleaseConfig(baseConfig(), {
    buildMode: "lan-test",
    defaultServerOrigin: "https://ai.intranet.local",
    updaterEnabled: "true",
    updaterEndpoint: "http://192.168.20.15:5193/updates/{{target}}/{{arch}}/latest.json",
    updaterPublicKey: "PUBLIC-KEY",
  });
  assert.equal(config.bundle.createUpdaterArtifacts, true);
});

test("production rejects HTTP updater endpoint", () => {
  assert.throws(() => buildReleaseConfig(baseConfig(), {
    buildMode: "production",
    defaultServerOrigin: "https://ai.example.com",
    updaterEnabled: "true",
    updaterEndpoint: "http://192.168.20.15:5193/updates/{{target}}/{{arch}}/latest.json",
    updaterPublicKey: "PUBLIC-KEY",
  }), /AI_UPDATER_URL/);
});

test("invalid buildMode is rejected", () => {
  assert.throws(() => buildReleaseConfig(baseConfig(), {
    buildMode: "staging",
    defaultServerOrigin: "",
    updaterEnabled: "false",
    updaterEndpoint: "",
    updaterPublicKey: "",
  }), /buildMode/);
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
      buildMode: "production",
      defaultServerOrigin: unsafe,
      updaterEnabled: "false",
      updaterEndpoint: "",
      updaterPublicKey: "",
    }), /AI_ASSISTANT_DEFAULT_SERVER_ORIGIN/);
  });
}

for (const inputs of [
  {
    buildMode: "production",
    updaterEnabled: "true",
    updaterEndpoint: "http://updates.example.com/latest.json",
    updaterPublicKey: "public-key",
  },
  {
    buildMode: "production",
    updaterEnabled: "true",
    updaterEndpoint: "https://updates.example.com/latest.json",
    updaterPublicKey: "",
  },
  {
    buildMode: "production",
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
