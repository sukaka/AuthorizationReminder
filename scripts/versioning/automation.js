const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  SYSTEMS,
  SYSTEM_BY_ID,
  isSharedPath,
  matchVersionTarget,
  validateSystemRegistry,
} = require('./systems');
const { assertStrictSemVer } = require('./semver');

const SYSTEM_ID_PATTERN = SYSTEMS.map(({ id }) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const PLATFORM_VERSION_PREFIX_RE = new RegExp(
  `^(?:\\[repo\\]\\s+|\\[v\\d+\\.\\d+\\.\\d+\\]\\s+|(?:\\[(?:${SYSTEM_ID_PATTERN})-v\\d+\\.\\d+\\.\\d+\\])+\\s+)`,
  'i'
);
const ANY_VERSION_PREFIX_RE = /^(?:\[repo\]\s+|\[v\d+\.\d+\.\d+\]\s+|(?:\[[a-z0-9-]+-v\d+\.\d+\.\d+\])+\s+)/i;
const SKIP_PREFIX_RE = /^(?:fixup!|squash!|merge\b)/i;
const MAJOR_PREFIX_RE = /^(?:(?:breaking|major)(?:\([^)]+\))?:|[a-z][\w-]*(?:\([^)]+\))?!:)/i;
const MINOR_PREFIX_RE = /^(?:(?:feat|minor|perf)(?:\([^)]+\))?:)/i;
const PATCH_PREFIX_RE = /^(?:(?:fix|patch|docs|chore|style|refactor|test|build|ci|revert)(?:\([^)]+\))?:|revert\b)/i;

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const writeText = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

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
    } else if (isSharedPath(filePath)) {
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

const normalizeCommitMessage = (message) => {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (!lines.length) return '';
  lines[0] = String(lines[0] || '').replace(ANY_VERSION_PREFIX_RE, '').trim();
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
  const scopedType = summary.match(/^[a-z][\w-]*\(([^)]*)\)!?:/i);
  if (scopedType && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(scopedType[1])) {
    throw new Error(`提交 scope 语法非法：${scopedType[1] || '<empty>'}`);
  }
  const bumpType = parseCommitBumpType(summary);
  if (!bumpType) {
    throw new Error(
      '提交信息前缀不受支持。请使用 breaking:/major:/feat:/minor:/perf:/fix:/patch:/docs:/chore:/style:/refactor:/test:/build:/ci:/revert:'
    );
  }
  return bumpType;
};

const bumpVersion = (version, bumpType) => {
  const [major, minor, patch] = assertStrictSemVer(version).split('.').map(BigInt);
  if (bumpType === 'major') return `${major + 1n}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1n}.0`;
  if (bumpType === 'patch') return `${major}.${minor}.${patch + 1n}`;
  throw new Error(`不支持的版本升级级别：${bumpType}`);
};

