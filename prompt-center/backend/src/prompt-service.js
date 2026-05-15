const { appError, canPublishPrompt, canWritePrompt } = require('./auth');

const ALLOWED_PROMPT_STATUSES = new Set(['draft', 'published', 'archived']);
const ALLOWED_VISIBILITIES = new Set(['department', 'company']);

const trimText = (value) => String(value || '').trim();
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const isDuplicateKeyError = (err) => (
  err?.code === 'ER_DUP_ENTRY'
  || /Duplicate entry/i.test(String(err?.message || ''))
);

const assertUniqueDepartmentName = async (db, name, id = null) => {
  const params = [name];
  let sql = 'SELECT id FROM pc_departments WHERE name = ?';
  if (id) {
    sql += ' AND id <> ?';
    params.push(Number(id));
  }
  const existing = await db.get(sql, params);
  if (existing) throw appError(`部门“${name}”已存在`, 409);
};

const assertUniqueCategoryName = async (db, departmentId, name, id = null) => {
  const params = [Number(departmentId), name];
  let sql = 'SELECT id FROM pc_categories WHERE department_id = ? AND name = ?';
  if (id) {
    sql += ' AND id <> ?';
    params.push(Number(id));
  }
  const existing = await db.get(sql, params);
  if (existing) throw appError(`分类“${name}”在该部门下已存在`, 409);
};

const normalizeTags = (value) => {
  const source = Array.isArray(value)
    ? value
    : trimText(value)
      ? trimText(value).split(/[,\n，、]/)
      : [];
  return Array.from(new Set(
    source
      .map((item) => trimText(item).replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 20)
  ));
};

const parseTags = (value) => {
  if (Array.isArray(value)) return normalizeTags(value);
  const raw = trimText(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeTags(parsed);
  } catch (_err) {
    return normalizeTags(raw);
  }
};

const extractPromptVariables = (content) => {
  const text = String(content || '');
  const found = new Set();
  const pattern = /\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5-]{1,64})\s*\}\}/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
};

const normalizePromptPayload = (payload = {}, { partial = false } = {}) => {
  const title = trimText(payload.title);
  const content = String(payload.content || '').trim();
  const departmentId = Number(payload.department_id || payload.departmentId || 0);
  const categoryId = Number(payload.category_id || payload.categoryId || 0);
  const visibility = trimText(payload.visibility) || 'department';
  if (!partial || title) {
    if (!title || title.length > 255) throw appError('提示词标题不能为空且不能超过255个字符', 400);
  }
  if (!partial || content) {
    if (!content || content.length > 100000) throw appError('提示词内容不能为空且不能超过100000个字符', 400);
  }
  if (!partial || departmentId) {
    if (!Number.isInteger(departmentId) || departmentId <= 0) throw appError('请选择所属部门', 400);
  }
  if (!partial || categoryId) {
    if (!Number.isInteger(categoryId) || categoryId <= 0) throw appError('请选择所属分类', 400);
  }
  if (!ALLOWED_VISIBILITIES.has(visibility)) throw appError('可见范围无效', 400);
  return {
    title,
    content,
    department_id: departmentId,
    category_id: categoryId,
    summary: trimText(payload.summary).slice(0, 512),
    visibility,
    tags: normalizeTags(payload.tags),
    change_note: trimText(payload.change_note || payload.changeNote).slice(0, 512),
  };
};

const normalizePromptRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    department_id: Number(row.department_id),
    category_id: Number(row.category_id),
    usage_count: Number(row.usage_count || 0),
    current_version_id: row.current_version_id ? Number(row.current_version_id) : null,
    tags: parseTags(row.tags_json),
    variables: extractPromptVariables(row.content),
  };
};

const normalizeAuditRow = (row) => ({
  ...row,
  id: Number(row.id),
  entity_id: row.entity_id ? Number(row.entity_id) : null,
  detail: (() => {
    try {
      return row.detail_json ? JSON.parse(row.detail_json) : {};
    } catch (_err) {
      return {};
    }
  })(),
});

const actorParams = (user) => [
  user?.id ? Number(user.id) : null,
  trimText(user?.display_name || user?.username),
  trimText(user?.role),
];

