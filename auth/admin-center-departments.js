const { normalizeDepartmentCode } = require('./admin-center-users');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertDbMethods = (db, methods = []) => {
  const missing = methods.filter((method) => typeof db?.[method] !== 'function');
  if (missing.length) {
    throw new Error(`db adapter is missing method(s): ${missing.join(', ')}`);
  }
};

const normalizeDepartmentName = (name) => {
  const value = String(name || '').trim();
  if (!value) throw createHttpError(400, '部门名称不能为空');
  if (value.length > 64) throw createHttpError(400, '部门名称不能超过64个字符');
  return value;
};

const toSortOrder = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num);
};

const groupDepartments = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const code = normalizeDepartmentCode(row.code);
    if (!code) return;
    if (!map.has(code)) {
      map.set(code, {
        code,
        name: String(row.name || ''),
        sort_order: toSortOrder(row.sort_order, 0),
        is_active: Number(row.is_active) === 1 ? 1 : 0,
        admins: [],
      });
    }
    const item = map.get(code);
    const adminUserId = Number(row.admin_user_id || 0);
    if (adminUserId > 0) {
      item.admins.push({
        user_id: adminUserId,
        username: String(row.admin_username || ''),
      });
    }
  });
  return Array.from(map.values()).sort((left, right) => {
    const sortDiff = Number(left.sort_order || 0) - Number(right.sort_order || 0);
    if (sortDiff !== 0) return sortDiff;
    return String(left.code || '').localeCompare(String(right.code || ''));
  });
};

const listDepartmentsWithAdapter = async (adapter) => {
  const rows = await adapter.query(
    `SELECT
       d.code,
       d.name,
       d.sort_order,
       d.is_active,
       u.id AS admin_user_id,
       u.username AS admin_username
     FROM departments d
     LEFT JOIN department_doc_admins dda
       ON dda.department_code = d.code
      AND dda.can_manage_docs = 1
     LEFT JOIN users u
       ON u.id = dda.user_id
     ORDER BY d.sort_order ASC, d.code ASC, u.id ASC`
  );
  return groupDepartments(rows);
};

const createAdminCenterDepartmentsService = ({ db } = {}) => {
  if (!db || typeof db !== 'object') throw new Error('db adapter is required');

  return {
    async listDepartments() {
      assertDbMethods(db, ['query']);
      return listDepartmentsWithAdapter(db);
    },

    async saveDepartment({ code, payload } = {}) {
      assertDbMethods(db, ['get', 'transaction']);
      const departmentCode = normalizeDepartmentCode(code);
      if (!departmentCode) throw createHttpError(400, '部门编码不能为空');
      const name = normalizeDepartmentName(payload?.name);
      const sortOrder = toSortOrder(payload?.sort_order, 0);
      const isActive = payload?.is_active === 0 || payload?.is_active === false ? 0 : 1;
      const adminUserIds = Array.from(
        new Set(
          (Array.isArray(payload?.admin_user_ids) ? payload.admin_user_ids : [])
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0)
        )
      );

      for (const userId of adminUserIds) {
        const user = await db.get('SELECT id, username, role, department_code FROM users WHERE id = ?', [userId]);
        if (!user) throw createHttpError(400, `指定的部门管理员不存在（ID: ${userId}）`);
      }

      return db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO departments (code, name, sort_order, is_active)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             sort_order = VALUES(sort_order),
             is_active = VALUES(is_active)`,
          [departmentCode, name, sortOrder, isActive]
        );

        await tx.run('DELETE FROM department_doc_admins WHERE department_code = ?', [departmentCode]);
        for (const userId of adminUserIds) {
          await tx.run(
            `INSERT INTO department_doc_admins (department_code, user_id, can_manage_docs)
             VALUES (?, ?, 1)`,
            [departmentCode, userId]
          );
        }
        const rows = await listDepartmentsWithAdapter(tx);
        const department = rows.find((item) => item.code === departmentCode);
        if (!department) throw createHttpError(500, '部门保存后读取失败');
        return department;
      });
    },
  };
};

module.exports = {
  createAdminCenterDepartmentsService,
  groupDepartments,
  normalizeDepartmentName,
};
