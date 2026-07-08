const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  parseCommitBumpType,
  bumpVersion,
  syncRepositoryVersion,
  applyVersioningToHeadCommit,
  pushCurrentBranch,
  switchToVersionBranch,
  validateCommitMessage,
  normalizeCommitMessage,
} = require('../scripts/versioning/automation');
const { runPostCommit } = require('../scripts/versioning/post-commit');

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const writeText = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const makePackageLock = (version) => ({
  name: 'fixture',
  version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'fixture',
      version,
    },
  },
});

test('post-commit exposes a guarded runner for side-effect-free testing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../scripts/versioning/post-commit.js'),
    'utf8'
  );

  assert.match(source, /if\s*\(require\.main\s*===\s*module\)/);
  assert.match(source, /module\.exports\s*=\s*\{[^}]*runPostCommit/s);
});

test('parseCommitBumpType maps supported prefixes to version levels', () => {
  assert.equal(parseCommitBumpType('breaking: redesign auth shell'), 'major');
  assert.equal(parseCommitBumpType('major(platform): rebuild navigation'), 'major');
  assert.equal(parseCommitBumpType('feat(auth)!: incompatible audit rewrite'), 'major');
  assert.equal(parseCommitBumpType('feat(auth): redesign audit center'), 'minor');
  assert.equal(parseCommitBumpType('minor(ui): refine control layout'), 'minor');
  assert.equal(parseCommitBumpType('perf(web): optimize bundle split'), 'minor');
  assert.equal(parseCommitBumpType('fix(auth): localize audit labels'), 'patch');
  assert.equal(parseCommitBumpType('docs: explain version rule'), 'patch');
  assert.equal(parseCommitBumpType('unknown: unsupported prefix'), null);
});

test('bumpVersion increments the expected semver segment', () => {
  assert.equal(bumpVersion('4.1.4', 'patch'), '4.1.5');
  assert.equal(bumpVersion('4.1.4', 'minor'), '4.2.0');
  assert.equal(bumpVersion('4.1.4', 'major'), '5.0.0');
});