const logAudit = async (db, { user, action, entity, entityId, detail, requestIp }) => {
  await db.run(
    `INSERT INTO pc_audit_logs
      (actor_id, actor_name, actor_role, action, entity, entity_id, detail_json, request_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ...actorParams(user),
      trimText(action),
      trimText(entity),
      entityId ? Number(entityId) : null,
      JSON.stringify(detail || {}),
      trimText(requestIp).slice(0, 64),
    ]
  );
};

const ensureDepartment = async (db, id) => {
  const row = await db.get('SELECT * FROM pc_departments WHERE id = ?', [Number(id)]);
  if (!row) throw appError('部门不存在', 404);
  return row;
};

const ensureCategory = async (db, id, departmentId) => {
  const row = await db.get('SELECT * FROM pc_categories WHERE id = ?', [Number(id)]);
  if (!row) throw appError('分类不存在', 404);
  if (departmentId && Number(row.department_id) !== Number(departmentId)) throw appError('分类不属于所选部门', 400);
  return row;
};

const createVersion = async (tx, promptId, payload, user, changeNote) => {
  const latest = await tx.get('SELECT COALESCE(MAX(version_no), 0) AS latest FROM pc_prompt_versions WHERE prompt_id = ?', [
    Number(promptId),
  ]);
  const versionNo = Number(latest?.latest || 0) + 1;
  const result = await tx.run(
    `INSERT INTO pc_prompt_versions
      (prompt_id, version_no, title, summary, content, tags_json, change_note, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(promptId),
      versionNo,
      payload.title,
      payload.summary,
      payload.content,
      JSON.stringify(payload.tags || []),
      changeNote || '',
      user?.id || null,
      trimText(user?.display_name || user?.username),
    ]
  );
  return { id: result.insertId, version_no: versionNo };
};

const listDepartments = async (db, { includeInactive = false } = {}) => {
  const rows = await db.query(
    `SELECT d.*,
      (SELECT COUNT(1) FROM pc_prompts p WHERE p.department_id = d.id AND p.status <> 'archived') AS prompt_count
     FROM pc_departments d
     ${includeInactive ? '' : 'WHERE d.is_active = 1'}
     ORDER BY d.sort_order ASC, d.id ASC`
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), prompt_count: Number(row.prompt_count || 0) }));
};

const saveDepartment = async (db, payload, user, requestIp, id = null) => {
  const name = trimText(payload.name);
  if (!name || name.length > 128) throw appError('部门名称不能为空且不能超过128个字符', 400);
  const data = {
    name,
    description: trimText(payload.description),
    sort_order: Number(payload.sort_order || payload.sortOrder || 0) || 0,
    is_active: payload.is_active === false || payload.isActive === false ? 0 : 1,
  };
  await assertUniqueDepartmentName(db, data.name, id);
  if (id) {
    try {
      await db.run(
        'UPDATE pc_departments SET name = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
        [data.name, data.description, data.sort_order, data.is_active, Number(id)]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) throw appError(`部门“${data.name}”已存在`, 409);
      throw err;
    }
    await logAudit(db, { user, action: 'department.update', entity: 'department', entityId: id, detail: data, requestIp });
    return ensureDepartment(db, id);
  }
  let result;
  try {
    result = await db.run(
      'INSERT INTO pc_departments (name, description, sort_order, is_active) VALUES (?, ?, ?, ?)',
      [data.name, data.description, data.sort_order, data.is_active]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) throw appError(`部门“${data.name}”已存在`, 409);
    throw err;
  }
  await logAudit(db, { user, action: 'department.create', entity: 'department', entityId: result.insertId, detail: data, requestIp });
  return ensureDepartment(db, result.insertId);
};

