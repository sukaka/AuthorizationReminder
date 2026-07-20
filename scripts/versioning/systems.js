const fs = require('node:fs');
const path = require('node:path');
const { assertStrictSemVer } = require('./semver');

const freezeSystem = (system) => Object.freeze({
  ...system,
  paths: Object.freeze(system.paths),
  packageDirs: Object.freeze(system.packageDirs),
  jsonFiles: Object.freeze(system.jsonFiles || []),
  tomlFiles: Object.freeze(system.tomlFiles || []),
  cargoLockPackages: Object.freeze((system.cargoLockPackages || []).map(Object.freeze)),
  versionTargets: Object.freeze((system.versionTargets || []).map(Object.freeze)),
});

const SYSTEMS = Object.freeze([
  freezeSystem({
    id: 'ai-assistant',
    name: '聚信 AI 助手',
    versionFile: 'juxin-ai-assistant/VERSION',
    paths: ['juxin-ai-assistant'],
    packageDirs: ['juxin-ai-assistant/apps/desktop'],
    jsonFiles: ['juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json'],
    tomlFiles: ['juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml'],
    cargoLockPackages: [{
      file: 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.lock',
      packageName: 'juxin-ai-assistant',
    }],
    versionTargets: [
      {
        file: 'juxin-ai-assistant/server/app/config.py',
        field: 'Settings.app_version',
        pattern: /^[ \t]*app_version: str = "(?<version>\d+\.\d+\.\d+)"[ \t]*$/m,
      },
      {
        file: 'docker-compose.yml',
        field: 'services.ai-assistant-api.environment.APP_VERSION',
        pattern: /^  ai-assistant-api:\n(?: {4,}.*\n)*?      APP_VERSION: "(?<version>\d+\.\d+\.\d+)"[ \t]*$/m,
      },
    ],
  }),
  freezeSystem({
    id: 'auth',
    name: '统一登录系统',
    versionFile: 'auth/VERSION',
    paths: ['auth'],
    packageDirs: ['auth'],
  }),
  freezeSystem({
    id: 'big-screen',
    name: '大屏中心',
    versionFile: 'big-screen-center/VERSION',
    paths: ['big-screen-center'],
    packageDirs: ['big-screen-center/backend', 'big-screen-center/frontend'],
  }),
  freezeSystem({
    id: 'cmdb',
    name: '配置管理数据库',
    versionFile: 'cmdb/VERSION',
    paths: ['cmdb'],
    packageDirs: ['cmdb/web'],
  }),
  freezeSystem({
    id: 'delivery',
    name: '交付管理',
    versionFile: 'delivery/VERSION',
    paths: ['delivery'],
    packageDirs: ['delivery/backend', 'delivery/frontend'],
  }),
  freezeSystem({
    id: 'device-flow',
    name: '设备流转',
    versionFile: 'device-flow/VERSION',
    paths: ['device-flow'],
    packageDirs: ['device-flow/backend', 'device-flow/frontend'],
  }),
  freezeSystem({
    id: 'faq',
    name: '常见问题',
    versionFile: 'faq/VERSION',
    paths: ['faq'],
    packageDirs: ['faq/backend', 'faq/frontend'],
  }),
  freezeSystem({
    id: 'inventory',
    name: '库存管理',
    versionFile: 'inventory-system/VERSION',
    paths: ['inventory-system'],
    packageDirs: [
      'inventory-system/backend',
      'inventory-system/frontend',
      'inventory-system/shipping-gateway',
    ],
  }),
  freezeSystem({
    id: 'prompt-center',
    name: '提示词中心',
    versionFile: 'prompt-center/VERSION',
    paths: ['prompt-center'],
    packageDirs: ['prompt-center/backend', 'prompt-center/frontend'],
  }),
  freezeSystem({
    id: 'reminder',
    name: '授权提醒',
    versionFile: 'server/VERSION',
    paths: ['server', 'web'],
    packageDirs: ['web'],
  }),
  freezeSystem({
    id: 'sca',
    name: '九章软件开源组件分析系统',
    versionFile: 'sca-platform/VERSION',
    paths: ['sca-platform'],
    packageDirs: ['sca-platform/frontend'],
    versionTargets: [
      {
        file: 'sca-platform/backend/app/config.py',
        field: 'Settings.app_version',
        pattern: /^[ \t]*app_version: str = "(?<version>\d+\.\d+\.\d+)"[ \t]*$/m,
      },
      {
        file: 'sca-platform/docker-compose.yml',
        field: 'x-sca-environment.APP_VERSION',
        pattern: /^  APP_VERSION: \$\{SCA_APP_VERSION:-(?<version>\d+\.\d+\.\d+)\}[ \t]*$/m,
      },
      {
        file: 'sca-platform/.env.example',
        field: 'APP_VERSION',
        pattern: /^APP_VERSION=(?<version>\d+\.\d+\.\d+)[ \t]*$/m,
      },
      {
        file: 'sca-platform/.env.example',
        field: 'SCA_APP_VERSION',
        pattern: /^SCA_APP_VERSION=(?<version>\d+\.\d+\.\d+)[ \t]*$/m,
      },
      ...['sca-api', 'sca-worker', 'sca-scanner-worker', 'sca-beat'].map((service) => ({
        file: 'docker-compose.yml',
        field: `services.${service}.environment.APP_VERSION`,
        pattern: new RegExp(`^  ${service}:\\n(?: {4,}.*\\n)*?      APP_VERSION: \\$\\{SCA_APP_VERSION:-(?<version>\\d+\\.\\d+\\.\\d+)\\}[ \\t]*$`, 'm'),
      })),
    ],
  }),
  freezeSystem({
    id: 'sec-impl',
    name: '安全实施',
    versionFile: 'sec-impl/VERSION',
    paths: ['sec-impl'],
    packageDirs: ['sec-impl/backend', 'sec-impl/frontend'],
  }),
  freezeSystem({
    id: 'tender',
    name: '招标管理',
    versionFile: 'tender/VERSION',
    paths: ['tender'],
    packageDirs: ['tender/backend', 'tender/frontend'],
  }),
  freezeSystem({
    id: 'ticketing',
    name: '工单管理',
    versionFile: 'ticketing/VERSION',
    paths: ['ticketing'],
    packageDirs: ['ticketing', 'ticketing/web'],
  }),
  freezeSystem({
    id: 'train-exam',
    name: '培训考试',
    versionFile: 'train-exam/VERSION',
    paths: ['train-exam'],
    packageDirs: ['train-exam/backend', 'train-exam/frontend'],
  }),
]);