test('syncRepositoryVersion updates live version files and bootstrap references', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-sync-'));

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.1.4' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('4.1.4'));
  writeJson(path.join(rootDir, 'auth/package.json'), { name: 'auth', version: '4.1.4' });
  writeJson(path.join(rootDir, 'auth/package-lock.json'), makePackageLock('4.1.4'));
  writeJson(path.join(rootDir, 'web/package.json'), { name: 'web', version: '4.1.4' });
  writeJson(path.join(rootDir, 'web/package-lock.json'), makePackageLock('4.1.4'));
  writeText(path.join(rootDir, 'auth/index.js'), "const RELEASE_VERSION = '4.1.4';\n");
  writeText(
    path.join(rootDir, 'docs/versioning.md'),
    [
      '# 系统版本规范',
      '',
      '- 当前整套系统口径版本：`4.1.4`',
      '- 示例：`codex/4.1.4`',
      '- 示例：`v4.1.4`',
      '- 示例：`docs/releases/4.1.4.md`',
      '',
    ].join('\n')
  );
  writeText(
    path.join(rootDir, 'README.md'),
    [
      'git clone -b codex/4.1.4 https://github.com/sukaka/AuthorizationReminder.git /root/AuthorizationReminder-codex-4.1.4',
      '> 说明：`bootstrap-full-server.sh` 默认把仓库同步到 `/root/AuthorizationReminder-codex-4.1.4`，并使用分支 `codex/4.1.4`。',
      '',
    ].join('\n')
  );
  writeText(
    path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'),
    [
      'BOOTSTRAP_REPO_DIR="${BOOTSTRAP_REPO_DIR:-/root/AuthorizationReminder-codex-4.1.4}"',
      'BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/4.1.4}"',
      '',
    ].join('\n')
  );
  writeText(
    path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'),
    [
      "BOOTSTRAP_BRANCH='codex/4.1.4' \\",
      "if ! grep -q '^git clone -b codex/4.1.4 https://example.invalid/repo.git ' \"${LOG_FILE}\"; then",
      '',
    ].join('\n')
  );

  const changedFiles = syncRepositoryVersion({
    rootDir,
    currentVersion: '4.1.4',
    nextVersion: '4.2.0',
  });

  assert.ok(changedFiles.includes('package.json'));
  assert.ok(changedFiles.includes('auth/index.js'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version, '4.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')).version, '4.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')).packages[''].version, '4.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'auth/package.json'), 'utf8')).version, '4.2.0');
  assert.match(fs.readFileSync(path.join(rootDir, 'auth/index.js'), 'utf8'), /RELEASE_VERSION = '4\.2\.0'/);
  assert.match(fs.readFileSync(path.join(rootDir, 'docs/versioning.md'), 'utf8'), /当前整套系统口径版本：`4\.2\.0`/);
  assert.match(fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8'), /codex\/4\.2\.0/);
  assert.match(fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8'), /AuthorizationReminder-codex-4\.2\.0/);
  assert.match(fs.readFileSync(path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'), 'utf8'), /codex\/4\.2\.0/);
  assert.match(fs.readFileSync(path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'), 'utf8'), /codex\/4\.2\.0/);
});

test('syncRepositoryVersion aligns web package even when it lagged behind root version', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-web-align-'));

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '5.24.1' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('5.24.1'));
  writeJson(path.join(rootDir, 'web/package.json'), { name: 'web', version: '5.10.12' });
  writeJson(path.join(rootDir, 'web/package-lock.json'), makePackageLock('5.10.12'));

  const changedFiles = syncRepositoryVersion({
    rootDir,
    currentVersion: '5.24.1',
    nextVersion: '5.24.2',
  });

  assert.ok(changedFiles.includes('web/package.json'));
  assert.ok(changedFiles.includes('web/package-lock.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'web/package.json'), 'utf8')).version, '5.24.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'web/package-lock.json'), 'utf8')).version, '5.24.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'web/package-lock.json'), 'utf8')).packages[''].version, '5.24.2');
});

test('syncRepositoryVersion explicitly excludes the independently versioned desktop agent', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-agent-ignore-'));
  const desktopDir = path.join(rootDir, 'juxin-ai-assistant/apps/desktop');

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '5.89.0' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('5.89.0'));
  writeJson(path.join(desktopDir, 'package.json'), { name: 'agent', version: '1.0.0' });
  writeJson(path.join(desktopDir, 'package-lock.json'), makePackageLock('1.0.0'));

  const changedFiles = syncRepositoryVersion({
    rootDir,
    currentVersion: '5.89.0',
    nextVersion: '5.90.0',
  });

  assert.ok(changedFiles.includes('package.json'));
  assert.ok(!changedFiles.includes('juxin-ai-assistant/apps/desktop/package.json'));
  assert.ok(!changedFiles.includes('juxin-ai-assistant/apps/desktop/package-lock.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).version, '1.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(desktopDir, 'package-lock.json'), 'utf8')).version, '1.0.0');
});

test('syncRepositoryVersion ignores nested worktree directories', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-worktree-ignore-'));

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '5.0.1' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('5.0.1'));
  writeJson(path.join(rootDir, 'auth/package.json'), { name: 'auth', version: '5.0.1' });
  writeJson(path.join(rootDir, 'auth/package-lock.json'), makePackageLock('5.0.1'));
  writeText(path.join(rootDir, 'auth/index.js'), "const RELEASE_VERSION = '5.0.1';\n");
  writeText(path.join(rootDir, 'docs/versioning.md'), '- 当前整套系统口径版本：`5.0.1`\n');
  writeText(path.join(rootDir, 'README.md'), 'git clone -b codex/5.0.1 /root/AuthorizationReminder-codex-5.0.1\n');
  writeText(path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'), 'BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/5.0.1}"\n');
  writeText(path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'), "BOOTSTRAP_BRANCH='codex/5.0.1' \\\n");

  writeJson(path.join(rootDir, '.worktrees/delivery-system/package.json'), { name: 'nested', version: '5.0.1' });
  writeJson(path.join(rootDir, '.worktrees/delivery-system/package-lock.json'), makePackageLock('5.0.1'));

  const changedFiles = syncRepositoryVersion({
    rootDir,
    currentVersion: '5.0.1',
    nextVersion: '5.0.2',
  });

  assert.ok(changedFiles.includes('package.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version, '5.0.2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, '.worktrees/delivery-system/package.json'), 'utf8')).version, '5.0.1');
});

