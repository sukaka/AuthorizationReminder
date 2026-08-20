const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminCenterUsersService,
  normalizeAppAccess,
} = require('../admin-center-users');

const DEFAULT_POLICY = {
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

test('normalizeAppAccess strips dedicated centers for admin and adds AI assistant to privileged roles', () => {
  const adminAccess = normalizeAppAccess(['reminder', 'ticketing', 'sec-impl', 'admin-center', 'audit-center'], 'admin');
  const sysadminAccess = normalizeAppAccess(['reminder', 'admin-center'], 'sysadmin');
  const auditorAccess = normalizeAppAccess(['faq', 'audit-center'], 'auditor');

  assert.ok(adminAccess.includes('reminder'));
  assert.ok(adminAccess.includes('delivery'));
  assert.equal(adminAccess.includes('ticketing'), false);
  assert.equal(adminAccess.includes('sec-impl'), false);
  assert.equal(adminAccess.includes('admin-center'), false);
  assert.equal(adminAccess.includes('audit-center'), false);
  assert.deepEqual(sysadminAccess, ['admin-center', 'ai-assistant']);
  assert.deepEqual(auditorAccess, ['audit-center', 'delivery', 'ai-assistant']);
});

test('sysadmin can batch add AI assistant access without replacing existing access', async () => {
  let currentAccess = '["faq"]';
  const service = createAdminCenterUsersService({
    db: {
      async get(sql) {
        if (sql.startsWith('SELECT role, app_access')) return { role: 'user', app_access: currentAccess };
        if (sql.includes('FROM users WHERE id = ?')) {
          return { id: 8, username: 'alice', role: 'user', is_active: 1, app_access: currentAccess, created_at: '2026-07-12' };
        }
        throw new Error(`unexpected get: ${sql}`);
      },
      async run(sql, params = []) {
        if (sql.includes('SET app_access = ?')) currentAccess = params[0];
        return { changes: 1 };
      },
    },
  });

  const result = await service.updateUsers({
    actor: { id: 2, role: 'sysadmin' },
    targetIds: [8],
    payload: { app_access_add: ['ai-assistant'] },
  });

  assert.equal(result.updated, 1);
  assert.deepEqual(JSON.parse(currentAccess), ['faq', 'ai-assistant']);
});

test('non-sysadmin cannot batch edit users', async () => {
  const service = createAdminCenterUsersService({ db: {} });
  await assert.rejects(
    service.updateUsers({ actor: { role: 'admin' }, targetIds: [8], payload: { is_active: 1 } }),
    (error) => error.statusCode === 403
  );
});

test('listUsers merges lock state into formatted payload', async () => {
  const queries = [];
  const service = createAdminCenterUsersService({
    db: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM users ORDER BY id DESC')) {
          return [
            { id: 9, username: 'sysadmin', role: 'sysadmin', is_active: 1, email: '', phone: '', wecom_id: '', app_access: '["admin-center"]', department_code: 'TECH', totp_enabled: 0, created_at: '2026-03-14 10:00:00' },
            { id: 8, username: 'alice', role: 'user', is_active: 1, email: 'a@example.com', phone: '13900000000', wecom_id: '', app_access: '["reminder"]', department_code: 'SEC_OPERATION', totp_enabled: 0, created_at: '2026-03-14 09:00:00' },
          ];
        }
        if (sql.includes('FROM auth_login_attempts')) {
          return [
            { username: 'sysadmin', locked_until: '2999-01-01 00:00:00', locked_ip_count: 1 },
          ];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
  });

  const rows = await service.listUsers();

  assert.equal(rows.length, 2);
  assert.equal(rows[0].login_id, 'sysadmin');
  assert.equal(rows[0].lock_status, 'locked');
  assert.equal(rows[0].department_code, 'TECH');
  assert.equal(rows[1].login_id, '13900000000');
  assert.equal(rows[1].lock_status, 'normal');
  assert.equal(rows[1].department_code, 'SEC_OPERATION');
  assert.equal(rows[0].app_access[0], 'admin-center');
  assert.equal(queries.length, 2);
});

test('listUsers filters users by username or phone with a parameterized keyword', async () => {
  const queries = [];
  const service = createAdminCenterUsersService({
    db: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM users')) {
          return [
            { id: 8, username: 'alice', role: 'user', is_active: 1, email: '', phone: '13900000000', wecom_id: '', app_access: '[]', department_code: '', totp_enabled: 0, created_at: '2026-03-14 09:00:00' },
          ];
        }
        if (sql.includes('FROM auth_login_attempts')) return [];
        throw new Error(`unexpected query: ${sql}`);
      },
    },
  });

  const rows = await service.listUsers({ keyword: '  ali  ' });

  assert.equal(rows.length, 1);
  assert.match(queries[0].sql, /WHERE \(username LIKE \? OR phone LIKE \?\)/);
  assert.deepEqual(queries[0].params, ['%ali%', '%ali%']);
});

