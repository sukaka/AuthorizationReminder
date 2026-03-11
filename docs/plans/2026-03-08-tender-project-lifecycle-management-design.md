# Tender Project Lifecycle Management Design

**Date:** 2026-03-08

**Scope**

This design closes the current `GAP-0021` with a minimum, reviewable frontend slice on top of existing backend APIs. The goal is to make the "标书管理" page usable as a true lifecycle management page without introducing new backend contracts.

## Goal

Complete the project lifecycle management page so users can:

- edit a project's basic information
- view current lifecycle progress
- assign project members
- inspect review history
- continue using existing status transitions, review submission, delete, version, and editor actions

## Existing Constraints

- Backend already supports bid detail, member assignment, status transition, review submit, and review history.
- There is no authenticated user list API for member picking.
- The current frontend is a single-page `App.jsx`, so the change should stay incremental and avoid broad refactors.

## Approaches Considered

### Option A: Extend the current `bids` page detail area

- Add a project detail panel below the selected bid's version panel.
- Reuse current `selectedBid` state and existing bid actions.
- Use username-based manual member assignment because there is no user directory API.

This is the recommended option because it keeps the diff small and aligns with the existing screen structure.

### Option B: Create a brand new project-detail route/view

- Cleaner separation between list and detail.
- Better long-term structure for future pages.

This is not recommended for this pass because it increases surface area and delays closure of `GAP-0021`.

## Final Design

### 1. Project Detail Panel

When a bid is selected, show a lifecycle management panel under the version history area with four blocks:

- Basic info
- Lifecycle progress
- Member assignment
- Review history

This keeps all project actions in one place and preserves the current "select from list, operate in detail" pattern.

### 2. Basic Info Editing

Fields:

- title
- customer_name
- project_name
- summary

Behavior:

- load from `/api/tender/bids/:id`
- edit locally in a small form
- save via `PUT /api/tender/bids/:id`
- refresh list and selected detail after save

### 3. Lifecycle Progress

Show a visual step list based on current status:

- 草稿
- 文件就绪
- 资料补齐
- 生成与编制
- 多级审核
- 导出归档

Each step shows whether it is complete, current, or pending. The panel also shows current status, review stage, review status, and key timestamps when available.

### 4. Member Assignment

Show current assigned members from `/api/tender/bids/:id/members`.

Editing model:

- add rows locally
- fields: `member_username`, `member_role`, `member_title`
- allow deleting non-owner draft rows
- submit all rows via `PUT /api/tender/bids/:id/members`

Because there is no user directory API, the UI uses manual username input instead of a picker.

### 5. Review History

Load `/api/tender/bids/:id/reviews?limit=30` and render:

- round
- review stage
- review status
- submitted by / reviewer
- comment
- submitted / handled time

This gives visible auditability for lifecycle progress without adding new backend logic.

## Error Handling

- If detail, members, or reviews fail independently, show inline empty/error state and keep the rest of the panel usable.
- Member submission validates username and role before sending.
- Basic info save validates required fields before sending.

## Testing Strategy

Use a small pure helper module plus node-based tests for:

- lifecycle step derivation from bid status
- member draft normalization and validation
- review label mapping

Then run frontend build to verify integration.
