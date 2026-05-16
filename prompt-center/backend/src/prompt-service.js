const { appError, canPublishPrompt, canWritePrompt } = require('./auth');

const ALLOWED_PROMPT_STATUSES = new Set(['draft', 'published', 'archived']);
const ALLOWED_VISIBILITIES = new Set(['department', 'company']);
const PROMPT_STATUS_LABELS = Object.freeze({
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
});
const PROMPT_VISIBILITY_LABELS = Object.freeze({
  department: '部门可见',
  company: '全公司可见',
});

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

const assertUniqueCategoryName = async (db, departmentId, parentId, name, id = null) => {
  const params = [Number(departmentId)];
  let sql = 'SELECT id FROM pc_categories WHERE department_id = ?';
  if (parentId) {
    sql += ' AND parent_id = ?';
    params.push(Number(parentId));
  } else {
    sql += ' AND parent_id IS NULL';
  }
  sql += ' AND name = ?';
  params.push(name);
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
    department_manager_user_id: row.department_manager_user_id ? Number(row.department_manager_user_id) : null,
    usage_count: Number(row.usage_count || 0),
    current_version_id: row.current_version_id ? Number(row.current_version_id) : null,
    is_favorite: row.is_favorite === true || Number(row.is_favorite || 0) > 0,
    tags: parseTags(row.tags_json),
    variables: extractPromptVariables(row.content),
  };
};

const normalizeDepartmentRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    manager_user_id: row.manager_user_id ? Number(row.manager_user_id) : null,
    prompt_count: Number(row.prompt_count || 0),
  };
};

const normalizeCategoryRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    department_id: Number(row.department_id),
    parent_id: row.parent_id ? Number(row.parent_id) : null,
    level: Number(row.level || 1),
    prompt_count: Number(row.prompt_count || 0),
    direct_prompt_count: Number(row.direct_prompt_count || 0),
  };
};

const isDepartmentManager = (department, user) => (
  Number(department?.manager_user_id || 0) > 0
  && Number(department?.manager_user_id || 0) === Number(user?.id || 0)
);

const assertDepartmentManager = (department, user) => {
  if (!department?.manager_user_id) throw appError(`请先为${department?.name || '该部门'}设置负责人`, 403);
  if (!isDepartmentManager(department, user)) throw appError(`仅${department.name}负责人可维护该部门提示词`, 403);
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
  const row = normalizeCategoryRow(await db.get('SELECT * FROM pc_categories WHERE id = ?', [Number(id)]));
  if (!row) throw appError('分类不存在', 404);
  if (departmentId && Number(row.department_id) !== Number(departmentId)) throw appError('分类不属于所选部门', 400);
  return row;
};

