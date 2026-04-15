const crypto = require('crypto');
const xlsx = require('xlsx');

const pickFirst = (row, keys) => {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return '';
};

const trimText = (value) => String(value ?? '').trim();
const pad2 = (value) => String(value).padStart(2, '0');
const sanitizeAsciiFilename = (value, fallback = 'download.xlsx') => {
  const text = String(value || '').replace(/[^\x20-\x7E]/g, '').trim();
  return text || fallback;
};
const buildDownloadHeaderMeta = (fileName, asciiFallback = 'download.xlsx') => {
  const displayName = trimText(fileName) || asciiFallback;
  const fallbackName = sanitizeAsciiFilename(asciiFallback, 'download.xlsx');
  const encodedName = encodeURIComponent(displayName);
  return {
    fileName: displayName,
    encodedFileName: encodedName,
    contentDisposition: `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
  };
};
const IMPORT_ROLE_ALIASES = Object.freeze({
  '普通用户': 'user',
  '业务管理员': 'editor',
  '审核用户': 'reviewer',
  '系统管理员': 'sysadmin',
  '审计管理员': 'auditor',
  '销售': 'sales',
});
const IMPORT_SYSTEM_ALIASES = Object.freeze({
  '授权到期提醒系统': 'reminder',
  '提醒系统': 'reminder',
  '交付系统': 'delivery',
  'cmdb系统': 'cmdb',
  'cmdb': 'cmdb',
  '库存管理系统': 'inventory',
  '设备流转系统': 'device-flow',
  '文档管理系统': 'faq',
  '标书协同制作系统': 'tender',
  '培训考试系统': 'train-exam',
});
const USER_IMPORT_TEMPLATE_HEADERS = Object.freeze([
  '账号',
  '角色',
  '状态',
  '可访问系统',
  '邮箱',
  '手机号',
  '企业微信UserID',
]);
const USER_IMPORT_TEMPLATE_SAMPLE_ROW = Object.freeze({
  账号: '张三',
  角色: '普通用户',
  状态: '启用',
  可访问系统: '培训考试系统|文档管理系统',
  邮箱: 'zhangsan@example.com',
  手机号: '13800000000',
  企业微信UserID: 'zhangsan',
});

const normalizeImportRole = (value) => {
  const text = trimText(value);
  if (!text) return '';
  const normalized = text.toLowerCase();
  return IMPORT_ROLE_ALIASES[text] || IMPORT_ROLE_ALIASES[normalized] || normalized;
};

const splitImportAccess = (value) => Array.from(
  new Set(
    String(value || '')
      .split(/[|,，、;；\s]+/)
      .map((item) => {
        const text = trimText(item);
        if (!text) return '';
        const normalized = text.toLowerCase();
        return IMPORT_SYSTEM_ALIASES[text] || IMPORT_SYSTEM_ALIASES[normalized] || normalized;
      })
      .filter(Boolean)
  )
);

const normalizeImportActive = (value) => {
  const text = trimText(value).toLowerCase();
  if (!text) return 1;
  if (['0', 'false', 'disabled', 'inactive', '禁用', '停用'].includes(text)) return 0;
  return 1;
};

const normalizeUserImportRow = (raw = {}) => ({
  username: trimText(pickFirst(raw, ['username', '账号'])),
  role: normalizeImportRole(pickFirst(raw, ['role', '角色'])),
  is_active: normalizeImportActive(pickFirst(raw, ['is_active', 'status', '状态'])),
  email: trimText(pickFirst(raw, ['email', '邮箱'])),
  phone: trimText(pickFirst(raw, ['phone', '手机号'])),
  wecom_id: trimText(pickFirst(raw, ['wecom_id', 'wecomId', '企业微信UserID', '企业微信userid', '企业微信ID', '企业微信id'])),
  app_access: splitImportAccess(pickFirst(raw, ['app_access', '可访问系统', '系统权限'])),
});

const randomChar = (source) => source[crypto.randomInt(0, source.length)];

const shuffle = (text) => {
  const chars = String(text || '').split('');
  for (let idx = chars.length - 1; idx > 0; idx -= 1) {
    const next = crypto.randomInt(0, idx + 1);
    [chars[idx], chars[next]] = [chars[next], chars[idx]];
  }
  return chars.join('');
};

const generateImportPassword = (policy = {}) => {
  const normalized = {
    minLength: Math.max(6, Number(policy?.minLength || 10)),
    requireUppercase: policy?.requireUppercase !== false,
    requireLowercase: policy?.requireLowercase !== false,
    requireNumber: policy?.requireNumber !== false,
    requireSpecial: policy?.requireSpecial !== false,
  };
  const pools = [];
  const required = [];
  if (normalized.requireUppercase) {
    pools.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    required.push(randomChar('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  }
  if (normalized.requireLowercase) {
    pools.push('abcdefghijklmnopqrstuvwxyz');
    required.push(randomChar('abcdefghijklmnopqrstuvwxyz'));
  }
  if (normalized.requireNumber) {
    pools.push('0123456789');
    required.push(randomChar('0123456789'));
  }
  if (normalized.requireSpecial) {
    pools.push('!@#$%^&*_-+=');
    required.push(randomChar('!@#$%^&*_-+='));
  }
  if (!pools.length) pools.push('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');

  const allChars = pools.join('');
  while (required.length < normalized.minLength) {
    required.push(randomChar(allChars));
  }
  return shuffle(required.join(''));
};

const buildUserImportWorkbook = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sheet = xlsx.utils.json_to_sheet(safeRows, {
    header: ['username', 'role', 'is_active', 'app_access_text', 'result', 'reason', 'initial_password'],
  });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'result');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const buildUserImportTemplateWorkbook = () => {
  const sheet = xlsx.utils.aoa_to_sheet([
    USER_IMPORT_TEMPLATE_HEADERS,
    USER_IMPORT_TEMPLATE_HEADERS.map((key) => USER_IMPORT_TEMPLATE_SAMPLE_ROW[key] ?? ''),
  ]);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'template');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const isUserImportExcelFile = (file) => {
  const name = trimText(file?.originalname).toLowerCase();
  return name.endsWith('.xlsx') || name.endsWith('.xls');
};

const buildUserImportFilename = (date = new Date()) => {
  const current = date instanceof Date ? date : new Date(date);
  const year = current.getUTCFullYear();
  const month = pad2(current.getUTCMonth() + 1);
  const day = pad2(current.getUTCDate());
  const hour = pad2(current.getUTCHours());
  const minute = pad2(current.getUTCMinutes());
  const second = pad2(current.getUTCSeconds());
  return `user-import-result-${year}-${month}-${day}-${hour}-${minute}-${second}.xlsx`;
};

const toResultRow = ({ rowNumber, row, result, reason, initialPassword }) => ({
  row: rowNumber,
  username: row.username,
  role: row.role,
  is_active: row.is_active,
  app_access_text: Array.isArray(row.app_access) ? row.app_access.join('|') : '',
  result,
  reason: reason || '',
  initial_password: initialPassword || '',
});

const importUsersFromRows = async ({
  rows,
  passwordPolicy,
  validateRow = () => '',
  findUserByUsername,
  insertUser,
  normalizeRow = normalizeUserImportRow,
  resolveInsertError = (err) => trimText(err?.message) || '用户创建失败',
}) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const resultRows = [];
  const errors = [];
  let created = 0;
  let skipped = 0;

  for (const [index, raw] of sourceRows.entries()) {
    const rowNumber = index + 2;
    const normalizedRow = normalizeRow(raw);
    const validationError = trimText(validateRow(normalizedRow, { rowNumber, raw }));
    if (validationError) {
      skipped += 1;
      errors.push({ row: rowNumber, reason: validationError });
      resultRows.push(toResultRow({
        rowNumber,
        row: normalizedRow,
        result: 'SKIPPED',
        reason: validationError,
        initialPassword: '',
      }));
      continue;
    }

    const existing = await findUserByUsername(normalizedRow.username);
    if (existing) {
      skipped += 1;
      errors.push({ row: rowNumber, reason: '用户名已存在' });
      resultRows.push(toResultRow({
        rowNumber,
        row: normalizedRow,
        result: 'SKIPPED',
        reason: '用户名已存在',
        initialPassword: '',
      }));
      continue;
    }

    const initialPassword = generateImportPassword(passwordPolicy);
    try {
      await insertUser({ ...normalizedRow, password: initialPassword }, { rowNumber, raw });
    } catch (err) {
      const reason = trimText(resolveInsertError(err, normalizedRow, { rowNumber, raw })) || '用户创建失败';
      skipped += 1;
      errors.push({ row: rowNumber, reason });
      resultRows.push(toResultRow({
        rowNumber,
        row: normalizedRow,
        result: 'SKIPPED',
        reason,
        initialPassword: '',
      }));
      continue;
    }
    created += 1;
    resultRows.push(toResultRow({
      rowNumber,
      row: normalizedRow,
      result: 'SUCCESS',
      reason: '',
      initialPassword,
    }));
  }

  return {
    created,
    skipped,
    total: sourceRows.length,
    errors,
    resultRows,
  };
};

module.exports = {
  buildDownloadHeaderMeta,
  normalizeUserImportRow,
  generateImportPassword,
  buildUserImportWorkbook,
  buildUserImportTemplateWorkbook,
  importUsersFromRows,
  splitImportAccess,
  normalizeImportActive,
  isUserImportExcelFile,
  buildUserImportFilename,
};