test('applyVersioningToHeadCommit amends the latest commit with bumped version files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-hook-'));
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });

  git('init');
  git('config', 'user.name', 'Codex Test');
  git('config', 'user.email', 'codex@example.com');

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.1.4' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('4.1.4'));
  writeText(path.join(rootDir, 'auth/index.js'), "const RELEASE_VERSION = '4.1.4';\n");
  writeText(path.join(rootDir, 'docs/versioning.md'), '- 当前整套系统口径版本：`4.1.4`\n');
  writeText(path.join(rootDir, 'README.md'), 'git clone -b codex/4.1.4 /root/AuthorizationReminder-codex-4.1.4\n');
  writeText(path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'), 'BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/4.1.4}"\n');
  writeText(path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'), "BOOTSTRAP_BRANCH='codex/4.1.4' \\\n");
  writeText(path.join(rootDir, 'note.txt'), 'init\n');

  git('add', '.');
  git('commit', '-m', 'chore: init');

  fs.writeFileSync(path.join(rootDir, 'note.txt'), 'changed\n');
  git('add', 'note.txt');
  git('commit', '-m', 'feat: redesign audit center');

  applyVersioningToHeadCommit({ rootDir });

  const summary = git('log', '-1', '--pretty=%s').trim();
  const trackedFiles = git('show', '--name-only', '--pretty=', 'HEAD');

  assert.equal(summary, '[v4.2.0] feat: redesign audit center');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version, '4.2.0');
  assert.match(trackedFiles, /package\.json/);
  assert.match(trackedFiles, /auth\/index\.js/);
  assert.match(trackedFiles, /note\.txt/);
});

test('applyVersioningToHeadCommit skips commits that already carry a version prefix', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-skip-'));
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });

  git('init');
  git('config', 'user.name', 'Codex Test');
  git('config', 'user.email', 'codex@example.com');

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.2.0' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('4.2.0'));
  writeText(path.join(rootDir, 'auth/index.js'), "const RELEASE_VERSION = '4.2.0';\n");
  writeText(path.join(rootDir, 'docs/versioning.md'), '- 当前整套系统口径版本：`4.2.0`\n');
  writeText(path.join(rootDir, 'README.md'), 'git clone -b codex/4.2.0 /root/AuthorizationReminder-codex-4.2.0\n');
  writeText(path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'), 'BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/4.2.0}"\n');
  writeText(path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'), "BOOTSTRAP_BRANCH='codex/4.2.0' \\\n");
  writeText(path.join(rootDir, 'note.txt'), 'versioned\n');

  git('add', '.');
  git('commit', '-m', '[v4.2.0] feat: already versioned');

  const beforeHead = git('rev-parse', 'HEAD').trim();
  const result = applyVersioningToHeadCommit({ rootDir });
  const afterHead = git('rev-parse', 'HEAD').trim();
  const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already-versioned');
  assert.equal(beforeHead, afterHead);
  assert.equal(version, '4.2.0');
});

test('agent version commits are valid and skip all platform post-commit actions', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-agent-commit-'));
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });

  git('init');
  git('config', 'user.name', 'Codex Test');
  git('config', 'user.email', 'codex@example.com');
  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '5.89.0' });
  git('add', 'package.json');
  git('commit', '-m', '[agent-v1.0.1] fix(ai-assistant): repair launcher');

  const agentMessage = '[agent-v1.0.1] fix(ai-assistant): repair launcher';
  assert.equal(normalizeCommitMessage(agentMessage), agentMessage);
  assert.equal(validateCommitMessage(agentMessage), 'patch');
  const beforeHead = git('rev-parse', 'HEAD').trim();
  const result = applyVersioningToHeadCommit({ rootDir });
  const afterHead = git('rev-parse', 'HEAD').trim();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'agent-version');
  assert.equal(afterHead, beforeHead);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version, '5.89.0');

  const calls = [];
  const postCommitResult = runPostCommit({
    repositoryRoot: rootDir,
    readHeadCommitSummary: () => '[agent-v1.0.1] fix(ai-assistant): repair launcher',
    applyVersioning: () => calls.push('apply'),
    switchBranch: () => calls.push('switch'),
    pushBranch: () => calls.push('push'),
    log: () => {},
  });
  assert.deepEqual(calls, []);
  assert.equal(postCommitResult.skipped, true);
  assert.equal(postCommitResult.reason, 'agent-version');
});

