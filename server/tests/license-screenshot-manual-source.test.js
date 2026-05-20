const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(process.cwd(), 'server', 'db.js'), 'utf8');

test('licenses can be manually marked as having an uploaded screenshot', () => {
  assert.match(dbSource, /screenshot_marked_uploaded TINYINT/);
  assert.match(serverSource, /\/api\/licenses\/:id\/screenshot\/mark-uploaded/);
  assert.match(serverSource, /screenshot_marked_uploaded = 1/);
  assert.match(serverSource, /screenshot_marked_uploaded = 0/);
});

test('missing screenshot filter excludes manually marked licenses', () => {
  assert.match(serverSource, /COALESCE\(licenses\.screenshot_marked_uploaded, 0\) <> 1/);
});
