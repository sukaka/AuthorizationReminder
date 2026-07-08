#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findUpdateRequests(entries) {
  if (!Array.isArray(entries)) throw new Error("network recording must be a JSON array");
  return entries.filter((item) => /(?:^|[./_-])(update|updates|updater|latest\.json)(?:[./?_-]|$)/i.test(
    String(item?.url ?? ""),
  ));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const recordingPath = process.argv[2];
  if (!recordingPath) {
    console.error("Usage: node assert-no-update-requests.mjs <network-recording.json>");
    process.exitCode = 2;
  } else {
    try {
      const entries = JSON.parse(await readFile(recordingPath, "utf8"));
      const updates = findUpdateRequests(entries);
      if (updates.length > 0) throw new Error(`检测到 ${updates.length} 个更新请求`);
      console.log("update requests: 0");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