const SHARED_PATHS = Object.freeze([
  'README.md',
  'deploy',
  'https-nginx',
  'scripts/deploy',
  'scripts/dev',
  'scripts/tests',
]);

const SYSTEM_BY_ID = new Map(SYSTEMS.map((system) => [system.id, system]));
const ROOT_DOCKER_COMPOSE_RE = /^docker-compose[^/]*\.yml$/;

const pathMatches = (candidate, ownedPath) => candidate === ownedPath || candidate.startsWith(`${ownedPath}/`);

const isSharedPath = (candidate) => (
  ROOT_DOCKER_COMPOSE_RE.test(candidate)
  || SHARED_PATHS.some((sharedPath) => pathMatches(candidate, sharedPath))
);

const normalizeRelativePath = (value) => {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`非法相对路径：${value}`);
  }
  return normalized;
};

const pathsOverlap = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const isOwnedPath = (candidate, ownedPaths) => ownedPaths.some((ownedPath) => candidate === ownedPath || candidate.startsWith(`${ownedPath}/`));

const validateRegistryEntries = (entries) => {
  if (!Array.isArray(entries)) {
    throw new Error('系统注册表必须是数组');
  }

  const ids = new Set();
  const ownedPaths = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error('系统 ID 非法');
    }
    if (ids.has(entry.id)) {
      throw new Error(`系统 ID 重复：${entry.id}`);
    }
    ids.add(entry.id);

    if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
      throw new Error(`系统路径缺失：${entry.id}`);
    }
    const entryPaths = entry.paths.map(normalizeRelativePath);
    for (const ownedPath of entryPaths) {
      const conflict = ownedPaths.find((existing) => pathsOverlap(existing.path, ownedPath));
      if (conflict) {
        throw new Error(`路径归属重叠：${conflict.id}:${conflict.path} 与 ${entry.id}:${ownedPath}`);
      }
      ownedPaths.push({ id: entry.id, path: ownedPath });
    }

    for (const packageDir of entry.packageDirs || []) {
      const normalizedPackageDir = normalizeRelativePath(packageDir);
      if (!isOwnedPath(normalizedPackageDir, entryPaths)) {
        throw new Error(`未知包目录：${entry.id}:${normalizedPackageDir}`);
      }
    }
  }
};

const validateDeclaredFiles = (system, field, description) => {
  if (!Array.isArray(system[field])) {
    throw new Error(`${description}声明非法：${system.id}`);
  }
  const ownedPaths = system.paths.map(normalizeRelativePath);
  for (const filePath of system[field]) {
    const normalizedFilePath = normalizeRelativePath(filePath);
    if (!isOwnedPath(normalizedFilePath, ownedPaths)) {
      throw new Error(`${description}不属于系统：${system.id}:${normalizedFilePath}`);
    }
  }
};

