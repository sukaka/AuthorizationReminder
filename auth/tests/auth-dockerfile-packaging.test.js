const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

test('auth Dockerfile packages system access display helper', () => {
  assert.match(source, /COPY auth\/system-access-display\.js \.\/auth\/system-access-display\.js/);
});

test('auth Dockerfile packages department admin helper', () => {
  assert.match(source, /COPY auth\/admin-center-departments\.js \.\/auth\/admin-center-departments\.js/);
});

test('auth Dockerfile packages audit log display helper', () => {
  assert.match(source, /COPY auth\/audit-log-display\.js \.\/auth\/audit-log-display\.js/);
});
