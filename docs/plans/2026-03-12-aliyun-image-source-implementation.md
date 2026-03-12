# Docker Aliyun-First Image Source Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make repository Docker builds and Compose runtime images prefer Aliyun-hosted images when resolvable, with automatic fallback to official upstream images.

**Architecture:** Dockerfiles and Compose files stop hardcoding registry hosts and instead consume named image aliases. A resolver script produces an env file containing selected image references after probing Aliyun candidates first and official images second. Bootstrap and manual deployment flows both route through that resolver.

**Tech Stack:** Docker Compose, shell scripts, Dockerfile ARGs, Bash, existing repository deployment scripts.

---

### Task 1: Inventory image aliases

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docs/plans/2026-03-12-aliyun-image-source-implementation.md`

**Step 1: Enumerate all unique upstream images in Dockerfiles and Compose**

Run: `cd /Users/zhanglei/Documents/codex-new && rg -n "docker\.m\.daocloud\.io|^FROM |image:" --glob 'Dockerfile*' --glob 'docker-compose*.yml'`
Expected: full list of hardcoded image sources.

**Step 2: Normalize them into alias names**

Create aliases for each unique upstream image and keep one alias per exact tag.

**Step 3: Re-read inventory before editing**

Run: `cd /Users/zhanglei/Documents/codex-new && rg -n "NODE_20_|MYSQL_8_|ONLYOFFICE_|CP_KAFKA_|CP_ZOOKEEPER_" . || true`
Expected: aliases do not yet exist.

### Task 2: Add failing resolver tests

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/scripts/tests/aliyun-image-resolution.sh`
- Modify: `/Users/zhanglei/Documents/codex-new/scripts/deploy/resolve-image-sources.sh`

**Step 1: Write a shell test harness that expects Aliyun candidate selection when probe succeeds**

Test should stub the probe function and assert the generated env file contains the Aliyun image reference.

**Step 2: Run the test before implementation**

Run: `bash /Users/zhanglei/Documents/codex-new/scripts/tests/aliyun-image-resolution.sh`
Expected: FAIL because resolver script does not exist or behavior is missing.

**Step 3: Implement minimal resolver to satisfy the test**

Add functions for alias registration, probe, fallback, and env-file emission.

**Step 4: Re-run the test**

Run: `bash /Users/zhanglei/Documents/codex-new/scripts/tests/aliyun-image-resolution.sh`
Expected: PASS.

### Task 3: Parameterize Dockerfiles

**Files:**
- Modify all Dockerfiles that currently use the legacy hardcoded mirror registry
- Modify untracked ECS Dockerfiles within repository scope

**Step 1: For each Dockerfile, replace hardcoded `FROM` with `ARG` + official default**

Example:
```Dockerfile
ARG NODE_20_BOOKWORM_IMAGE=node:20-bookworm
FROM ${NODE_20_BOOKWORM_IMAGE} AS build
```

**Step 2: Preserve exact tags and stage names**

Do not change runtime behavior beyond the image source.

**Step 3: Run a repository-wide grep to confirm removal of the legacy mirror registry from Dockerfiles**

Run: `cd /Users/zhanglei/Documents/codex-new && rg -n "docker\.m\.daocloud\.io" --glob 'Dockerfile*'`
Expected: no matches.

### Task 4: Parameterize Compose files

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- Modify: `/Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml`

**Step 1: Replace hardcoded `image:` values with env-backed aliases**

Example:
```yaml
image: ${MYSQL_IMAGE:-mysql:8.4}
```

**Step 2: Pass build args into every service whose Dockerfile now consumes image aliases**

Add exact `build.args` entries only for aliases used by that Dockerfile.

**Step 3: Render Compose to verify syntax**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose --env-file .env.example config >/tmp/compose.aliyun.yml`
Expected: PASS.

### Task 5: Add deployment wrappers and docs

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/scripts/deploy/resolve-image-sources.sh`
- Create: `/Users/zhanglei/Documents/codex-new/scripts/deploy/docker-compose-aliyun.sh`
- Modify: `/Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-new-server.sh`
- Modify: `/Users/zhanglei/Documents/codex-new/.env.example`
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/deploy-docker.md`

**Step 1: Implement resolver output env generation**

The resolver should support full-image override env vars and optional Aliyun prefix env vars.

**Step 2: Implement Compose wrapper**

Wrapper should call resolver first, then execute `docker compose` with generated env file plus user args.

**Step 3: Update bootstrap script to use the wrapper**

Keep existing health checks intact.

**Step 4: Document operator inputs**

Document that Aliyun mirror prefixes are optional, and official fallback remains default-safe.

### Task 6: Verify and commit

**Files:**
- Verify modified files above

**Step 1: Run resolver test**

Run: `bash /Users/zhanglei/Documents/codex-new/scripts/tests/aliyun-image-resolution.sh`
Expected: PASS.

**Step 2: Run shell syntax checks**

Run: `cd /Users/zhanglei/Documents/codex-new && bash -n scripts/deploy/resolve-image-sources.sh && bash -n scripts/deploy/docker-compose-aliyun.sh && bash -n scripts/deploy/bootstrap-new-server.sh`
Expected: PASS.

**Step 3: Run Compose render checks**

Run: `cd /Users/zhanglei/Documents/codex-new && docker compose --env-file .env.example config >/tmp/compose.aliyun.root.yml && docker compose -f cmdb/deploy/docker-compose.yml --env-file .env.example config >/tmp/compose.aliyun.cmdb.yml`
Expected: PASS.

**Step 4: Run a targeted build through the wrapper**

Run: `cd /Users/zhanglei/Documents/codex-new && scripts/deploy/docker-compose-aliyun.sh build auth ticketing`
Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/zhanglei/Documents/codex-new
git add docker-compose.yml cmdb/deploy/docker-compose.yml .env.example README.md docs/deploy-docker.md scripts/deploy/resolve-image-sources.sh scripts/deploy/docker-compose-aliyun.sh scripts/deploy/bootstrap-new-server.sh scripts/tests/aliyun-image-resolution.sh $(rg --files -g 'Dockerfile*')
git commit -m "chore: prefer aliyun docker image sources"
```
