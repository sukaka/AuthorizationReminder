# CMDB MySQL Runtime User Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move CMDB runtime access from MySQL root to a dedicated `cmdb_user` account managed by environment variables.

**Architecture:** Keep the Go service on a single `MYSQL_DSN`, but shift account provisioning into a reusable init script executed by compose one-shot tasks. Root is used only for initialization; runtime uses `cmdb_user` with DML-only privileges.

**Tech Stack:** Go 1.22, MySQL 8, Docker Compose, shell init script, React/Vite frontend docs

---

### Task 1: Add and verify the reusable CMDB DB init script

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db.sh`
- Create: `/Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db-test.sh`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/migrations/mysql/001_init_cmdb.sql`

**Step 1: Write the failing test**

Add a shell test that runs the init script with a fake `mysql` binary and asserts:
- it checks readiness
- it executes `001_init_cmdb.sql`
- it sends SQL that creates/resets `cmdb_user` and grants `cmdb.*`

**Step 2: Run test to verify it fails**

Run: `bash /Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db-test.sh`
Expected: FAIL because the init script does not exist yet.

**Step 3: Write minimal implementation**

Create the init script with:
- required env validation
- readiness loop
- base schema execution
- runtime user create/alter/grant logic

**Step 4: Run test to verify it passes**

Run: `bash /Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db-test.sh`
Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db.sh \
  /Users/zhanglei/Documents/codex-new/cmdb/scripts/init-cmdb-db-test.sh \
  /Users/zhanglei/Documents/codex-new/cmdb/migrations/mysql/001_init_cmdb.sql
git commit -m "feat(cmdb): add mysql runtime user init script"
```

### Task 2: Switch compose stacks to `cmdb_user`

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml`

**Step 1: Write the failing test**

Use compose rendering as the safety net: the rendered config should stop referencing root in CMDB DSNs.

**Step 2: Run baseline inspection**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose config | rg 'root:|cmdb_user|CMDB_MYSQL_PASSWORD'`
Expected: current CMDB DSN still uses root.

**Step 3: Write minimal implementation**

- Mount and execute the shared init script in both compose stacks
- Inject `MYSQL_ROOT_PASSWORD` and `CMDB_MYSQL_PASSWORD`
- Add a one-shot init service to `cmdb/deploy`
- Change runtime `MYSQL_DSN` values to `cmdb_user`

**Step 4: Run verification**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose config | rg 'root:|cmdb_user|CMDB_MYSQL_PASSWORD'`
Expected: CMDB DSN shows `cmdb_user`, and init services receive `CMDB_MYSQL_PASSWORD`.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/docker-compose.yml \
  /Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml
git commit -m "chore(cmdb): use dedicated mysql runtime user"
```

### Task 3: Update docs and examples

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/.env.example`
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/deploy/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/manuals/system-mysql-topology.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/releases/4.0.7.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/releases/4.0.7-github-release.md`

**Step 1: Write the failing test**

Use repository search to detect missing doc updates.

**Step 2: Run baseline inspection**

Run: `cd /Users/zhanglei/Documents/codex-new && rg -n 'cmdb_user|CMDB_MYSQL_PASSWORD|root@cmdb|root:rootpass@tcp' README.md cmdb docs`
Expected: docs do not yet fully describe the new runtime user.

**Step 3: Write minimal implementation**

- Add `CMDB_MYSQL_PASSWORD` to relevant env docs
- Remove stale root runtime wording for CMDB
- Remove stale local example lines that imply the old setup

**Step 4: Run verification**

Run: `cd /Users/zhanglei/Documents/codex-new && rg -n 'CMDB_MYSQL_PASSWORD|cmdb_user' README.md cmdb docs`
Expected: new variable and account are documented in the intended files.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/cmdb/.env.example \
  /Users/zhanglei/Documents/codex-new/README.md \
  /Users/zhanglei/Documents/codex-new/cmdb/README.md \
  /Users/zhanglei/Documents/codex-new/cmdb/deploy/README.md \
  /Users/zhanglei/Documents/codex-new/docs/manuals/system-mysql-topology.md \
  /Users/zhanglei/Documents/codex-new/docs/releases/4.0.7.md \
  /Users/zhanglei/Documents/codex-new/docs/releases/4.0.7-github-release.md
git commit -m "docs(cmdb): document dedicated mysql runtime user"
```

### Task 4: Apply local env and verify runtime

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/.env`

**Step 1: Apply the runtime password**

Set `CMDB_MYSQL_PASSWORD` in the local root `.env` file.

**Step 2: Rebuild services**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose up -d --build --remove-orphans cmdb-mysql-init cmdb web-cmdb`
Expected: init task completes, `cmdb` starts.

**Step 3: Verify grants**

Run: `docker exec codex-new-mysql-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW GRANTS FOR 'cmdb_user'@'%';"`
Expected: grants include `SELECT, INSERT, UPDATE, DELETE ON cmdb.*`.

**Step 4: Verify app health**

Run: `docker exec codex-new-cmdb-1 /bin/sh -lc 'wget -qO- http://127.0.0.1:8088/healthz'`
Expected: `{"service":"cmdb","status":"ok"}`.

**Step 5: Commit**

```bash
git add /Users/zhanglei/Documents/codex-new/.env
git commit -m "chore(cmdb): configure mysql runtime password"
```