test('createUser applies normalized role and dedicated center defaults', async () => {
  const operations = [];
  const runs = [];
  const service = createAdminCenterUsersService({
    db: {
      async run(sql, params = []) {
        runs.push({ sql, params });
        if (sql.startsWith('INSERT INTO users')) return { insertId: 42 };
        throw new Error(`unexpected run: ${sql}`);
      },
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE wecom_id = ?') || sql.includes('FROM users WHERE feishu_open_id = ?')) {
          return null;
        }
        if (sql.includes('FROM users WHERE id = ?')) {
          assert.deepEqual(params, [42]);
          return {
            id: 42,
            username: 'boss',
            role: 'sysadmin',
            is_active: 1,
            must_change_password: 0,
            email: 'boss@example.com',
            phone: '13911112222',
            wecom_id: 'wx-boss',
            feishu_open_id: 'ou-boss',
            app_access: '["admin-center"]',
            department_code: 'TECH',
            totp_enabled: 0,
            created_at: '2026-03-14 15:00:00',
          };
        }
        throw new Error(`unexpected get: ${sql}`);
      },
    },
    hashPassword: async (password) => `hashed:${password}`,
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
    logOperation: async (payload) => { operations.push(payload); },
  });

  const row = await service.createUser({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    payload: {
      username: 'boss',
      password: 'Strong#1234',
      role: 'sysadmin',
      email: 'boss@example.com',
      phone: '13911112222',
      wecom_id: 'wx-boss',
      feishu_open_id: 'ou-boss',
      department_code: 'TECH',
    },
  });

  assert.equal(row.id, 42);
  assert.deepEqual(row.app_access, ['admin-center', 'ai-assistant']);
  assert.equal(row.department_code, 'TECH');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[1], 'hashed:Strong#1234');
  assert.equal(runs[0].params[6], 'wx-boss');
  assert.equal(runs[0].params[7], 'ou-boss');
  assert.deepEqual(JSON.parse(runs[0].params[8]), ['admin-center', 'ai-assistant']);
  assert.equal(runs[0].params[9], 'TECH');
  assert.equal(runs[0].params[10], 0);
  assert.equal(operations[0].action, 'CREATE');
  assert.equal(operations[0].entity, 'user');
});

test('createUser can mark imported users as requiring password change on first login', async () => {
  const runs = [];
  const service = createAdminCenterUsersService({
    db: {
      async run(sql, params = []) {
        runs.push({ sql, params });
        if (sql.startsWith('INSERT INTO users')) return { insertId: 52 };
        throw new Error(`unexpected run: ${sql}`);
      },
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE id = ?')) {
          assert.deepEqual(params, [52]);
          return {
            id: 52,
            username: 'imported-user',
            role: 'user',
            is_active: 1,
            must_change_password: 1,
            email: 'imported@example.com',
            phone: '13911112222',
            wecom_id: '',
            app_access: '["train-exam"]',
            department_code: 'TECH',
            totp_enabled: 0,
            created_at: '2026-04-15 15:00:00',
          };
        }
        throw new Error(`unexpected get: ${sql}`);
      },
    },
    hashPassword: async (password) => `hashed:${password}`,
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  const row = await service.createUser({
    actor: { id: 1, username: 'admin', role: 'admin' },
    payload: {
      username: 'imported-user',
      password: 'Strong#1234',
      role: 'user',
      phone: '13911112222',
      app_access: ['train-exam'],
      must_change_password: 1,
    },
  });

  assert.equal(row.must_change_password, 1);
  assert.equal(runs[0].params[10], 1);
});

