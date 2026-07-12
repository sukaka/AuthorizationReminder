const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  SYSTEMS,
  SHARED_PATHS,
  SYSTEM_BY_ID,
} = require('./systems');

const AGENT_VERSION_PREFIX_RE = /^\[agent-v\d+\.\d+\.\d+\]\s+/i;
const PLATFORM_VERSION_PREFIX_RE = /^(?:\[v\d+\.\d+\.\d+\]\s+|(?:(?!\[agent-v)\[[a-z0-9-]+-v\d+\.\d+\.\d+\])+\s+)/i;
const ANY_VERSION_PREFIX_RE = /^(?:\[agent-v\d+\.\d+\.\d+\]\s+|\[v\d+\.\d+\.\d+\]\s+|(?:(?!\[agent-v)\[[a-z0-9-]+-v\d+\.\d+\.\d+\])+\s+)/i;
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

const FORCE_VERSION_PACKAGE_DIRS = new Set([
  '.',
  'auth',
  'train-exam/backend',
  'train-exam/frontend',
  'web',
]);

const INDEPENDENT_PACKAGE_DIRS = new Set([
  'juxin-ai-assistant/apps/desktop',
]);

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

const stripVersionPrefix = (summary) => String(summary || '').replace(ANY_VERSION_PREFIX_RE, '').trim();

const parseCommitScope = (summary) => {
  const match = stripVersionPrefix(summary).match(/^[a-z][\w-]*(?:\(([^)]+)\))?!?:/i);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
};

const pathMatches = (filePath, ownedPath) => filePath === ownedPath || filePath.startsWith(`${ownedPath}/`);

const classifyChangedPaths = (paths) => {
  const systemIds = new Set();
  const sharedPaths = new Set();
  const repoPaths = new Set();

  for (const changedPath of paths || []) {
    const filePath = String(changedPath || '').trim().replace(/^\.\//, '');
    if (!filePath) continue;

    const system = SYSTEMS.find((entry) => entry.paths.some((ownedPath) => pathMatches(filePath, ownedPath)));
    if (system) {
      systemIds.add(system.id);
    } else if (SHARED_PATHS.some((sharedPath) => pathMatches(filePath, sharedPath))) {
      sharedPaths.add(filePath);
    } else {
      repoPaths.add(filePath);
    }
  }

  return {
    systemIds: Array.from(systemIds).sort(),
    sharedPaths: Array.from(sharedPaths).sort(),
    repoPaths: Array.from(repoPaths).sort(),
  };
};

const resolveAffectedSystems = ({ summary, changedPaths }) => {
  const scope = parseCommitScope(summary);
  const { systemIds, sharedPaths } = classifyChangedPaths(changedPaths);

  if (scope && scope !== 'all' && scope !== 'repo' && !SYSTEM_BY_ID.has(scope)) {
    throw new Error(`未知系统 scope：${scope}`);
  }
  if (scope === 'all') {
    return SYSTEMS.map((system) => system.id).sort();
  }
  if (scope === 'repo') {
    if (sharedPaths.length) {
      throw new Error('scope repo 不能用于共享文件变更');
    }
    if (systemIds.length) {
      throw new Error(`scope repo 与业务系统 ${systemIds.join(', ')} 不一致`);
    }
    return [];
  }
  if (scope) {
    const excludedSystemId = systemIds.find((systemId) => systemId !== scope);
    if (excludedSystemId) {
      throw new Error(`scope ${scope} 与业务系统 ${excludedSystemId} 不一致`);
    }
    return [scope];
  }
  if (sharedPaths.length && !scope) {
    throw new Error('共享文件变更必须声明系统 scope');
  }
  return systemIds;
};

const isAgentVersionCommit = (message) => AGENT_VERSION_PREFIX_RE.test(getCommitSummary(message));

const normalizeCommitMessage = (message) => {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (!lines.length) return '';
  lines[0] = String(lines[0] || '').replace(PLATFORM_VERSION_PREFIX_RE, '').trim();
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
      const relativeDir = toPosixRelative(rootDir, fullPath);
      if (INDEPENDENT_PACKAGE_DIRS.has(relativeDir)) continue;
      walkForPackageJson(rootDir, fullPath, result);
      continue;
    }
    if (entry.name === 'package.json') {
      result.push(fullPath);
    }
  }
  return result;
};

