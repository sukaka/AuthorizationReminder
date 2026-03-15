#!/usr/bin/env node
const path = require('node:path');

const { applyVersioningToHeadCommit, pushCurrentBranch, switchToVersionBranch } = require('./automation');

const rootDir = path.resolve(__dirname, '..', '..');

try {
  const bypass = String(process.env.CODEX_VERSIONING_BYPASS || '').trim().toLowerCase();
  if (bypass === '1' || bypass === 'true') process.exit(0);

  const result = applyVersioningToHeadCommit({ rootDir });
  const branchResult = result && !result.skipped
    ? switchToVersionBranch({
      rootDir,
      currentVersion: result.currentVersion,
      nextVersion: result.nextVersion,
    })
    : { switched: false };
  const pushResult = pushCurrentBranch({ rootDir });

  if (result && !result.skipped) {
    console.log(
      `[versioning] ${result.currentVersion} -> ${result.nextVersion} (${result.bumpType})`
    );
  }

  if (branchResult && branchResult.switched) {
    console.log(
      `[versioning] moved ${branchResult.previousBranch} -> ${branchResult.currentBranch}`
    );
  }

  if (pushResult && !pushResult.skipped) {
    const suffix = pushResult.upstreamSet ? ' (set upstream)' : '';
    console.log(`[versioning] pushed ${pushResult.remote}/${pushResult.branch}${suffix}`);
  }
} catch (error) {
  console.error(`[versioning] ${error.message}`);
  process.exit(1);
}
