# Task 5 Report: Independent Version Migration

## Status

DONE

## Implementation

- Corrected `reminder` ownership to `paths: ['server', 'web']` and `packageDirs: ['web']` before runtime migration.
- Added `findSystemVersionDrift` to audit registry-declared package, lock, JSON, and TOML structured version targets against each system's `VERSION` source.
- Reset all 15 system `VERSION` sources and 69 registry-declared runtime/version files to `1.0.0`.
- Reset root `package.json` and both root `package-lock.json` version fields to the version-tool value `1.0.0`.
- Removed the legacy repository-wide package scanner, root product-version synchronization, global version commit helper, and version-driven branch switching APIs/tests.
- Rewrote `docs/versioning.md` for independent sources, path/scope rules, system-prefixed commit/tag examples, current-branch amend/push behavior, and historical release preservation.
- Updated README deployment guidance to use stable `main` or an explicit `BOOTSTRAP_BRANCH`, with no version-derived deployment branch or directory.
- Did not modify historical release documents, tags, or commits.

## TDD Evidence

1. Added failing assertions for reminder ownership, repository runtime consistency, root tool version consistency, and declared-file drift detection.
2. RED: `node --test tests/versioning-automation.test.js --test-name-pattern='repository runtime versions'` exited 1 with reminder ownership mismatch and missing drift detection.
3. Added the minimal registry correction and drift detector; the drift unit test passed while repository consistency remained RED and listed the existing AI assistant runtime mismatch.
4. Migrated versions through `syncSystemVersion`; the focused registry/drift/repository tests passed 3/3.
5. Added a failing contract that legacy global-version and branch-switch APIs must not be exported; RED showed `syncRepositoryVersion` still existed.
6. Removed the legacy APIs and obsolete behavior tests; the replacement contract and current-branch push test passed 2/2.

## Verification

- `npm run test:versioning`: 41 passed, 0 failed.
- `node --test juxin-ai-assistant/apps/desktop/scripts/tests/agent-version.test.mjs`: 6 passed, 0 failed.
- Root `package.json` and `package-lock.json` JSON parse checks: passed.
- `git diff --check`: passed.
- Registry audit: 15 systems, 69 declared files, 26 packages, 26 locks, 1 JSON file, and 1 TOML file; all versions are `1.0.0` with no drift.
- Obsolete guidance scan: no global current-product version, numeric `codex/<version>` deployment example, or automatic version-branch switching guidance remains in README/versioning docs.
- Legacy production API scan: no repository-wide version scanner, root version reader, or version branch-switching API remains in version automation or hooks.

## Commit And Push

- Commit: `ca9638dc` — `feat(repo): migrate systems to independent 1.0.0 versions`.
- Commit message: `feat(repo): migrate systems to independent 1.0.0 versions`.
- Commit uses `CODEX_VERSIONING_BYPASS=1`; the final title must not contain a `[v...]` prefix.
- Push intentionally not performed; the controller will push after review.

## Review

- Final diff and registry declaration boundaries were reviewed locally.
- No Critical or Important findings remain.
- A dedicated reviewer subagent was unavailable in the current toolset; controller review remains the next external review gate.

## Concerns

- The Node test runner prints Git default-branch hints while temporary repositories initialize; these are informational and do not affect test results.

## Review Findings Fix

- Corrected the shared-file scope contract: shared paths require a concrete system scope or `all`; `repo` is restricted to repository-only, non-shared changes.
- Removed `textFiles` from the registry schema, validation, fixtures, synchronization, drift detection, implementation plan, documentation, and audit claims.
- Replaced generic text substring replacement with exact whole-file updates for canonical `VERSION` sources; all remaining secondary targets use structured package/lock, JSON, or TOML fields.
- Added regression coverage that registry entries do not expose `textFiles` and that documented shared/`repo` scope behavior matches `resolveAffectedSystems`.
- Verification after the review fix: versioning tests 42/42, AI agent-version tests 6/6, root JSON checks passed, `git diff --check` passed, and registry audit reported 15 systems, 69 declared files, and zero drift.