const listCategories = async (db, filters = {}) => {
  const params = [];
  const where = [];
  if (filters.department_id) {
    where.push('c.department_id = ?');
    params.push(Number(filters.department_id));
  }
  if (!filters.includeInactive) where.push('c.is_active = 1');
  const rows = await db.query(
    `SELECT c.*, d.name AS department_name,
      (SELECT COUNT(1) FROM pc_prompts p WHERE p.category_id = c.id AND p.status <> 'archived') AS prompt_count
     FROM pc_categories c
     LEFT JOIN pc_departments d ON d.id = c.department_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.sort_order ASC, c.sort_order ASC, c.id ASC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    department_id: Number(row.department_id),
    prompt_count: Number(row.prompt_count || 0),
  }));
};

const saveCategory = async (db, payload, user, requestIp, id = null) => {
  const departmentId = Number(payload.department_id || payload.departmentId || 0);
  const name = trimText(payload.name);
  if (!departmentId) throw appError('请选择所属部门', 400);
  if (!name || name.length > 128) throw appError('分类名称不能为空且不能超过128个字符', 400);
  await ensureDepartment(db, departmentId);
  const data = {
    department_id: departmentId,
    name,
    description: trimText(payload.description),
    sort_order: Number(payload.sort_order || payload.sortOrder || 0) || 0,
    is_active: payload.is_active === false || payload.isActive === false ? 0 : 1,
  };
  await assertUniqueCategoryName(db, data.department_id, data.name, id);
  if (id) {
    try {
      await db.run(
        'UPDATE pc_categories SET department_id = ?, name = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
        [data.department_id, data.name, data.description, data.sort_order, data.is_active, Number(id)]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) throw appError(`分类“${data.name}”在该部门下已存在`, 409);
      throw err;
    }
    await logAudit(db, { user, action: 'category.update', entity: 'category', entityId: id, detail: data, requestIp });
    return db.get('SELECT * FROM pc_categories WHERE id = ?', [Number(id)]);
  }
  let result;
  try {
    result = await db.run(
      'INSERT INTO pc_categories (department_id, name, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?)',
      [data.department_id, data.name, data.description, data.sort_order, data.is_active]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) throw appError(`分类“${data.name}”在该部门下已存在`, 409);
    throw err;
  }
  await logAudit(db, { user, action: 'category.create', entity: 'category', entityId: result.insertId, detail: data, requestIp });
  return db.get('SELECT * FROM pc_categories WHERE id = ?', [result.insertId]);
};

const buildPromptWhere = (filters = {}, req = null) => {
  const where = [];
  const params = [];
  const status = trimText(filters.status);
  if (status) {
    if (!ALLOWED_PROMPT_STATUSES.has(status)) throw appError('状态参数无效', 400);
    where.push('p.status = ?');
    params.push(status);
  } else if (!canWritePrompt(req || {})) {
    where.push("p.status = 'published'");
  }
  if (filters.department_id) {
    where.push('p.department_id = ?');
    params.push(Number(filters.department_id));
  }
  if (filters.category_id) {
    where.push('p.category_id = ?');
    params.push(Number(filters.category_id));
  }
  const keyword = trimText(filters.keyword);
  if (keyword) {
    where.push('(p.title LIKE ? OR p.summary LIKE ? OR p.content LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const tag = trimText(filters.tag);
  if (tag) {
    where.push("JSON_SEARCH(p.tags_json, 'one', ?) IS NOT NULL");
    params.push(tag.replace(/^#/, ''));
  }
  return { where, params };
};

const listPrompts = async (db, filters, req) => {
  const { where, params } = buildPromptWhere(filters, req);
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 60)));
  const offset = Math.max(0, Number(filters.offset || 0));
  const rows = await db.query(
    `SELECT p.*, d.name AS department_name, c.name AS category_name, v.version_no AS current_version_no
     FROM pc_prompts p
     LEFT JOIN pc_departments d ON d.id = p.department_id
     LEFT JOIN pc_categories c ON c.id = p.category_id
     LEFT JOIN pc_prompt_versions v ON v.id = p.current_version_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows.map(normalizePromptRow);
};

const getPromptById = async (db, id, req) => {
  const prompt = normalizePromptRow(await db.get(
    `SELECT p.*, d.name AS department_name, c.name AS category_name, v.version_no AS current_version_no
     FROM pc_prompts p
     LEFT JOIN pc_departments d ON d.id = p.department_id
     LEFT JOIN pc_categories c ON c.id = p.category_id
     LEFT JOIN pc_prompt_versions v ON v.id = p.current_version_id
     WHERE p.id = ?`,
    [Number(id)]
  ));
  if (!prompt) throw appError('提示词不存在', 404);
  if (!canWritePrompt(req || {}) && prompt.status !== 'published') throw appError('无权限访问未发布提示词', 403);
  return prompt;
};

const createPrompt = async (db, payload, user, requestIp) => {
  const data = normalizePromptPayload(payload);
  await ensureDepartment(db, data.department_id);
  await ensureCategory(db, data.category_id, data.department_id);
  const result = await db.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO pc_prompts
        (department_id, category_id, title, summary, content, tags_json, visibility, created_by_id, created_by_name, updated_by_id, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.department_id,
        data.category_id,
        data.title,
        data.summary,
        data.content,
        JSON.stringify(data.tags),
        data.visibility,
        user?.id || null,
        trimText(user?.display_name || user?.username),
        user?.id || null,
        trimText(user?.display_name || user?.username),
      ]
    );
    const version = await createVersion(tx, inserted.insertId, data, user, data.change_note || '创建提示词');
    await tx.run('UPDATE pc_prompts SET current_version_id = ? WHERE id = ?', [version.id, inserted.insertId]);
    return { id: inserted.insertId, version };
  });
  await logAudit(db, {
    user,
    action: 'prompt.create',
    entity: 'prompt',
    entityId: result.id,
    detail: { title: data.title, version_no: result.version.version_no },
    requestIp,
  });
  return getPromptById(db, result.id, { user: { role: 'admin' } });
};

