const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('faq frontend shows 文档管理系统 branding', () => {
  assert.match(source, /文档管理系统初始化中/);
  assert.match(source, /文档管理系统/);
  assert.match(source, /文档管理/);
  assert.match(source, /文档知识库/);
  assert.match(html, /<title>文档管理系统<\/title>/);
  assert.doesNotMatch(source, /FAQ 系统初始化中/);
});

test('faq frontend exposes global library, department library and access request copy', () => {
  assert.match(source, /全局库/);
  assert.match(source, /部门库/);
  assert.match(source, /跨部门受限/);
  assert.match(source, /申请查看/);
  assert.match(source, /待审批/);
});
