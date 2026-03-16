const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

test('faq schema includes department library fields and access tables', () => {
  assert.match(dbSource, /faq_article_access_requests/);
  assert.match(dbSource, /faq_article_access_grants/);
  assert.match(dbSource, /faq_article_department_backfill_queue/);
  assert.match(dbSource, /library_scope/);
  assert.match(dbSource, /department_code/);
});

test('faq api exposes department access request workflow routes', () => {
  assert.match(apiSource, /\/api\/faq\/articles\/:id\/access-requests/);
  assert.match(apiSource, /\/api\/faq\/access-requests/);
  assert.match(apiSource, /\/api\/faq\/access-requests\/:id\/review/);
  assert.match(apiSource, /\/api\/faq\/access-grants\/:id\/revoke/);
});
