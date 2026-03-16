const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdminCenterDepartmentsService } = require('../admin-center-departments');

test('listDepartments returns departments with document admin users', async () => {
  const service = createAdminCenterDepartmentsService({
    db: {
      async query(sql) {
        if (sql.includes('FROM departments d')) {
          return [
            {
              code: 'TECH',
              name: '技术部',
              sort_order: 30,
              is_active: 1,
              admin_user_id: 8,
              admin_username: 'alice',
            },
            {
              code: 'TECH',
              name: '技术部',
              sort_order: 30,
              is_active: 1,
              admin_user_id: 9,
              admin_username: 'bob',
            },
            {
              code: 'SEC_OPERATION',
              name: '安全运营部',
              sort_order: 20,
              is_active: 1,
              admin_user_id: null,
              admin_username: null,
            },
          ];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    },
  });

  const rows = await service.listDepartments();

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    code: 'SEC_OPERATION',
    name: '安全运营部',
    sort_order: 20,
    is_active: 1,
    admins: [],
  });
  assert.deepEqual(rows[1], {
    code: 'TECH',
    name: '技术部',
    sort_order: 30,
    is_active: 1,
    admins: [
      { user_id: 8, username: 'alice' },
      { user_id: 9, username: 'bob' },
    ],
  });
});

test('saveDepartment upserts department and replaces admin assignments', async () => {
  const runs = [];
  const service = createAdminCenterDepartmentsService({
    db: {
      async get(sql, params = []) {
        if (sql.includes('FROM users WHERE id = ?')) {
          const userId = Number(params[0]);
          if (userId === 8) return { id: 8, username: 'alice', role: 'editor', department_code: 'TECH' };
          if (userId === 9) return { id: 9, username: 'bob', role: 'reviewer', department_code: 'TECH' };
        }
        throw new Error(`unexpected get: ${sql}`);
      },
      async transaction(fn) {
        const tx = {
          async run(sql, params = []) {
            runs.push({ sql, params });
            return {};
          },
          async query(sql) {
            if (sql.includes('FROM departments d')) {
              return [
                {
                  code: 'TECH',
                  name: '技术部',
                  sort_order: 35,
                  is_active: 1,
                  admin_user_id: 8,
                  admin_username: 'alice',
                },
                {
                  code: 'TECH',
                  name: '技术部',
                  sort_order: 35,
                  is_active: 1,
                  admin_user_id: 9,
                  admin_username: 'bob',
                },
              ];
            }
            throw new Error(`unexpected query: ${sql}`);
          },
        };
        return fn(tx);
      },
    },
  });

  const result = await service.saveDepartment({
    code: 'TECH',
    payload: {
      name: '技术部',
      sort_order: 35,
      is_active: 1,
      admin_user_ids: [8, 9],
    },
  });

  assert.equal(result.code, 'TECH');
  assert.equal(result.admins.length, 2);
  assert.ok(runs.some((item) => item.sql.includes('INSERT INTO departments')));
  assert.ok(runs.some((item) => item.sql.includes('DELETE FROM department_doc_admins') && item.params[0] === 'TECH'));
  assert.ok(runs.filter((item) => item.sql.includes('INSERT INTO department_doc_admins')).length === 2);
});
