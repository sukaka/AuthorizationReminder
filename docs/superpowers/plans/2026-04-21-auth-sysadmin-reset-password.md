# Auth Sysadmin Reset Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow only `sysadmin` to reset any non-`sysadmin` user password to the fixed value `!b$#+^o9uF`, force password change on next login, and immediately revoke the target user's active sessions.

**Architecture:** Keep the existing reset-password endpoint and force-change-password flow, but move reset authorization and post-reset side effects into the auth admin-center user service. The backend becomes the single source of truth for reset policy, while the frontend only shows a clearer confirmation/success message and removes custom password input.

**Tech Stack:** Node.js, Express, MySQL adapter helpers, existing auth session revocation helpers, React, Vitest, node:test

---

### Task 1: Lock Reset Rules with Backend Tests

**Files:**
- Modify: `auth/tests/admin-center-users.test.js`
- Reference: `auth/admin-center-users.js`

- [ ] **Step 1: Write the failing service tests**

Add these test cases to [admin-center-users.test.js](/Users/zhanglei/Documents/codex-new/auth/tests/admin-center-users.test.js):

```js
test('resetPassword allows sysadmin to reset a non-sysadmin user to the fixed password and force password change', async () => {
  const calls = [];
  const service = createAdminCenterUsersService({
    db: {
      get: async (sql, params) => {
        if (sql.includes('FROM users WHERE id = ?')) {
          return { id: Number(params[0]), username: 'editor-a', role: 'editor', must_change_password: 0 };
        }
        return null;
      },
      run: async (sql, params) => {
        calls.push({ sql, params });
        return { affectedRows: 1 };
      },
    },
    hashPassword: async (password) => `hashed:${password}`,
    revokeSessions: async (payload) => {
      calls.push({ type: 'revoke', payload });
    },
    logOperation: async (payload) => {
      calls.push({ type: 'audit', payload });
    },
  });

  const result = await service.resetPassword({
    actor: { id: 9, username: 'sysadmin', role: 'sysadmin' },
    targetId: 18,
  });

  expect(result).toEqual({
    ok: true,
    username: 'editor-a',
    reset_password: '!b$#+^o9uF',
  });
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sql: expect.stringContaining('UPDATE users SET password_hash = ?, must_change_password = ?'),
      params: ['hashed:!b$#+^o9uF', 1, 18],
    }),
    expect.objectContaining({
      type: 'revoke',
      payload: { userId: 18, reason: 'password_reset' },
    }),
  ]));
});

test('resetPassword rejects non-sysadmin actors', async () => {
  const service = createAdminCenterUsersService({
    db: {
      get: async () => ({ id: 18, username: 'editor-a', role: 'editor' }),
      run: async () => ({ affectedRows: 1 }),
    },
  });

  await expect(service.resetPassword({
    actor: { id: 3, username: 'admin', role: 'admin' },
    targetId: 18,
  })).rejects.toMatchObject({ statusCode: 403 });
});

test('resetPassword rejects resetting self or any sysadmin target', async () => {
  const service = createAdminCenterUsersService({
    db: {
      get: async (_sql, params) => {
        const id = Number(params[0]);
        if (id === 9) return { id: 9, username: 'sysadmin', role: 'sysadmin' };
        if (id === 12) return { id: 12, username: 'admin-a', role: 'admin' };
        return null;
      },
      run: async () => ({ affectedRows: 1 }),
    },
  });

  await expect(service.resetPassword({
    actor: { id: 9, username: 'sysadmin', role: 'sysadmin' },
    targetId: 9,
  })).rejects.toMatchObject({ statusCode: 400 });

  await expect(service.resetPassword({
    actor: { id: 9, username: 'sysadmin', role: 'sysadmin' },
    targetId: 13,
  })).rejects.toMatchObject({ statusCode: 404 });
});
```

- [ ] **Step 2: Run the backend auth tests to verify they fail**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/admin-center-users.test.js`

Expected: FAIL because `resetPassword` currently requires `newPassword`, does not enforce `sysadmin`, does not reject self/`sysadmin`, and does not revoke sessions.

- [ ] **Step 3: Implement the minimal reset-password policy in the service**

Update the service factory in [admin-center-users.js](/Users/zhanglei/Documents/codex-new/auth/admin-center-users.js):

```js
const FIXED_RESET_PASSWORD = '!b$#+^o9uF';

const canResetPassword = ({ actorRole, actorId, targetUser }) => {
  if (normalizeUserRole(actorRole) !== 'sysadmin') {
    throw createHttpError(403, '仅系统管理员可重置密码');
  }
  if (!targetUser) {
    throw createHttpError(404, '用户不存在');
  }
  if (Number(targetUser.id || 0) === Number(actorId || 0)) {
    throw createHttpError(400, '不能重置自己的密码');
  }
  if (normalizeUserRole(targetUser.role) === 'sysadmin') {
    throw createHttpError(403, '不能重置系统管理员密码');
  }
};