const updatePrompt = async (db, id, payload, user, requestIp) => {
  const existing = await getPromptById(db, id, { user: { role: 'admin' } });
  const data = normalizePromptPayload({
    ...existing,
    ...payload,
    tags: payload.tags === undefined ? existing.tags : payload.tags,
  });
  await ensureDepartment(db, data.department_id);
  await ensureCategory(db, data.category_id, data.department_id);
  const version = await db.transaction(async (tx) => {
    const created = await createVersion(tx, Number(id), data, user, data.change_note || '更新提示词');
    await tx.run(
      `UPDATE pc_prompts
       SET department_id = ?, category_id = ?, title = ?, summary = ?, content = ?, tags_json = ?,
           visibility = ?, current_version_id = ?, updated_by_id = ?, updated_by_name = ?
       WHERE id = ?`,
      [
        data.department_id,
        data.category_id,
        data.title,
        data.summary,
        data.content,
        JSON.stringify(data.tags),
        data.visibility,
        created.id,
        user?.id || null,
        trimText(user?.display_name || user?.username),
        Number(id),
      ]
    );
    return created;
  });
  await logAudit(db, {
    user,
    action: 'prompt.update',
    entity: 'prompt',
    entityId: id,
    detail: { title: data.title, version_no: version.version_no },
    requestIp,
  });
  return getPromptById(db, id, { user: { role: 'admin' } });
};

const setPromptStatus = async (db, id, status, user, requestIp) => {
  if (!ALLOWED_PROMPT_STATUSES.has(status)) throw appError('状态无效', 400);
  const prompt = await getPromptById(db, id, { user: { role: 'admin' } });
  const fields = {
    published_at: status === 'published' ? nowSql() : prompt.published_at,
    archived_at: status === 'archived' ? nowSql() : null,
  };
  await db.run(
    'UPDATE pc_prompts SET status = ?, published_at = ?, archived_at = ?, updated_by_id = ?, updated_by_name = ? WHERE id = ?',
    [status, fields.published_at, fields.archived_at, user?.id || null, trimText(user?.display_name || user?.username), Number(id)]
  );
  await logAudit(db, {
    user,
    action: `prompt.${status}`,
    entity: 'prompt',
    entityId: id,
    detail: { title: prompt.title, status },
    requestIp,
  });
  return getPromptById(db, id, { user: { role: 'admin' } });
};

