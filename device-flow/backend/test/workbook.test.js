const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWorkbookBuffer,
  readFirstWorksheetRows,
} = require('../src/workbook');

test('reads the first worksheet as header-keyed rows', async () => {
  const source = await buildWorkbookBuffer({
    sheetName: 'ImportTemplate',
    rows: [
      { 设备SN: 'SN-001', 客户名称: '客户A' },
      { 设备SN: 'SN-002', 客户名称: '客户B' },
    ],
  });

  const rows = await readFirstWorksheetRows(source);

  assert.deepEqual(rows, [
    { 设备SN: 'SN-001', 客户名称: '客户A' },
    { 设备SN: 'SN-002', 客户名称: '客户B' },
  ]);
});

test('reads CSV input for backward-compatible import precheck', async () => {
  const rows = await readFirstWorksheetRows(
    Buffer.from('device_sn,customer_name\nSN-CSV-001,CSV客户\n', 'utf8')
  );

  assert.deepEqual(rows, [
    { device_sn: 'SN-CSV-001', customer_name: 'CSV客户' },
  ]);
});

test('rejects workbooks without a data sheet', async () => {
  await assert.rejects(
    () => readFirstWorksheetRows(Buffer.alloc(0)),
    /Excel 文件解析失败|Excel 文件缺少工作表/
  );
});

test('writes a valid workbook buffer for export', async () => {
  const buffer = await buildWorkbookBuffer({
    sheetName: 'Jobs',
    rows: [{ 流转单号: 'DF-001', 状态: 'OPEN' }],
  });
  const rows = await readFirstWorksheetRows(buffer);

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.deepEqual(rows, [{ 流转单号: 'DF-001', 状态: 'OPEN' }]);
});

