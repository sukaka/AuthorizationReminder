const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  parseCommitBumpType,
  bumpVersion,
  applyVersioningToHeadCommit,
  buildSystemVersionedCommitMessage,
  pushCurrentBranch,
  validateCommitMessage,
  normalizeCommitMessage,
  parseCommitScope,
  classifyChangedPaths,
  resolveAffectedSystems,
  readSystemVersion,
  findSystemVersionDrift,
  syncSystemVersion,
  planSystemBumps,
} = require('../scripts/versioning/automation');
const { runPostCommit } = require('../scripts/versioning/post-commit');
const {
  SYSTEMS,
  SYSTEM_BY_ID,
  validateRegistryEntries,
  validateSystemRegistry,
} = require('../scripts/versioning/systems');

const repositoryRoot = path.join(__dirname, '..');
const versioningDocs = fs.readFileSync(path.join(repositoryRoot, 'docs/versioning.md'), 'utf8');

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

const makeSystemRegistryFixture = ({ missingVersionFile = '' } = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-system-registry-'));
  for (const system of SYSTEMS) {
    if (system.versionFile !== missingVersionFile) {
      writeText(path.join(rootDir, system.versionFile), '1.0.0\n');
    }
    for (const packageDir of system.packageDirs) {
      writeJson(path.join(rootDir, packageDir, 'package.json'), { name: packageDir, version: '1.0.0' });
    }
  }
  return rootDir;
};

const makeIndependentVersionFixture = () => {
  const rootDir = makeSystemRegistryFixture();

  for (const system of SYSTEMS) {
    for (const packageDir of system.packageDirs) {
      writeJson(path.join(rootDir, packageDir, 'package-lock.json'), makePackageLock('1.0.0'));
    }
    for (const jsonFile of system.jsonFiles || []) {
      writeJson(path.join(rootDir, jsonFile), { name: system.id, version: '1.0.0' });
    }
    for (const tomlFile of system.tomlFiles || []) {
      writeText(
        path.join(rootDir, tomlFile),
        '[package]\nname = "fixture"\nversion = "1.0.0"\n[dependencies]\nexample = { version = "1.0.0" }\n'
      );
    }
  }

  return rootDir;
};

const readPackageVersion = (rootDir, packageDir) => JSON.parse(
  fs.readFileSync(path.join(rootDir, packageDir, 'package.json'), 'utf8')
).version;

const readPackageLockVersion = (rootDir, packageDir) => JSON.parse(
  fs.readFileSync(path.join(rootDir, packageDir, 'package-lock.json'), 'utf8')
).packages[''].version;

const readPackageLock = (rootDir, packageDir) => JSON.parse(
  fs.readFileSync(path.join(rootDir, packageDir, 'package-lock.json'), 'utf8')
);