test('pushCurrentBranch sets upstream for a new local branch', () => {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-remote-'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-push-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  git(remoteDir, 'init', '--bare');

  git(rootDir, 'init');
  git(rootDir, 'config', 'user.name', 'Codex Test');
  git(rootDir, 'config', 'user.email', 'codex@example.com');
  git(rootDir, 'checkout', '-b', 'codex/4.2.0');
  git(rootDir, 'remote', 'add', 'origin', remoteDir);

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.2.0' });
  git(rootDir, 'add', 'package.json');
  git(rootDir, 'commit', '-m', 'chore: init');

  const result = pushCurrentBranch({ rootDir });
  const upstream = git(rootDir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim();
  const localHead = git(rootDir, 'rev-parse', 'HEAD').trim();
  const remoteHead = git(remoteDir, 'rev-parse', 'refs/heads/codex/4.2.0').trim();

  assert.equal(result.skipped, false);
  assert.equal(result.branch, 'codex/4.2.0');
  assert.equal(result.remote, 'origin');
  assert.equal(result.upstreamSet, true);
  assert.equal(upstream, 'origin/codex/4.2.0');
  assert.equal(remoteHead, localHead);
});

test('applyVersioningToHeadCommit can be followed by pushCurrentBranch to publish the amended commit', () => {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-amend-remote-'));
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-amend-push-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  git(remoteDir, 'init', '--bare');

  git(rootDir, 'init');
  git(rootDir, 'config', 'user.name', 'Codex Test');
  git(rootDir, 'config', 'user.email', 'codex@example.com');
  git(rootDir, 'checkout', '-b', 'codex/4.2.0');
  git(rootDir, 'remote', 'add', 'origin', remoteDir);

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.1.4' });
  writeJson(path.join(rootDir, 'package-lock.json'), makePackageLock('4.1.4'));
  writeText(path.join(rootDir, 'auth/index.js'), "const RELEASE_VERSION = '4.1.4';\n");
  writeText(path.join(rootDir, 'docs/versioning.md'), '- 当前整套系统口径版本：`4.1.4`\n');
  writeText(path.join(rootDir, 'README.md'), 'git clone -b codex/4.1.4 /root/AuthorizationReminder-codex-4.1.4\n');
  writeText(path.join(rootDir, 'scripts/deploy/bootstrap-full-server.sh'), 'BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/4.1.4}"\n');
  writeText(path.join(rootDir, 'scripts/tests/bootstrap-full-server.sh'), "BOOTSTRAP_BRANCH='codex/4.1.4' \\\n");
  writeText(path.join(rootDir, 'note.txt'), 'init\n');

  git(rootDir, 'add', '.');
  git(rootDir, 'commit', '-m', 'chore: init');

  fs.writeFileSync(path.join(rootDir, 'note.txt'), 'changed\n');
  git(rootDir, 'add', 'note.txt');
  git(rootDir, 'commit', '-m', 'feat: auto push after bump');

  applyVersioningToHeadCommit({ rootDir });
  const pushResult = pushCurrentBranch({ rootDir });

  const summary = git(rootDir, 'log', '-1', '--pretty=%s').trim();
  const localHead = git(rootDir, 'rev-parse', 'HEAD').trim();
  const remoteHead = git(remoteDir, 'rev-parse', 'refs/heads/codex/4.2.0').trim();

  assert.equal(summary, '[v4.2.0] feat: auto push after bump');
  assert.equal(pushResult.skipped, false);
  assert.equal(pushResult.branch, 'codex/4.2.0');
  assert.equal(remoteHead, localHead);
});

test('switchToVersionBranch moves the release commit onto the next version branch and preserves the old branch', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-branch-shift-'));
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });

  git('init');
  git('config', 'user.name', 'Codex Test');
  git('config', 'user.email', 'codex@example.com');
  git('checkout', '-b', 'codex/4.2.0');

  writeJson(path.join(rootDir, 'package.json'), { name: 'root', version: '4.2.0' });
  git('add', 'package.json');
  git('commit', '-m', 'chore: init');

  writeText(path.join(rootDir, 'note.txt'), 'release\n');
  git('add', 'note.txt');
  git('commit', '-m', '[v4.3.0] feat: release next version');

  const previousHead = git('rev-parse', 'HEAD^').trim();
  const releaseHead = git('rev-parse', 'HEAD').trim();

  const result = switchToVersionBranch({
    rootDir,
    currentVersion: '4.2.0',
    nextVersion: '4.3.0',
  });

  assert.equal(result.switched, true);
  assert.equal(result.previousBranch, 'codex/4.2.0');
  assert.equal(result.currentBranch, 'codex/4.3.0');
  assert.equal(result.previousCommit, previousHead);
  assert.equal(git('branch', '--show-current').trim(), 'codex/4.3.0');
  assert.equal(git('rev-parse', 'codex/4.2.0').trim(), previousHead);
  assert.equal(git('rev-parse', 'codex/4.3.0').trim(), releaseHead);
});
