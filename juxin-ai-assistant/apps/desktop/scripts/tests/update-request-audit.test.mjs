import assert from "node:assert/strict";
import test from "node:test";

import { findUpdateRequests } from "../../../../scripts/assert-no-update-requests.mjs";

test("default five-minute network capture contains zero update requests", () => {
  const ordinaryTraffic = [
    { url: "https://ai.internal.example.com/api/ai/catalog" },
    { url: "https://ai.internal.example.com/api/auth/me" },
  ];

  assert.deepEqual(findUpdateRequests(ordinaryTraffic), []);
});

test("network audit identifies updater endpoint traffic", () => {
  const requests = [{ url: "https://updates.example.com/juxin/latest.json" }];

  assert.deepEqual(findUpdateRequests(requests), requests);
});