const initializeIndependentVersionGitRepo = ({ branch = 'feature/independent-versions' } = {}) => {
  const rootDir = makeIndependentVersionFixture();
  const git = (...args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' });

  git('init');
  git('config', 'user.name', 'Codex Test');
  git('config', 'user.email', 'codex@example.com');
  git('checkout', '-b', branch);
  git('add', '.');
  git('commit', '-m', 'chore(repo): initialize version fixtures');

  return { rootDir, git };
};

test('system registry defines every approved independent system', () => {
  assert.deepEqual(
    SYSTEMS.map((system) => system.id),
    [
      'ai-assistant',
      'auth',
      'big-screen',
      'cmdb',
      'delivery',
      'device-flow',
      'faq',
      'inventory',
      'prompt-center',
      'reminder',
      'sca',
      'sec-impl',
      'tender',
      'ticketing',
      'train-exam',
    ]
  );
  assert.equal(SYSTEMS.every((system) => !Object.hasOwn(system, 'textFiles')), true);
  assert.deepEqual(SYSTEM_BY_ID.get('reminder').paths, ['server', 'web']);
  assert.deepEqual(SYSTEM_BY_ID.get('reminder').packageDirs, ['web']);
});

test('validateRegistryEntries rejects overlapping owned paths', () => {
  assert.throws(
    () => validateRegistryEntries([
      { id: 'a', paths: ['foo'] },
      { id: 'b', paths: ['foo/bar'] },
    ]),
    /路径归属重叠/
  );
});

test('validateRegistryEntries rejects package directories outside system ownership', () => {
  assert.throws(
    () => validateRegistryEntries([{ id: 'a', paths: ['foo'], packageDirs: ['bar'] }]),
    /未知包目录/
  );
});

test('validateSystemRegistry validates every declared version source', () => {
  assert.doesNotThrow(() => validateSystemRegistry(path.join(__dirname, '..')));
});

test('validateSystemRegistry rejects missing version sources', () => {
  const rootDir = makeSystemRegistryFixture({ missingVersionFile: 'server/VERSION' });

  assert.throws(() => validateSystemRegistry(rootDir), /缺少版本源：server\/VERSION/);
});

test('validateSystemRegistry rejects VERSION files with whitespace or extra blank lines', () => {
  for (const invalidContent of ['1.0.0 \n', '1.0.0\n\n']) {
    const rootDir = makeSystemRegistryFixture();
    writeText(path.join(rootDir, 'server/VERSION'), invalidContent);

    assert.throws(
      () => validateSystemRegistry(rootDir),
      /版本源非法：server\/VERSION/
    );
  }
});

test('validateSystemRegistry rejects VERSION segments with leading zeros', () => {
  for (const invalidContent of ['01.0.0\n', '1.02.0\n', '1.0.03\n']) {
    const rootDir = makeSystemRegistryFixture();
    writeText(path.join(rootDir, 'server/VERSION'), invalidContent);

    assert.throws(
      () => validateSystemRegistry(rootDir),
      /版本源非法：server\/VERSION/
    );
  }
});

test('validateSystemRegistry accepts zero and multi-digit VERSION segments', () => {
  for (const validContent of ['0.0.0\n', '10.20.30\n']) {
    const rootDir = makeSystemRegistryFixture();
    writeText(path.join(rootDir, 'server/VERSION'), validContent);

    assert.doesNotThrow(() => validateSystemRegistry(rootDir));
  }
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

test('parseCommitScope extracts normalized scopes after version prefixes', () => {
  assert.equal(parseCommitScope('[v5.1.0] fix(Auth): repair session'), 'auth');
  assert.equal(parseCommitScope('feat: add system registry'), '');
});

test('classifyChangedPaths separates owned, shared, and repo paths', () => {
  assert.deepEqual(
    classifyChangedPaths([
      'auth/index.js',
      'docker-compose.yml',
      'docs/versioning.md',
      'inventory-system/backend/src/index.js',
    ]),
    {
      systemIds: ['auth', 'inventory'],
      sharedPaths: ['docker-compose.yml'],
      repoPaths: ['docs/versioning.md'],
    }
  );
});

test('classifyChangedPaths treats every future root docker-compose yml as shared', () => {
  assert.deepEqual(
    classifyChangedPaths([
      'docker-compose.future-overlay.yml',
      'docker-composeexperimental.yml',
      'docs/docker-compose.future-overlay.yml',
    ]),
    {
      systemIds: [],
      sharedPaths: [
        'docker-compose.future-overlay.yml',
        'docker-composeexperimental.yml',
      ],
      repoPaths: ['docs/docker-compose.future-overlay.yml'],
    }
  );
});

test('resolveAffectedSystems detects a single business system from paths', () => {
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'fix: repair session handling',
      changedPaths: ['auth/index.js'],
    }),
    ['auth']
  );
});

test('resolveAffectedSystems detects multiple business systems', () => {
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'feat: improve login and stock',
      changedPaths: ['auth/index.js', 'inventory-system/backend/src/index.js'],
    }),
    ['auth', 'inventory']
  );
});

test('classifies and resolves unordered paths with deterministic system ordering', () => {
  const changedPaths = [
    'inventory-system/backend/src/index.js',
    'juxin-ai-assistant/apps/desktop/src-tauri/src/main.rs',
    'auth/index.js',
  ];

  assert.deepEqual(classifyChangedPaths(changedPaths).systemIds, [
    'ai-assistant',
    'auth',
    'inventory',
  ]);
  assert.deepEqual(
    resolveAffectedSystems({ summary: 'feat: coordinate systems', changedPaths }),
    ['ai-assistant', 'auth', 'inventory']
  );
});

test('shared paths require an explicit scope', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix: adjust compose routing',
      changedPaths: ['docker-compose.yml'],
    }),
    /共享文件.*scope/
  );
});

test('shared paths require an explicit scope alongside owned business paths', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix: adjust auth compose routing',
      changedPaths: ['docker-compose.yml', 'auth/index.js'],
    }),
    /共享文件.*scope/
  );
});

test('recognized scope covers shared paths alongside matching owned business paths', () => {
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'fix(auth): adjust auth compose routing',
      changedPaths: ['docker-compose.yml', 'auth/index.js'],
    }),
    ['auth']
  );
});

