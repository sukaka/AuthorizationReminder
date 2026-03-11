# FAQ Article Row Number Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a row-number column to the FAQ article list and recycle list, using globally continuous numbering across paginated pages.

**Architecture:** Keep numbering logic entirely in the frontend. Compute the first visible row number from the current page and page size, then render `rowStart + rowIndex + 1` in the table header, loading skeleton, and each data row. Adjust CSS grid columns to reserve a narrow sequence column.

**Tech Stack:** React, Vite, CSS

---

### Task 1: Add row-number rendering to the FAQ article list

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.jsx`

**Step 1: Compute row start**

Add a derived value based on:
- `articles.page`
- `articles.limit`

Formula:

```js
const articleRowStart = ((articles.page || 1) - 1) * (articles.limit || 20)
```

**Step 2: Add sequence header**

Render a `序号` column before `标题`.

**Step 3: Add sequence skeleton cell**

Update loading rows so the column count remains aligned.

**Step 4: Add sequence value in each article row**

Use:

```js
articleRowStart + rowIndex + 1
```

### Task 2: Adjust FAQ article table layout

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/faq/frontend/src/App.css`

**Step 1: Add article row sequence column width**

Adjust the table grid used by the FAQ article list so the sequence column is narrow and stable.

**Step 2: Center the sequence cell**

Keep the sequence visually compact and aligned with the rest of the table.

### Task 3: Verify and record

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/memory/2026-03-10.md`

**Step 1: Build frontend**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new/faq/frontend && npm run build
```

Expected: PASS

**Step 2: Update memory**

Append the FAQ article row-number change and verification result to the daily memory.
