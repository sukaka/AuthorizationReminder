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

test('filteredCategories is declared before allCategoryIds to avoid TDZ on first render', () => {
  const filteredIndex = source.indexOf('const filteredCategories = useMemo(');
  const allIdsIndex = source.indexOf('const allCategoryIds = useMemo(');
  assert.notEqual(filteredIndex, -1, 'filteredCategories declaration missing');
  assert.notEqual(allIdsIndex, -1, 'allCategoryIds declaration missing');
  assert.ok(filteredIndex < allIdsIndex, 'filteredCategories must be declared before allCategoryIds');
});

test('selectedArticleManageable is declared before editor polling effect dependencies', () => {
  const selectedManageableIndex = source.indexOf('const selectedArticleManageable =');
  const effectIndex = source.indexOf("}, [editorVisible, selectedArticle?.id, selectedArticleManageable])");
  assert.notEqual(selectedManageableIndex, -1, 'selectedArticleManageable declaration missing');
  assert.notEqual(effectIndex, -1, 'editor polling effect missing');
  assert.ok(selectedManageableIndex < effectIndex, 'selectedArticleManageable must be declared before the effect dependency array');
});

test('article list filters expose visible field labels instead of placeholders only', () => {
  assert.match(source, /筛选文档/);
  assert.match(source, /关键词搜索/);
  assert.match(source, /文库范围/);
  assert.match(source, /文档状态/);
  assert.match(source, /文档分类/);
});

test('article composer is progressively disclosed behind an expandable trigger', () => {
  assert.match(source, /展开新建文档/);
  assert.match(source, /收起新建文档/);
  assert.match(source, /aria-expanded=\{articleComposerOpen\}/);
});

test('article workspace emphasizes one primary shortcuts area and one reminders area', () => {
  assert.match(source, /继续处理/);
  assert.match(source, /待处理提醒/);
  assert.match(source, /最近访问/);
  assert.match(source, /我的收藏/);
});

test('recycle mode exposes purge actions for single and batch delete', () => {
  assert.match(source, /批量彻底删除/);
  assert.match(source, /彻底删除/);
  assert.match(source, /确认彻底删除选中的回收站文章吗/);
});