test('mismatched scope is rejected for shared paths alongside owned business paths', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix(inventory): adjust auth compose routing',
      changedPaths: ['docker-compose.yml', 'auth/index.js'],
    }),
    /scope inventory.*auth/
  );
});

test('resolveAffectedSystems expands all scope and accepts repo scope', () => {
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'feat(all): coordinate release behavior',
      changedPaths: ['docker-compose.yml'],
    }),
    SYSTEMS.map((system) => system.id)
  );
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'chore(repo): update release documentation',
      changedPaths: ['docs/versioning.md'],
    }),
    []
  );
});

test('resolveAffectedSystems rejects repo scope for shared paths', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'chore(repo): adjust compose routing',
      changedPaths: ['docker-compose.yml'],
    }),
    /scope repo.*共享文件/
  );
});

test('versioning docs describe the same shared and repo scope behavior as the resolver', () => {
  assert.match(versioningDocs, /共享文件必须使用具体系统 scope 或 `all`/);
  assert.match(versioningDocs, /`repo` 仅用于仓库自身且不属于共享路径的变更/);
  assert.doesNotMatch(versioningDocs, /共享文件[^\n]*scope、`all` 或 `repo`/);
});

test('resolveAffectedSystems rejects unknown and mismatched system scopes', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix(unknown): adjust system routing',
      changedPaths: ['docker-compose.yml'],
    }),
    /未知系统 scope：unknown/
  );
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix(auth): adjust inventory API',
      changedPaths: ['inventory-system/backend/src/index.js'],
    }),
    /scope auth.*inventory/
  );
});

test('commit-msg rejects unknown system scopes before post-commit', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-commit-msg-scope-'));
  const messageFile = path.join(rootDir, 'message.txt');
  writeText(messageFile, 'fix(unknown): reject invalid scope\n');

  assert.throws(
    () => execFileSync('node', ['scripts/versioning/commit-msg.js', messageFile], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'pipe',
    }),
    /未知系统 scope：unknown/
  );
});

test('bumpVersion increments the expected semver segment', () => {
  assert.equal(bumpVersion('4.1.4', 'patch'), '4.1.5');
  assert.equal(bumpVersion('4.1.4', 'minor'), '4.2.0');
  assert.equal(bumpVersion('4.1.4', 'major'), '5.0.0');
});

