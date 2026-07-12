#!/usr/bin/env node
const path = require('node:path');

const {
  applyVersioningToHeadCommit,
  pushCurrentBranch,
} = require('./automation');

const rootDir = path.resolve(__dirname, '..', '..');

const runPostCommit = ({
  repositoryRoot = rootDir,
  applyVersioning = applyVersioningToHeadCommit,
  pushBranch = pushCurrentBranch,
  log = console.log,
} = {}) => {
  const bypass = String(process.env.CODEX_VERSIONING_BYPASS || '').trim().toLowerCase();
  if (bypass === '1' || bypass === 'true') {
    return { skipped: true, reason: 'bypass' };
  }
  const result = applyVersioning({ rootDir: repositoryRoot });
  const pushResult = pushBranch({ rootDir: repositoryRoot });

  if (result && !result.skipped && result.bumps.length) {
    const transitions = result.bumps
      .map(({ system, currentVersion, nextVersion }) => `${system.id} ${currentVersion} -> ${nextVersion}`)
      .join(', ');
    log(`[versioning] ${transitions} (${result.bumpType})`);
  }

  if (pushResult && !pushResult.skipped) {
    const suffix = pushResult.upstreamSet ? ' (set upstream)' : '';
    log(`[versioning] pushed ${pushResult.remote}/${pushResult.branch}${suffix}`);
  }

  return { result, pushResult };
};

module.exports = { runPostCommit };

if (require.main === module) {
  try {
    runPostCommit();
  } catch (error) {
    console.error(`[versioning] ${error.message}`);
    process.exit(1);
  }
}
