const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const VERSION_PREFIX_RE = /^\[v\d+\.\d+\.\d+\]\s+/i;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SKIP_PREFIX_RE = /^(?:fixup!|squash!|merge\b)/i;
const MAJOR_PREFIX_RE = /^(?:(?:breaking|major)(?:\([^)]+\))?:|[a-z][\w-]*(?:\([^)]+\))?!:)/i;
const MINOR_PREFIX_RE = /^(?:(?:feat|minor|perf)(?:\([^)]+\))?:)/i;
const PATCH_PREFIX_RE = /^(?:(?:fix|patch|docs|chore|style|refactor|test|build|ci|revert)(?:\([^)]+\))?:|revert\b)/i;

const TEXT_VERSION_FILES = [
  'auth/index.js',
  'docs/versioning.md',
  'README.md',
  'scripts/deploy/bootstrap-full-server.sh',
  'scripts/tests/bootstrap-full-server.sh',
];

const WALK_IGNORE_DIRS = new Set([
  '.git',
  '.worktrees',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'memory',
]);

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const writeText = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPosixRelative = (rootDir, filePath) => path.relative(rootDir, filePath).split(path.sep).join('/');

const getCommitSummary = (message) => String(message || '').replace(/\r\n/g, '\n').split('\n')[0].trim();

const stripVersionPrefix = (summary) => String(summary || '').replace(VERSION_PREFIX_RE, '').trim();

const normalizeCommitMessage = (message) => {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (!lines.length) return '';
  lines[0] = stripVersionPrefix(lines[0]);
  return lines.join('\n').replace(/\n+$/, '\n');
};

const parseCommitBumpType = (message) => {
  const summary = stripVersionPrefix(getCommitSummary(message));
  if (!summary) return null;
  if (SKIP_PREFIX_RE.test(summary)) return 'skip';
  if (MAJOR_PREFIX_RE.test(summary)) return 'major';
  if (MINOR_PREFIX_RE.test(summary)) return 'minor';
  if (PATCH_PREFIX_RE.test(summary)) return 'patch';
  return null;
};

const validateCommitMessage = (message) => {
  const summary = stripVersionPrefix(getCommitSummary(message));
  const bumpType = parseCommitBumpType(summary);
  if (!bumpType) {
    throw new Error(
      '提交信息前缀不受支持。请使用 breaking:/major:/feat:/minor:/perf:/fix:/patch:/docs:/chore:/style:/refactor:/test:/build:/ci:/revert:'
    );
  }
  return bumpType;
};

const bumpVersion = (version, bumpType) => {
  if (!VERSION_RE.test(String(version || '').trim())) {
    throw new Error(`非法版本号：${version}`);
  }
  const [major, minor, patch] = String(version).split('.').map((item) => Number(item));
  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  if (bumpType === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`不支持的版本升级级别：${bumpType}`);
};

const walkForPackageJson = (rootDir, startDir = rootDir, result = []) => {
  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (WALK_IGNORE_DIRS.has(entry.name)) continue;
      walkForPackageJson(rootDir, fullPath, result);
      continue;
    }
    if (entry.name === 'package.json') {
      result.push(fullPath);
    }
  }
  return result;
};

const updateJsonVersionFile = ({ filePath, currentVersion, nextVersion }) => {
  if (!fs.existsSync(filePath)) return false;
  const original = readText(filePath);
  const json = JSON.parse(original);
  let changed = false;
  if (json.version === currentVersion) {
    json.version = nextVersion;
    changed = true;
  }
  if (json.packages && json.packages[''] && json.packages[''].version === currentVersion) {
    json.packages[''].version = nextVersion;
    changed = true;
  }
  if (!changed) return false;
  writeText(filePath, `${JSON.stringify(json, null, 2)}\n`);
  return true;
};

const updateTextVersionFile = ({ filePath, currentVersion, nextVersion }) => {
  if (!fs.existsSync(filePath)) return false;
  const original = readText(filePath);
  const updated = original.replace(new RegExp(escapeRegExp(currentVersion), 'g'), nextVersion);
  if (updated === original) return false;
  writeText(filePath, updated);
  return true;
};

const readRootVersion = (rootDir) => {
  const rootPackagePath = path.join(rootDir, 'package.json');
  const rootPackage = JSON.parse(readText(rootPackagePath));
  const version = String(rootPackage.version || '').trim();
  if (!VERSION_RE.test(version)) {
    throw new Error(`根 package.json 版本号非法：${version || '<empty>'}`);
  }
  return version;
};

