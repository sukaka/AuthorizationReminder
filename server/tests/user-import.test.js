const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const {
  buildDownloadHeaderMeta,
  buildAdminCenterUsersExportWorkbook,
  normalizeUserImportRow,
  generateImportPassword,
  buildUserImportWorkbook,
  buildUserImportTemplateWorkbook,
  importUsersFromRows,
  isUserImportExcelFile,
  buildUserImportFilename,
} = require('../user-import.js');

test('buildDownloadHeaderMeta encodes non-ascii filenames for HTTP headers', () => {
  const meta = buildDownloadHeaderMeta('用户导入模板.xlsx', 'user-import-template.xlsx');

  assert.equal(meta.fileName, '用户导入模板.xlsx');
  assert.equal(meta.encodedFileName, '%E7%94%A8%E6%88%B7%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx');
  assert.equal(
    meta.contentDisposition,
    `attachment; filename="user-import-template.xlsx"; filename*=UTF-8''${meta.encodedFileName}`
  );
});

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
      notify_email_status: 'SENT',
      notify_email_reason: '',
    },
    {
      username: 'dup-user',
      role: 'viewer',
      is_active: 1,
      app_access_text: 'faq',
      result: 'SKIPPED',
      reason: '用户名已存在',
      initial_password: '',
      notify_email_status: 'SKIPPED',
      notify_email_reason: '用户名已存在',
    },
  ]);

  assert.ok(Buffer.isBuffer(buffer));

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets.result, { defval: '' });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].username, 'editor01');
  assert.equal(rows[0].initial_password, 'Temp#2026Aa');
  assert.equal(rows[0].notify_email_status, 'SENT');
  assert.equal(rows[1].username, 'dup-user');
  assert.equal(rows[1].initial_password, '');
  assert.equal(rows[1].notify_email_status, 'SKIPPED');
  assert.equal(rows[1].reason, '用户名已存在');
  assert.equal(rows[1].notify_email_reason, '用户名已存在');
});

test('buildAdminCenterUsersExportWorkbook writes localized user export rows', () => {
  const buffer = buildAdminCenterUsersExportWorkbook([
    {
      username: 'zhangsan',
      role_label: '普通用户',
      department_name: '技术部',
      status_label: '启用',
      lock_status_label: '正常',
      app_access_labels: '培训考试系统、文档管理系统',
      email: 'zhangsan@example.com',
      phone: '13800000000',
      wecom_id: 'zhangsan',
      mfa_methods_label: '邮箱、谷歌认证',
      created_at: '2026-04-15 13:40:00',
    },
  ]);

  assert.ok(Buffer.isBuffer(buffer));

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets.users, { header: 1, defval: '' });

  assert.deepEqual(rows[0], [
    '账号',
    '角色',
    '主归属部门',
    '状态',
    '锁定状态',
    '可访问系统',
    '邮箱',
    '手机号',
    '企业微信UserID',
    '二次验证',
    '创建时间',
  ]);
  assert.deepEqual(rows[1], [
    'zhangsan',
    '普通用户',
    '技术部',
    '启用',
    '正常',
    '培训考试系统、文档管理系统',
    'zhangsan@example.com',
    '13800000000',
    'zhangsan',
    '邮箱、谷歌认证',
    '2026-04-15 13:40:00',
  ]);
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

test('importUsersFromRows records per-user email delivery outcome without failing created users', async () => {
  const result = await importUsersFromRows({
    rows: [
      { username: 'email-ok', role: 'viewer', is_active: '1', app_access: 'faq', email: 'ok@example.com' },
      { username: 'email-missing', role: 'editor', is_active: '1', app_access: 'faq|tender', email: '' },
      { username: 'email-fail', role: 'editor', is_active: '1', app_access: 'faq|tender', email: 'fail@example.com' },
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
    insertUser: async (payload) => ({ id: payload.username, ...payload }),
    notifyUser: async ({ row }) => {
      if (!row.email) {
        return { status: 'SKIPPED', reason: '未填写邮箱' };
      }
      if (row.username === 'email-fail') {
        throw new Error('邮箱配置不完整');
      }
      return { status: 'SENT', reason: '' };
    },
  });

  assert.equal(result.created, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.resultRows[0].notify_email_status, 'SENT');
  assert.equal(result.resultRows[0].notify_email_reason, '');
  assert.equal(result.resultRows[1].notify_email_status, 'SKIPPED');
  assert.equal(result.resultRows[1].notify_email_reason, '未填写邮箱');
  assert.equal(result.resultRows[2].notify_email_status, 'FAILED');
  assert.equal(result.resultRows[2].notify_email_reason, '邮箱配置不完整');
  assert.equal(result.resultRows[2].result, 'SUCCESS');
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
