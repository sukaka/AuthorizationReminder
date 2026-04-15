const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const {
  normalizeUserImportRow,
  generateImportPassword,
  buildUserImportWorkbook,
  buildUserImportTemplateWorkbook,
  importUsersFromRows,
  isUserImportExcelFile,
  buildUserImportFilename,
} = require('../user-import.js');

test('normalizeUserImportRow normalizes aliases, access list, and active flag', () => {
  const row = normalizeUserImportRow({
    账号: ' editor01 ',
    角色: 'EDITOR',
    状态: '禁用',
    可访问系统: 'faq|tender，train-exam',
    邮箱: ' editor01@example.com ',
    手机号: ' 13800000000 ',
    企业微信UserID: ' wx-editor01 ',
  });

  assert.deepEqual(row, {
    username: 'editor01',
    role: 'editor',
    is_active: 0,
    email: 'editor01@example.com',
    phone: '13800000000',
    wecom_id: 'wx-editor01',
    app_access: ['faq', 'tender', 'train-exam'],
  });
});

test('normalizeUserImportRow accepts Chinese role labels and system labels', () => {
  const row = normalizeUserImportRow({
    账号: '张三',
    角色: '普通用户',
    状态: '启用',
    可访问系统: '培训考试系统|文档管理系统',
    邮箱: 'zhangsan@example.com',
    手机号: '13800000000',
    企业微信UserID: 'zhangsan',
  });

  assert.deepEqual(row, {
    username: '张三',
    role: 'user',
    is_active: 1,
    email: 'zhangsan@example.com',
    phone: '13800000000',
    wecom_id: 'zhangsan',
    app_access: ['train-exam', 'faq'],
  });
});

test('generateImportPassword satisfies the active password policy', () => {
  const password = generateImportPassword({
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
  });

  assert.ok(password.length >= 12);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.match(password, /[^A-Za-z0-9]/);
});

test('buildUserImportWorkbook writes success passwords and keeps skipped rows empty', () => {
  const buffer = buildUserImportWorkbook([
    {
      username: 'editor01',
      role: 'editor',
      is_active: 1,
      app_access_text: 'faq|tender',
      result: 'SUCCESS',
      reason: '',
      initial_password: 'Temp#2026Aa',
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
  ]);

  assert.ok(Buffer.isBuffer(buffer));

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets.result, { defval: '' });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].username, 'editor01');
  assert.equal(rows[0].initial_password, 'Temp#2026Aa');
  assert.equal(rows[1].username, 'dup-user');
  assert.equal(rows[1].initial_password, '');
  assert.equal(rows[1].reason, '用户名已存在');
});

test('buildUserImportTemplateWorkbook writes the expected template header and sample row', () => {
  const buffer = buildUserImportTemplateWorkbook();

  assert.ok(Buffer.isBuffer(buffer));

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['template']);

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets.template, { header: 1, defval: '' });

  assert.deepEqual(rows[0], [
    '账号',
    '角色',
    '状态',
    '可访问系统',
    '邮箱',
    '手机号',
    '企业微信UserID',
  ]);
  assert.deepEqual(rows[1], [
    '张三',
    '普通用户',
    '启用',
    '培训考试系统|文档管理系统',
    'zhangsan@example.com',
    '13800000000',
    'zhangsan',
  ]);
});

test('importUsersFromRows skips duplicates and returns generated passwords for created users', async () => {
  const inserted = [];
  const result = await importUsersFromRows({
    rows: [
      { username: 'dup-user', role: 'viewer', is_active: '1', app_access: 'faq' },
      { username: 'new-user', role: 'editor', is_active: '启用', app_access: 'faq|tender' },
    ],
    passwordPolicy: {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
    },
    validateRow: () => '',
    findUserByUsername: async (username) => (username === 'dup-user' ? { id: 9 } : null),
    insertUser: async (payload) => {
      inserted.push(payload);
      return { id: inserted.length, ...payload };
    },
  });

  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].reason, '用户名已存在');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].username, 'new-user');
  assert.match(inserted[0].password, /[A-Z]/);
  assert.equal(result.resultRows[0].result, 'SKIPPED');
  assert.equal(result.resultRows[1].result, 'SUCCESS');
  assert.ok(result.resultRows[1].initial_password);
});

test('isUserImportExcelFile only accepts xls and xlsx names', () => {
  assert.equal(isUserImportExcelFile({ originalname: 'users.xlsx' }), true);
  assert.equal(isUserImportExcelFile({ originalname: 'users.xls' }), true);
  assert.equal(isUserImportExcelFile({ originalname: 'users.csv' }), false);
  assert.equal(isUserImportExcelFile({ originalname: 'users' }), false);
});

test('buildUserImportFilename includes a stable timestamp-like suffix', () => {
  const fileName = buildUserImportFilename(new Date('2026-03-14T08:09:10Z'));

  assert.equal(fileName, 'user-import-result-2026-03-14-08-09-10.xlsx');
});

test('importUsersFromRows records insert failures and continues the batch', async () => {
  const result = await importUsersFromRows({
    rows: [
      { username: 'first-user', role: 'viewer', is_active: '1', app_access: 'faq' },
      { username: 'second-user', role: 'editor', is_active: '1', app_access: 'faq|tender' },
    ],
    passwordPolicy: {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
    },
    validateRow: () => '',
    findUserByUsername: async () => null,
    insertUser: async (payload) => {
      if (payload.username === 'first-user') throw new Error('数据库写入失败');
      return { id: 2, ...payload };
    },
    resolveInsertError: (err) => err.message,
  });

  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].reason, '数据库写入失败');
  assert.equal(result.resultRows[0].result, 'SKIPPED');
  assert.equal(result.resultRows[1].result, 'SUCCESS');
});
