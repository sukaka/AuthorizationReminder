# Independent System Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repository-wide shared version with independently bumped `1.0.0` versions for each business system while preserving automatic amend and push behavior.

**Architecture:** Add an explicit JavaScript system registry and one `VERSION` source file per business system. The Git hooks derive affected systems from changed paths plus commit scope, synchronize only those systems' declared runtime files, amend the commit with deterministic system-version prefixes, and push the current branch without version-based branch switching.

**Tech Stack:** Node.js 20, CommonJS, `node:test`, Git hooks, JSON/package-lock structural updates, Tauri JSON/TOML version files.

## Global Constraints

- Every existing business system starts at exactly `1.0.0`.
- Frontend, backend, gateway, desktop, and deployment artifacts inside one business system share one version.
- Different business systems never bump because an unrelated system changed.
- `major` changes increment the first segment; `feat/minor/perf` increment the second; fixes and maintenance increment the third.
- Multi-system commits bump every affected system using the same bump type.
- Shared files require a concrete system scope or `all`; `repo` is only for repository-only non-shared changes, and scope/path mismatches fail.
- Automatic amend and current-branch push remain enabled.
- Version changes never switch the repository to `codex/<version>` branches.
- Historical tags, branches, release documents, and unrelated untracked files remain untouched.

---

## File Structure

- Create `scripts/versioning/systems.js`: authoritative registry, scope aliases, path ownership, shared-path rules, and version-file declarations.
- Modify `scripts/versioning/automation.js`: affected-system resolution, per-system reads/bumps/sync, deterministic title prefixes, and commit amend behavior.
- Modify `scripts/versioning/commit-msg.js`: validate type/scope syntax before commit; path-dependent validation remains in post-commit where the committed diff is authoritative.
- Modify `scripts/versioning/post-commit.js`: remove version-branch switching and keep amend plus current-branch push.
- Modify `tests/versioning-automation.test.js`: unit and temporary-repository coverage for registry, detection, synchronization, amend, push, and worktree preservation.
- Create one `VERSION` file at each system root listed in Task 1.
- Modify registered runtime version files, `package.json`, lock files, Tauri metadata, `docs/versioning.md`, and relevant README version guidance.

---

### Task 1: Add the System Registry and Independent Version Sources

**Files:**
- Create: `scripts/versioning/systems.js`
- Create: `auth/VERSION`
- Create: `server/VERSION`
- Create: `ticketing/VERSION`
- Create: `inventory-system/VERSION`
- Create: `device-flow/VERSION`
- Create: `delivery/VERSION`
- Create: `sec-impl/VERSION`
- Create: `cmdb/VERSION`
- Create: `faq/VERSION`
- Create: `tender/VERSION`
- Create: `train-exam/VERSION`
- Create: `prompt-center/VERSION`
- Create: `sca-platform/VERSION`
- Create: `big-screen-center/VERSION`
- Create: `juxin-ai-assistant/VERSION`
- Test: `tests/versioning-automation.test.js`

**Interfaces:**
- Produces: `SYSTEMS`, `SHARED_PATHS`, `SYSTEM_BY_ID`, `validateSystemRegistry(rootDir)`.
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write failing registry tests**

Add tests that require exactly the 15 approved IDs and reject path overlap or missing version sources:

```js
test('system registry defines every approved independent system', () => {
  assert.deepEqual(
    SYSTEMS.map((system) => system.id),
    ['ai-assistant', 'auth', 'big-screen', 'cmdb', 'delivery', 'device-flow',
      'faq', 'inventory', 'prompt-center', 'reminder', 'sca', 'sec-impl',
      'tender', 'ticketing', 'train-exam']
  );
});

test('validateSystemRegistry rejects overlapping owned paths', () => {
  assert.throws(
    () => validateRegistryEntries([
      { id: 'a', paths: ['foo'] },
      { id: 'b', paths: ['foo/bar'] },
    ]),
    /路径归属重叠/
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/versioning-automation.test.js`

Expected: FAIL because `scripts/versioning/systems.js` and registry exports do not exist.

- [ ] **Step 3: Implement the explicit registry**

