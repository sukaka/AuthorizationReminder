# CMDB Storage Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the legacy secondary datastore from the CMDB service so runtime, config, compose, and docs rely only on MySQL.

**Architecture:** CMDB already persists business data in MySQL. The implementation removes the unused secondary datastore bootstrap path, updates composition and documentation to match the real architecture, and verifies the service still starts and serves existing APIs.

**Tech Stack:** Go 1.22, Gin, MySQL, Docker Compose, React/Vite frontend, Nginx

---

### Task 1: Remove secondary datastore bootstrap and config

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/cmd/cmdb/main.go`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/internal/handler/router.go`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/internal/config/config.go`
- Delete: 历史附加存储的 DB helper 文件（位于 `/Users/zhanglei/Documents/codex-new/cmdb/internal/db`）
- Test: `/Users/zhanglei/Documents/codex-new/cmdb` existing package tests via `go test ./...`

**Step 1: Write the failing test**

There is no targeted unit for bootstrap wiring, so use compile/test failure as the safety net after changing signatures.

**Step 2: Run test to verify current baseline**

Run: `cd /Users/zhanglei/Documents/codex-new/cmdb && go test ./...`
Expected: PASS before code removal.

**Step 3: Write minimal implementation**

- Remove secondary datastore client creation and cleanup logic from `main.go`.
- Change `handler.NewRouter` signature to remove the extra parameter.
- Remove old config fields and env parsing.
- Delete the unused DB helper file.

**Step 4: Run test to verify it passes**

Run: `cd /Users/zhanglei/Documents/codex-new/cmdb && go test ./...`
Expected: PASS with no legacy datastore imports.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/cmdb/cmd/cmdb/main.go \
  /Users/zhanglei/Documents/codex-new/cmdb/internal/handler/router.go \
  /Users/zhanglei/Documents/codex-new/cmdb/internal/config/config.go \
  /Users/zhanglei/Documents/codex-new/cmdb/internal/db
git commit -m "refactor(cmdb): remove legacy datastore bootstrap"
```

### Task 2: Remove datastore dependency declarations

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/go.mod`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/go.sum`

**Step 1: Write the failing test**

Dependency drift is detected by module tidy and package tests.

**Step 2: Run baseline command**

Run: `cd /Users/zhanglei/Documents/codex-new/cmdb && go mod tidy`
Expected: legacy driver remains until imports are removed.

**Step 3: Write minimal implementation**

- Remove the old datastore driver from `go.mod`.
- Regenerate `go.sum` with `go mod tidy`.

**Step 4: Run verification**

Run: `cd /Users/zhanglei/Documents/codex-new/cmdb && go test ./...`
Expected: PASS and no legacy driver in module graph.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/cmdb/go.mod /Users/zhanglei/Documents/codex-new/cmdb/go.sum
git commit -m "build(cmdb): drop legacy datastore driver"
```

### Task 3: Remove datastore service from compose and deploy configs

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml`

**Step 1: Write the failing test**

Configuration verification happens by starting the stack and checking that `cmdb` comes up without the retired datastore service.

**Step 2: Run baseline inspection**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose config | rg 'cmdb-mysql-init|cmdb|web-cmdb'`
Expected: compose renders CMDB services without any retired datastore service.

**Step 3: Write minimal implementation**

- Remove the old datastore service blocks and volumes.
- Remove `cmdb` dependency on that service.
- Remove related env vars from service definitions.

**Step 4: Run verification**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose config | rg 'cmdb-mysql-init|cmdb|web-cmdb'`
Expected: CMDB services remain present and no retired datastore settings exist.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/docker-compose.yml /Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml
git commit -m "chore(cmdb): remove legacy datastore compose services"
```

### Task 4: Update docs and remove stale schema docs

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/README.md`
- Delete or modify: historical schema docs under `/Users/zhanglei/Documents/codex-new/cmdb/schemas`

**Step 1: Write the failing test**

Documentation consistency is checked by repository search.

**Step 2: Run baseline inspection**

Run: `rg -n 'legacy datastore|secondary datastore' /Users/zhanglei/Documents/codex-new/docs /Users/zhanglei/Documents/codex-new/cmdb/README.md`
Expected: current docs and compose still mention the retired datastore before cleanup.

**Step 3: Write minimal implementation**

- Update README stack and quick start steps.
- Remove or replace stale schema docs so the repo no longer describes the retired datastore as active CMDB storage.

**Step 4: Run verification**

Run: `rg -n 'legacy datastore|secondary datastore' /Users/zhanglei/Documents/codex-new/docs /Users/zhanglei/Documents/codex-new/cmdb/README.md`
Expected: no matches.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/cmdb/README.md /Users/zhanglei/Documents/codex-new/cmdb/schemas /Users/zhanglei/Documents/codex-new/docker-compose.yml
git commit -m "docs(cmdb): align docs with mysql-only architecture"
```

### Task 5: Rebuild runtime and run smoke verification

**Files:**
- No source changes required; runtime verification only

**Step 1: Start the updated services**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose up -d --build cmdb web-cmdb`
Expected: `cmdb` and `web-cmdb` start successfully with only MySQL persistence.

**Step 2: Verify runtime state**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose ps | rg 'cmdb|web-cmdb'`
Expected: `cmdb` and `web-cmdb` are up.

**Step 3: Verify health endpoints**

Run: `docker exec codex-new-cmdb-1 /bin/sh -lc 'wget -qO- http://127.0.0.1:8088/healthz'`
Expected: backend health check returns success.

**Step 4: Verify business APIs**

Run: open CMDB UI and smoke check models, reports, and discovery in the existing local flow.
Expected: existing CMDB endpoints and pages still respond normally.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(cmdb): clean legacy datastore references"
```
