#!/usr/bin/env node
import { resolve } from "node:path";

import { verifyArtifacts } from "../apps/desktop/scripts/verify-artifacts.mjs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: node verify-artifacts.mjs <manifest.json>");
  process.exitCode = 2;
} else {
  try {
    const verified = await verifyArtifacts(resolve(manifestPath));
    console.log(`Verified ${verified.length} release artifact(s).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