Use this shape and keep entries sorted by `id`:

```js
const SYSTEMS = Object.freeze([
  {
    id: 'auth',
    name: '统一登录系统',
    versionFile: 'auth/VERSION',
    paths: ['auth'],
    packageDirs: ['auth'],
    jsonFiles: [],
    tomlFiles: [],
  },
  {
    id: 'inventory',
    name: '库存管理',
    versionFile: 'inventory-system/VERSION',
    paths: ['inventory-system'],
    packageDirs: [
      'inventory-system/backend',
      'inventory-system/frontend',
      'inventory-system/shipping-gateway',
    ],
    jsonFiles: [],
    tomlFiles: [],
  },
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
```

Complete the same fields for all 15 systems. Export registry validation that rejects duplicate IDs, overlapping owned paths, unknown package directories, and missing/invalid `VERSION` files.

- [ ] **Step 4: Create all version sources**

Each approved system `VERSION` file contains exactly:

```text
1.0.0
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/versioning-automation.test.js`

Expected: PASS for registry and version-source tests.

- [ ] **Step 6: Commit Task 1 with old automation bypassed**

```bash
git add scripts/versioning/systems.js tests/versioning-automation.test.js */VERSION juxin-ai-assistant/VERSION inventory-system/VERSION big-screen-center/VERSION prompt-center/VERSION sca-platform/VERSION train-exam/VERSION device-flow/VERSION
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(repo): add independent system version registry"
```

---

### Task 2: Resolve Affected Systems from Paths and Scope

**Files:**
- Modify: `scripts/versioning/automation.js`
- Modify: `scripts/versioning/commit-msg.js`
- Test: `tests/versioning-automation.test.js`

**Interfaces:**
- Consumes: `SYSTEMS`, `SHARED_PATHS`, `SYSTEM_BY_ID` from Task 1.
- Produces: `parseCommitScope(summary)`, `classifyChangedPaths(paths)`, `resolveAffectedSystems({ summary, changedPaths })`.

- [ ] **Step 1: Write failing path/scope tests**

Cover single-system, multi-system, shared, `all`, `repo`, unknown scope, and mismatch behavior:

```js
test('resolveAffectedSystems detects multiple business systems', () => {
  assert.deepEqual(
    resolveAffectedSystems({
      summary: 'feat: improve login and stock',
      changedPaths: ['auth/index.js', 'inventory-system/backend/src/index.js'],
    }),
    ['auth', 'inventory']
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

test('scope and owned paths must agree', () => {
  assert.throws(
    () => resolveAffectedSystems({
      summary: 'fix(auth): adjust inventory API',
      changedPaths: ['inventory-system/backend/src/index.js'],
    }),
    /scope auth.*inventory/
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/versioning-automation.test.js --test-name-pattern='affected|scope|shared'`

Expected: FAIL because affected-system functions are not implemented.

- [ ] **Step 3: Implement deterministic classification**

Implement these rules:

```js
const parseCommitScope = (summary) => {
  const match = stripVersionPrefix(summary).match(/^[a-z][\w-]*(?:\(([^)]+)\))?!?:/i);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
};

const pathMatches = (filePath, ownedPath) =>
  filePath === ownedPath || filePath.startsWith(`${ownedPath}/`);
```

`resolveAffectedSystems` must sort IDs, expand `all` to every system, return `[]` for valid `repo` changes, require a recognized system scope for shared-only changes, and reject a system scope that excludes any owned business path in the commit.

- [ ] **Step 4: Validate commit type and scope syntax**

Update `commit-msg.js` so unknown scopes fail immediately while path-aware checks stay in post-commit:

```js
const scope = parseCommitScope(normalized);
if (scope && scope !== 'all' && scope !== 'repo' && !SYSTEM_BY_ID.has(scope)) {
  throw new Error(`未知系统 scope：${scope}`);
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/versioning-automation.test.js`

Expected: all registry, scope, and path tests PASS.

- [ ] **Step 6: Commit Task 2 with bypass**

```bash
git add scripts/versioning/automation.js scripts/versioning/commit-msg.js tests/versioning-automation.test.js
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(repo): detect affected systems for versioning"
```

