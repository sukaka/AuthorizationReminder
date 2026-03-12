# New Server Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic auth/reminder database bootstrap and a one-shot new-server deployment script.

**Architecture:** Extract pure bootstrap SQL helpers for testability, reuse them from `server/db.js`, and make the root compose pass admin credentials to the services that share `server/db.js`. Add a shell script that seeds `.env`, starts the stack, and performs basic health checks.

**Tech Stack:** Node.js, mysql2, Bash, Docker Compose

---

### Task 1: Add failing bootstrap helper test

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/auth/tests/server-db-bootstrap.test.js`
- Create: `/Users/zhanglei/Documents/codex-new/server/db-bootstrap.js`

**Step 1: Write the failing test**

- Assert generated bootstrap statements include:
  - `CREATE DATABASE`
  - `CREATE USER`
  - `ALTER USER`
  - `GRANT`
  - `FLUSH PRIVILEGES`

**Step 2: Run test to verify it fails**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/server-db-bootstrap.test.js`

### Task 2: Implement reminder/auth bootstrap

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/db.js`
- Create: `/Users/zhanglei/Documents/codex-new/server/db-bootstrap.js`

**Step 1: Write minimal implementation**

- Add pure helper to build bootstrap statements
- Use admin connection in `server/db.js`
- Bootstrap database and current service user before pool readiness

**Step 2: Run targeted test**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/server-db-bootstrap.test.js`

### Task 3: Wire compose and bootstrap script

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- Create: `/Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-new-server.sh`

**Step 1: Update compose**

- Inject `MYSQL_ADMIN_USER` / `MYSQL_ADMIN_PASSWORD` into `api` / `auth` / `ticketing`

**Step 2: Add script**

- Seed `.env`
- Require explicit builtin default password when missing
- Start stack
- Run basic health checks

**Step 3: Verify syntax**

Run: `bash -n /Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-new-server.sh`

### Task 4: Update docs and run end verification

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`

**Step 1: Document server bootstrap**

- Add copy-pastable usage for the new script

**Step 2: Verify**

Run:
- `cd /Users/zhanglei/Documents/codex-new && docker compose config >/tmp/codex-compose.yml`
- `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/server-db-bootstrap.test.js`
- `bash -n /Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-new-server.sh`
