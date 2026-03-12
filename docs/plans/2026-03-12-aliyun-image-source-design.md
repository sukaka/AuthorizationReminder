# Docker Aliyun-First Image Source Design

**Date:** 2026-03-12

## Goal

Make all Dockerfile base images and Compose runtime images prefer Aliyun-hosted image sources when available, while falling back to official upstream images when Aliyun-hosted copies are unavailable.

## Constraints

- Dockerfile `FROM` and Compose `image` do not support native fallback lists.
- A generic, stable Aliyun public image path for every upstream image used in this repository cannot be safely assumed.
- The solution must not hardcode secrets or tenant-specific ACR namespaces.
- Existing `docker compose up -d --build` workflows should remain usable.

## Chosen Approach

Use indirection plus resolution scripts.

1. Replace hardcoded registry prefixes in all `Dockerfile*` files with `ARG`-based image variables whose defaults are official upstream images.
2. Replace hardcoded `image:` values in Compose files with environment-backed variables, also defaulting to official upstream images.
3. Add a resolver script that:
   - accepts optional Aliyun registry prefixes or full-image overrides via environment variables;
   - probes candidate Aliyun image references with `docker manifest inspect`;
   - writes a generated env file containing the selected image for each alias;
   - falls back to the official image when Aliyun is unavailable.
4. Add a wrapper script that runs the resolver, then invokes `docker compose` with the generated env file.
5. Update the new-server bootstrap script to use the wrapper so first-time deployment follows the same resolution logic.

## Why This Approach

- It is the only reliable way to implement “Aliyun first, official second” without lying about Docker’s capabilities.
- It avoids inventing non-portable public image paths.
- It works for both build-time images (`FROM`) and runtime images (`image:`).
- It keeps local development working even without any Aliyun registry setup.

## Configuration Model

The resolver will support:

- `ALIYUN_IMAGE_NAMESPACE` style registry prefixes for common upstream mirrors.
- full-image overrides for exceptional cases, such as third-party images.
- official image defaults embedded in the script and Dockerfiles.

Example selected aliases:

- `NODE_20_BOOKWORM_IMAGE`
- `NODE_20_BOOKWORM_SLIM_IMAGE`
- `NODE_20_ALPINE_IMAGE`
- `NGINX_1_25_ALPINE_IMAGE`
- `NGINX_1_27_ALPINE_IMAGE`
- `MYSQL_8_IMAGE`
- `GOLANG_1_22_ALPINE_IMAGE`
- `ALPINE_3_20_IMAGE`
- `ONLYOFFICE_DOCUMENTSERVER_8_1_1_IMAGE`
- `CP_ZOOKEEPER_7_6_1_IMAGE`
- `CP_KAFKA_7_6_1_IMAGE`
- `KAFKA_UI_LATEST_IMAGE`

## Files To Change

- Root Compose: `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
- CMDB deploy Compose: `/Users/zhanglei/Documents/codex-new/cmdb/deploy/docker-compose.yml`
- All repository Dockerfiles using hardcoded registries
- Root env example: `/Users/zhanglei/Documents/codex-new/.env.example`
- Deployment docs and bootstrap scripts

## Verification

- `docker compose --env-file .env.example config`
- `bash -n` for new scripts
- targeted script test runs for image resolution
- at least one `docker compose build` path using generated image env output

## Risks

- Some servers may not have `docker manifest inspect` support in older Docker builds.
- Aliyun mirror layout is operator-specific in many environments, so defaults must remain official-safe.
- Build cache invalidation may increase on first rebuild after alias changes.

## Non-Goals

- Managing Docker daemon registry-mirror settings.
- Creating or syncing Aliyun ACR repositories automatically.
- Rewriting application package-manager mirrors unless required by specific Dockerfiles.
