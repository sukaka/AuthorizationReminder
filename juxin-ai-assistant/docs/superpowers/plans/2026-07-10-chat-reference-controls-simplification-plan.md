# Chat Reference Controls Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate chat reference controls and automatically select a newly uploaded, ready personal reference.

**Architecture:** Keep `referenceScope` as the single source of truth and expose it only through the top-bar selector. Reuse the existing personal-reference selection state after upload; no backend or API contract changes.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

## Global Constraints

- Keep the top-bar assistant-mode and reference-scope selectors.
- Keep composer upload and specific-file picker actions.
- Do not change backend APIs or reference permission rules.
- Do not touch unrelated untracked files.

---

### Task 1: Simplify Composer Controls And Auto-Select Uploads

**Files:**
- Modify: `juxin-ai-assistant/apps/desktop/tests/chat-page.test.tsx`
- Modify: `juxin-ai-assistant/apps/desktop/src/pages/ChatPage.tsx`
- Modify: root and desktop package version files selected by the repository version workflow

**Interfaces:**
- Consumes: `ReferenceScope`, `setReferenceScope`, `setSelectedPersonalReferenceIds`, `isReadyPersonalReference`
- Produces: unchanged chat prepare request contract with updated UI state

- [x] **Step 1: Write failing tests**

Update the composer shortcut test to assert that `查公司知识`, `我的资料`, `当前附件`, and the composer mode echo are absent while the top reference selector remains. Replace the upload test expectation with:

```ts
expect(screen.getByRole('combobox', { name: '助手模式' })).toHaveValue('knowledge');
expect(screen.getByRole('combobox', { name: '参考资料' })).toHaveValue('with_personal');
expect(screen.getByRole('region', { name: '已引用资料' })).toHaveTextContent('引用：会议记录.txt');
```

Also assert the next prepare request contains `mode: 'knowledge'`, `include_personal_references: true`, and `include_session_attachments: false`.

- [x] **Step 2: Verify RED**

Run:

```bash
npm test -- --run tests/chat-page.test.tsx
```

Expected: FAIL because duplicate controls still render and personal uploads remain unselected.

- [x] **Step 3: Implement minimal behavior**

In the ready personal upload branch, add the uploaded file to `personalReferenceFiles`, select its UUID, set mode to `knowledge`, and enable personal references while preserving any enabled session attachment:

```ts
if (isReadyPersonalReference(uploaded)) {
  setSelectedPersonalReferenceIds((current) => (
    current.includes(uploaded.file_uuid) ? current : current.concat(uploaded.file_uuid)
  ));
  setMode('knowledge');
  setReferenceScope((current) => (
    current === 'with_session' || current === 'personal_and_session'
      ? 'personal_and_session'
      : 'with_personal'
  ));
}
```

Change the success copy to state that the file is selected. Remove the three composer source buttons and `.chat-mode-pill` element. Remove handlers and labels that become unused only if TypeScript confirms they have no remaining callers.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- --run tests/chat-page.test.tsx
npm run typecheck
```

Expected: chat-page tests and TypeScript pass.

- [x] **Step 5: Visual verification**

Run the existing desktop web dev server and capture desktop and narrow viewport screenshots. Confirm the composer contains only upload, specific-file selection, model/background controls, and send action without overlap.

- [x] **Step 6: Version and commit**

Use the repository version workflow to bump the feature/minor version, then stage only this task's source, test, spec, plan, and version files. Commit with:

```bash
git commit -m "feat(ai-assistant): simplify chat reference controls"
```

Push `codex/simplify-chat-reference-controls`.