test('registry and automation share strict SemVer validation without leading zeros', () => {
  const systemsSource = fs.readFileSync(path.join(repositoryRoot, 'scripts/versioning/systems.js'), 'utf8');
  const automationSource = fs.readFileSync(path.join(repositoryRoot, 'scripts/versioning/automation.js'), 'utf8');

  assert.match(systemsSource, /require\(['"]\.\/semver['"]\)/);
  assert.match(automationSource, /require\(['"]\.\/semver['"]\)/);
  for (const version of ['01.0.0', '1.02.0', '1.0.03']) {
    assert.throws(() => bumpVersion(version, 'patch'), /SemVer|版本号/);
  }
});

test('syncSystemVersion updates every package in one system only', () => {
  const rootDir = makeIndependentVersionFixture();
  const changed = syncSystemVersion({
    rootDir,
    system: SYSTEM_BY_ID.get('inventory'),
    currentVersion: '1.0.0',
    nextVersion: '1.1.0',
  });

  assert.equal(readSystemVersion(rootDir, SYSTEM_BY_ID.get('inventory')), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/frontend'), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/backend'), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/shipping-gateway'), '1.1.0');
  assert.equal(readPackageLockVersion(rootDir, 'inventory-system/frontend'), '1.1.0');
  assert.equal(readPackageLockVersion(rootDir, 'inventory-system/backend'), '1.1.0');
  assert.equal(readPackageLockVersion(rootDir, 'inventory-system/shipping-gateway'), '1.1.0');
  const frontendLock = readPackageLock(rootDir, 'inventory-system/frontend');
  assert.equal(frontendLock.version, '1.1.0');
  assert.equal(frontendLock.packages[''].version, '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'auth'), '1.0.0');
  assert.ok(changed.includes('inventory-system/VERSION'));
  assert.ok(changed.includes('inventory-system/frontend/package-lock.json'));
});

test('findSystemVersionDrift reports declared package, lock, JSON, and TOML mismatches', () => {
  const rootDir = makeIndependentVersionFixture();
  const system = SYSTEM_BY_ID.get('ai-assistant');
  const packageDir = 'juxin-ai-assistant/apps/desktop';
  const packageLock = readPackageLock(rootDir, packageDir);

  writeJson(path.join(rootDir, packageDir, 'package.json'), { name: 'fixture', version: '9.0.0' });
  packageLock.version = '8.0.0';
  packageLock.packages[''].version = '7.0.0';
  writeJson(path.join(rootDir, packageDir, 'package-lock.json'), packageLock);
  writeJson(
    path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json'),
    { name: 'ai-assistant', version: '6.0.0' }
  );
  writeText(
    path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml'),
    '[package]\nname = "fixture"\nversion = "5.0.0"\n[dependencies]\nexample = { version = "1.0.0" }\n'
  );

  assert.deepEqual(findSystemVersionDrift(rootDir, system), [
    {
      file: 'juxin-ai-assistant/apps/desktop/package.json',
      field: 'version',
      expected: '1.0.0',
      actual: '9.0.0',
    },
    {
      file: 'juxin-ai-assistant/apps/desktop/package-lock.json',
      field: 'version',
      expected: '1.0.0',
      actual: '8.0.0',
    },
    {
      file: 'juxin-ai-assistant/apps/desktop/package-lock.json',
      field: "packages[''].version",
      expected: '1.0.0',
      actual: '7.0.0',
    },
    {
      file: 'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json',
      field: 'version',
      expected: '1.0.0',
      actual: '6.0.0',
    },
    {
      file: 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml',
      field: 'package.version',
      expected: '1.0.0',
      actual: '5.0.0',
    },
  ]);
});

test('repository runtime versions match every system VERSION source', () => {
  for (const system of SYSTEMS) {
    assert.equal(readSystemVersion(repositoryRoot, system), '1.0.0');
    assert.deepEqual(findSystemVersionDrift(repositoryRoot, system), []);
  }

  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const rootLock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  assert.equal(rootPackage.version, '1.0.0');
  assert.equal(rootLock.version, '1.0.0');
  assert.equal(rootLock.packages[''].version, '1.0.0');
});

test('syncSystemVersion uses canonical fields and ignores forged cross-system and parent paths', (t) => {
  const rootDir = makeIndependentVersionFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-versioning-outside-'));
  const outsideRelativePath = `../${path.basename(outsideDir)}`;
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  writeText(path.join(outsideDir, 'VERSION'), '1.0.0\n');
  writeJson(path.join(outsideDir, 'package.json'), { name: 'outside', version: '1.0.0' });
  writeJson(path.join(outsideDir, 'package-lock.json'), makePackageLock('1.0.0'));

  const changed = syncSystemVersion({
    rootDir,
    system: {
      ...SYSTEM_BY_ID.get('inventory'),
      versionFile: `${outsideRelativePath}/VERSION`,
      packageDirs: ['auth', outsideRelativePath],
    },
    currentVersion: '1.0.0',
    nextVersion: '1.1.0',
  });

  assert.equal(readSystemVersion(rootDir, SYSTEM_BY_ID.get('inventory')), '1.1.0');
  assert.equal(readSystemVersion(rootDir, SYSTEM_BY_ID.get('auth')), '1.0.0');
  assert.equal(readPackageVersion(rootDir, 'auth'), '1.0.0');
  assert.equal(fs.readFileSync(path.join(outsideDir, 'VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(readPackageVersion(outsideDir, '.'), '1.0.0');
  assert.deepEqual(changed, [
    'inventory-system/VERSION',
    'inventory-system/backend/package-lock.json',
    'inventory-system/backend/package.json',
    'inventory-system/frontend/package-lock.json',
    'inventory-system/frontend/package.json',
    'inventory-system/shipping-gateway/package-lock.json',
    'inventory-system/shipping-gateway/package.json',
  ]);
});

test('syncSystemVersion rejects source and current version mismatches before making changes', () => {
  const rootDir = makeIndependentVersionFixture();
  writeText(path.join(rootDir, 'inventory-system/VERSION'), '1.0.1\n');

  assert.throws(
    () => syncSystemVersion({
      rootDir,
      system: SYSTEM_BY_ID.get('inventory'),
      currentVersion: '1.0.0',
      nextVersion: '1.1.0',
    }),
    /inventory.*版本源.*当前版本/
  );

  assert.equal(readSystemVersion(rootDir, SYSTEM_BY_ID.get('inventory')), '1.0.1');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/frontend'), '1.0.0');
  assert.equal(readPackageLockVersion(rootDir, 'inventory-system/frontend'), '1.0.0');
});

test('syncSystemVersion rejects unknown system IDs before making changes', () => {
  const rootDir = makeIndependentVersionFixture();

  assert.throws(
    () => syncSystemVersion({
      rootDir,
      system: {
        id: 'unknown',
        versionFile: 'inventory-system/VERSION',
        packageDirs: ['inventory-system/frontend'],
      },
      currentVersion: '1.0.0',
      nextVersion: '1.1.0',
    }),
    /未知系统：unknown/
  );

  assert.equal(readSystemVersion(rootDir, SYSTEM_BY_ID.get('inventory')), '1.0.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/frontend'), '1.0.0');
  assert.equal(readPackageLockVersion(rootDir, 'inventory-system/frontend'), '1.0.0');
});

test('syncSystemVersion structurally updates AI assistant Tauri JSON and TOML', () => {
  const rootDir = makeIndependentVersionFixture();
  const changed = syncSystemVersion({
    rootDir,
    system: SYSTEM_BY_ID.get('ai-assistant'),
    currentVersion: '1.0.0',
    nextVersion: '1.0.1',
  });
  const tauriPath = 'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json';
  const cargoPath = 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml';

  assert.equal(readPackageVersion(rootDir, 'juxin-ai-assistant/apps/desktop'), '1.0.1');
  assert.equal(readPackageLockVersion(rootDir, 'juxin-ai-assistant/apps/desktop'), '1.0.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(rootDir, tauriPath), 'utf8')).version, '1.0.1');
  assert.match(
    fs.readFileSync(path.join(rootDir, cargoPath), 'utf8'),
    /^version = "1\.0\.1"\n\[dependencies\]\nexample = \{ version = "1\.0\.0" \}/m
  );
  assert.ok(changed.includes(tauriPath));
  assert.ok(changed.includes(cargoPath));
});

test('syncSystemVersion preflights every declared structure before writing', () => {
  const cases = [
    {
      name: 'package.json version',
      mutate(rootDir) {
        writeJson(path.join(rootDir, 'auth/package.json'), { name: 'auth' });
      },
    },
    {
      name: 'package.json version',
      mutate(rootDir) {
        writeJson(path.join(rootDir, 'auth/package.json'), { name: 'auth', version: '01.0.0' });
      },
    },
    {
      name: 'auth/package-lock.json',
      mutate(rootDir) {
        fs.rmSync(path.join(rootDir, 'auth/package-lock.json'));
      },
    },
    {
      name: 'package-lock.json top-level version',
      mutate(rootDir) {
        const packageLock = makePackageLock('1.0.0');
        delete packageLock.version;
        writeJson(path.join(rootDir, 'auth/package-lock.json'), packageLock);
      },
    },
    {
      name: "package-lock.json packages[''].version",
      mutate(rootDir) {
        const packageLock = makePackageLock('1.0.0');
        delete packageLock.packages[''].version;
        writeJson(path.join(rootDir, 'auth/package-lock.json'), packageLock);
      },
    },
    {
      name: 'declared JSON version',
      system: 'ai-assistant',
      mutate(rootDir) {
        writeJson(
          path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json'),
          { name: 'ai-assistant' }
        );
      },
    },
    {
      name: 'tauri.conf.json',
      system: 'ai-assistant',
      mutate(rootDir) {
        fs.rmSync(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json'));
      },
    },
    {
      name: 'TOML package version',
      system: 'ai-assistant',
      mutate(rootDir) {
        writeText(
          path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml'),
          '[package]\nname = "fixture"\n[dependencies]\nexample = { version = "1.0.0" }\n'
        );
      },
    },
    {
      name: 'Cargo.toml',
      system: 'ai-assistant',
      mutate(rootDir) {
        fs.rmSync(path.join(rootDir, 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml'));
      },
    },
  ];

  for (const testCase of cases) {
    const rootDir = makeIndependentVersionFixture();
    const system = SYSTEM_BY_ID.get(testCase.system || 'auth');
    testCase.mutate(rootDir);
    const beforeVersionSource = fs.readFileSync(path.join(rootDir, system.versionFile), 'utf8');

    assert.throws(
      () => syncSystemVersion({
        rootDir,
        system,
        currentVersion: '1.0.0',
        nextVersion: '1.0.1',
      }),
      new RegExp(testCase.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.equal(fs.readFileSync(path.join(rootDir, system.versionFile), 'utf8'), beforeVersionSource);
  }
});

test('sync and drift only use version inside the TOML package section', () => {
  const rootDir = makeIndependentVersionFixture();
  const system = SYSTEM_BY_ID.get('ai-assistant');
  const relativePath = 'juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml';
  writeText(
    path.join(rootDir, relativePath),
    'version = "9.9.9"\n[workspace]\nmembers = []\n[package]\nname = "fixture"\nversion = "1.0.0"\n[dependencies]\nexample = { version = "8.8.8" }\n'
  );

  assert.deepEqual(findSystemVersionDrift(rootDir, system), []);
  syncSystemVersion({
    rootDir,
    system,
    currentVersion: '1.0.0',
    nextVersion: '1.0.1',
  });

  const updated = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  assert.match(updated, /^version = "9\.9\.9"/);
  assert.match(updated, /\[package\]\nname = "fixture"\nversion = "1\.0\.1"/);
  assert.match(updated, /example = \{ version = "8\.8\.8" \}/);
});

test('planSystemBumps reads declared system versions in stable order', () => {
  const rootDir = makeIndependentVersionFixture();
  writeText(path.join(rootDir, 'auth/VERSION'), '2.4.9\n');
  writeText(path.join(rootDir, 'inventory-system/VERSION'), '3.0.0\n');

  const plan = planSystemBumps({
    rootDir,
    systemIds: ['inventory', 'auth'],
    bumpType: 'minor',
  });

  assert.deepEqual(
    plan.map(({ system, currentVersion, nextVersion }) => ({ id: system.id, currentVersion, nextVersion })),
    [
      { id: 'auth', currentVersion: '2.4.9', nextVersion: '2.5.0' },
      { id: 'inventory', currentVersion: '3.0.0', nextVersion: '3.1.0' },
    ]
  );
});

test('buildSystemVersionedCommitMessage sorts multi-system prefixes', () => {
  assert.equal(
    buildSystemVersionedCommitMessage({
      message: 'feat: improve stock login\n',
      bumps: [
        { system: { id: 'inventory' }, nextVersion: '1.1.0' },
        { system: { id: 'auth' }, nextVersion: '1.1.0' },
      ],
    }),
    '[auth-v1.1.0][inventory-v1.1.0] feat: improve stock login\n'
  );
});

test('applyVersioningToHeadCommit amends once for two systems and restores untracked files', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();

  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  writeText(path.join(rootDir, 'inventory-system/feature.js'), 'inventory change\n');
  git('add', 'auth/feature.js', 'inventory-system/feature.js');
  git('commit', '-m', 'feat: improve stock login');
  const beforeHead = git('rev-parse', 'HEAD').trim();
  writeText(path.join(rootDir, 'unrelated.txt'), 'preserve me\n');

  const result = applyVersioningToHeadCommit({ rootDir });

  const summary = git('log', '-1', '--pretty=%s').trim();
  const trackedFiles = git('show', '--name-only', '--pretty=', 'HEAD');
  const amendEntries = git('reflog', '--format=%gs').split('\n').filter((line) => line.includes('(amend)'));

  assert.equal(summary, '[auth-v1.1.0][inventory-v1.1.0] feat: improve stock login');
  assert.notEqual(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(amendEntries.length, 1);
  assert.equal(git('branch', '--show-current').trim(), 'feature/independent-versions');
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.1.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'inventory-system/VERSION'), 'utf8'), '1.1.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'server/VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'unrelated.txt'), 'utf8'), 'preserve me\n');
  assert.match(trackedFiles, /auth\/VERSION/);
  assert.match(trackedFiles, /inventory-system\/VERSION/);
  assert.deepEqual(result.bumps.map((bump) => bump.system.id), ['auth', 'inventory']);
});

test('applyVersioningToHeadCommit preserves staged, unstaged, and untracked user changes exactly', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  writeText(path.join(rootDir, 'user-staged.txt'), 'base staged\n');
  writeText(path.join(rootDir, 'user-unstaged.txt'), 'base unstaged\n');
  git('add', 'user-staged.txt', 'user-unstaged.txt');
  git('commit', '-m', 'chore(repo): add user change fixtures');

  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  git('add', 'auth/feature.js');
  git('commit', '-m', 'fix(auth): preserve local changes');

  writeText(path.join(rootDir, 'user-staged.txt'), 'staged user change\n');
  git('add', 'user-staged.txt');
  writeText(path.join(rootDir, 'user-unstaged.txt'), 'unstaged user change\n');
  writeText(path.join(rootDir, 'user-untracked.txt'), 'untracked user change\n');
  const beforeStatus = git('status', '--porcelain=v1', '--untracked-files=all');

  applyVersioningToHeadCommit({ rootDir });

  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), beforeStatus);
  assert.equal(fs.readFileSync(path.join(rootDir, 'user-staged.txt'), 'utf8'), 'staged user change\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'user-unstaged.txt'), 'utf8'), 'unstaged user change\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'user-untracked.txt'), 'utf8'), 'untracked user change\n');
});

test('applyVersioningToHeadCommit rolls back every target after a mid-sync write failure', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  writeText(path.join(rootDir, 'inventory-system/feature.js'), 'inventory change\n');
  git('add', 'auth/feature.js', 'inventory-system/feature.js');
  git('commit', '-m', 'fix: trigger transactional sync');
  const beforeHead = git('rev-parse', 'HEAD').trim();
  const beforeStatus = git('status', '--porcelain=v1', '--untracked-files=all');
  let writes = 0;

  assert.throws(
    () => applyVersioningToHeadCommit({
      rootDir,
      writeTarget(filePath, content) {
        writes += 1;
        if (writes === 3) throw new Error('injected mid-sync failure');
        fs.writeFileSync(filePath, content);
      },
    }),
    /injected mid-sync failure/
  );

  assert.equal(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), beforeStatus);
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'inventory-system/VERSION'), 'utf8'), '1.0.0\n');
});

