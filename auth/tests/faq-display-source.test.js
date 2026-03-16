const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('auth exposes faq app as 文档管理系统', () => {
  assert.match(source, /apps\.push\(\{ key: 'faq', name: '文档管理系统', url: faqURL, allow: !!faqAuth\.allow \}\)/);
  assert.match(source, /<option value="faq">文档管理系统<\/option>/);
});

test('auth faq authorization messages use 文档管理系统 wording', () => {
  assert.match(source, /无权限访问文档管理系统/);
  assert.match(source, /仅管理员或编辑可执行文档写操作/);
  assert.match(source, /仅管理员或审核员可执行文档审核操作/);
  assert.match(source, /仅审计管理员可查看文档审计信息/);
});