const updateJsonVersionFile = ({ filePath, currentVersion, nextVersion, force = false }) => {
  if (!fs.existsSync(filePath)) return false;
  const original = readText(filePath);
  const json = JSON.parse(original);
  let changed = false;
  if (json.version === currentVersion || (force && json.version !== nextVersion)) {
    json.version = nextVersion;
    changed = true;
  }
  if (
    json.packages
    && json.packages['']
    && (json.packages[''].version === currentVersion || (force && json.packages[''].version !== nextVersion))
  ) {
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

const updateTomlPackageVersionFile = ({ filePath, nextVersion }) => {
  if (!fs.existsSync(filePath)) return false;
  const original = readText(filePath);
  const updated = original.replace(
    /^(version\s*=\s*)"\d+\.\d+\.\d+"/m,
    `$1"${nextVersion}"`
  );
  if (updated === original) return false;
  writeText(filePath, updated);
  return true;
};

const readSystemVersion = (rootDir, system) => {
  const value = readText(path.join(rootDir, system.versionFile)).trim();
  if (!VERSION_RE.test(value)) {
    throw new Error(`${system.id} 版本号非法：${value || '<empty>'}`);
  }
  return value;
};

const syncSystemVersion = ({ rootDir, system, currentVersion, nextVersion }) => {
  const resolvedRoot = path.resolve(rootDir);
  if (!system || !system.id) {
    throw new Error('系统声明非法');
  }
  const canonicalSystem = SYSTEM_BY_ID.get(system.id);
  if (!canonicalSystem) {
    throw new Error(`未知系统：${system.id}`);
  }
  const normalizedCurrentVersion = String(currentVersion || '').trim();
  const normalizedNextVersion = String(nextVersion || '').trim();
  if (!VERSION_RE.test(normalizedCurrentVersion)) {
    throw new Error(`当前版本号非法：${currentVersion}`);
  }
  if (!VERSION_RE.test(normalizedNextVersion)) {
    throw new Error(`目标版本号非法：${nextVersion}`);
  }
  const sourceVersion = readSystemVersion(resolvedRoot, canonicalSystem);
  if (sourceVersion !== normalizedCurrentVersion) {
    throw new Error(
      `系统 ${canonicalSystem.id}（${canonicalSystem.name}）版本源与当前版本不一致：期望 ${normalizedCurrentVersion}，实际 ${sourceVersion}`
    );
  }

  const changedFiles = new Set();
  const updateDeclaredFile = (relativePath, update) => {
    if (update({ filePath: path.join(resolvedRoot, relativePath) })) {
      changedFiles.add(relativePath);
    }
  };

  updateDeclaredFile(canonicalSystem.versionFile, (options) => updateTextVersionFile({
    ...options,
    currentVersion: normalizedCurrentVersion,
    nextVersion: normalizedNextVersion,
  }));

  for (const packageDir of canonicalSystem.packageDirs) {
    updateDeclaredFile(path.posix.join(packageDir, 'package.json'), (options) => updateJsonVersionFile({
      ...options,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
      force: true,
    }));
    updateDeclaredFile(path.posix.join(packageDir, 'package-lock.json'), (options) => updateJsonVersionFile({
      ...options,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
      force: true,
    }));
  }

  for (const relativePath of canonicalSystem.jsonFiles || []) {
    updateDeclaredFile(relativePath, (options) => updateJsonVersionFile({
      ...options,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
      force: true,
    }));
  }
  for (const relativePath of canonicalSystem.tomlFiles || []) {
    updateDeclaredFile(relativePath, (options) => updateTomlPackageVersionFile({
      ...options,
      nextVersion: normalizedNextVersion,
    }));
  }
  for (const relativePath of canonicalSystem.textFiles || []) {
    updateDeclaredFile(relativePath, (options) => updateTextVersionFile({
      ...options,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
  }

  return Array.from(changedFiles).sort();
};

const planSystemBumps = ({ rootDir, systemIds, bumpType }) => [...systemIds]
  .sort()
  .map((systemId) => {
    const system = SYSTEM_BY_ID.get(systemId);
    if (!system) {
      throw new Error(`未知系统：${systemId}`);
    }
    const currentVersion = readSystemVersion(rootDir, system);
    return { system, currentVersion, nextVersion: bumpVersion(currentVersion, bumpType) };
  });

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
    const packageDir = toPosixRelative(resolvedRoot, path.dirname(packageJsonPath)) || '.';
    const forceVersion = FORCE_VERSION_PACKAGE_DIRS.has(packageDir);
    if (updateJsonVersionFile({ filePath: packageJsonPath, currentVersion: sourceVersion, nextVersion, force: forceVersion })) {
      changedFiles.add(toPosixRelative(resolvedRoot, packageJsonPath));
    }
    const lockPath = path.join(path.dirname(packageJsonPath), 'package-lock.json');
    if (updateJsonVersionFile({ filePath: lockPath, currentVersion: sourceVersion, nextVersion, force: forceVersion })) {
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

const buildSystemVersionedCommitMessage = ({ message, bumps }) => {
  const text = normalizeCommitMessage(message).replace(/\n$/, '');
  const lines = text.split('\n');
  const summary = stripVersionPrefix(lines[0] || '');
  const body = lines.slice(1).join('\n');
  const prefixes = [...bumps]
    .sort((left, right) => {
      if (left.system.id < right.system.id) return -1;
      if (left.system.id > right.system.id) return 1;
      return 0;
    })
    .map(({ system, nextVersion }) => `[${system.id}-v${nextVersion}]`)
    .join('');
  const nextSummary = `${prefixes} ${summary}`;
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
  if (isAgentVersionCommit(rawSummary)) {
    return { skipped: true, reason: 'agent-version' };
  }
  if (PLATFORM_VERSION_PREFIX_RE.test(rawSummary)) {
    return { skipped: true, reason: 'already-versioned' };
  }
  const summary = stripVersionPrefix(rawSummary);
  const bumpType = parseCommitBumpType(summary);
  if (!bumpType || bumpType === 'skip') {
    return { skipped: true, reason: bumpType || 'unsupported' };
  }

  const changedPaths = git({
    rootDir: resolvedRoot,
    args: ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'],
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  const systemIds = resolveAffectedSystems({ summary, changedPaths });
  if (!systemIds.length) {
    return {
      skipped: true,
      reason: parseCommitScope(summary) === 'repo' ? 'repo-only' : 'no-systems',
    };
  }

  const stashMarker = stashLocalChanges(resolvedRoot);

  try {
    const bumps = planSystemBumps({ rootDir: resolvedRoot, systemIds, bumpType });
    const changedFiles = Array.from(new Set(bumps.flatMap((bump) => syncSystemVersion({
      rootDir: resolvedRoot,
      ...bump,
    })))).sort();

    if (changedFiles.length) {
      git({
        rootDir: resolvedRoot,
        args: ['add', '--', ...changedFiles],
      });
    }

    const commitMessage = buildSystemVersionedCommitMessage({ message: fullMessage, bumps });
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
      bumps,
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
  buildSystemVersionedCommitMessage,
  buildVersionedCommitMessage,
  isAgentVersionCommit,
  normalizeCommitMessage,
  parseCommitScope,
  parseCommitBumpType,
  planSystemBumps,
  pushCurrentBranch,
  classifyChangedPaths,
  readSystemVersion,
  resolveAffectedSystems,
  stripVersionPrefix,
  switchToVersionBranch,
  syncSystemVersion,
  syncRepositoryVersion,
  validateCommitMessage,
};