const syncRepositoryVersion = ({ rootDir, currentVersion = '', nextVersion = '' }) => {
  const resolvedRoot = path.resolve(rootDir);
  const sourceVersion = currentVersion || readRootVersion(resolvedRoot);
  if (!VERSION_RE.test(String(nextVersion || '').trim())) {
    throw new Error(`目标版本号非法：${nextVersion}`);
  }

  const changedFiles = new Set();
  const packageJsonFiles = walkForPackageJson(resolvedRoot);
  for (const packageJsonPath of packageJsonFiles) {
    if (updateJsonVersionFile({ filePath: packageJsonPath, currentVersion: sourceVersion, nextVersion })) {
      changedFiles.add(toPosixRelative(resolvedRoot, packageJsonPath));
    }
    const lockPath = path.join(path.dirname(packageJsonPath), 'package-lock.json');
    if (updateJsonVersionFile({ filePath: lockPath, currentVersion: sourceVersion, nextVersion })) {
      changedFiles.add(toPosixRelative(resolvedRoot, lockPath));
    }
  }

  for (const relativePath of TEXT_VERSION_FILES) {
    const filePath = path.join(resolvedRoot, relativePath);
    if (updateTextVersionFile({ filePath, currentVersion: sourceVersion, nextVersion })) {
      changedFiles.add(relativePath);
    }
  }

  return Array.from(changedFiles).sort();
};