---

### Task 3: Synchronize Versions Per System

**Files:**
- Modify: `scripts/versioning/automation.js`
- Test: `tests/versioning-automation.test.js`

**Interfaces:**
- Consumes: registry and `resolveAffectedSystems` from Tasks 1-2.
- Produces: `readSystemVersion(rootDir, system)`, `syncSystemVersion({ rootDir, system, currentVersion, nextVersion })`, `planSystemBumps({ rootDir, systemIds, bumpType })`.

- [ ] **Step 1: Write failing synchronization tests**

Use temporary repositories to prove isolation and same-system consistency:

```js
test('syncSystemVersion updates every package in one system only', () => {
  const rootDir = makeIndependentVersionFixture();
  const changed = syncSystemVersion({
    rootDir,
    system: SYSTEM_BY_ID.get('inventory'),
    currentVersion: '1.0.0',
    nextVersion: '1.1.0',
  });

  assert.equal(readPackageVersion(rootDir, 'inventory-system/frontend'), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/backend'), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'inventory-system/shipping-gateway'), '1.1.0');
  assert.equal(readPackageVersion(rootDir, 'auth'), '1.0.0');
  assert.ok(changed.includes('inventory-system/VERSION'));
});
```

Add structural tests for package locks and AI assistant Tauri files.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/versioning-automation.test.js --test-name-pattern='syncSystemVersion|planSystemBumps|Tauri'`

Expected: FAIL because per-system sync does not exist.

- [ ] **Step 3: Implement system version reads and bump plans**

```js
const readSystemVersion = (rootDir, system) => {
  const value = readText(path.join(rootDir, system.versionFile)).trim();
  if (!VERSION_RE.test(value)) {
    throw new Error(`${system.id} 版本号非法：${value || '<empty>'}`);
  }
  return value;
};

const planSystemBumps = ({ rootDir, systemIds, bumpType }) =>
  [...systemIds].sort().map((systemId) => {
    const system = SYSTEM_BY_ID.get(systemId);
    const currentVersion = readSystemVersion(rootDir, system);
    return { system, currentVersion, nextVersion: bumpVersion(currentVersion, bumpType) };
  });
```

- [ ] **Step 4: Implement declared-file synchronization**

Update only the selected system's `VERSION`, declared package files, lock files, JSON metadata, TOML package version, and explicit text constants. Do not call the old repository-wide walker.

For TOML, replace only the first package declaration matching:

```js
/^(version\s*=\s*)"\d+\.\d+\.\d+"/m
```

For `tauri.conf.json`, parse JSON and set `version` structurally.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/versioning-automation.test.js`

Expected: synchronization tests PASS and unrelated-system versions remain unchanged.

- [ ] **Step 6: Commit Task 3 with bypass**

```bash
git add scripts/versioning/automation.js tests/versioning-automation.test.js
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(repo): synchronize versions per system"
```

---

### Task 4: Amend Commits with Independent Version Prefixes

**Files:**
- Modify: `scripts/versioning/automation.js`
- Modify: `scripts/versioning/post-commit.js`
- Test: `tests/versioning-automation.test.js`

**Interfaces:**
- Consumes: `resolveAffectedSystems`, `planSystemBumps`, `syncSystemVersion`.
- Produces: `buildSystemVersionedCommitMessage({ message, bumps })`, updated `applyVersioningToHeadCommit({ rootDir })`, simplified `runPostCommit()`.

- [ ] **Step 1: Write failing amend and branch tests**

```js
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

test('post-commit pushes current branch without switching version branches', () => {
  const switchBranch = () => assert.fail('must not switch branches');
  const result = runPostCommit({ applyVersioning, pushBranch, switchBranch });
  assert.equal(result.pushResult.branch, 'feature/independent-versions');
});
```