const validateCargoLockPackages = (system) => {
  if (!Array.isArray(system.cargoLockPackages)) {
    throw new Error(`Cargo.lock 版本目标声明非法：${system.id}`);
  }
  const ownedPaths = system.paths.map(normalizeRelativePath);
  for (const target of system.cargoLockPackages) {
    if (!target || typeof target.file !== 'string' || typeof target.packageName !== 'string' || !target.packageName.trim()) {
      throw new Error(`Cargo.lock 版本目标声明非法：${system.id}`);
    }
    const normalizedFilePath = normalizeRelativePath(target.file);
    if (!isOwnedPath(normalizedFilePath, ownedPaths)) {
      throw new Error(`Cargo.lock 版本文件不属于系统：${system.id}:${normalizedFilePath}`);
    }
  }
};

const matchVersionTarget = (source, target) => {
  const flags = Array.from(new Set(`${target.pattern.flags.replace(/[dgy]/g, '')}dg`)).join('');
  const matches = Array.from(String(source).matchAll(new RegExp(target.pattern.source, flags)));
  if (matches.length !== 1 || !matches[0].groups?.version || !matches[0].indices?.groups?.version) {
    throw new Error(`${target.file} ${target.field} 版本目标缺失或重复`);
  }
  const [start, end] = matches[0].indices.groups.version;
  return { value: matches[0].groups.version, start, end };
};

const validateVersionTargets = (rootDir, system, currentVersion, declaredTargets) => {
  if (!Array.isArray(system.versionTargets)) {
    throw new Error(`运行时版本目标声明非法：${system.id}`);
  }
  const ownedPaths = system.paths.map(normalizeRelativePath);
  for (const target of system.versionTargets) {
    if (!target || typeof target.file !== 'string' || typeof target.field !== 'string' || !(target.pattern instanceof RegExp)) {
      throw new Error(`运行时版本目标声明非法：${system.id}`);
    }
    const relativePath = normalizeRelativePath(target.file);
    if (!isOwnedPath(relativePath, ownedPaths) && !isSharedPath(relativePath)) {
      throw new Error(`运行时版本文件不属于系统或共享路径：${system.id}:${relativePath}`);
    }
    const targetKey = `${relativePath}:${target.field}`;
    if (declaredTargets.has(targetKey)) {
      throw new Error(`运行时版本目标重复：${targetKey}`);
    }
    declaredTargets.add(targetKey);
    const filePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`缺少运行时版本文件：${relativePath}`);
    }
    const match = matchVersionTarget(fs.readFileSync(filePath, 'utf8'), target);
    assertStrictSemVer(match.value, `${relativePath} ${target.field}`);
    if (match.value !== currentVersion) {
      throw new Error(`${relativePath} ${target.field} 与 VERSION 不一致：期望 ${currentVersion}，实际 ${match.value}`);
    }
  }
};

const validateSystemRegistry = (rootDir) => {
  validateRegistryEntries(SYSTEMS);
  const resolvedRoot = path.resolve(rootDir);
  const declaredTargets = new Set();

  for (const system of SYSTEMS) {
    if (typeof system.name !== 'string' || !system.name.trim()) {
      throw new Error(`系统名称非法：${system.id}`);
    }
    if (typeof system.versionFile !== 'string' || !system.versionFile.trim()) {
      throw new Error(`版本源声明非法：${system.id}`);
    }

    const versionFile = normalizeRelativePath(system.versionFile);
    if (!isOwnedPath(versionFile, system.paths.map(normalizeRelativePath))) {
      throw new Error(`版本源不属于系统：${system.id}:${versionFile}`);
    }
    const versionFilePath = path.join(resolvedRoot, versionFile);
    if (!fs.existsSync(versionFilePath)) {
      throw new Error(`缺少版本源：${versionFile}`);
    }
    const versionSource = fs.readFileSync(versionFilePath, 'utf8');
    if (!versionSource.endsWith('\n') || versionSource.slice(0, -1).includes('\n')) {
      throw new Error(`版本源非法：${versionFile}`);
    }
    try {
      assertStrictSemVer(versionSource.slice(0, -1), `版本源 ${versionFile}`);
    } catch (_error) {
      throw new Error(`版本源非法：${versionFile}`);
    }

    for (const packageDir of system.packageDirs) {
      const packageFile = path.join(resolvedRoot, normalizeRelativePath(packageDir), 'package.json');
      if (!fs.existsSync(packageFile)) {
        throw new Error(`未知包目录：${system.id}:${packageDir}`);
      }
    }

    validateDeclaredFiles(system, 'jsonFiles', 'JSON 版本文件');
    validateDeclaredFiles(system, 'tomlFiles', 'TOML 版本文件');
    validateCargoLockPackages(system);
    validateVersionTargets(resolvedRoot, system, versionSource.slice(0, -1), declaredTargets);
  }
};

module.exports = {
  SYSTEMS,
  SHARED_PATHS,
  SYSTEM_BY_ID,
  isSharedPath,
  matchVersionTarget,
  validateRegistryEntries,
  validateSystemRegistry,
};
