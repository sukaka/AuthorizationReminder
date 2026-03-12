# Full Server Bootstrap Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a single command entrypoint that brings up a fresh server for `4.0.9`, from Docker mirror configuration through full service bootstrap.

**Architecture:** The new shell script orchestrates host preparation, repository synchronization, and existing in-repo bootstrap scripts. It remains stateless and runtime-configured through environment variables so no private values are committed.

**Tech Stack:** Bash, Docker, Docker Compose wrapper scripts, git, systemd.

---

### Task 1: Write the failing orchestration test

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/scripts/tests/bootstrap-full-server.sh`
- Create: `/Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-full-server.sh`

**Step 1: Write a shell test harness that stubs `git`, `docker`, `systemctl`, and `mkdir` side effects**

The test should assert that the script:
- writes the configured mirror URL into `/etc/docker/daemon.json` replacement path,
- clones the target branch when the repo directory does not exist,
- invokes `bootstrap-new-server.sh` in the target repo with the supplied default password.

**Step 2: Run the test before implementation**

Run: `bash /Users/zhanglei/Documents/codex-new/scripts/tests/bootstrap-full-server.sh`
Expected: FAIL because the script does not exist yet.

**Step 3: Implement the minimal script to satisfy the test**

### Task 2: Implement runtime options and safety checks

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-full-server.sh`

**Step 1: Add defaults for repo dir, branch, and repo URL**

**Step 2: Require `ALIYUN_MIRROR_URL` and `AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD`**

**Step 3: Ensure the script exits clearly when required tools are missing**

### Task 3: Update docs

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/deploy-docker.md`

**Step 1: Add a copy-pastable example for full server bootstrap**

**Step 2: Explain the required environment variables**

### Task 4: Verify and release

**Files:**
- Verify files above

**Step 1: Run the shell test**

Run: `bash /Users/zhanglei/Documents/codex-new/scripts/tests/bootstrap-full-server.sh`
Expected: PASS.

**Step 2: Run syntax checks**

Run: `cd /Users/zhanglei/Documents/codex-new && bash -n scripts/deploy/bootstrap-full-server.sh && bash -n scripts/deploy/bootstrap-new-server.sh && bash -n scripts/deploy/docker-compose-aliyun.sh`
Expected: PASS.

**Step 3: Commit and tag**

```bash
cd /Users/zhanglei/Documents/codex-new
git add scripts/deploy/bootstrap-full-server.sh scripts/tests/bootstrap-full-server.sh README.md docs/deploy-docker.md docs/plans/2026-03-12-full-server-bootstrap-design.md docs/plans/2026-03-12-full-server-bootstrap-implementation.md
git commit -m "feat: add full server bootstrap script"
git tag v4.0.9
git push origin codex/4.0.9
git push origin v4.0.9
```