const git = ({ rootDir, args, env = {} }) => execFileSync('git', args, {
  cwd: rootDir,
  encoding: 'utf8',
  env: {
    ...process.env,
    ...env,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const getCurrentBranchName = (rootDir) => git({
  rootDir,
  args: ['rev-parse', '--abbrev-ref', 'HEAD'],
}).trim();

const getBranchHead = (rootDir, branchName) => git({
  rootDir,
  args: ['rev-parse', '--verify', `refs/heads/${branchName}`],
}).trim();

const branchExists = (rootDir, branchName) => {
  try {
    getBranchHead(rootDir, branchName);
    return true;
  } catch (_error) {
    return false;
  }
};

const buildVersionBranchName = (version) => `codex/${version}`;

const switchToVersionBranch = ({ rootDir, currentVersion, nextVersion }) => {
  const resolvedRoot = path.resolve(rootDir);
  const currentBranch = getCurrentBranchName(resolvedRoot);
  const previousBranch = buildVersionBranchName(currentVersion);
  const nextBranch = buildVersionBranchName(nextVersion);

  if (
    !VERSION_RE.test(String(currentVersion || '').trim())
    || !VERSION_RE.test(String(nextVersion || '').trim())
    || currentBranch !== previousBranch
    || previousBranch === nextBranch
  ) {
    return {
      switched: false,
      previousBranch,
      currentBranch,
      previousCommit: '',
    };
  }

  const releaseHead = git({ rootDir: resolvedRoot, args: ['rev-parse', 'HEAD'] }).trim();
  const previousCommit = git({ rootDir: resolvedRoot, args: ['rev-parse', 'HEAD^'] }).trim();

  if (branchExists(resolvedRoot, nextBranch)) {
    const existingHead = getBranchHead(resolvedRoot, nextBranch);
    if (existingHead !== releaseHead) {
      throw new Error(`版本分支 ${nextBranch} 已存在且不指向当前提交`);
    }
    git({ rootDir: resolvedRoot, args: ['switch', nextBranch] });
  } else {
    git({ rootDir: resolvedRoot, args: ['switch', '-c', nextBranch] });
  }

  git({
    rootDir: resolvedRoot,
    args: ['branch', '-f', previousBranch, previousCommit],
  });

  return {
    switched: true,
    previousBranch,
    currentBranch: nextBranch,
    previousCommit,
    currentCommit: releaseHead,
  };
};

const hasUpstreamBranch = (rootDir) => {
  try {
    git({
      rootDir,
      args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    });
    return true;
  } catch (_error) {
    return false;
  }
};

const pushCurrentBranch = ({ rootDir, remoteName = 'origin' }) => {
  const resolvedRoot = path.resolve(rootDir);
  const branch = getCurrentBranchName(resolvedRoot);
  if (!branch || branch === 'HEAD') {
    return { skipped: true, reason: 'detached-head' };
  }

  const upstreamExists = hasUpstreamBranch(resolvedRoot);
  const args = upstreamExists
    ? ['push', remoteName, branch]
    : ['push', '--set-upstream', remoteName, branch];

  git({
    rootDir: resolvedRoot,
    args,
  });

  return {
    skipped: false,
    branch,
    remote: remoteName,
    upstreamSet: !upstreamExists,
  };
};

const hasLocalChanges = (rootDir) => Boolean(git({ rootDir, args: ['status', '--porcelain', '--untracked-files=all'] }).trim());

const stashLocalChanges = (rootDir) => {
  if (!hasLocalChanges(rootDir)) return '';
  const marker = `codex-versioning-autostash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  git({
    rootDir,
    args: ['stash', 'push', '--include-untracked', '--message', marker],
  });
  return marker;
};

const popStash = (rootDir, marker) => {
  if (!marker) return;
  const lines = git({ rootDir, args: ['stash', 'list', '--format=%gd %gs'] })
    .trim()
    .split('\n')
    .filter(Boolean);
  const matched = lines.find((line) => line.endsWith(marker));
  if (!matched) return;
  const stashRef = matched.split(' ')[0];
  git({ rootDir, args: ['stash', 'pop', '--index', stashRef] });
};

const buildVersionedCommitMessage = ({ message, nextVersion }) => {
  const text = normalizeCommitMessage(message).replace(/\n$/, '');
  const lines = text.split('\n');
  const summary = stripVersionPrefix(lines[0] || '');
  const body = lines.slice(1).join('\n');
  const nextSummary = `[v${nextVersion}] ${summary}`;
  return body ? `${nextSummary}\n${body}\n` : `${nextSummary}\n`;
};

const applyVersioningToHeadCommit = ({ rootDir }) => {
  const resolvedRoot = path.resolve(rootDir);
  const bypass = String(process.env.CODEX_VERSIONING_BYPASS || '').trim();
  if (bypass === '1' || bypass.toLowerCase() === 'true') {
    return { skipped: true, reason: 'bypass' };
  }

  const fullMessage = git({ rootDir: resolvedRoot, args: ['log', '-1', '--pretty=%B'] });
  const rawSummary = getCommitSummary(fullMessage);
  if (VERSION_PREFIX_RE.test(rawSummary)) {
    return { skipped: true, reason: 'already-versioned' };
  }
  const summary = stripVersionPrefix(rawSummary);
  const bumpType = parseCommitBumpType(summary);
  if (!bumpType || bumpType === 'skip') {
    return { skipped: true, reason: bumpType || 'unsupported' };
  }

  const currentVersion = readRootVersion(resolvedRoot);
  const nextVersion = bumpVersion(currentVersion, bumpType);
  const stashMarker = stashLocalChanges(resolvedRoot);

  try {
    const changedFiles = syncRepositoryVersion({
      rootDir: resolvedRoot,
      currentVersion,
      nextVersion,
    });

    if (changedFiles.length) {
      git({
        rootDir: resolvedRoot,
        args: ['add', '--', ...changedFiles],
      });
    }

    const commitMessage = buildVersionedCommitMessage({ message: fullMessage, nextVersion });
    const messageFile = path.join(os.tmpdir(), `codex-version-commit-${Date.now()}.txt`);
    writeText(messageFile, commitMessage);
    try {
      git({
        rootDir: resolvedRoot,
        args: ['commit', '--amend', '--no-verify', '-F', messageFile],
        env: {
          CODEX_VERSIONING_BYPASS: '1',
        },
      });
    } finally {
      fs.rmSync(messageFile, { force: true });
    }

    popStash(resolvedRoot, stashMarker);

    return {
      skipped: false,
      bumpType,
      currentVersion,
      nextVersion,
      changedFiles,
    };
  } catch (error) {
    try {
      popStash(resolvedRoot, stashMarker);
    } catch (restoreError) {
      throw new Error(`${error.message}；恢复本地改动失败：${restoreError.message}`);
    }
    throw error;
  }
};

module.exports = {
  applyVersioningToHeadCommit,
  bumpVersion,
  buildVersionBranchName,
  buildVersionedCommitMessage,
  normalizeCommitMessage,
  parseCommitBumpType,
  pushCurrentBranch,
  stripVersionPrefix,
  switchToVersionBranch,
  syncRepositoryVersion,
  validateCommitMessage,
};
