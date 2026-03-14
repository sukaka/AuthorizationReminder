# User Import Template Download Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a sysadmin-only Excel template download for user import so admins can get the exact workbook structure expected by the existing import flow.

**Architecture:** Keep template generation on the reminder server beside the current user import helpers, expose one small authenticated download route, and add a single button in the existing user import UI that downloads the workbook as a blob.

**Tech Stack:** Node.js, Express, xlsx, React, Vite, node:test

---

### Task 1: Add backend template workbook helper with tests

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/user-import.js`
- Modify: `/Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js`

**Step 1: Write the failing test**

Add a test like:

```js
const buffer = buildUserImportTemplateWorkbook()
const workbook = xlsx.read(buffer, { type: 'buffer' })
const rows = xlsx.utils.sheet_to_json(workbook.Sheets.template, { defval: '' })

assert.ok(Buffer.isBuffer(buffer))
assert.equal(workbook.SheetNames[0], 'template')
assert.equal(rows[0].username, 'editor_demo')
assert.equal(rows[0].app_access, 'faq|tender')
```

**Step 2: Run test to verify it fails**

Run: `node --test server/tests/user-import.test.js`

Expected: FAIL with `buildUserImportTemplateWorkbook is not a function`.

**Step 3: Write minimal implementation**

In `/Users/zhanglei/Documents/codex-new/server/user-import.js`, add:

```js
const buildUserImportTemplateWorkbook = () => {
  const rows = [
    {
      username: 'editor_demo',
      role: 'editor',
      is_active: '1',
      app_access: 'faq|tender',
      email: 'editor_demo@example.com',
      phone: '13800000000',
      wecom_id: 'editor-demo',
    },
  ]
  const sheet = xlsx.utils.json_to_sheet(rows, {
    header: ['username', 'role', 'is_active', 'app_access', 'email', 'phone', 'wecom_id'],
  })
  const workbook = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(workbook, sheet, 'template')
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}
```

Also export the helper.

**Step 4: Run test to verify it passes**

Run: `node --test server/tests/user-import.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add server/user-import.js server/tests/user-import.test.js
git commit -m "feat: add user import template workbook helper"
```

### Task 2: Add template download route and OpenAPI entry

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/index.js`
- Modify: `/Users/zhanglei/Documents/codex-new/server/api/openapi/reminder-v1.yaml`

**Step 1: Write the failing test**

Because this codebase currently does not have route-level automated tests for this area, keep the TDD seam in the helper layer from Task 1 and use syntax/runtime verification for the route itself.

Document the route contract explicitly in the OpenAPI diff first:

- `GET /api/import/users/template.xlsx`
- `requireRole(['sysadmin'])`
- binary Excel response

**Step 2: Run the route syntax verification**

Run: `node --check /Users/zhanglei/Documents/codex-new/server/index.js`

Expected: PASS before edits.

**Step 3: Write minimal implementation**

In `/Users/zhanglei/Documents/codex-new/server/index.js`:

- import `buildUserImportTemplateWorkbook`
- add:

```js
app.get('/api/import/users/template.xlsx', requireRole(['sysadmin']), async (_req, res) => {
  const buffer = buildUserImportTemplateWorkbook()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="user-import-template.xlsx"')
  res.send(buffer)
})
```

Update `/Users/zhanglei/Documents/codex-new/server/api/openapi/reminder-v1.yaml` with the new route.

**Step 4: Run verification**

Run: `node --check /Users/zhanglei/Documents/codex-new/server/index.js`

Expected: PASS

Run: `node --test server/tests/user-import.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add server/index.js server/api/openapi/reminder-v1.yaml
git commit -m "feat: add user import template download route"
```

### Task 3: Add frontend download button in the existing import area

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/web/src/App.jsx`
- Modify: `/Users/zhanglei/Documents/codex-new/web/src/user-import.js`

**Step 1: Write the failing test**

If you extend the frontend helper, add a focused test in `/Users/zhanglei/Documents/codex-new/web/src/user-import.test.js` like:

```js
assert.equal(resolveUserImportTemplateFilename(null), 'user-import-template.xlsx')
assert.equal(resolveUserImportTemplateFilename('custom.xlsx'), 'custom.xlsx')
```

**Step 2: Run test to verify it fails**

Run: `node --test web/src/user-import.test.js`

Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

In `/Users/zhanglei/Documents/codex-new/web/src/user-import.js`, add a tiny filename helper if needed:

```js
export const resolveUserImportTemplateFilename = (value) =>
  String(value || 'user-import-template.xlsx')
```

In `/Users/zhanglei/Documents/codex-new/web/src/App.jsx`:

- add `onDownloadUserImportTemplate`
- call `fetch('/api/import/users/template.xlsx', { credentials: 'include' })`
- read blob
- trigger browser download

Add a secondary button next to the existing Excel import button in the current user import block. Do not move the whole layout.

**Step 4: Run verification**

Run: `node --test web/src/user-import.test.js`

Expected: PASS

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run build`

Expected: PASS

**Step 5: Commit**

```bash
git add web/src/App.jsx web/src/user-import.js web/src/user-import.test.js
git commit -m "feat: add user import template download button"
```

### Task 4: Update manual and do final verification

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docs/manuals/reminder-user-manual.md`

**Step 1: Update docs**

In the user management section, add one flat bullet:

- 支持下载用户导入模板 Excel，按模板填写后再执行批量导入

**Step 2: Run final verification**

Run: `node --test /Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js /Users/zhanglei/Documents/codex-new/web/src/user-import.test.js`

Expected: PASS

Run: `node --check /Users/zhanglei/Documents/codex-new/server/index.js`

Expected: PASS

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run build`

Expected: PASS

**Step 3: Manual smoke**

1. Log in as `sysadmin`
2. Open 用户管理
3. Click 下载模板
4. Confirm browser downloads `user-import-template.xlsx`
5. Open the workbook and confirm:
   - first sheet is `template`
   - headers match the import contract
   - one sample row exists

**Step 4: Commit**

```bash
git add docs/manuals/reminder-user-manual.md
git commit -m "docs: add user import template download guidance"
```
