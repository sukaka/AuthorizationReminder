# Device Flow Job Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure only `admin` can view every device-flow job, while other users can view jobs they created or jobs for which they were permanently designated as the second signer, and show every eligible device-flow user in the second-signer selector.

**Architecture:** Add a small pure visibility module that builds one SQL predicate from the authenticated actor. Reuse that predicate in list/aggregate queries and a centralized Express access middleware for job-specific routes, so frontend hiding is never the security boundary. Keep the auth directory contract unchanged and remove only the erroneous frontend role filter, because the directory already returns active users eligible to enter device-flow.

**Tech Stack:** Node.js, Express, MySQL 8, React, Node test runner, Docker Compose.

---

### Task 1: Define and test the visibility predicate

**Files:**
- Create: `device-flow/backend/src/job-visibility.js`
- Create: `device-flow/backend/tests/job-visibility.test.js`

- [x] Write tests proving `admin` is unrestricted and every other role is scoped by creator or permanent second-signer identity.
- [x] Run `node --test device-flow/backend/tests/job-visibility.test.js` and verify it fails because the module is missing.
- [x] Implement `buildJobVisibilityScope({ actor, jobAlias })` with parameterized SQL and no dual-sign status restriction.
- [x] Run the focused test and verify it passes.

### Task 2: Enforce visibility in device-flow APIs

**Files:**
- Modify: `device-flow/backend/src/index.js`
- Modify: `device-flow/backend/tests/stage-flow-source.test.js`

- [x] Write source regression tests for the visibility import, list scope, centralized `requireVisibleJob`, and 404 response.
- [x] Run the source test and verify it fails before implementation.
- [x] Scope list, dashboard, SLA, exports, cycle reports, and dual-sign session reads with the common predicate.
- [x] Guard job-ID routes with `requireVisibleJob`; resolve parent jobs for attachment and change-request ID routes.
- [x] Run backend tests and syntax checks.

### Task 3: Show all eligible second signers and release

**Files:**
- Modify: `device-flow/frontend/src/App.jsx`
- Modify: `device-flow/backend/tests/stage-flow-source.test.js`

- [x] Write a failing source test that rejects management-role-only filtering.
- [x] Build options from all users returned by `/api/auth/system-users?system=device-flow`, excluding only the current user.
- [x] Run backend tests, frontend Docker build, versioning tests, and `git diff --check`.
- [ ] Commit with `fix: isolate device flow jobs by user`, let hooks bump/push the patch version, and rebuild auth/device-flow containers.