const listManagedDepartmentIds = async (db, user) => {
  if (!user?.id) return [];
  const rows = await db.query(
    'SELECT id FROM pc_departments WHERE manager_user_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC',
    [Number(user.id)]
  );
  return rows.map((row) => Number(row.id)).filter(Boolean);
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

const cleanAuditDetail = (detail) => Object.fromEntries(
  Object.entries(detail).filter(([, value]) => {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  })
);

const promptAuditSnapshot = (source = {}, extra = {}) => {
  const status = trimText(source.status || extra.status);
  const visibility = trimText(source.visibility || extra.visibility);
  const tags = parseTags(source.tags ?? source.tags_json ?? extra.tags);
  return cleanAuditDetail({
    title: trimText(source.title || extra.title),
    department_id: Number(source.department_id || extra.department_id || 0) || null,
    department_name: trimText(source.department_name || extra.department_name),
    category_id: Number(source.category_id || extra.category_id || 0) || null,
    category_name: trimText(source.category_name || extra.category_name),
    status,
    status_label: PROMPT_STATUS_LABELS[status] || '',
    visibility,
    visibility_label: PROMPT_VISIBILITY_LABELS[visibility] || '',
    version_no: Number(source.current_version_no || source.version_no || extra.version_no || 0) || null,
    summary: trimText(source.summary || extra.summary).slice(0, 512),
    tags,
    change_note: trimText(source.change_note || source.changeNote || extra.change_note).slice(0, 512),
  });
};

const listDepartments = async (db, { includeInactive = false } = {}) => {
  const rows = await db.query(
    `SELECT d.*,
      (SELECT COUNT(1) FROM pc_prompts p WHERE p.department_id = d.id AND p.status <> 'archived') AS prompt_count
     FROM pc_departments d
     ${includeInactive ? '' : 'WHERE d.is_active = 1'}
     ORDER BY d.sort_order ASC, d.id ASC`
  );
  return rows.map(normalizeDepartmentRow);
};

const saveDepartment = async (db, payload, user, requestIp, id = null) => {
  const name = trimText(payload.name);
  if (!name || name.length > 128) throw appError('部门名称不能为空且不能超过128个字符', 400);
  const data = {
    name,
    description: trimText(payload.description),
    manager_user_id: Number(payload.manager_user_id || payload.managerUserId || 0) || null,
    manager_name: trimText(payload.manager_name || payload.managerName).slice(0, 128),
    sort_order: Number(payload.sort_order || payload.sortOrder || 0) || 0,
    is_active: payload.is_active === false || payload.isActive === false ? 0 : 1,
  };
  await assertUniqueDepartmentName(db, data.name, id);
  if (id) {
    try {
      await db.run(
        `UPDATE pc_departments
         SET name = ?, description = ?, manager_user_id = ?, manager_name = ?, sort_order = ?, is_active = ?
         WHERE id = ?`,
        [data.name, data.description, data.manager_user_id, data.manager_name, data.sort_order, data.is_active, Number(id)]
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
      `INSERT INTO pc_departments
        (name, description, manager_user_id, manager_name, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.description, data.manager_user_id, data.manager_name, data.sort_order, data.is_active]
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
  const activeCategoryFilter = filters.includeInactive ? '' : 'WHERE is_active = 1';
  const activeChildFilter = filters.includeInactive ? '' : 'AND child.is_active = 1';
  const rows = await db.query(
    `WITH RECURSIVE category_tree AS (
      SELECT id AS root_id, id AS category_id
      FROM pc_categories
      ${activeCategoryFilter}
      UNION ALL
      SELECT parent.root_id, child.id AS category_id
      FROM pc_categories child
      INNER JOIN category_tree parent ON child.parent_id = parent.category_id
      ${activeChildFilter}
    )
     SELECT c.*, d.name AS department_name, parent.name AS parent_name,
      (SELECT COUNT(1)
       FROM pc_prompts p
       INNER JOIN category_tree ct ON ct.category_id = p.category_id
       WHERE ct.root_id = c.id AND p.status <> 'archived') AS prompt_count,
      (SELECT COUNT(1)
       FROM pc_prompts p
       WHERE p.category_id = c.id AND p.status <> 'archived') AS direct_prompt_count
     FROM pc_categories c
     LEFT JOIN pc_departments d ON d.id = c.department_id
     LEFT JOIN pc_categories parent ON parent.id = c.parent_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.sort_order ASC, c.sort_order ASC, c.id ASC`,
    params
  );
  return rows.map(normalizeCategoryRow);
};

const saveCategory = async (db, payload, user, requestIp, id = null) => {
  const departmentId = Number(payload.department_id || payload.departmentId || 0);
  const parentId = Number(payload.parent_id || payload.parentId || 0) || null;
  const name = trimText(payload.name);
  if (!departmentId) throw appError('请选择所属部门', 400);
  if (!name || name.length > 128) throw appError('分类名称不能为空且不能超过128个字符', 400);
  const department = await ensureDepartment(db, departmentId);
  let parent = null;
  if (parentId) {
    parent = await ensureCategory(db, parentId, departmentId);
    if (Number(parent.level || 1) >= 3) throw appError('提示词分类最多支持三级', 400);
    if (id && Number(parent.id) === Number(id)) throw appError('上级分类不能选择自己', 400);
  }
  const data = {
    department_id: departmentId,
    department_name: department.name,
    parent_id: parentId,
    parent_name: parent?.name || '',
    level: parent ? Number(parent.level || 1) + 1 : 1,
    name,
    description: trimText(payload.description),
    sort_order: Number(payload.sort_order || payload.sortOrder || 0) || 0,
    is_active: payload.is_active === false || payload.isActive === false ? 0 : 1,
  };
  await assertUniqueCategoryName(db, data.department_id, data.parent_id, data.name, id);
  if (id) {
    try {
      await db.run(
        'UPDATE pc_categories SET department_id = ?, parent_id = ?, level = ?, name = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
        [data.department_id, data.parent_id, data.level, data.name, data.description, data.sort_order, data.is_active, Number(id)]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) throw appError(`分类“${data.name}”在该部门下已存在`, 409);
      throw err;
    }
    await logAudit(db, { user, action: 'category.update', entity: 'category', entityId: id, detail: data, requestIp });
    return normalizeCategoryRow(await db.get('SELECT * FROM pc_categories WHERE id = ?', [Number(id)]));
  }
  let result;
  try {
    result = await db.run(
      'INSERT INTO pc_categories (department_id, parent_id, level, name, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.department_id, data.parent_id, data.level, data.name, data.description, data.sort_order, data.is_active]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) throw appError(`分类“${data.name}”在该部门下已存在`, 409);
    throw err;
  }
  await logAudit(db, { user, action: 'category.create', entity: 'category', entityId: result.insertId, detail: data, requestIp });
  return normalizeCategoryRow(await db.get('SELECT * FROM pc_categories WHERE id = ?', [result.insertId]));
};

const buildPromptWhere = (filters = {}, req = null) => {
  const where = [];
  const params = [];
  let categoryCte = '';
  const status = trimText(filters.status);
  if (status) {
    if (!ALLOWED_PROMPT_STATUSES.has(status)) throw appError('状态参数无效', 400);
    where.push('p.status = ?');
    params.push(status);
  }
  if (filters.department_id) {
    where.push('p.department_id = ?');
    params.push(Number(filters.department_id));
  }
  if (filters.category_id) {
    categoryCte = `WITH RECURSIVE category_tree AS (
      SELECT id FROM pc_categories WHERE id = ?
      UNION ALL
      SELECT child.id FROM pc_categories child
      INNER JOIN category_tree parent ON child.parent_id = parent.id
    )`;
    params.push(Number(filters.category_id));
    where.push('p.category_id IN (SELECT id FROM category_tree)');
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
  if (!canWritePrompt(req || {})) {
    if (req?.user?.id) {
      where.push(
        `(p.status = 'published'
          OR p.department_id IN (SELECT id FROM pc_departments WHERE manager_user_id = ?))`
      );
      params.push(Number(req.user.id));
    } else {
      where.push("p.status = 'published'");
    }
  }
  return { where, params, categoryCte };
};

const listPrompts = async (db, filters, req) => {
  const { where, params, categoryCte } = buildPromptWhere(filters, req);
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 60)));
  const offset = Math.max(0, Number(filters.offset || 0));
  const favoriteUserId = Number(req?.user?.id || 0);
  const favoriteSelect = favoriteUserId
    ? `EXISTS(SELECT 1 FROM pc_prompt_favorites f WHERE f.prompt_id = p.id AND f.user_id = ${favoriteUserId}) AS is_favorite,`
    : '0 AS is_favorite,';
  const rows = await db.query(
    `${categoryCte ? `${categoryCte}\n` : ''}SELECT p.*, ${favoriteSelect} d.name AS department_name, d.manager_user_id AS department_manager_user_id,
       d.manager_name AS department_manager_name, c.name AS category_name, v.version_no AS current_version_no
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
    `SELECT p.*, d.name AS department_name, d.manager_user_id AS department_manager_user_id,
       d.manager_name AS department_manager_name, c.name AS category_name, v.version_no AS current_version_no
     FROM pc_prompts p
     LEFT JOIN pc_departments d ON d.id = p.department_id
     LEFT JOIN pc_categories c ON c.id = p.category_id
     LEFT JOIN pc_prompt_versions v ON v.id = p.current_version_id
     WHERE p.id = ?`,
    [Number(id)]
  ));
  if (!prompt) throw appError('提示词不存在', 404);
  if (
    !canWritePrompt(req || {})
    && !isDepartmentManager({ manager_user_id: prompt.department_manager_user_id }, req?.user)
    && prompt.status !== 'published'
  ) {
    throw appError('无权限访问未发布提示词', 403);
  }
  return prompt;
};

const createPrompt = async (db, payload, user, requestIp) => {
  const data = normalizePromptPayload(payload);
  const department = await ensureDepartment(db, data.department_id);
  assertDepartmentManager(department, user);
  const category = await ensureCategory(db, data.category_id, data.department_id);
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
    detail: promptAuditSnapshot(data, {
      department_name: department.name,
      category_name: category.name,
      status: 'draft',
      version_no: result.version.version_no,
    }),
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
  const existingDepartment = await ensureDepartment(db, existing.department_id);
  assertDepartmentManager(existingDepartment, user);
  const department = Number(data.department_id) === Number(existing.department_id)
    ? existingDepartment
    : await ensureDepartment(db, data.department_id);
  assertDepartmentManager(department, user);
  const category = await ensureCategory(db, data.category_id, data.department_id);
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
    detail: {
      ...promptAuditSnapshot(data, {
        department_name: department.name,
        category_name: category.name,
        status: existing.status,
        version_no: version.version_no,
      }),
      before: promptAuditSnapshot(existing),
      after: promptAuditSnapshot(data, {
        department_name: department.name,
        category_name: category.name,
        status: existing.status,
        version_no: version.version_no,
      }),
    },
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
    detail: {
      ...promptAuditSnapshot({ ...prompt, status }),
      before: promptAuditSnapshot(prompt),
      after: promptAuditSnapshot({ ...prompt, status }),
    },
    requestIp,
  });
  return getPromptById(db, id, { user: { role: 'admin' } });
};

