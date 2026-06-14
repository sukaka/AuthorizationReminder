# Device Flow Risk Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four remaining Device Flow security, dependency, RBAC-test, and version-alignment risks.

**Architecture:** Isolate callback target validation and Excel processing into focused modules with unit tests. Keep RBAC provisioning in test-only scripts and extend the existing repository version automation instead of creating a second version source.

**Tech Stack:** Node.js, Express 4, Multer 2, ExcelJS, Vite 8, MySQL 8, Docker Compose, Bash, Node test runner.

---

### Task 1: Callback SSRF Guard

**Files:**
- Create: `device-flow/backend/src/callback-url-policy.js`
- Create: `device-flow/backend/test/callback-url-policy.test.js`
- Modify: `device-flow/backend/src/index.js`
- Modify: `device-flow/backend/.env.example`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] Write failing tests that reject URL credentials, loopback/private/link-local IPv4, private IPv6, mapped IPv4, metadata hosts, and DNS answers containing blocked addresses.
- [ ] Write failing tests that accept a public target and an exact `CALLBACK_ALLOWED_HOSTS` entry.
- [ ] Run `npm --prefix device-flow/backend test` and confirm the new tests fail because the policy module does not exist.
- [ ] Implement parsing, IP classification, asynchronous DNS resolution, and exact-host allowlisting.
- [ ] Replace the inline URL check and validate again before delivery with redirects disabled.
- [ ] Run backend tests and confirm all callback policy tests pass.

### Task 2: ExcelJS Migration and Dependency Upgrades

**Files:**
- Create: `device-flow/backend/src/workbook.js`
- Create: `device-flow/backend/test/workbook.test.js`
- Modify: `device-flow/backend/src/index.js`
- Modify: `device-flow/backend/package.json`
- Modify: `device-flow/backend/package-lock.json`
- Modify: `device-flow/frontend/package.json`
- Modify: `device-flow/frontend/package-lock.json`

- [ ] Write failing tests for first-sheet import, empty workbook rejection, template output, and job export output.
- [ ] Run the workbook tests and confirm failure because the adapter is missing.
- [ ] Implement ExcelJS load/write helpers and update the affected handlers to await them.
- [ ] Replace `xlsx` with `exceljs`; upgrade Express and Multer to safe releases.
- [ ] Upgrade Vite and `@vitejs/plugin-react` to compatible safe releases.
- [ ] Run backend tests, frontend build, and both `npm audit` commands; require zero known vulnerabilities.

### Task 3: Isolated RBAC Test Accounts

**Files:**
- Create: `device-flow/scripts/rbac-test-users.js`
- Create: `device-flow/scripts/rbac-test-users.test.js`
- Modify: `scripts/tests/device-flow.sh`

- [ ] Write failing tests for deterministic SQL parameters, role/app-access mapping, and cleanup statements.
- [ ] Implement a container-executed helper that upserts three dedicated users with an in-memory random password and removes them on cleanup.
- [ ] Update the one-command test to provision accounts, obtain tokens, run the matrix, and clean up through a trap.
- [ ] Run the helper tests and full RBAC matrix using the dedicated users.

### Task 4: Platform Version Alignment

**Files:**
- Modify: `scripts/versioning/automation.js`
- Modify: `tests/versioning-automation.test.js`
- Modify: `docker-compose.yml`
- Modify: `device-flow/backend/package.json`
- Modify: `device-flow/backend/package-lock.json`
- Modify: `device-flow/frontend/package.json`
- Modify: `device-flow/frontend/package-lock.json`

- [ ] Add a failing version automation test proving lagging Device Flow packages are aligned.
- [ ] Add Device Flow package directories to the forced version set.
- [ ] Inject `${APP_VERSION}` into the Device Flow API service.
- [ ] Set current Device Flow package and lock versions to the root platform version.
- [ ] Run version automation tests and verify `/api/version` and `/api/build` after rebuilding the container.

### Task 5: Integrated Verification and Release

**Files:**
- Modify as required only for defects found by verification.

- [ ] Run syntax checks and `git diff --check`.
- [ ] Run backend tests and frontend production build.
- [ ] Run backend and frontend dependency audits.
- [ ] Rebuild Auth and Device Flow containers.
- [ ] Run health, readiness, version, smoke, API regression, upload cleanup, and full RBAC tests.
- [ ] Run security-hardening and version-automation tests.
- [ ] Commit with `fix(device-flow): close remaining security risks`; allow the version hook to increment the patch version and push the branch.

