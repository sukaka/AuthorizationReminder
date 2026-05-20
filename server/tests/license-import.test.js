const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const {
  buildLicenseImportTemplateWorkbook,
  normalizeLicenseImportRow,
} = require('../user-import.js');

test('buildLicenseImportTemplateWorkbook writes the expected template header and sample row', () => {
  const buffer = buildLicenseImportTemplateWorkbook();

  assert.ok(Buffer.isBuffer(buffer));

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['licenses']);

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets.licenses, { header: 1, defval: '' });

  assert.deepEqual(rows[0], ['客户名称', '授权名称', '开始日期', '到期日期', '状态', '备注', '提醒天数']);
  assert.deepEqual(rows[1], ['示例客户有限公司', '云桌面授权', '2026-01-01', '2026-12-31', '有效', '合同编号：HT-2026-001', '60,30,7']);
});

test('normalizeLicenseImportRow accepts Chinese headers and status labels', () => {
  const row = normalizeLicenseImportRow({
    客户名称: ' 示例客户有限公司 ',
    授权名称: ' 云桌面授权 ',
    开始日期: '2026/01/01',
    到期日期: '2026/12/31',
    状态: '有效',
    备注: ' 续费合同 ',
    提醒天数: ' 60,30,7 ',
  });

  assert.deepEqual(row, {
    customer_name: '示例客户有限公司',
    name: '云桌面授权',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'ACTIVE',
    note: '续费合同',
    reminder_days: '60,30,7',
  });
});

test('normalizeLicenseImportRow keeps missing optional fields empty and marks expired status', () => {
  const row = normalizeLicenseImportRow({
    customer_name: 'Acme',
    name: 'Support',
    end_date: '2026-05-20',
    status: '已过期',
  });

  assert.deepEqual(row, {
    customer_name: 'Acme',
    name: 'Support',
    start_date: '',
    end_date: '2026-05-20',
    status: 'EXPIRED',
    note: '',
    reminder_days: '',
  });
});
