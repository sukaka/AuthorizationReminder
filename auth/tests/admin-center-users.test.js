const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminCenterUsersService,
} = require('../admin-center-users');

const DEFAULT_POLICY = {
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

test('listUsers merges lock state into formatted payload', async () => {
  const queries = [];
  const service = createAdminCenterUsersService({
    db: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (sql.includes('FROM users ORDER BY id DESC')) {
          return [
            { id: 9, username: 'sysadmin', role: 'sysadmin', is_active: 1, email: '', phone: '', wecom_id: '', app_access: '["admin-center"]', totp_enabled: 0, created_at: '2026-03-14 10:00:00' },
            { id: 8, username: 'alice', role: 'user', is_active: 1, email: 'a@example.com', phone: '13900000000', wecom_id: '', app_access: '["reminder"]', totp_enabled: 0, created_at: '2026-03-14 09:00:00' },
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
  assert.equal(rows[1].login_id, '13900000000');
  assert.equal(rows[1].lock_status, 'normal');
  assert.equal(rows[0].app_access[0], 'admin-center');
  assert.equal(queries.length, 2);
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
        if (sql.includes('FROM users WHERE id = ?')) {
          assert.deepEqual(params, [42]);
          return {
            id: 42,
            username: 'boss',
            role: 'sysadmin',
            is_active: 1,
            email: 'boss@example.com',
            phone: '13911112222',
            wecom_id: 'wx-boss',
            app_access: '["admin-center"]',
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
    },
  });

  assert.equal(row.id, 42);
  assert.deepEqual(row.app_access, ['admin-center']);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[1], 'hashed:Strong#1234');
  assert.deepEqual(JSON.parse(runs[0].params[7]), ['admin-center']);
  assert.equal(operations[0].action, 'CREATE');
  assert.equal(operations[0].entity, 'user');
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
        return {
          id: Number(params[0]),
          username: 'editor-user',
          role: 'editor',
          is_active: 1,
          email: 'old@example.com',
          phone: '13800000000',
          wecom_id: 'old-wecom',
          app_access: '["faq","tender"]',
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
      app_access: ['faq', 'train-exam'],
    },
  });

  assert.ok(runs.some((item) => item.sql.includes('SET role = ?') && item.params[0] === 'reviewer'));
  assert.ok(runs.some((item) => item.sql.includes('SET email = ?') && item.params[0] === 'next@example.com'));
  assert.ok(runs.some((item) => item.sql.includes('SET phone = ?') && item.params[0] === '13911112222'));
  assert.ok(runs.some((item) => item.sql.includes('SET wecom_id = ?') && item.params[0] === 'next-wecom'));
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

test('resetPassword hashes the new password before saving', async () => {
  const runs = [];
  const service = createAdminCenterUsersService({
    db: {
      async get(sql, params = []) {
        return { id: Number(params[0]), username: 'target-user' };
      },
      async run(sql, params = []) {
        runs.push({ sql, params });
        return {};
      },
    },
    hashPassword: async (password) => `hashed:${password}`,
    getSecurityConfig: async () => ({ passwordPolicy: DEFAULT_POLICY }),
  });

  const result = await service.resetPassword({
    actor: { id: 1, username: 'sysadmin', role: 'sysadmin' },
    targetId: 5,
    newPassword: 'Strong#5678',
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(runs[0].params[0], 'hashed:Strong#5678');
});