test('applyVersioningToHeadCommit rolls back generated files after staging failure', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  git('add', 'auth/feature.js');
  git('commit', '-m', 'fix(auth): trigger staging failure');
  const beforeHead = git('rev-parse', 'HEAD').trim();
  const indexLock = path.join(rootDir, '.git/index.lock');
  writeText(indexLock, 'locked\n');

  try {
    assert.throws(() => applyVersioningToHeadCommit({ rootDir }), /index\.lock|Unable to create/);
  } finally {
    fs.rmSync(indexLock, { force: true });
  }

  assert.equal(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.0.0\n');
});

test('applyVersioningToHeadCommit rolls back generated files and restores users after amend failure', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  writeText(path.join(rootDir, 'tracked-staged.txt'), 'base staged\n');
  writeText(path.join(rootDir, 'tracked-unstaged.txt'), 'base unstaged\n');
  git('add', 'tracked-staged.txt', 'tracked-unstaged.txt');
  git('commit', '-m', 'chore(repo): add rollback fixtures');
  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  git('add', 'auth/feature.js');
  git('commit', '-m', 'fix(auth): trigger amend failure');
  const beforeHead = git('rev-parse', 'HEAD').trim();

  writeText(path.join(rootDir, 'tracked-staged.txt'), 'staged survives\n');
  git('add', 'tracked-staged.txt');
  writeText(path.join(rootDir, 'tracked-unstaged.txt'), 'unstaged survives\n');
  writeText(path.join(rootDir, 'untracked-survives.txt'), 'untracked survives\n');
  const beforeStatus = git('status', '--porcelain=v1', '--untracked-files=all');
  git('config', 'commit.gpgsign', 'true');
  git('config', 'gpg.program', '/usr/bin/false');

  assert.throws(() => applyVersioningToHeadCommit({ rootDir }), /failed to sign|gpg failed|false/);

  assert.equal(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), beforeStatus);
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'tracked-staged.txt'), 'utf8'), 'staged survives\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'tracked-unstaged.txt'), 'utf8'), 'unstaged survives\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'untracked-survives.txt'), 'utf8'), 'untracked survives\n');
});