const rollbackPrompt = async (db, id, versionId, user, requestIp) => {
  const prompt = await getPromptById(db, id, { user: { role: 'admin' } });
  const department = await ensureDepartment(db, prompt.department_id);
  assertDepartmentManager(department, user);
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
    detail: {
      ...promptAuditSnapshot({
        ...prompt,
        title: version.title,
        summary: version.summary,
        tags_json: version.tags_json,
        current_version_no: version.version_no,
        version_no: version.version_no,
      }),
      before: promptAuditSnapshot(prompt),
      after: promptAuditSnapshot({
        ...prompt,
        title: version.title,
        summary: version.summary,
        tags_json: version.tags_json,
        current_version_no: version.version_no,
      }),
    },
    requestIp,
  });
  return getPromptById(db, id, { user: { role: 'admin' } });
};

const listVersions = async (db, id, req = null) => {
  const prompt = await getPromptById(db, id, { user: { role: 'admin' } });
  const department = await ensureDepartment(db, prompt.department_id);
  if (!canWritePrompt(req || {}) && !isDepartmentManager(department, req?.user)) {
    throw appError('仅部门负责人可查看版本记录', 403);
  }
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
    detail: promptAuditSnapshot(prompt),
    requestIp,
  });
  return { ok: true };
};

const addFavorite = async (db, id, user, requestIp) => {
  if (!user?.id) throw appError('请先登录后再收藏提示词', 401);
  await db.run(
    'INSERT IGNORE INTO pc_prompt_favorites (user_id, prompt_id) VALUES (?, ?)',
    [Number(user.id), Number(id)]
  );
  await logAudit(db, {
    user,
    action: 'prompt.favorite',
    entity: 'prompt',
    entityId: id,
    detail: { prompt_id: Number(id), result: '收藏' },
    requestIp,
  });
  return { ok: true, is_favorite: true };
};

