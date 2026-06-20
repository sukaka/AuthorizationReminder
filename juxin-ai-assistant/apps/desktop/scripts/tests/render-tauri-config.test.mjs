import assert from "node:assert/strict";
import test from "node:test";

import { buildRemoteConfig } from "../render-tauri-config.mjs";

test("remote config accepts exactly one HTTPS origin", () => {
  // Given: a production HTTPS origin without a path or credentials.
  const origin = "https://ai.internal.example.com";

  // When: the remote Tauri configuration is derived.
  const config = buildRemoteConfig(origin);

  // Then: the window and capability use only that exact origin.
  assert.deepEqual(config, {
    windowUrl: origin,
    remoteUrls: [`${origin}/*`],
    csp: `default-src 'self'; connect-src 'self' ${origin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`,
  });
});

for (const unsafe of [
  "https://*",
  "http://ai.example.com",
  "file:///tmp/app",
  "https://user:pass@ai.example.com",
  "https://ai.example.com/path",
]) {
  test(`remote config rejects unsafe value ${unsafe}`, () => {
    // Given / When / Then: an unsafe remote input never reaches generated config.
    assert.throws(() => buildRemoteConfig(unsafe));
  });
}
