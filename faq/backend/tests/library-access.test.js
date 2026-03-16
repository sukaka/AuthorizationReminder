const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveArticleAccess,
  sanitizeArticleForList,
  canReviewDepartmentRequest,
} = require('../src/library-access');

test('global library articles are readable to normal business users', () => {
  const access = resolveArticleAccess({
    user: {
      role: 'user',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article: {
      library_scope: 'global',
      department_code: null,
    },
  });

  assert.equal(access.canRead, true);
  assert.equal(access.visibility, 'full');
});

test('department library articles are fully readable inside the same department', () => {
  const access = resolveArticleAccess({
    user: {
      role: 'editor',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article: {
      library_scope: 'department',
      department_code: 'TECH',
    },
  });

  assert.equal(access.canRead, true);
  assert.equal(access.visibility, 'full');
});

test('cross-department articles stay restricted without an active grant', () => {
  const article = {
    id: 18,
    title: '财务归档规范',
    summary: '不应泄露的正文摘要',
    tags_json: '["财务","归档"]',
    library_scope: 'department',
    department_code: 'FIN',
  };
  const access = resolveArticleAccess({
    user: {
      role: 'user',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article,
  });

  assert.equal(access.canRead, false);
  assert.equal(access.canRequest, true);
  assert.equal(access.visibility, 'restricted');
  assert.deepEqual(sanitizeArticleForList(article, access), {
    ...article,
    summary: '',
    tags_json: '[]',
    tags: [],
    match_snippet: '',
    matched_search_text: '',
    category_name: '',
    current_version_id: null,
    published_version_id: null,
    visibility: 'restricted',
    restricted: true,
    can_request_access: true,
  });
});

test('cross-department active grant unlocks the full article', () => {
  const access = resolveArticleAccess({
    user: {
      role: 'user',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article: {
      library_scope: 'department',
      department_code: 'FIN',
    },
    activeGrant: {
      id: 7,
      status: 'approved',
      expires_at: '2999-01-01 00:00:00',
    },
  });

  assert.equal(access.canRead, true);
  assert.equal(access.visibility, 'full');
});

test('admin keeps global read and write authority', () => {
  const access = resolveArticleAccess({
    user: {
      role: 'admin',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article: {
      library_scope: 'department',
      department_code: 'FIN',
    },
  });

  assert.equal(access.canRead, true);
  assert.equal(access.canManage, true);
});

test('department document admins can only review requests for managed departments', () => {
  const user = {
    role: 'user',
    scope: {
      department: { code: 'TECH' },
      managedDepartments: [{ code: 'FIN' }],
    },
  };

  assert.equal(canReviewDepartmentRequest(user, 'FIN'), true);
  assert.equal(canReviewDepartmentRequest(user, 'TECH'), false);
});

test('reviewer does not gain document manage authority only because of same department', () => {
  const access = resolveArticleAccess({
    user: {
      role: 'reviewer',
      scope: { department: { code: 'TECH' }, managedDepartments: [] },
    },
    article: {
      library_scope: 'department',
      department_code: 'TECH',
    },
  });

  assert.equal(access.canRead, true);
  assert.equal(access.canManage, false);
});
