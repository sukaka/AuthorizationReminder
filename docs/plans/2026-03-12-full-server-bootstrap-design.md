# Full Server Bootstrap Script Design

**Date:** 2026-03-12

## Goal

Provide a single repository script that can configure the Docker mirror, fetch or update the repository, prepare deployment prerequisites, and bootstrap all services on a new server for release `4.0.9`.

## Approved Approach

Use a wrapper bootstrap script with safe defaults and required runtime inputs.

- Default repository directory: `/root/AuthorizationReminder-codex-4.0.9`
- Default branch: `codex/4.0.9`
- Required runtime inputs:
  - `ALIYUN_MIRROR_URL`
  - `AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD`
- Optional overrides:
  - `BOOTSTRAP_REPO_DIR`
  - `BOOTSTRAP_BRANCH`
  - `BOOTSTRAP_REPO_URL`

The script will configure `/etc/docker/daemon.json`, restart Docker, clone or update the repository, set executable bits for deploy scripts, then call the existing repository bootstrap entrypoint.

## Why This Design

- Keeps operator workflow to one script invocation.
- Avoids hardcoding tenant-specific secrets or private mirror values into the repository.
- Reuses existing `bootstrap-new-server.sh` and `docker-compose-aliyun.sh` instead of duplicating service bootstrap logic.
- Supports later reuse on other hosts by allowing directory and branch overrides.

## Non-Goals

- Managing systemd units.
- Creating ACR image repositories.
- Replacing the existing app-level bootstrap scripts.

## Files To Change

- Create: `/Users/zhanglei/Documents/codex-new/scripts/deploy/bootstrap-full-server.sh`
- Create: `/Users/zhanglei/Documents/codex-new/scripts/tests/bootstrap-full-server.sh`
- Modify: `/Users/zhanglei/Documents/codex-new/README.md`
- Modify: `/Users/zhanglei/Documents/codex-new/docs/deploy-docker.md`

## Verification

- Shell test for orchestration flow with stubbed `git`, `docker`, and `systemctl`
- `bash -n` on the new script and touched scripts
- No secrets written to repository files
