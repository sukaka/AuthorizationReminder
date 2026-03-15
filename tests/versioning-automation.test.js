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
} = require('../scripts/versioning/automation');

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
