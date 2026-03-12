# Runtime Middleware Image Policy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade runtime middleware images to newer compatible image lines without changing build-stage base images.

**Architecture:** Normalize runtime image aliases in Compose and the image resolver so deployment scripts choose newer compatible middleware images. Keep stateful services on compatible maintained lines rather than raw floating major-version tags.

**Tech Stack:** Docker Compose, Bash, Dockerfiles

---

### Task 1: Normalize runtime image aliases

**Files:**
- Modify: `docker-compose.yml`
- Modify: `cmdb/deploy/docker-compose.yml`

**Step 1: Update Compose build args and runtime image aliases**
- Replace `NGINX_1_25_ALPINE_IMAGE` / `NGINX_1_27_ALPINE_IMAGE` with `NGINX_ALPINE_IMAGE`.
- Replace `MYSQL_8_IMAGE` with `MYSQL_IMAGE` and default to `mysql:8.4`.
- Replace `CP_ZOOKEEPER_7_6_1_IMAGE` / `CP_KAFKA_7_6_1_IMAGE` with generic aliases defaulting to `7.8.7`.

**Step 2: Render Compose config**
Run: `./scripts/deploy/docker-compose-aliyun.sh config`
Expected: config renders successfully.

### Task 2: Update runtime Dockerfiles

**Files:**
- Modify: `web/Dockerfile`
- Modify: `ticketing/web/Dockerfile`
- Modify: `device-flow/frontend/Dockerfile`
- Modify: `sec-impl/frontend/Dockerfile`
- Modify: `train-exam/frontend/Dockerfile`
- Modify: `inventory-system/frontend/Dockerfile`
- Modify: `tender/frontend/Dockerfile`
- Modify: `faq/frontend/Dockerfile`
- Modify: `cmdb/web/Dockerfile`

**Step 1: Replace versioned Nginx ARG names**
- Use `ARG NGINX_ALPINE_IMAGE=nginx:alpine`
- Use `FROM ${NGINX_ALPINE_IMAGE}` for the final stage.

**Step 2: Run a fast syntax-level build-path check**
Run: `./scripts/deploy/docker-compose-aliyun.sh config`
Expected: no missing build args.

### Task 3: Update image resolver and tests

**Files:**
- Modify: `scripts/deploy/resolve-image-sources.sh`
- Modify: `scripts/tests/aliyun-image-resolution.sh`

**Step 1: Update resolver defaults**
- `NGINX_ALPINE_IMAGE=nginx:alpine`
- `MYSQL_IMAGE=mysql:8.4`
- `CP_ZOOKEEPER_IMAGE=confluentinc/cp-zookeeper:7.8.7`
- `CP_KAFKA_IMAGE=confluentinc/cp-kafka:7.8.7`

**Step 2: Update shell test expectations**
Run: `bash scripts/tests/aliyun-image-resolution.sh`
Expected: `aliyun image resolution: ok`

### Task 4: Update docs and verify runtime compatibility notes

**Files:**
- Modify: `docs/deploy-docker.md`
- Modify: `docs/plans/2026-03-12-aliyun-image-source-design.md`
- Modify: `docs/plans/2026-03-12-aliyun-image-source-implementation.md`

**Step 1: Refresh documentation to the new image policy**
- Note that MySQL is on `8.4` LTS rather than raw `latest`
- Note that Kafka/ZooKeeper stay on compatible 7.x because 8.x removes ZooKeeper

**Step 2: Run final checks**
Run:
- `bash -n scripts/deploy/resolve-image-sources.sh`
- `bash -n scripts/deploy/docker-compose-aliyun.sh`
- `./scripts/deploy/docker-compose-aliyun.sh config`
- `bash scripts/tests/aliyun-image-resolution.sh`

Expected: all commands succeed.
