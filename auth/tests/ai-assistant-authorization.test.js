const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { authorizeAiAssistant } = require('../ai-assistant-authorization');

const user = (role, access = ['ai-assistant']) => ({
  role,
  app_access: JSON.stringify(access),
});

test('ordinary employees can only enter and use the AI assistant', () => {
  const employee = user('user');

  assert.equal(authorizeAiAssistant(employee, 'app:enter').allow, true);
  assert.equal(authorizeAiAssistant(employee, 'ai_assistant:use').allow, true);
  assert.equal(authorizeAiAssistant(employee, 'ai_assistant:task:suggest', { managedDepartments: [] }).allow, false);
  assert.equal(authorizeAiAssistant(employee, 'ai_assistant:department:stats', { managedDepartments: [] }).allow, false);
  assert.equal(authorizeAiAssistant(employee, 'ai_assistant:admin').allow, false);
  assert.equal(authorizeAiAssistant(employee, 'ai_assistant:audit:read').allow, false);
});

test('department managers can suggest and view only their managed department scope', () => {
  const manager = user('user');
  const scope = { managedDepartments: [{ code: 'SALES', name: '销售部' }] };

  assert.equal(authorizeAiAssistant(manager, 'ai_assistant:task:suggest', scope).allow, true);
  assert.equal(authorizeAiAssistant(manager, 'ai_assistant:department:stats', scope).allow, true);
  assert.equal(authorizeAiAssistant(manager, 'ai_assistant:admin', scope).allow, false);
  assert.equal(authorizeAiAssistant(manager, 'ai_assistant:audit:read', scope).allow, false);
});

test('department managers cannot act on a department outside their managed scope', () => {
  const manager = user('user');
  const scope = { managedDepartments: ['销售'] };

  assert.equal(
    authorizeAiAssistant(manager, 'ai_assistant:task:suggest', scope, { department_code: '销售' }).allow,
    true
  );
  assert.equal(
    authorizeAiAssistant(manager, 'ai_assistant:task:suggest', scope, { department_code: '商务投标' }).allow,
    false
  );
  assert.equal(
    authorizeAiAssistant(manager, 'ai_assistant:department:stats', scope, { department_code: '商务投标' }).allow,
    false
  );
});

test('system administrators receive admin but not audit actions', () => {
  const sysadmin = user('sysadmin');

  assert.equal(authorizeAiAssistant(sysadmin, 'ai_assistant:use').allow, true);
  assert.equal(authorizeAiAssistant(sysadmin, 'ai_assistant:admin').allow, true);
  assert.equal(authorizeAiAssistant(sysadmin, 'ai_assistant:audit:read').allow, false);
});

test('auditors receive audit but not admin actions', () => {
  const auditor = user('auditor');

  assert.equal(authorizeAiAssistant(auditor, 'ai_assistant:use').allow, true);
  assert.equal(authorizeAiAssistant(auditor, 'ai_assistant:audit:read').allow, true);
  assert.equal(authorizeAiAssistant(auditor, 'ai_assistant:admin').allow, false);
});

test('anonymous users and unknown actions are denied', () => {
  assert.equal(authorizeAiAssistant(null, 'ai_assistant:use').allow, false);
  assert.equal(authorizeAiAssistant(user('user'), 'ai_assistant:unknown').allow, false);
});

test('unified authorization records denied AI assistant actions without resource content', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /system === 'ai-assistant' && !result\.allow/);
  assert.match(source, /action: 'authorization\.denied'/);
  assert.match(source, /entityId: String\(action \|\| ''\)/);
});