test('updateUser can toggle active state for regular users', async () => {
  const runs = [];
  const operations = [];
  let currentActive = 1;
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE id = ?')) {
          return {
            id: Number(params[0]),
            username: 'normal-user',
            role: 'user',
            is_active: currentActive,
            email: '',
            phone: '13800000000',
            wecom_id: '',
            app_access: '["reminder"]',
            totp_enabled: 0,
            created_at: '2026-03-14 16:00:00',
          };
        }
        throw new Error(`unexpected get: ${sql}`);
      },
      async run(sql, params = []) {
        runs.push({ sql, params });
        if (sql.includes('SET is_active = ?')) currentActive = Number(params[0]);
        return {};
      },
    },
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
    logOperation: async (payload) => { operations.push(payload); },
  });

  const row = await service.updateUser({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetId: 88,
    payload: { is_active: 0 },
  });

  assert.equal(row.is_active, 0);
  assert.equal(runs[0].params[0], 0);
  assert.equal(operations[0].action, 'DISABLE_USER');
});

test('updateUser can update profile fields and app access', async () => {
  const runs = [];
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE wecom_id = ?') || sql.includes('FROM users WHERE feishu_open_id = ?')) {
          return null;
        }
        return {
          id: Number(params[0]),
          username: 'editor-user',
          role: 'editor',
          is_active: 1,
          email: 'old@example.com',
          phone: '13800000000',
          wecom_id: 'old-wecom',
          feishu_open_id: 'old-feishu',
          app_access: '["faq","tender"]',
          department_code: 'TECH',
          totp_enabled: 0,
          created_at: '2026-03-14 16:00:00',
        };
      },
      async run(sql, params = []) {
        runs.push({ sql, params });
        return {};
      },
    },
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  await service.updateUser({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetId: 88,
    payload: {
      role: 'reviewer',
      email: 'next@example.com',
      phone: '13911112222',
      wecom_id: 'next-wecom',
      feishu_open_id: 'next-feishu',
      app_access: ['faq', 'train-exam'],
      department_code: 'SEC_SERVICE',
    },
  });

  assert.ok(runs.some((item) => item.sql.includes('SET role = ?') && item.params[0] === 'reviewer'));
  assert.ok(runs.some((item) => item.sql.includes('SET email = ?') && item.params[0] === 'next@example.com'));
  assert.ok(runs.some((item) => item.sql.includes('SET phone = ?') && item.params[0] === '13911112222'));
  assert.ok(runs.some((item) => item.sql.includes('SET wecom_id = ?') && item.params[0] === 'next-wecom'));
  assert.ok(runs.some((item) => item.sql.includes('SET feishu_open_id = ?') && item.params[0] === 'next-feishu'));
  assert.ok(runs.some((item) => item.sql.includes('SET app_access = ?') && JSON.parse(item.params[0])[1] === 'train-exam'));
  assert.ok(runs.some((item) => item.sql.includes('SET department_code = ?') && item.params[0] === 'SEC_SERVICE'));
});

