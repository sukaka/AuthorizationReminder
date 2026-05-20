const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');

test('sales license overview exposes grouped data and csv export endpoints', () => {
  assert.match(source, /\/api\/sales-license-overview/);
  assert.match(source, /\/api\/sales-license-overview\/export/);
  assert.match(source, /COALESCE\(NULLIF\(customers\.juxin_sales, ''\), '未分配聚信销售'\)/);
  assert.match(source, /DATEDIFF\(licenses\.end_date, CURDATE\(\)\)/);
  assert.match(source, /toCsv\(exportRows/);
});
