import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'App.jsx'), 'utf8');

test('prompt center UI contains department, category, version and audit views', () => {
  assert.match(source, /部门/);
  assert.match(source, /分类/);
  assert.match(source, /版本/);
  assert.match(source, /审计/);
});

test('prompt center UI calls prompt-center API namespace', () => {
  assert.match(source, /\/api\/prompt-center/);
  assert.match(source, /\/prompts\/\$\{selectedPrompt\.id\}\/publish/);
});

test('prompt center UI sends csrf token for write requests', () => {
  assert.match(source, /\/csrf/);
  assert.match(source, /X-CSRF-Token/);
});