test('createUser rejects an external identity that is already bound to another user', async () => {
  const service = createAdminCenterUsersService({
    db: {
      async get(sql) {
        if (sql.includes('FROM users WHERE feishu_open_id = ?')) return { id: 7 };
        return null;
      },
      async run() {
        throw new Error('insert must not run for a duplicate external identity');
      },
    },
    hashPassword: async (password) => `hashed:${password}`,
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  await assert.rejects(
    service.createUser({
      actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
      payload: {
        username: 'duplicate-feishu',
        password: 'Strong#1234',
        role: 'user',
        app_access: ['reminder'],
        feishu_open_id: 'ou-already-bound',
      },
    }),
    (error) => error?.statusCode === 400 && error?.message === '飞书 Open ID 已绑定其他账号'
  );
});

test('updateUser allows builtin account role changes while keeping access normalized', async () => {
  const runs = [];
  let currentRole = 'admin';
  let currentAppAccess = '["reminder","delivery"]';
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        return {
          id: Number(params[0]),
          username: 'admin',
          role: currentRole,
          is_active: 1,
          must_change_password: 0,
          email: 'admin@example.com',
          phone: '',
          wecom_id: '',
          app_access: currentAppAccess,
          department_code: 'TECH',
          totp_enabled: 0,
          created_at: '2026-04-15 16:00:00',
        };
      },
      async run(sql, params = []) {
        if (sql.includes('SET role = ?')) currentRole = String(params[0]);
        if (sql.includes('SET app_access = ?')) currentAppAccess = String(params[0]);
        runs.push({ sql, params });
        return {};
      },
    },
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  const row = await service.updateUser({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetId: 1,
    payload: { role: 'auditor' },
  });

  assert.equal(row.role, 'auditor');
  assert.deepEqual(row.app_access, ['audit-center', 'delivery', 'ai-assistant']);
  assert.ok(runs.some((item) => item.sql.includes('SET role = ?') && item.params[0] === 'auditor'));
  assert.ok(runs.some((item) => item.sql.includes('SET app_access = ?') && JSON.parse(item.params[0])[0] === 'audit-center'));
});

test('updateUser allows builtin account access updates when bundled with role changes', async () => {
  const runs = [];
  let currentRole = 'admin';
  let currentAppAccess = '["reminder","delivery","train-exam"]';
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        return {
          id: Number(params[0]),
          username: 'admin',
          role: currentRole,
          is_active: 1,
          must_change_password: 0,
          email: 'admin@example.com',
          phone: '',
          wecom_id: '',
          app_access: currentAppAccess,
          department_code: 'TECH',
          totp_enabled: 0,
          created_at: '2026-04-15 16:30:00',
        };
      },
      async run(sql, params = []) {
        if (sql.includes('SET role = ?')) currentRole = String(params[0]);
        if (sql.includes('SET app_access = ?')) currentAppAccess = String(params[0]);
        runs.push({ sql, params });
        return {};
      },
    },
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  const row = await service.updateUser({
    actor: { id: 2, username: 'sysadmin', role: 'sysadmin' },
    targetId: 1,
    payload: {
      role: 'user',
      app_access: ['reminder', 'train-exam'],
    },
  });

  assert.equal(row.role, 'user');
  assert.deepEqual(row.app_access, ['reminder', 'train-exam']);
  assert.ok(runs.some((item) => item.sql.includes('SET role = ?') && item.params[0] === 'user'));
  assert.ok(runs.some((item) => item.sql.includes('SET app_access = ?') && JSON.parse(item.params[0])[1] === 'train-exam'));
});

test('unlockUser clears login attempts for target login id', async () => {
  const runs = [];
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        return { id: Number(params[0]), username: 'sysadmin', phone: '' };
      },
      async query(sql) {
        if (sql.includes('FROM auth_login_attempts')) {
          return [{ username: 'sysadmin', ip: '127.0.0.1', fail_count: 5 }];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      async run(sql, params = []) {
        runs.push({ sql, params });
        return {};
      },
    },
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
  });

  const result = await service.unlockUser({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetId: 2,
  });

  assert.deepEqual(result, { ok: true, unlocked_count: 1 });
  assert.equal(runs[0].params[0], 'sysadmin');
});

test('resetPassword allows sysadmin to reset a non-sysadmin user to the fixed password and force password change', async () => {
  const calls = [];
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE id = ?')) {
          return {
            id: Number(params[0]),
            username: 'editor-a',
            role: 'editor',
            must_change_password: 0,
          };
        }
        return null;
      },
      async run(sql, params = []) {
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

  assert.deepEqual(result, {
    ok: true,
    username: 'editor-a',
    reset_password: '!b$#+^o9uF',
  });
  assert.deepEqual(calls, [
    {
      sql: 'UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?',
      params: ['hashed:!b$#+^o9uF', 1, 18],
    },
    {
      type: 'revoke',
      payload: { userId: 18, reason: 'password_reset' },
    },
    {
      type: 'audit',
      payload: {
        user: { id: 9, username: 'sysadmin', role: 'sysadmin' },
        action: 'RESET_PASSWORD',
        entity: 'user',
        entityId: 18,
        afterData: { username: 'editor-a', forced_change: true },
      },
    },
  ]);
});