const removeFavorite = async (db, id, user, requestIp) => {
  if (!user?.id) throw appError('请先登录后再取消收藏', 401);
  await db.run(
    'DELETE FROM pc_prompt_favorites WHERE user_id = ? AND prompt_id = ?',
    [Number(user.id), Number(id)]
  );
  await logAudit(db, {
    user,
    action: 'prompt.unfavorite',
    entity: 'prompt',
    entityId: id,
    detail: { prompt_id: Number(id), result: '取消收藏' },
    requestIp,
  });
  return { ok: true, is_favorite: false };
};

const listFavoritePrompts = async (db, req) => {
  if (!req?.user?.id) throw appError('请先登录后查看收藏', 401);
  const favoriteUserId = Number(req.user.id);
  const rows = await db.query(
    `SELECT p.*, 1 AS is_favorite, d.name AS department_name, d.manager_user_id AS department_manager_user_id,
       d.manager_name AS department_manager_name, c.name AS category_name, v.version_no AS current_version_no,
       f.created_at AS favorite_at
     FROM pc_prompt_favorites f
     INNER JOIN pc_prompts p ON p.id = f.prompt_id
     LEFT JOIN pc_departments d ON d.id = p.department_id
     LEFT JOIN pc_categories c ON c.id = p.category_id
     LEFT JOIN pc_prompt_versions v ON v.id = p.current_version_id
     WHERE f.user_id = ? AND p.status <> 'archived'
     ORDER BY f.created_at DESC, p.updated_at DESC`,
    [favoriteUserId]
  );
  return rows.map(normalizePromptRow);
};

const archivePrompt = async (db, id, user, requestIp) => setPromptStatus(db, id, 'archived', user, requestIp);

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
  listManagedDepartmentIds,
  listCategories,
  saveCategory,
  listPrompts,
  getPromptById,
  createPrompt,
  updatePrompt,
  setPromptStatus,
  archivePrompt,
  rollbackPrompt,
  listVersions,
  recordUsage,
  addFavorite,
  removeFavorite,
  listFavoritePrompts,
  getOverview,
  listAuditLogs,
  logAudit,
  canPublishPrompt,
};
