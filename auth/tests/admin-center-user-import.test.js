const test = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');

const {
  parseAdminCenterUserImportFile,
} = require('../admin-center-user-import');

const buildWorkbookBuffer = (rows) => {
  const sheet = xlsx.utils.json_to_sheet(rows, { defval: '' });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'template');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

test('parseAdminCenterUserImportFile parses the first worksheet rows', () => {
  const buffer = buildWorkbookBuffer([
    { username: 'editor_demo', role: 'editor', app_access: 'faq|tender' },
  ]);

  const rows = parseAdminCenterUserImportFile({
    originalname: 'users.xlsx',
    buffer,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'editor_demo');
  assert.equal(rows[0].role, 'editor');
});

test('parseAdminCenterUserImportFile rejects non-excel files', () => {
  assert.throws(
    () => parseAdminCenterUserImportFile({ originalname: 'users.csv', buffer: Buffer.from('x') }),
    /仅支持 Excel 文件/
  );
});

test('parseAdminCenterUserImportFile enforces max record count', () => {
  const buffer = buildWorkbookBuffer([
    { username: 'u1' },
    { username: 'u2' },
  ]);

  assert.throws(
    () => parseAdminCenterUserImportFile({ originalname: 'users.xlsx', buffer }, { maxRecords: 1 }),
    /单次导入最多 1 行/
  );
});