test('resetPassword rejects non-sysadmin actors', async () => {
  const service = createAdminCenterUsersService({
    db: {
      async get() {
        return { id: 18, username: 'editor-a', role: 'editor' };
      },
      async run() {
        return { affectedRows: 1 };
      },
    },
  });

  await assert.rejects(
    service.resetPassword({
      actor: { id: 3, username: 'admin', role: 'admin' },
      targetId: 18,
    }),
    (error) => error?.statusCode === 403 && error?.message === '仅系统管理员可重置密码'
  );
});

test('resetPassword rejects resetting self or any sysadmin target', async () => {
  const service = createAdminCenterUsersService({
    db: {
      async get(_sql, params = []) {
        const id = Number(params[0]);
        if (id === 9) return { id: 9, username: 'sysadmin', role: 'sysadmin' };
        if (id === 12) return { id: 12, username: 'sysadmin-backup', role: 'sysadmin' };
        return null;
      },
      async run() {
        return { affectedRows: 1 };
      },
    },
  });

  await assert.rejects(
    service.resetPassword({
      actor: { id: 9, username: 'sysadmin', role: 'sysadmin' },
      targetId: 9,
    }),
    (error) => error?.statusCode === 400 && error?.message === '不能重置自己的密码'
  );

  await assert.rejects(
    service.resetPassword({
      actor: { id: 9, username: 'sysadmin', role: 'sysadmin' },
      targetId: 12,
    }),
    (error) => error?.statusCode === 403 && error?.message === '不能重置系统管理员密码'
  );
});

test('deleteUsers deletes regular users and skips protected ones', async () => {
  const runs = [];
  const operations = [];
  const deletedIds = [];
  const rowsById = new Map([
    [2, {
      id: 2,
      username: 'alice',
      role: 'user',
      is_active: 1,
      must_change_password: 0,
      email: 'alice@example.com',
      phone: '13800000001',
      wecom_id: '',
      app_access: '["reminder"]',
      department_code: 'TECH',
      totp_enabled: 0,
      created_at: '2026-04-15 09:00:00',
    }],
    [3, {
      id: 3,
      username: 'admin',
      role: 'admin',
      is_active: 1,
      must_change_password: 0,
      email: 'admin@example.com',
      phone: '',
      wecom_id: '',
      app_access: '["reminder","delivery","train-exam"]',
      department_code: 'TECH',
      totp_enabled: 0,
      created_at: '2026-04-15 09:10:00',
    }],
    [4, {
      id: 4,
      username: 'bob',
      role: 'user',
      is_active: 1,
      must_change_password: 0,
      email: 'bob@example.com',
      phone: '13800000002',
      wecom_id: '',
      app_access: '["train-exam"]',
      department_code: 'TECH',
      totp_enabled: 0,
      created_at: '2026-04-15 09:20:00',
    }],
  ]);
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        return rowsById.get(Number(params[0])) || null;
      },
      async run(sql, params = []) {
        runs.push({ sql, params });
        if (sql.startsWith('DELETE FROM users WHERE id = ?')) {
          deletedIds.push(Number(params[0]));
          return {};
        }
        throw new Error(`unexpected run: ${sql}`);
      },
    },
    builtinAccountUsernames: new Set(['admin', 'sysadmin', 'auditor', 'editor', 'reviewer']),
    logOperation: async (payload) => { operations.push(payload); },
  });

  const result = await service.deleteUsers({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetIds: [2, 3, 4],
  });

  assert.equal(result.ok, true);
  assert.equal(result.total, 3);
  assert.equal(result.deleted, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(deletedIds, [2, 4]);
  assert.equal(runs.length, 2);
  assert.equal(operations.length, 2);
  assert.deepEqual(
    result.results.map((item) => ({ id: item.id, status: item.status, error: item.error || '' })),
    [
      { id: 2, status: 'DELETED', error: '' },
      { id: 3, status: 'FAILED', error: '内置账号不可删除' },
      { id: 4, status: 'DELETED', error: '' },
    ]
  );
});
