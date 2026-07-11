# Upload Category Hierarchy and Nonempty UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parent and child knowledge categories unmistakable in both upload flows and guarantee a recoverable UI when a workspace component crashes.

**Architecture:** Add a small shared category presentation module that converts existing `KnowledgeCategoryPayload[]` into stable, indented select options and resolves breadcrumb paths without changing API values. Both upload surfaces consume it. Add a React error boundary around the workspace as the application-level last resort; existing page-level loading, empty, and error states remain responsible for normal recoverable failures.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, existing CSS tokens.

## Global Constraints

- Preserve existing upload API payloads; category values remain category names.
- Use native `select`; do not add a new UI dependency.
- Disabled categories are not selectable.
- Do not expose exception messages or stacks in the fallback UI.
- Keep `.agents/` and unrelated worktree changes unstaged.

---

### Task 1: Shared hierarchical category presentation

**Files:**
- Create: `apps/desktop/src/components/knowledgeCategoryOptions.ts`
- Create: `apps/desktop/tests/knowledge-category-options.test.ts`

**Interfaces:**
- Consumes: `KnowledgeCategoryPayload[]` from `src/api/chat.ts`.
- Produces: `buildKnowledgeCategoryOptions(categories, currentValue?, fallbackNames?)` and `getKnowledgeCategoryPath(categories, selectedName)`.

- [x] **Step 1: Write failing unit tests**

Test stable parent-first ordering, labels `产品资料` and `　└ WDSP`, original value `WDSP`, disabled-category exclusion, and path `产品资料 / WDSP`.

- [x] **Step 2: Run RED verification**

Run: `npm test -- knowledge-category-options.test.ts`

Expected: FAIL because `knowledgeCategoryOptions.ts` does not exist.

- [x] **Step 3: Implement minimal shared functions**

Build a visited parent-child traversal using `sort_order` then Chinese name. Preserve orphan categories as root entries and prevent cycles with a visited set.

- [x] **Step 4: Run GREEN verification**

Run: `npm test -- knowledge-category-options.test.ts`

Expected: all tests pass.

### Task 2: Use hierarchy in both upload flows

**Files:**
- Modify: `apps/desktop/src/pages/KnowledgePage.tsx`
- Modify: `apps/desktop/src/pages/ChatPage.tsx`
- Modify: `apps/desktop/tests/admin-navigation.test.tsx`
- Modify: `apps/desktop/tests/chat-page.test.tsx`
- Modify: `apps/desktop/src/theme/tokens.css`

**Interfaces:**
- Consumes: Task 1 shared category options and path helper.
- Produces: native select options whose visible labels express hierarchy while submitted values remain unchanged.

- [x] **Step 1: Write failing UI tests**

Mock `产品资料` and child `WDSP`; assert each upload select contains `产品资料` and `　└ WDSP`, selecting the child shows `当前分类：产品资料 / WDSP`, and upload submits `category: 'WDSP'`.

- [x] **Step 2: Run RED verification**

Run: `npm test -- admin-navigation.test.tsx chat-page.test.tsx`

Expected: hierarchy/path assertions fail against the current flat name arrays.

- [x] **Step 3: Replace flat option construction**

Use shared options in both pages. Render a small path note below each select. When no server categories exist, retain existing fallback categories; when the server returns only disabled categories, show the actionable empty-category notice and disable the upload action.

- [x] **Step 4: Run GREEN verification**

Run: `npm test -- admin-navigation.test.tsx chat-page.test.tsx`

Expected: all targeted tests pass.

### Task 3: Application-level nonempty fallback

**Files:**
- Create: `apps/desktop/src/components/WorkspaceErrorBoundary.tsx`
- Create: `apps/desktop/tests/workspace-error-boundary.test.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/theme/tokens.css`

**Interfaces:**
- Consumes: workspace React children.
- Produces: a fallback region with “页面暂时无法显示”, “重新加载”, and “返回工作台”.

- [x] **Step 1: Write failing boundary tests**

Render a child that throws and assert the fallback is visible, the thrown message is absent, reload invokes the provided callback, and return invokes the provided callback.

- [x] **Step 2: Run RED verification**

Run: `npm test -- workspace-error-boundary.test.tsx`

Expected: FAIL because the boundary does not exist.

- [x] **Step 3: Implement and wire the boundary**

Create a class error boundary, wrap the workspace content in `App.tsx`, and use existing status/fallback visual tokens. Do not log the exception content.

- [x] **Step 4: Run GREEN verification**

Run: `npm test -- workspace-error-boundary.test.tsx`

Expected: all tests pass.

### Task 4: Verification, audit, version, and delivery

**Files:**
- Modify: version files selected by the repository version hook for a functional optimization release.

- [x] **Step 1: Run focused and related tests**

Run: `npm test -- knowledge-category-options.test.ts workspace-error-boundary.test.tsx admin-navigation.test.tsx chat-page.test.tsx`

Expected: zero failures.

- [x] **Step 2: Run static and production checks**

Run: `npm run typecheck`

Run: `npm run build`

Expected: both exit 0.

- [x] **Step 3: Review UI/UX findings**

Record remaining high-value issues discovered by the focused audit; do not mix unrelated redesigns into this diff.

- [x] **Step 4: Inspect and commit only task files**

Run: `git diff --check` and `git status --short`; stage only the files listed above plus automatic version files. Commit as a functional optimization so the repository hook increments the second version component, then push the current branch.

