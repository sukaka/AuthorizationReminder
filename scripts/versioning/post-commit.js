#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  applyVersioningToHeadCommit,
  isAgentVersionCommit,
  pushCurrentBranch,
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