const rollbackPrompt = async (db, id, versionId, user, requestIp) => {
  const prompt = await getPromptById(db, id, { user: { role: 'admin' } });
  const version = await db.get('SELECT * FROM pc_prompt_versions WHERE id = ? AND prompt_id = ?', [Number(versionId), Number(id)]);
  if (!version) throw appError('版本不存在', 404);
  await db.run(
    `UPDATE pc_prompts
     SET title = ?, summary = ?, content = ?, tags_json = tags_json, current_version_id = ?, updated_by_id = ?, updated_by_name = ?
     WHERE id = ?`,
    [
      version.title,
      version.summary,
      version.content,
      Number(version.id),
      user?.id || null,
      trimText(user?.display_name || user?.username),
      Number(id),
    ]
  );
  await db.run('UPDATE pc_prompts SET tags_json = ? WHERE id = ?', [version.tags_json || '[]', Number(id)]);
  await logAudit(db, {
    user,
    action: 'prompt.rollback',
    entity: 'prompt',
    entityId: id,
    detail: { title: prompt.title, version_no: version.version_no },
    requestIp,
  });
  return getPromptById(db, id, { user: { role: 'admin' } });
};

const listVersions = async (db, id) => {
  const rows = await db.query(
    'SELECT * FROM pc_prompt_versions WHERE prompt_id = ? ORDER BY version_no DESC',
    [Number(id)]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    prompt_id: Number(row.prompt_id),
    version_no: Number(row.version_no),
    tags: parseTags(row.tags_json),
    variables: extractPromptVariables(row.content),
  }));
};

const recordUsage = async (db, id, user, requestIp) => {
  const prompt = await getPromptById(db, id, { user: { role: 'viewer' } });
  await db.run('UPDATE pc_prompts SET usage_count = usage_count + 1 WHERE id = ?', [Number(id)]);
  await logAudit(db, {
    user,
    action: 'prompt.use',
    entity: 'prompt',
    entityId: id,
    detail: { title: prompt.title },
    requestIp,
  });
  return { ok: true };
};

const getOverview = async (db) => {
  const [counts, departments, categories, recentlyUpdated] = await Promise.all([
    db.get(
      `SELECT
        COUNT(1) AS total,
        SUM(status = 'published') AS published,
        SUM(status = 'draft') AS draft,
        SUM(status = 'archived') AS archived,
        COALESCE(SUM(usage_count), 0) AS usage_count
       FROM pc_prompts`
    ),
    listDepartments(db),
    listCategories(db),
    db.query(
      `SELECT p.id, p.title, p.status, p.updated_at, d.name AS department_name, c.name AS category_name
       FROM pc_prompts p
       LEFT JOIN pc_departments d ON d.id = p.department_id
       LEFT JOIN pc_categories c ON c.id = p.category_id
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT 8`
    ),
  ]);
  return {
    counts: {
      total: Number(counts?.total || 0),
      published: Number(counts?.published || 0),
      draft: Number(counts?.draft || 0),
      archived: Number(counts?.archived || 0),
      usage_count: Number(counts?.usage_count || 0),
    },
    departments,
    categories,
    recently_updated: recentlyUpdated,
  };
};

const listAuditLogs = async (db, filters = {}) => {
  const params = [];
  const where = [];
  if (filters.action) {
    where.push('action = ?');
    params.push(trimText(filters.action));
  }
  if (filters.entity) {
    where.push('entity = ?');
    params.push(trimText(filters.entity));
  }
  if (filters.username) {
    where.push('actor_name LIKE ?');
    params.push(`%${trimText(filters.username)}%`);
  }
  const limit = Math.max(1, Math.min(500, Number(filters.limit || 100)));
  const rows = await db.query(
    `SELECT * FROM pc_audit_logs
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );
  return rows.map(normalizeAuditRow);
};

module.exports = {
  normalizeTags,
  parseTags,
  extractPromptVariables,
  normalizePromptPayload,
  listDepartments,
  saveDepartment,
  listCategories,
  saveCategory,
  listPrompts,
  getPromptById,
  createPrompt,
  updatePrompt,
  setPromptStatus,
  rollbackPrompt,
  listVersions,
  recordUsage,
  getOverview,
  listAuditLogs,
  logAudit,
  canPublishPrompt,
};
