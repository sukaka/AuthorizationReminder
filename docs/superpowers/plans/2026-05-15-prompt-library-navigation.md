# Prompt Library Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-level prompt library browser with prompt creation, prompt list, row actions, and personal favorites.

**Architecture:** Extend the existing prompt-center backend service and React single-page app without adding new frameworks. Keep the API namespace under `/api/prompt-center` and keep existing department-manager permissions.

**Tech Stack:** Node.js, Express, MySQL, React, Vite, Node test runner, Vitest.

---

### Task 1: Backend Schema and Service Tests

**Files:**
- Modify: `prompt-center/backend/tests/prompt-service.test.mjs`
- Modify: `prompt-center/backend/src/db.js`
- Modify: `prompt-center/backend/src/prompt-service.js`

- [ ] Add failing tests for category parent/level validation, descendant category prompt filtering, and personal favorite writes.
- [ ] Run `npm --prefix prompt-center/backend test -- prompt-service.test.mjs` and confirm the new tests fail.
- [ ] Add `parent_id`, `level`, and `pc_prompt_favorites`.
- [ ] Implement service helpers and rerun backend tests.

### Task 2: Backend Routes

**Files:**
- Modify: `prompt-center/backend/src/index.js`
- Modify: `prompt-center/backend/tests/prompt-service.test.mjs`

- [ ] Add route coverage expectations for favorites and category hierarchy behavior.
- [ ] Implement `GET /favorites`, `POST /prompts/:id/favorite`, and `DELETE /prompts/:id/favorite`.
- [ ] Run backend tests and `node --check` on backend source files.

### Task 3: Frontend Navigation and Pages

**Files:**
- Modify: `prompt-center/frontend/tests/source-ui.test.mjs`
- Modify: `prompt-center/frontend/src/App.jsx`
- Modify: `prompt-center/frontend/src/App.css`

- [ ] Add failing source tests for “提示词创建”, “提示词列表”, “我的收藏”, “一级分类”, “二级分类”, “三级分类”, “编辑”, “删除”, and “收藏”.
- [ ] Implement sidebar submenu, create page, department/category drill-down list page, and favorites page.
- [ ] Run frontend tests and Vite build.

### Task 4: Verification and Release

**Files:**
- All modified files.

- [ ] Run backend tests, frontend tests, build, and syntax checks.
- [ ] Rebuild Docker services `prompt-center-api` and `web-prompt-center`.
- [ ] Probe health endpoints.
- [ ] Commit and push with feature version bump.