async resetPassword({ actor, targetId }) {
  assertDbMethods(db, ['get', 'run']);
  const targetUser = await db.get('SELECT id, username, role FROM users WHERE id = ?', [targetId]);
  canResetPassword({
    actorRole: actor?.role,
    actorId: actor?.id,
    targetUser,
  });
  const hash = await hashPassword(FIXED_RESET_PASSWORD);
  await db.run(
    'UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?',
    [hash, 1, Number(targetId)]
  );
  await revokeSessions({ userId: Number(targetId), reason: 'password_reset' });
  await logOperation({
    user: actor,
    action: 'RESET_PASSWORD',
    entity: 'user',
    entityId: Number(targetId),
    afterData: { username: targetUser.username, forced_change: true },
  });
  return {
    ok: true,
    username: targetUser.username,
    reset_password: FIXED_RESET_PASSWORD,
  };
}
```

Also update the service factory signature to accept the new dependency:

```js
const createAdminCenterUsersService = ({
  db,
  hashPassword = async (value) => value,
  getSecurityConfig = async () => ({}),
  logOperation = async () => {},
  revokeSessions = async () => {},
  builtinAccountUsernames = new Set(),
} = {}) => {
```

Export the constant if you need to reference it in integration wiring:

```js
module.exports = {
  ALLOWED_USER_ROLES,
  FIXED_RESET_PASSWORD,
  createAdminCenterUsersService,
  // ...
};
```

- [ ] **Step 4: Run the backend auth tests to verify they pass**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/admin-center-users.test.js`

Expected: PASS for the new reset-password policy cases and existing user service tests.

- [ ] **Step 5: Commit the backend service rule change**

```bash
cd /Users/zhanglei/Documents/codex-new
git add auth/admin-center-users.js auth/tests/admin-center-users.test.js
git commit -m "feat(auth): restrict sysadmin password reset policy"
```

### Task 2: Wire Session Revocation into Auth Endpoint

**Files:**
- Modify: `auth/index.js`
- Reference: `auth/admin-center-users.js`

- [ ] **Step 1: Add a narrow integration test or assertion target**

If `auth/index.js` already has route-level tests for admin-center actions, add or extend one to verify the service is created with `revokeUserSessions`. If no direct route test exists, add a small source-level guard to keep wiring from regressing:

```js
test('auth index wires revokeUserSessions into adminCenterUsersService', () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.match(source, /revokeSessions:\s*revokeUserSessions/);
});
```

Place it in a small new file such as `auth/tests/admin-center-reset-password-wiring.test.js`.

- [ ] **Step 2: Run the wiring test to verify it fails**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/admin-center-reset-password-wiring.test.js`

Expected: FAIL because the current service wiring does not pass `revokeUserSessions`.

- [ ] **Step 3: Pass the revoke-session dependency and stop accepting frontend-provided passwords**

Update the admin-center users service construction in [auth/index.js](/Users/zhanglei/Documents/codex-new/auth/index.js):

```js
const adminCenterUsersService = createAdminCenterUsersService({
  db,
  hashPassword,
  getSecurityConfig,
  logOperation,
  revokeSessions: revokeUserSessions,
  builtinAccountUsernames: BUILTIN_ACCOUNT_USERNAMES,
});
```

Then tighten the route so it no longer forwards a client-supplied password:

```js
app.post('/api/admin-center/users/:id/reset-password', async (req, res) => {
  if (!canUseDedicatedCenter(req.user, ADMIN_CENTER_KEY)) {
    return res.status(403).json({ error: '无权限访问管理后台' });
  }
  try {
    const result = await adminCenterUsersService.resetPassword({
      actor: req.user,
      targetId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return sendApiError(res, err, '重置密码失败');
  }
});
```

- [ ] **Step 4: Run the wiring test and a fast auth syntax check**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test auth/tests/admin-center-reset-password-wiring.test.js`
Expected: PASS

Run: `cd /Users/zhanglei/Documents/codex-new && node --check auth/index.js`
Expected: no output

- [ ] **Step 5: Commit the auth wiring change**

```bash
cd /Users/zhanglei/Documents/codex-new
git add auth/index.js auth/tests/admin-center-reset-password-wiring.test.js
git commit -m "feat(auth): revoke sessions on sysadmin password reset"
```

### Task 3: Update Frontend Reset Password UX

**Files:**
- Modify: `web/src/App.jsx`
- Test: `web/src/user-reset-password-source.test.js`

- [ ] **Step 1: Write a small frontend source test for the new reset UX**

Create [user-reset-password-source.test.js](/Users/zhanglei/Documents/codex-new/web/src/user-reset-password-source.test.js) with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, 'App.jsx'), 'utf8');

test('reset password dialog uses fixed sysadmin password copy and no manual input', () => {
  assert.match(appSource, /!b\\$#\\+\\^o9uF/);
  assert.match(appSource, /下次登录必须修改密码/);
  assert.match(appSource, /当前登录会话已失效/);
  assert.doesNotMatch(appSource, /请输入新密码/);
  assert.doesNotMatch(appSource, /newPassword/);
});
```

- [ ] **Step 2: Run the frontend source test to verify it fails**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test web/src/user-reset-password-source.test.js`

Expected: FAIL because the current UI still asks the operator to type a new password and posts `newPassword`.

- [ ] **Step 3: Replace manual password input with a fixed confirmation dialog**

Update the reset handler in [App.jsx](/Users/zhanglei/Documents/codex-new/web/src/App.jsx):

```jsx
const RESET_PASSWORD_TEXT = '!b$#+^o9uF'

const onResetUserPassword = async (id, username, role) => {
  if (String(user?.role || '').toLowerCase() !== 'sysadmin') {
    showError('仅系统管理员可重置密码')
    return
  }
  if (String(role || '').toLowerCase() === 'sysadmin') {
    showError('不能重置系统管理员密码')
    return
  }
  if (Number(id || 0) === Number(user?.id || 0)) {
    showError('不能重置自己的密码')
    return
  }
  openConfirmDialog({
    title: '重置用户密码',
    message: `将把 ${username} 的密码重置为 ${RESET_PASSWORD_TEXT}。该用户下次登录必须修改密码，当前登录会话会立即失效。`,
    confirmLabel: '确认重置',
    onConfirm: async () => {
      await api.post(`/api/users/${id}/reset-password`, {})
      showMessage('密码已重置')
      setModalInfo({
        title: '重置密码成功',
        message: `用户 ${username} 的密码已重置为 ${RESET_PASSWORD_TEXT}。该用户下次登录必须修改密码，当前登录会话已失效。`,
      })
    },
  })
}
```

If the user table row renderer does not already pass `username` and `role`, update the click handler call site to pass them:

```jsx
<button onClick={() => onResetUserPassword(item.id, item.username, item.role)}>重置密码</button>
```

- [ ] **Step 4: Run the frontend source test and targeted build check**

Run: `cd /Users/zhanglei/Documents/codex-new && node --test web/src/user-reset-password-source.test.js`
Expected: PASS

Run: `cd /Users/zhanglei/Documents/codex-new && npm --prefix web run build`
Expected: build succeeds

- [ ] **Step 5: Commit the frontend reset UX change**

```bash
cd /Users/zhanglei/Documents/codex-new
git add web/src/App.jsx web/src/user-reset-password-source.test.js
git commit -m "feat(web): simplify sysadmin password reset flow"
```

### Task 4: Verify Force-Change-Password End-to-End Semantics

**Files:**
- Modify: `auth/tests/admin-center-users.test.js`
- Modify: `auth/tests/admin-center-user-reset-password-wiring.test.js`
- Reference: `auth/index.js:6565-6587`

- [ ] **Step 1: Add a regression test for login-path compatibility**

Extend the auth tests with a source-level assertion or route-level test that the existing change-password path still clears `must_change_password` and revokes sessions:

```js
test('change-password flow still clears must_change_password after forced reset', () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.match(source, /UPDATE users SET password_hash = \?, must_change_password = \? WHERE id = \?/);
  assert.match(source, /revokeUserSessions\\(\\{ userId: req\\.user\\.id, reason: 'password_change' \\}\\)/);
});
```

- [ ] **Step 2: Run the final focused auth test bundle**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new
node --test auth/tests/admin-center-users.test.js auth/tests/admin-center-reset-password-wiring.test.js
```

Expected: PASS

- [ ] **Step 3: Run a final lightweight verification sweep**

Run:

```bash
cd /Users/zhanglei/Documents/codex-new
node --check auth/index.js
node --test web/src/user-reset-password-source.test.js
npm --prefix web run build
```

Expected: all commands pass

- [ ] **Step 4: Commit the verification-safe final state**

```bash
cd /Users/zhanglei/Documents/codex-new
git add auth/tests/admin-center-users.test.js auth/tests/admin-center-reset-password-wiring.test.js web/src/user-reset-password-source.test.js
git commit -m "test: cover sysadmin password reset flow"
```

## Self-Review

### Spec coverage

- `sysadmin` only: Task 1
- cannot reset self: Task 1 and Task 3
- cannot reset any `sysadmin`: Task 1 and Task 3
- fixed password `!b$#+^o9uF`: Task 1 and Task 3
- set `must_change_password = 1`: Task 1
- revoke active sessions immediately: Task 1 and Task 2
- reuse existing forced-change-password flow: Task 4

No spec gap remains.

### Placeholder scan

No `TBD`, `TODO`, “add tests later”, or unresolved references remain. Every task lists exact files, concrete code, and runnable commands.

### Type consistency

- backend service dependency name: `revokeSessions`
- auth wiring value: `revokeUserSessions`
- frontend fixed password constant: `RESET_PASSWORD_TEXT`
- reset response shape: `{ ok, username, reset_password }`

Names are consistent across tasks.
