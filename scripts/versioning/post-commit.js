#!/usr/bin/env node
const path = require('node:path');

const { applyVersioningToHeadCommit } = require('./automation');

const rootDir = path.resolve(__dirname, '..', '..');

try {
  const result = applyVersioningToHeadCommit({ rootDir });
  if (!result || result.skipped) process.exit(0);
  console.log(
    `[versioning] ${result.currentVersion} -> ${result.nextVersion} (${result.bumpType})`
  );
} catch (error) {
  console.error(`[versioning] ${error.message}`);
  process.exit(1);
}