test('multi-system preflight rejects malformed targets before any system write', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  const malformedLock = makePackageLock('1.0.0');
  delete malformedLock.packages[''].version;
  writeJson(path.join(rootDir, 'inventory-system/backend/package-lock.json'), malformedLock);
  writeText(path.join(rootDir, 'auth/feature.js'), 'auth change\n');
  writeText(path.join(rootDir, 'inventory-system/feature.js'), 'inventory change\n');
  git('add', 'auth/feature.js', 'inventory-system/feature.js', 'inventory-system/backend/package-lock.json');
  git('commit', '-m', 'fix: reject malformed target');
  const beforeHead = git('rev-parse', 'HEAD').trim();

  assert.throws(
    () => applyVersioningToHeadCommit({ rootDir }),
    /package-lock\.json packages\[''\]\.version/
  );

  assert.equal(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.0.0\n');
  assert.equal(fs.readFileSync(path.join(rootDir, 'inventory-system/VERSION'), 'utf8'), '1.0.0\n');
});

test('applyVersioningToHeadCommit amends valid repo-only commit titles without business bumps', () => {
  const { rootDir, git } = initializeIndependentVersionGitRepo();

  writeText(path.join(rootDir, 'note.txt'), 'repo tooling change\n');
  git('add', 'note.txt');
  git('commit', '-m', 'fix(repo): repair tooling');
  const beforeHead = git('rev-parse', 'HEAD').trim();

  const result = applyVersioningToHeadCommit({ rootDir });

  assert.equal(result.skipped, false);
  assert.equal(result.repoOnly, true);
  assert.deepEqual(result.bumps, []);
  assert.notEqual(git('rev-parse', 'HEAD').trim(), beforeHead);
  assert.equal(git('log', '-1', '--pretty=%s').trim(), '[repo] fix(repo): repair tooling');
  assert.equal(fs.readFileSync(path.join(rootDir, 'auth/VERSION'), 'utf8'), '1.0.0\n');
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
  const rootDir = makeIndependentVersionFixture();
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  git(remoteDir, 'init', '--bare');

  git(rootDir, 'init');
  git(rootDir, 'config', 'user.name', 'Codex Test');
  git(rootDir, 'config', 'user.email', 'codex@example.com');
  git(rootDir, 'checkout', '-b', 'feature/independent-versions');
  git(rootDir, 'remote', 'add', 'origin', remoteDir);

  git(rootDir, 'add', '.');
  git(rootDir, 'commit', '-m', 'chore(repo): init');

  writeText(path.join(rootDir, 'auth/push.js'), 'changed\n');
  git(rootDir, 'add', 'auth/push.js');
  git(rootDir, 'commit', '-m', 'feat(auth): auto push after bump');

  applyVersioningToHeadCommit({ rootDir });
  const pushResult = pushCurrentBranch({ rootDir });

  const summary = git(rootDir, 'log', '-1', '--pretty=%s').trim();
  const localHead = git(rootDir, 'rev-parse', 'HEAD').trim();
  const remoteHead = git(remoteDir, 'rev-parse', 'refs/heads/feature/independent-versions').trim();

  assert.equal(summary, '[auth-v1.1.0] feat(auth): auto push after bump');
  assert.equal(pushResult.skipped, false);
  assert.equal(pushResult.branch, 'feature/independent-versions');
  assert.equal(remoteHead, localHead);
});

