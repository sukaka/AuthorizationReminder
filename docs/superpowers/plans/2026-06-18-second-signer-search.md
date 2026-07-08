# Second Signer Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the second-signer native select with an accessible username-searchable combobox.

**Architecture:** Keep the component local to `App.jsx` and reuse the existing user option data. The component owns only open/query/highlight state while the parent continues to own the selected user ID.

**Tech Stack:** React, CSS, Node test runner, Vite, Docker Compose.

---

### Task 1: Searchable second signer selector

**Files:**
- Modify: `device-flow/frontend/src/App.jsx`
- Modify: `device-flow/frontend/src/App.css`
- Test: `device-flow/backend/tests/stage-flow-source.test.js`

- [x] Add a failing source test for `SearchableUserSelect`, username-only filtering, combobox semantics, keyboard handling, and “未找到用户”.
- [x] Run `node --test device-flow/backend/tests/stage-flow-source.test.js` and confirm RED.
- [x] Implement the controlled searchable selector and replace the native second-signer select.
- [x] Add focused dropdown, option, highlighted, empty, and clear-button styles.
- [x] Run the source test and confirm GREEN.
- [x] Run related tests, Docker frontend build, versioning tests, and `git diff --check`.
- [ ] Commit with `feat: add searchable second signer selector`, auto-bump to `5.86.0`, push, and rebuild `auth` plus `web-device-flow`.