const readRequiredText = (rootDir, relativePath) => {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativePath} 缺失`);
  }
  return { filePath, original: readText(filePath) };
};

const parseJsonObject = (original, relativePath) => {
  let value;
  try {
    value = JSON.parse(original);
  } catch (error) {
    throw new Error(`${relativePath} 不是有效 JSON：${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${relativePath} JSON 根结构必须是对象`);
  }
  return value;
};

const assertCurrentTargetVersion = ({ value, currentVersion, label }) => {
  assertStrictSemVer(value, label);
  if (value !== currentVersion) {
    throw new Error(`${label} 与 VERSION 不一致：期望 ${currentVersion}，实际 ${value}`);
  }
};

const findTomlPackageVersion = (source, relativePath) => {
  const packageHeaders = Array.from(source.matchAll(/^[ \t]*\[package\][ \t]*(?:#.*)?$/gm));
  if (packageHeaders.length !== 1) {
    throw new Error(`${relativePath} TOML [package] 结构非法`);
  }
  const packageStart = packageHeaders[0].index + packageHeaders[0][0].length;
  const remaining = source.slice(packageStart);
  const nextSection = remaining.match(/^[ \t]*\[[^\]\r\n]+\][ \t]*(?:#.*)?$/m);
  const packageEnd = nextSection ? packageStart + nextSection.index : source.length;
  const packageBody = source.slice(packageStart, packageEnd);
  const versionMatches = Array.from(
    packageBody.matchAll(/^([ \t]*version[ \t]*=[ \t]*")([^"]+)("[ \t]*(?:#.*)?)$/gm)
  );
  if (versionMatches.length !== 1) {
    throw new Error(`${relativePath} TOML package version 缺失或重复`);
  }
  const versionMatch = versionMatches[0];
  const versionStart = packageStart + versionMatch.index + versionMatch[1].length;
  return {
    value: versionMatch[2],
    start: versionStart,
    end: versionStart + versionMatch[2].length,
  };
};

const prepareVersionSourceUpdate = ({ rootDir, relativePath, currentVersion, nextVersion }) => {
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  if (!original.endsWith('\n') || original.slice(0, -1).includes('\n')) {
    throw new Error(`${relativePath} VERSION 结构非法`);
  }
  const sourceVersion = original.slice(0, -1);
  assertCurrentTargetVersion({
    value: sourceVersion,
    currentVersion,
    label: `${relativePath} VERSION`,
  });
  return { relativePath, filePath, original, content: `${nextVersion}\n` };
};

const preparePackageJsonUpdate = ({ rootDir, relativePath, currentVersion, nextVersion }) => {
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  const json = parseJsonObject(original, relativePath);
  if (!Object.hasOwn(json, 'version')) {
    throw new Error(`${relativePath} version 缺失`);
  }
  assertCurrentTargetVersion({
    value: json.version,
    currentVersion,
    label: `${relativePath} version`,
  });
  json.version = nextVersion;
  return { relativePath, filePath, original, content: `${JSON.stringify(json, null, 2)}\n` };
};

const preparePackageLockUpdate = ({ rootDir, relativePath, currentVersion, nextVersion }) => {
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  const json = parseJsonObject(original, relativePath);
  if (!Object.hasOwn(json, 'version')) {
    throw new Error(`${relativePath} top-level version 缺失`);
  }
  assertCurrentTargetVersion({
    value: json.version,
    currentVersion,
    label: `${relativePath} top-level version`,
  });
  if (!json.packages || typeof json.packages !== 'object' || Array.isArray(json.packages)) {
    throw new Error(`${relativePath} packages 结构非法`);
  }
  if (!json.packages[''] || typeof json.packages[''] !== 'object' || Array.isArray(json.packages[''])) {
    throw new Error(`${relativePath} packages[''] 结构非法`);
  }
  if (!Object.hasOwn(json.packages[''], 'version')) {
    throw new Error(`${relativePath} packages[''].version 缺失`);
  }
  assertCurrentTargetVersion({
    value: json.packages[''].version,
    currentVersion,
    label: `${relativePath} packages[''].version`,
  });
  json.version = nextVersion;
  json.packages[''].version = nextVersion;
  return { relativePath, filePath, original, content: `${JSON.stringify(json, null, 2)}\n` };
};

const prepareDeclaredJsonUpdate = ({ rootDir, relativePath, currentVersion, nextVersion }) => {
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  const json = parseJsonObject(original, relativePath);
  if (!Object.hasOwn(json, 'version')) {
    throw new Error(`${relativePath} declared JSON version 缺失`);
  }
  assertCurrentTargetVersion({
    value: json.version,
    currentVersion,
    label: `${relativePath} declared JSON version`,
  });
  json.version = nextVersion;
  return { relativePath, filePath, original, content: `${JSON.stringify(json, null, 2)}\n` };
};

const prepareTomlUpdate = ({ rootDir, relativePath, currentVersion, nextVersion }) => {
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  const packageVersion = findTomlPackageVersion(original, relativePath);
  assertCurrentTargetVersion({
    value: packageVersion.value,
    currentVersion,
    label: `${relativePath} TOML package version`,
  });
  const content = `${original.slice(0, packageVersion.start)}${nextVersion}${original.slice(packageVersion.end)}`;
  return { relativePath, filePath, original, content };
};

const findCargoLockPackageVersion = (source, relativePath, packageName) => {
  const sections = source.split(/(?=^\[\[package\]\][ \t]*(?:#.*)?$)/m);
  const matches = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => new RegExp(`^name[ \\t]*=[ \\t]*"${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[ \\t]*$`, 'm').test(section));
  if (matches.length !== 1) {
    throw new Error(`${relativePath} Cargo.lock 缺少 ${packageName} package 或存在重复`);
  }
  const versionMatches = Array.from(matches[0].section.matchAll(/^([ \t]*version[ \t]*=[ \t]*")([^"]+)("[ \t]*)$/gm));
  if (versionMatches.length !== 1) {
    throw new Error(`${relativePath} Cargo.lock 的 ${packageName} package version 缺失或重复`);
  }
  return {
    sections,
    sectionIndex: matches[0].index,
    value: versionMatches[0][2],
    versionMatch: versionMatches[0],
  };
};

const prepareCargoLockPackageUpdate = ({ rootDir, target, currentVersion, nextVersion }) => {
  const relativePath = target.file;
  const { filePath, original } = readRequiredText(rootDir, relativePath);
  const packageVersion = findCargoLockPackageVersion(original, relativePath, target.packageName);
  assertCurrentTargetVersion({
    value: packageVersion.value,
    currentVersion,
    label: `${relativePath} Cargo.lock ${target.packageName} package version`,
  });
  const section = packageVersion.sections[packageVersion.sectionIndex];
  const match = packageVersion.versionMatch;
  packageVersion.sections[packageVersion.sectionIndex] = `${section.slice(0, match.index)}${match[1]}${nextVersion}${match[3]}${section.slice(match.index + match[0].length)}`;
  return { relativePath, filePath, original, content: packageVersion.sections.join('') };
};

const applyEdits = (source, edits, relativePath) => {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].start < ordered[index].end) {
      throw new Error(`${relativePath} 运行时版本目标重叠`);
    }
  }
  return ordered.reduce(
    (content, edit) => `${content.slice(0, edit.start)}${edit.value}${content.slice(edit.end)}`,
    source
  );
};