test('post-commit amends repo-only title and pushes the current branch', () => {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-repo-remote-'));
  const { rootDir, git } = initializeIndependentVersionGitRepo();
  execFileSync('git', ['init', '--bare'], { cwd: remoteDir, encoding: 'utf8' });
  git('remote', 'add', 'origin', remoteDir);

  writeText(path.join(rootDir, 'repo-note.txt'), 'repo tooling change\n');
  git('add', 'repo-note.txt');
  git('commit', '-m', 'fix(repo): repair repository tooling');

  const result = runPostCommit({ repositoryRoot: rootDir, log: () => {} });
  const localHead = git('rev-parse', 'HEAD').trim();
  const remoteHead = execFileSync(
    'git',
    ['rev-parse', 'refs/heads/feature/independent-versions'],
    { cwd: remoteDir, encoding: 'utf8' }
  ).trim();

  assert.equal(git('log', '-1', '--pretty=%s').trim(), '[repo] fix(repo): repair repository tooling');
  assert.equal(result.result.repoOnly, true);
  assert.equal(result.pushResult.branch, 'feature/independent-versions');
  assert.equal(remoteHead, localHead);
});

test('post-commit pushes current branch without switching version branches', () => {
  const switchBranch = () => assert.fail('must not switch branches');
  const result = runPostCommit({
    readHeadCommitSummary: () => 'feat(auth): improve login',
    applyVersioning: () => ({
      skipped: false,
      bumpType: 'minor',
      bumps: [{
        system: { id: 'auth' },
        currentVersion: '1.0.0',
        nextVersion: '1.1.0',
      }],
    }),
    pushBranch: () => ({
      skipped: false,
      branch: 'feature/independent-versions',
      remote: 'origin',
      upstreamSet: false,
    }),
    switchBranch,
    log: () => {},
  });

  assert.equal(result.pushResult.branch, 'feature/independent-versions');
  assert.deepEqual(Object.keys(result).sort(), ['pushResult', 'result']);
});

test('automation exposes no global repository version or version branch switching APIs', () => {
  const automation = require('../scripts/versioning/automation');
  const source = fs.readFileSync(path.join(repositoryRoot, 'scripts/versioning/automation.js'), 'utf8');

  assert.equal(automation.syncRepositoryVersion, undefined);
  assert.equal(automation.switchToVersionBranch, undefined);
  assert.equal(automation.buildVersionBranchName, undefined);
  assert.doesNotMatch(source, /const walkForPackageJson\b/);
  assert.doesNotMatch(source, /const readRootVersion\b/);
  assert.doesNotMatch(source, /const switchToVersionBranch\b/);
});
