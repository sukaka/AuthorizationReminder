export const statusLabels = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

export const roleLabels = {
  admin: '管理员',
  editor: '业务管理员',
  reviewer: '审核用户',
  auditor: '审计管理员',
  sales: '销售',
  user: '普通用户',
  viewer: '普通用户',
};

export function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,，、\n]/);
  return Array.from(new Set(
    list
      .map((item) => String(item || '').trim().replace(/^#/, ''))
      .filter(Boolean)
  ));
}

export function tagsToInput(tags) {
  return normalizeTags(tags).join('，');
}

export function extractVariables(content) {
  const variables = new Set();
  const pattern = /\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5-]{1,64})\s*\}\}/g;
  let match;
  while ((match = pattern.exec(String(content || ''))) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

export function formatDateTime(value) {
  if (!value) return '-';
  const text = String(value).replace('T', ' ');
  return text.slice(0, 16);
}

export function buildPromptPayload(form) {
  return {
    title: String(form.title || '').trim(),
    summary: String(form.summary || '').trim(),
    content: String(form.content || '').trim(),
    department_id: Number(form.department_id || 0),
    category_id: Number(form.category_id || 0),
    visibility: form.visibility || 'department',
    tags: normalizeTags(form.tags),
    change_note: String(form.change_note || '').trim(),
  };
}