Add temporary Git repository coverage proving one commit can bump two systems, amend once, preserve unrelated untracked files, and leave the branch name unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/versioning-automation.test.js --test-name-pattern='prefix|post-commit|branch|untracked'`

Expected: FAIL because the old code emits `[vX.Y.Z]` and invokes version branch switching.

- [ ] **Step 3: Replace global amend flow**

Inside `applyVersioningToHeadCommit`:

1. Read `HEAD` message and committed paths with `git diff-tree --root --no-commit-id --name-only -r HEAD`.
2. Resolve affected systems.
3. Return `{ skipped: true, reason: 'repo-only' }` for valid `repo` commits.
4. Plan and synchronize each affected system.
5. Stage the union of changed version files.
6. Amend once with sorted system prefixes.
7. Restore the pre-existing worktree stash exactly as today.

- [ ] **Step 4: Remove version-based branch switching**

Delete the call to `switchToVersionBranch` from `runPostCommit`. The returned shape becomes:

```js
return { result, pushResult };
```

Keep `pushCurrentBranch` behavior unchanged.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/versioning-automation.test.js`

Expected: all amend, title, branch, push, and worktree-preservation tests PASS.

- [ ] **Step 6: Commit Task 4 with bypass**

```bash
git add scripts/versioning/automation.js scripts/versioning/post-commit.js tests/versioning-automation.test.js
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(repo): amend commits with system versions"
```

---

### Task 5: Reset Runtime Versions, Update Documentation, and Verify Migration

**Files:**
- Modify: every package and lock file declared by `scripts/versioning/systems.js`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/Cargo.toml`
- Modify: `juxin-ai-assistant/apps/desktop/src-tauri/tauri.conf.json`
- Modify: explicit runtime version constants declared in the registry
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/versioning.md`
- Modify: `README.md`
- Modify: `tests/versioning-automation.test.js`

**Interfaces:**
- Consumes: complete independent-version automation from Tasks 1-4.
- Produces: a repository where all 15 systems and all declared runtime files are at `1.0.0` and future commits bump only affected systems.

- [ ] **Step 1: Write failing migration consistency test**

```js
test('repository runtime versions match every system VERSION source', () => {
  for (const system of SYSTEMS) {
    assert.equal(readSystemVersion(repositoryRoot, system), '1.0.0');
    assert.deepEqual(findSystemVersionDrift(repositoryRoot, system), []);
  }
});
```

Also assert root `package.json` and root lock package are `1.0.0`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/versioning-automation.test.js --test-name-pattern='repository runtime versions'`

Expected: FAIL and list current version drift.

- [ ] **Step 3: Reset every declared runtime version to `1.0.0`**

Use a checked-in versioning function or a one-time Node invocation that calls `syncSystemVersion` for each registry entry with target `1.0.0`. Do not use blind global text replacement.

Set the root tool package structurally:

```json
{
  "version": "1.0.0"
}
```

Update both root `package-lock.json` version fields.

- [ ] **Step 4: Rewrite version documentation**

`docs/versioning.md` must document independent system sources, scope/path rules, title examples, no version-based branch switching, automatic amend/push, and system-prefixed tag guidance.

Update README deployment examples so they no longer imply a single current product version branch. Use the stable branch or configurable `BOOTSTRAP_BRANCH` without rewriting historical release documents.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm run test:versioning
node -e "JSON.parse(require('fs').readFileSync('package.json')); JSON.parse(require('fs').readFileSync('package-lock.json'))"
git diff --check
```

Expected: versioning tests PASS, JSON parsing exits 0, and `git diff --check` exits 0.

Run system-specific metadata checks:

```bash
npm --prefix juxin-ai-assistant/apps/desktop run agent:version -- --check
```

If the existing agent script has no check-only mode, replace this command with its test suite:

```bash
node --test juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs
```

Expected: AI assistant package, lock, Cargo, and Tauri versions agree at `1.0.0`.

- [ ] **Step 6: Commit the migration with bypass**

Stage only registry-declared version files, automation, tests, and version documentation. Preserve all unrelated untracked files.

```bash
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(repo): migrate systems to independent 1.0.0 versions"
```

- [ ] **Step 7: Push the current branch and audit**

```bash
git push origin HEAD
git status --short --branch
git log -5 --oneline --decorate
```

Expected: current branch is pushed, no version-derived branch is created, and only pre-existing unrelated untracked files remain.
