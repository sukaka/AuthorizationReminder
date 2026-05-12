const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth index wires revokeUserSessions into adminCenterUsersService', () => {
  assert.match(source, /revokeSessions:\s*revokeUserSessions/);
});

test('admin center reset-password endpoint no longer accepts a custom password payload', () => {
  assert.doesNotMatch(source, /newPassword:\s*req\.body\?\.newPassword/);
});

test('admin center client uses fixed-password confirmation instead of prompting for a custom password', () => {
  assert.match(source, /const fixedResetPassword = /);
  assert.doesNotMatch(source, /window\.prompt\('请输入用户“'\s*\+/);
});

test('admin center reset-password confirmation keeps newlines escaped in rendered script', () => {
  assert.ok(
    source.includes("吗？\\\\n\\\\n'"),
    'confirm message newline must remain escaped after the outer HTML template renders',
  );
});
