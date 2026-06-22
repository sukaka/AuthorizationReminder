#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  applyVersioningToHeadCommit,
  isAgentVersionCommit,
  pushCurrentBranch,
  switchToVersionBranch,
} = require('./automation');

const rootDir = path.resolve(__dirname, '..', '..');

const runPostCommit = ({
  repositoryRoot = rootDir,
  readHeadCommitSummary = (cwd) => execFileSync(
    'git',
    ['log', '-1', '--pretty=%s'],
    { cwd, encoding: 'utf8' }
  ).trim(),
  applyVersioning = applyVersioningToHeadCommit,
  switchBranch = switchToVersionBranch,
  pushBranch = pushCurrentBranch,
  log = console.log,
} = {}) => {
  const bypass = String(process.env.CODEX_VERSIONING_BYPASS || '').trim().toLowerCase();
  if (bypass === '1' || bypass === 'true') {
    return { skipped: true, reason: 'bypass' };
  }
  if (isAgentVersionCommit(readHeadCommitSummary(repositoryRoot))) {
    return { skipped: true, reason: 'agent-version' };
  }

  const result = applyVersioning({ rootDir: repositoryRoot });
  const branchResult = result && !result.skipped
    ? switchBranch({
      rootDir: repositoryRoot,
      currentVersion: result.currentVersion,
      nextVersion: result.nextVersion,
    })
    : { switched: false };
  const pushResult = pushBranch({ rootDir: repositoryRoot });

  if (result && !result.skipped) {
    log(
      `[versioning] ${result.currentVersion} -> ${result.nextVersion} (${result.bumpType})`
    );
  }

  if (branchResult && branchResult.switched) {
    log(
      `[versioning] moved ${branchResult.previousBranch} -> ${branchResult.currentBranch}`
    );
  }

  if (pushResult && !pushResult.skipped) {
    const suffix = pushResult.upstreamSet ? ' (set upstream)' : '';
    log(`[versioning] pushed ${pushResult.remote}/${pushResult.branch}${suffix}`);
  }

  return { result, branchResult, pushResult };
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
