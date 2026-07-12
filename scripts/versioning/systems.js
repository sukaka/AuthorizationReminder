const fs = require('node:fs');
const path = require('node:path');

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\n$/;

const freezeSystem = (system) => Object.freeze({
  ...system,
  paths: Object.freeze(system.paths),
  packageDirs: Object.freeze(system.packageDirs),
  textFiles: Object.freeze(system.textFiles),
  jsonFiles: Object.freeze(system.jsonFiles || []),
  tomlFiles: Object.freeze(system.tomlFiles || []),
});

const SYSTEMS = Object.freeze([
  freezeSystem({
    id: 'ai-assistant',
    name: '聚信 AI 助手',
    versionFile: 'juxin-ai-assistant/VERSION',
    paths: ['juxin-ai-assistant'],
    packageDirs: ['juxin-ai-assistant/apps/desktop'],
    textFiles: [],
    jsonFiles: ['juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json'],
    tomlFiles: ['juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml'],
  }),
  freezeSystem({
    id: 'auth',
    name: '统一登录系统',
    versionFile: 'auth/VERSION',
    paths: ['auth'],
    packageDirs: ['auth'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'big-screen',
    name: '大屏中心',
    versionFile: 'big-screen-center/VERSION',
    paths: ['big-screen-center'],
    packageDirs: ['big-screen-center/backend', 'big-screen-center/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'cmdb',
    name: '配置管理数据库',
    versionFile: 'cmdb/VERSION',
    paths: ['cmdb'],
    packageDirs: ['cmdb/web'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'delivery',
    name: '交付管理',
    versionFile: 'delivery/VERSION',
    paths: ['delivery'],
    packageDirs: ['delivery/backend', 'delivery/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'device-flow',
    name: '设备流转',
    versionFile: 'device-flow/VERSION',
    paths: ['device-flow'],
    packageDirs: ['device-flow/backend', 'device-flow/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'faq',
    name: '常见问题',
    versionFile: 'faq/VERSION',
    paths: ['faq'],
    packageDirs: ['faq/backend', 'faq/frontend'],
    textFiles: [],
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
    textFiles: [],
  }),
  freezeSystem({
    id: 'prompt-center',
    name: '提示词中心',
    versionFile: 'prompt-center/VERSION',
    paths: ['prompt-center'],
    packageDirs: ['prompt-center/backend', 'prompt-center/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'reminder',
    name: '授权提醒',
    versionFile: 'server/VERSION',
    paths: ['server'],
    packageDirs: [],
    textFiles: [],
  }),
  freezeSystem({
    id: 'sca',
    name: '软件成分分析平台',
    versionFile: 'sca-platform/VERSION',
    paths: ['sca-platform'],
    packageDirs: ['sca-platform/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'sec-impl',
    name: '安全实施',
    versionFile: 'sec-impl/VERSION',
    paths: ['sec-impl'],
    packageDirs: ['sec-impl/backend', 'sec-impl/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'tender',
    name: '招标管理',
    versionFile: 'tender/VERSION',
    paths: ['tender'],
    packageDirs: ['tender/backend', 'tender/frontend'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'ticketing',
    name: '工单管理',
    versionFile: 'ticketing/VERSION',
    paths: ['ticketing'],
    packageDirs: ['ticketing', 'ticketing/web'],
    textFiles: [],
  }),
  freezeSystem({
    id: 'train-exam',
    name: '培训考试',
    versionFile: 'train-exam/VERSION',
    paths: ['train-exam'],
    packageDirs: ['train-exam/backend', 'train-exam/frontend'],
    textFiles: [],
  }),
]);

const SHARED_PATHS = Object.freeze([
  'docker-compose.yml',
  'docker-compose.all-systems-https.yml',
  'README.md',
  'deploy',
  'https-nginx',
  'scripts/deploy',
  'scripts/dev',
  'scripts/tests',
]);

const SYSTEM_BY_ID = new Map(SYSTEMS.map((system) => [system.id, system]));

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

const validateSystemRegistry = (rootDir) => {
  validateRegistryEntries(SYSTEMS);
  const resolvedRoot = path.resolve(rootDir);

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
    const version = fs.readFileSync(versionFilePath, 'utf8');
    if (!VERSION_RE.test(version)) {
      throw new Error(`版本源非法：${versionFile}`);
    }

    for (const packageDir of system.packageDirs) {
      const packageFile = path.join(resolvedRoot, normalizeRelativePath(packageDir), 'package.json');
      if (!fs.existsSync(packageFile)) {
        throw new Error(`未知包目录：${system.id}:${packageDir}`);
      }
    }

    validateDeclaredFiles(system, 'textFiles', '文本版本文件');
    validateDeclaredFiles(system, 'jsonFiles', 'JSON 版本文件');
    validateDeclaredFiles(system, 'tomlFiles', 'TOML 版本文件');
  }
};

module.exports = {
  SYSTEMS,
  SHARED_PATHS,
  SYSTEM_BY_ID,
  validateRegistryEntries,
  validateSystemRegistry,
};
