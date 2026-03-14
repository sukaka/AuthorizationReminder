# User Excel Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Excel-based bulk user import in the reminder portal so sysadmins can upload user rows, skip duplicate usernames, receive generated per-user initial passwords, and download a result workbook immediately.

**Architecture:** Keep the import inside the existing reminder server instead of pushing row-by-row creation into the browser. Reuse the current file upload, `parseImportFile`, `import_jobs`, and `xlsx` stack, then return a generated result workbook plus summary headers to the existing React portal.

**Tech Stack:** Node.js, Express, mysql2, multer, xlsx, csv-parse, React, Vite, node:test

---

### Task 1: Build and test backend import helpers

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/server/user-import.js`
- Test: `/Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js`

**Step 1: Write the failing test**

```js
const summary = normalizeUserImportRow({
  username: 'editor01',
  role: 'editor',
  is_active: '启用',
  app_access: 'faq|tender',
})

assert.deepEqual(summary, {
  username: 'editor01',
  role: 'editor',
  is_active: 1,
  app_access: ['faq', 'tender'],
  email: '',
  phone: '',
  wecom_id: '',
})
```

再写一个密码测试：

```js
const password = generateImportPassword({
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
})

assert.match(password, /[A-Z]/)
assert.match(password, /[a-z]/)
assert.match(password, /\d/)
assert.match(password, /[^A-Za-z0-9]/)
assert.ok(password.length >= 10)
```

**Step 2: Run test to verify it fails**

Run: `node --test server/tests/user-import.test.js`

Expected: FAIL with `Cannot find module '/Users/zhanglei/Documents/codex-new/server/user-import.js'` or missing export error.

**Step 3: Write minimal implementation**

在 `server/user-import.js` 先实现这几个纯函数：

```js
const splitImportAccess = (value) =>
  String(value || '')
    .split(/[|,，、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const normalizeImportActive = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  if (['0', 'false', '禁用', '停用'].includes(text)) return 0
  return 1
}
```

再补 `generateImportPassword(policy)`，先保证满足复杂度要求，再打乱字符顺序。

**Step 4: Run test to verify it passes**

Run: `node --test server/tests/user-import.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add server/user-import.js server/tests/user-import.test.js
git commit -m "feat: add user import helper primitives"
```

### Task 2: Add unit-tested import summary and result workbook generation

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/user-import.js`
- Modify: `/Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js`

**Step 1: Write the failing test**

补一组结果文件测试：

```js
const buffer = buildUserImportWorkbook([
  {
    username: 'editor01',
    role: 'editor',
    is_active: 1,
    app_access_text: 'faq|tender',
    result: 'SUCCESS',
    reason: '',
    initial_password: 'Temp#2026a',
  },
  {
    username: 'dup-user',
    role: 'viewer',
    is_active: 1,
    app_access_text: 'faq',
    result: 'SKIPPED',
    reason: '用户名已存在',
    initial_password: '',
  },
])

assert.ok(Buffer.isBuffer(buffer))
```

如果你愿意多测一步，就把 workbook 再读回来，断言第二行失败记录的 `initial_password` 为空。

**Step 2: Run test to verify it fails**

Run: `node --test server/tests/user-import.test.js`

Expected: FAIL with `buildUserImportWorkbook is not a function`

**Step 3: Write minimal implementation**

在 helper 里补：

```js
const xlsx = require('xlsx')

const buildUserImportWorkbook = (rows) => {
  const sheet = xlsx.utils.json_to_sheet(rows, { header: [
    'username',
    'role',
    'is_active',
    'app_access_text',
    'result',
    'reason',
    'initial_password',
  ] })
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, sheet, 'result')
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
```

如果发现列标题需要中文，就在写 sheet 前先把 key 转成中文对象；不要在 route 中拼装 workbook。

**Step 4: Run test to verify it passes**

Run: `node --test server/tests/user-import.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add server/user-import.js server/tests/user-import.test.js
git commit -m "feat: add user import workbook generation"
```

### Task 3: Wire `/api/import/users` into the reminder server

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/server/index.js`
- Modify: `/Users/zhanglei/Documents/codex-new/server/api/openapi/reminder-v1.yaml`

**Step 1: Write the failing test**

先在 `server/tests/user-import.test.js` 增一组“导入汇总器”测试，不直接测 Express 路由，而是测抽出的批处理函数：

```js
const result = await importUsersFromRows({
  rows: [
    { username: 'dup-user', role: 'viewer', is_active: '1', app_access: 'faq' },
    { username: 'new-user', role: 'editor', is_active: '启用', app_access: 'faq|tender' },
  ],
  findUserByUsername: async (username) => username === 'dup-user' ? { id: 9 } : null,
  insertUser: async (payload) => ({ id: 18, ...payload }),
  passwordPolicy: {
    minLength: 10,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
  },
})

assert.equal(result.created, 1)
assert.equal(result.skipped, 1)
assert.equal(result.resultRows[0].reason, '用户名已存在')
assert.ok(result.resultRows[1].initial_password)
```

**Step 2: Run test to verify it fails**

Run: `node --test server/tests/user-import.test.js`

Expected: FAIL because `importUsersFromRows` is missing.

**Step 3: Write minimal implementation**

先把批处理逻辑也放进 `server/user-import.js`，让 route 只做 I/O：

```js
async function importUsersFromRows({ rows, findUserByUsername, insertUser, passwordPolicy }) {
  const resultRows = []
  let created = 0
  let skipped = 0

  for (const raw of rows) {
    const row = normalizeUserImportRow(raw)
    const existing = await findUserByUsername(row.username)
    if (existing) {
      skipped += 1
      resultRows.push({ ...row, app_access_text: row.app_access.join('|'), result: 'SKIPPED', reason: '用户名已存在', initial_password: '' })
      continue
    }
    const initialPassword = generateImportPassword(passwordPolicy)
    await insertUser({ ...row, password: initialPassword })
    created += 1
    resultRows.push({ ...row, app_access_text: row.app_access.join('|'), result: 'SUCCESS', reason: '', initial_password: initialPassword })
  }

  return { created, skipped, total: rows.length, resultRows }
}
```

然后在 `server/index.js` 新增路由，复用现有：

- `requireRole(['sysadmin'])`
- `importRateLimiter`
- `upload.single('file')`
- `parseImportFile`
- `getSecurityConfig`
- `validateUsernameFormat`
- `validateEmailFormat`
- `validatePhoneFormat`
- `normalizeAppAccess`
- `logOperation`
- `insertImportJob`

路由返回：

```js
res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
res.setHeader('X-Import-Total', String(total))
res.setHeader('X-Import-Created', String(created))
res.setHeader('X-Import-Skipped', String(skipped))
res.send(workbookBuffer)
```

并把 `/api/import/users` 补进 OpenAPI。

**Step 4: Run tests and syntax checks**

Run: `node --test server/tests/user-import.test.js`

Expected: PASS

Run: `node --check /Users/zhanglei/Documents/codex-new/server/index.js`

Expected: no output

**Step 5: Commit**

```bash
git add server/index.js server/user-import.js server/tests/user-import.test.js server/api/openapi/reminder-v1.yaml
git commit -m "feat: add backend user excel import"
```

### Task 4: Add frontend upload UI and blob download flow

**Files:**
- Create: `/Users/zhanglei/Documents/codex-new/web/src/user-import.js`
- Create: `/Users/zhanglei/Documents/codex-new/web/src/user-import.test.js`
- Modify: `/Users/zhanglei/Documents/codex-new/web/src/App.jsx`
- Modify: `/Users/zhanglei/Documents/codex-new/web/src/App.css`

**Step 1: Write the failing test**

为前端 helper 先写一个响应头解析测试：

```js
const headers = new Headers({
  'X-Import-Total': '10',
  'X-Import-Created': '8',
  'X-Import-Skipped': '2',
  'X-Import-Error-Count': '2',
  'X-Import-Filename': 'user-import-result-2026-03-13.xlsx',
})

assert.deepEqual(readUserImportSummary(headers), {
  total: 10,
  created: 8,
  skipped: 2,
  errorCount: 2,
  filename: 'user-import-result-2026-03-13.xlsx',
})
```

**Step 2: Run test to verify it fails**

Run: `node --test web/src/user-import.test.js`

Expected: FAIL with missing module/export.

**Step 3: Write minimal implementation**

在 `web/src/user-import.js` 实现：

```js
export const readUserImportSummary = (headers) => ({
  total: Number(headers.get('X-Import-Total') || 0),
  created: Number(headers.get('X-Import-Created') || 0),
  skipped: Number(headers.get('X-Import-Skipped') || 0),
  errorCount: Number(headers.get('X-Import-Error-Count') || 0),
  filename: String(headers.get('X-Import-Filename') || 'user-import-result.xlsx'),
})
```

再在 `App.jsx`：

- 新增 `userImportResult`、`userImportUploading`
- 新增 `onImportUsers(file)`
- 使用 `fetch('/api/import/users', { method: 'POST', body: formData, headers: { 'X-CSRF-Token': csrfToken } })`
- 把响应转成 `blob`
- 读取汇总 headers 更新 UI
- 用临时 `<a>` 触发下载

UI 放在用户管理表单下方，样式可复用现有 `.import-row` / `.import-errors` 风格，但文案改为：

- `批量导入（Excel）`
- `支持列：username、role、is_active、app_access、email、phone、wecom_id`
- `可访问系统示例：faq|tender|train-exam`

**Step 4: Run tests and build**

Run: `node --test web/src/user-import.test.js`

Expected: PASS

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run lint`

Expected: PASS

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run build`

Expected: PASS

**Step 5: Commit**

```bash
git add web/src/App.jsx web/src/App.css web/src/user-import.js web/src/user-import.test.js
git commit -m "feat: add user excel import ui"
```

### Task 5: Update manual and run final verification

**Files:**
- Modify: `/Users/zhanglei/Documents/codex-new/docs/manuals/reminder-user-manual.md`

**Step 1: Write the doc change**

在“5.4 用户管理（系统管理员）”里补充：

- 支持 Excel 批量导入用户
- 重复用户名会跳过
- 系统自动生成初始密码
- 导入完成后浏览器自动下载结果 Excel
- 明细错误可在“导入记录”查看

**Step 2: Run the focused verification**

Run: `node --test /Users/zhanglei/Documents/codex-new/server/tests/user-import.test.js /Users/zhanglei/Documents/codex-new/web/src/user-import.test.js`

Expected: PASS

Run: `node --check /Users/zhanglei/Documents/codex-new/server/index.js`

Expected: no output

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run lint`

Expected: PASS

Run: `npm --prefix /Users/zhanglei/Documents/codex-new/web run build`

Expected: PASS

**Step 3: Manual smoke**

Run the app, log in as `sysadmin`, then verify:

1. 在“用户管理”看见 Excel 导入入口
2. 上传含重复账号的 Excel
3. 页面出现汇总数字
4. 浏览器自动下载结果 Excel
5. “导入记录”新增 `type=users` 记录，并可查看失败原因

**Step 4: Commit**

```bash
git add docs/manuals/reminder-user-manual.md
git commit -m "docs: document user excel import"
```