const prepareVersionTargetUpdates = ({ rootDir, targets, currentVersion, nextVersion }) => {
  const targetsByFile = new Map();
  for (const target of targets || []) {
    const entries = targetsByFile.get(target.file) || [];
    entries.push(target);
    targetsByFile.set(target.file, entries);
  }

  return Array.from(targetsByFile, ([relativePath, fileTargets]) => {
    const { filePath, original } = readRequiredText(rootDir, relativePath);
    const edits = fileTargets.map((target) => {
      const match = matchVersionTarget(original, target);
      assertCurrentTargetVersion({
        value: match.value,
        currentVersion,
        label: `${relativePath} ${target.field}`,
      });
      return { start: match.start, end: match.end, value: nextVersion };
    });
    return {
      relativePath,
      filePath,
      original,
      content: applyEdits(original, edits, relativePath),
      edits,
    };
  });
};

const readSystemVersion = (rootDir, system) => {
  const { original } = readRequiredText(rootDir, system.versionFile);
  if (!original.endsWith('\n') || original.slice(0, -1).includes('\n')) {
    throw new Error(`${system.id} 版本号非法：${original || '<empty>'}`);
  }
  return assertStrictSemVer(original.slice(0, -1), `${system.id} 版本号`);
};

const findSystemVersionDrift = (rootDir, system) => {
  const resolvedRoot = path.resolve(rootDir);
  if (!system || !system.id) {
    throw new Error('系统声明非法');
  }
  const canonicalSystem = SYSTEM_BY_ID.get(system.id);
  if (!canonicalSystem) {
    throw new Error(`未知系统：${system.id}`);
  }
  const expected = readSystemVersion(resolvedRoot, canonicalSystem);
  const drift = [];
  const record = (file, field, actual) => {
    if (actual !== expected) {
      drift.push({ file, field, expected, actual });
    }
  };
  const readDeclaredJson = (relativePath) => {
    const filePath = path.join(resolvedRoot, relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(readText(filePath));
  };

  for (const packageDir of canonicalSystem.packageDirs) {
    const packagePath = path.posix.join(packageDir, 'package.json');
    const packageJson = readDeclaredJson(packagePath);
    record(packagePath, 'version', packageJson ? packageJson.version : '<missing file>');

    const lockPath = path.posix.join(packageDir, 'package-lock.json');
    const packageLock = readDeclaredJson(lockPath);
    if (!packageLock) {
      record(lockPath, 'version', '<missing file>');
    } else {
      record(lockPath, 'version', packageLock.version);
      record(lockPath, "packages[''].version", packageLock.packages?.['']?.version);
    }
  }

  for (const relativePath of canonicalSystem.jsonFiles || []) {
    const json = readDeclaredJson(relativePath);
    record(relativePath, 'version', json ? json.version : '<missing file>');
  }
  for (const relativePath of canonicalSystem.tomlFiles || []) {
    const filePath = path.join(resolvedRoot, relativePath);
    const source = fs.existsSync(filePath) ? readText(filePath) : '';
    try {
      record(relativePath, 'package.version', findTomlPackageVersion(source, relativePath).value);
    } catch (_error) {
      record(relativePath, 'package.version', '<missing>');
    }
  }
  for (const target of canonicalSystem.cargoLockPackages || []) {
    const filePath = path.join(resolvedRoot, target.file);
    const source = fs.existsSync(filePath) ? readText(filePath) : '';
    try {
      record(target.file, `package.${target.packageName}.version`, findCargoLockPackageVersion(source, target.file, target.packageName).value);
    } catch (_error) {
      record(target.file, `package.${target.packageName}.version`, '<missing>');
    }
  }
  for (const target of canonicalSystem.versionTargets || []) {
    const filePath = path.join(resolvedRoot, target.file);
    const source = fs.existsSync(filePath) ? readText(filePath) : '';
    try {
      record(target.file, target.field, matchVersionTarget(source, target).value);
    } catch (_error) {
      record(target.file, target.field, '<missing>');
    }
  }
  return drift;
};

const prepareSystemVersionSync = ({ rootDir, system, currentVersion, nextVersion }) => {
  const resolvedRoot = path.resolve(rootDir);
  if (!system || !system.id) {
    throw new Error('系统声明非法');
  }
  const canonicalSystem = SYSTEM_BY_ID.get(system.id);
  if (!canonicalSystem) {
    throw new Error(`未知系统：${system.id}`);
  }
  const normalizedCurrentVersion = assertStrictSemVer(currentVersion, '当前版本号');
  const normalizedNextVersion = assertStrictSemVer(nextVersion, '目标版本号');
  const sourceVersion = readSystemVersion(resolvedRoot, canonicalSystem);
  if (sourceVersion !== normalizedCurrentVersion) {
    throw new Error(
      `系统 ${canonicalSystem.id}（${canonicalSystem.name}）版本源与当前版本不一致：期望 ${normalizedCurrentVersion}，实际 ${sourceVersion}`
    );
  }

  const updates = [prepareVersionSourceUpdate({
    rootDir: resolvedRoot,
    relativePath: canonicalSystem.versionFile,
    currentVersion: normalizedCurrentVersion,
    nextVersion: normalizedNextVersion,
  })];

  for (const packageDir of canonicalSystem.packageDirs) {
    updates.push(preparePackageJsonUpdate({
      rootDir: resolvedRoot,
      relativePath: path.posix.join(packageDir, 'package.json'),
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
    updates.push(preparePackageLockUpdate({
      rootDir: resolvedRoot,
      relativePath: path.posix.join(packageDir, 'package-lock.json'),
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
  }

  for (const relativePath of canonicalSystem.jsonFiles || []) {
    updates.push(prepareDeclaredJsonUpdate({
      rootDir: resolvedRoot,
      relativePath,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
  }
  for (const relativePath of canonicalSystem.tomlFiles || []) {
    updates.push(prepareTomlUpdate({
      rootDir: resolvedRoot,
      relativePath,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
  }
  for (const target of canonicalSystem.cargoLockPackages || []) {
    updates.push(prepareCargoLockPackageUpdate({
      rootDir: resolvedRoot,
      target,
      currentVersion: normalizedCurrentVersion,
      nextVersion: normalizedNextVersion,
    }));
  }
  updates.push(...prepareVersionTargetUpdates({
    rootDir: resolvedRoot,
    targets: canonicalSystem.versionTargets,
    currentVersion: normalizedCurrentVersion,
    nextVersion: normalizedNextVersion,
  }));
  return updates;
};

const mergePreparedUpdates = (updates) => {
  const updatesByFile = new Map();
  for (const update of updates) {
    const entries = updatesByFile.get(update.filePath) || [];
    entries.push(update);
    updatesByFile.set(update.filePath, entries);
  }
  return Array.from(updatesByFile.values(), (entries) => {
    if (entries.length === 1) return entries[0];
    if (entries.some((entry) => !entry.edits || entry.original !== entries[0].original)) {
      throw new Error(`${entries[0].relativePath} 存在无法合并的重复版本更新`);
    }
    const edits = entries.flatMap((entry) => entry.edits);
    return {
      ...entries[0],
      content: applyEdits(entries[0].original, edits, entries[0].relativePath),
      edits,
    };
  });
};

const restorePreparedUpdates = (updates) => {
  for (const update of updates) {
    writeText(update.filePath, update.original);
  }
};

const writePreparedUpdates = (updates, writeTarget = writeText) => {
  for (const update of updates) {
    if (update.content !== update.original) {
      writeTarget(update.filePath, update.content);
    }
  }
};

const syncSystemVersion = ({ rootDir, system, currentVersion, nextVersion, writeTarget = writeText }) => {
  const updates = prepareSystemVersionSync({ rootDir, system, currentVersion, nextVersion });
  try {
    writePreparedUpdates(updates, writeTarget);
  } catch (error) {
    try {
      restorePreparedUpdates(updates);
    } catch (restoreError) {
      throw new Error(`${error.message}；恢复版本目标失败：${restoreError.message}`);
    }
    throw error;
  }
  return updates
    .filter((update) => update.content !== update.original)
    .map((update) => update.relativePath)
    .sort();
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

const findStashRef = (rootDir, marker) => {
  if (!marker) return '';
  const lines = git({ rootDir, args: ['stash', 'list', '--format=%gd %gs'] })
    .trim()
    .split('\n')
    .filter(Boolean);
  const matched = lines.find((line) => line.endsWith(marker));
  return matched ? matched.split(' ')[0] : '';
};

const popStash = (rootDir, marker) => {
  const stashRef = findStashRef(rootDir, marker);
  if (stashRef) git({ rootDir, args: ['stash', 'pop', '--index', stashRef] });
};

const restoreVersioningTransaction = ({ rootDir, originalHead, stashMarker, updates }) => {
  const stashRef = findStashRef(rootDir, stashMarker);
  restorePreparedUpdates(updates);
  git({ rootDir, args: ['reset', '--hard', originalHead] });
  if (!stashRef) return;
  git({ rootDir, args: ['clean', '-fd'] });
  git({ rootDir, args: ['stash', 'apply', '--index', stashRef] });
  git({ rootDir, args: ['stash', 'drop', stashRef] });
};

const buildSystemVersionedCommitMessage = ({ message, bumps }) => {
  const text = normalizeCommitMessage(message).replace(/\n$/, '');
  const lines = text.split('\n');
  const summary = stripVersionPrefix(lines[0] || '');
  const body = lines.slice(1).join('\n');
  const prefixes = bumps.length
    ? [...bumps]
      .sort((left, right) => {
        if (left.system.id < right.system.id) return -1;
        if (left.system.id > right.system.id) return 1;
        return 0;
      })
      .map(({ system, nextVersion }) => `[${system.id}-v${nextVersion}]`)
      .join('')
    : '[repo]';
  const nextSummary = `${prefixes} ${summary}`;
  return body ? `${nextSummary}\n${body}\n` : `${nextSummary}\n`;
};

const applyVersioningToHeadCommit = ({ rootDir, writeTarget = writeText }) => {
  const resolvedRoot = path.resolve(rootDir);
  const bypass = String(process.env.CODEX_VERSIONING_BYPASS || '').trim();
  if (bypass === '1' || bypass.toLowerCase() === 'true') {
    return { skipped: true, reason: 'bypass' };
  }
  validateSystemRegistry(resolvedRoot);

  const fullMessage = git({ rootDir: resolvedRoot, args: ['log', '-1', '--pretty=%B'] });
  const rawSummary = getCommitSummary(fullMessage);
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
  const repoOnly = !systemIds.length && parseCommitScope(summary) === 'repo';
  if (!systemIds.length && !repoOnly) {
    return {
      skipped: true,
      reason: 'no-systems',
    };
  }

  const originalHead = git({ rootDir: resolvedRoot, args: ['rev-parse', 'HEAD'] }).trim();
  const stashMarker = stashLocalChanges(resolvedRoot);
  let updates = [];
  let bumps = [];
  let changedFiles = [];

  try {
    bumps = planSystemBumps({ rootDir: resolvedRoot, systemIds, bumpType });
    updates = mergePreparedUpdates(bumps.flatMap((bump) => prepareSystemVersionSync({
      rootDir: resolvedRoot,
      ...bump,
    })));
    changedFiles = Array.from(new Set(
      updates
        .filter((update) => update.content !== update.original)
        .map((update) => update.relativePath)
    )).sort();
    writePreparedUpdates(updates, writeTarget);

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
  } catch (error) {
    try {
      restoreVersioningTransaction({
        rootDir: resolvedRoot,
        originalHead,
        stashMarker,
        updates,
      });
    } catch (restoreError) {
      throw new Error(`${error.message}；回滚版本事务失败：${restoreError.message}`);
    }
    throw error;
  }

  return {
    skipped: false,
    repoOnly,
    bumpType,
    bumps,
    changedFiles,
  };
};

module.exports = {
  applyVersioningToHeadCommit,
  bumpVersion,
  buildSystemVersionedCommitMessage,
  normalizeCommitMessage,
  parseCommitScope,
  parseCommitBumpType,
  planSystemBumps,
  prepareSystemVersionSync,
  pushCurrentBranch,
  classifyChangedPaths,
  findSystemVersionDrift,
  readSystemVersion,
  resolveAffectedSystems,
  stripVersionPrefix,
  syncSystemVersion,
  validateCommitMessage,
};
