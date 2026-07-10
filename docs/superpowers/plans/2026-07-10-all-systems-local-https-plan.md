# All Systems Local HTTPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every externally published HTTP system endpoint through one HTTPS-only gateway while preserving existing ports and providing safe local test certificates.

**Architecture:** A Compose Overlay removes direct HTTP publications from application services and publishes the same ports from one Nginx TLS gateway. A certificate script creates an ignored local CA and SAN certificate; internal Docker traffic remains HTTP.

**Tech Stack:** Docker Compose, Nginx, OpenSSL, Bash, Node.js configuration tests

## Global Constraints

- Preserve all existing public port numbers.
- Exclude MySQL, PostgreSQL, and Redis from HTTPS wrapping.
- Never commit generated certificates or private keys.
- Never weaken production TLS or cookie security.
- Keep the base Compose development workflow available.

---

### Task 1: Lock The HTTPS Port And Route Contract

**Files:**
- Create: `scripts/tests/all-systems-https-config.sh`
- Create: `deploy/https/all-systems-nginx.conf`
- Create: `docker-compose.all-systems-https.yml`

- [x] Write a failing shell test that renders the Overlay and verifies all 30 HTTPS ports are published only by `https-gateway`, every original service has no published port, and the Nginx config contains the matching TLS listener and upstream.
- [x] Run `bash scripts/tests/all-systems-https-config.sh` and confirm RED because the Overlay and gateway do not exist.
- [x] Add the minimal Nginx configuration and Compose Overlay to satisfy the route contract.
- [x] Re-run the configuration test and confirm GREEN.

### Task 2: Generate Safe Local Test Certificates

**Files:**
- Create: `scripts/dev/generate-local-https-cert.sh`
- Create: `scripts/tests/local-https-cert.sh`
- Modify: `.gitignore`

- [x] Write a failing test that generates certificates in a temporary directory and verifies issuer, key separation, SAN entries, file permissions, and stable reruns.
- [x] Run the certificate test and confirm RED.
- [x] Implement CA and leaf certificate generation with OpenSSL.
- [x] Ignore the default generated certificate directory.
- [x] Re-run the certificate test and confirm GREEN.

### Task 3: Enforce HTTPS Public URLs And Secure Cookies

**Files:**
- Modify: `docker-compose.all-systems-https.yml`
- Modify: `scripts/tests/all-systems-https-config.sh`
- Modify: `.env.example`

- [x] Extend the failing configuration test to assert HTTPS Auth/application URLs, HTTPS CORS origins, secure cookies, strict mode, and removal of direct API publications.
- [x] Run the test and confirm RED.
- [x] Add exact Overlay environment overrides for Auth and every API.
- [x] Document local HTTPS variables in `.env.example` without real secrets.
- [x] Re-run the test and confirm GREEN.

### Task 4: Add One-Command Local HTTPS Startup And Verification

**Files:**
- Create: `scripts/dev/start-local-https.sh`
- Create: `scripts/tests/start-local-https.sh`
- Create: `docs/local-https.md`

- [x] Write a failing command-contract test for validation, Compose invocation, and printed system URLs.
- [x] Run the command test and confirm RED.
- [x] Implement the startup script without embedding secrets.
- [x] Document certificate generation, macOS trust, startup, verification, and rollback.
- [x] Re-run command and configuration tests.

### Task 5: End-To-End Verification And Release

**Files:**
- Modify: root version files through repository version automation
- Modify: this plan checkbox state

- [x] Generate a real ignored local CA and certificate for `localhost`, `127.0.0.1`, and the current LAN IP.
- [x] Run all new tests and existing Compose/security tests.
- [x] Run `docker compose config` for base and HTTPS Overlay.
- [x] Run Nginx configuration validation and HTTPS route smoke tests where local services are available.
- [x] Confirm generated private keys are untracked and ignored.
- [x] Bump the platform minor version, commit only task files, and push the feature branch.
