const {
  BUSINESS_SYSTEM_ACCESS_KEYS,
  defaultAppAccessByRole,
} = require('./portal-routing');

const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
});

const ALLOWED_USER_ROLES = new Set(['admin', 'editor', 'reviewer', 'sysadmin', 'auditor', 'user', 'viewer', 'sales']);

const buildInClause = (values = []) => values.map(() => '?').join(',');

const normalizeUserRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'viewer') return 'user';
  return normalizedRole;
};

const parseAppAccessRaw = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (_err) {
    // fall back to comma-separated values
  }
  return text.split(',').map((item) => item.trim());
};

const normalizeAppAccess = (value, role = 'user') => {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === 'admin' || normalizedRole === 'sysadmin' || normalizedRole === 'auditor') {
    return defaultAppAccessByRole(normalizedRole);
  }
  const parsed = parseAppAccessRaw(value);
  const source = parsed === null ? defaultAppAccessByRole(normalizedRole) : parsed;
  return Array.from(
    new Set(source.map((item) => String(item || '').trim()).filter((item) => BUSINESS_SYSTEM_ACCESS_KEYS.includes(item)))
  );
};

const formatUserRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    role: normalizeUserRole(row.role),
    app_access: normalizeAppAccess(row.app_access, row.role),
    department_code: normalizeDepartmentCode(row.department_code),
  };
};

const resolveUserLoginId = (user, builtinAccountUsernames = new Set()) => {
  const username = String(user?.username || '').trim().toLowerCase();
  if (builtinAccountUsernames.has(username)) return username;
  const phone = String(user?.phone || '').trim();
  if (/^\d{6,20}$/.test(phone)) return phone;
  return '';
};

const isLocked = ({ lockedUntilIso }) => {
  if (!lockedUntilIso) return false;
  const until = new Date(lockedUntilIso).getTime();
  return Number.isFinite(until) && until > Date.now();
};

const validatePasswordComplexity = (password, policyInput = DEFAULT_PASSWORD_POLICY) => {
  const value = String(password || '');
  const policy = {
    ...DEFAULT_PASSWORD_POLICY,
    ...(policyInput && typeof policyInput === 'object' ? policyInput : {}),
  };
  if (value.length < policy.minLength) return `密码至少${policy.minLength}位`;
  if (policy.requireUppercase && !/[A-Z]/.test(value)) return '密码需包含至少1个大写字母';
  if (policy.requireLowercase && !/[a-z]/.test(value)) return '密码需包含至少1个小写字母';
  if (policy.requireNumber && !/\d/.test(value)) return '密码需包含至少1个数字';
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(value)) return '密码需包含至少1个特殊字符';
  return '';
};

const validateUsernameFormat = (username) => {
  const value = String(username || '').trim();
  if (!value) return '用户名不能为空';
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(value)) {
    return '用户名仅支持2-32位中文、字母、数字、下划线或中划线';
  }
  return '';
};

const validateEmailFormat = (email) => {
  const value = String(email || '').trim();
  if (!value) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
  return '';
};

const validatePhoneFormat = (phone) => {
  const value = String(phone || '').trim();
  if (!value) return '';
  if (!/^\d{6,20}$/.test(value)) return '手机号格式不正确（6-20位数字）';
  return '';
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeDepartmentCode = (departmentCode) => {
  const value = String(departmentCode || '').trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z0-9_-]{1,32}$/.test(value)) {
    throw createHttpError(400, '部门编码格式不正确');
  }
  return value;
};

const assertDbMethods = (db, methods = []) => {
  const missing = methods.filter((method) => typeof db?.[method] !== 'function');
  if (missing.length) {
    throw new Error(`db adapter is missing method(s): ${missing.join(', ')}`);
  }
};

const createAdminCenterUsersService = ({
  db,
  hashPassword = async (value) => value,
  getSecurityConfig = async () => ({}),
  logOperation = async () => {},
  builtinAccountUsernames = new Set(),
} = {}) => {
  if (!db || typeof db !== 'object') throw new Error('db adapter is required');

  return {
    async listUsers() {
      assertDbMethods(db, ['query']);
      const rows = await db.query(
        'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, department_code, totp_enabled, created_at FROM users ORDER BY id DESC'
      );
      const users = rows.map(formatUserRow);
      const loginIds = Array.from(new Set(users.map((item) => resolveUserLoginId(item, builtinAccountUsernames)).filter(Boolean)));
      const lockMap = new Map();
      if (loginIds.length) {
        const lockRows = await db.query(
          `SELECT username, MAX(locked_until) AS locked_until,
                  SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN 1 ELSE 0 END) AS locked_ip_count
           FROM auth_login_attempts
           WHERE username IN (${buildInClause(loginIds)})
           GROUP BY username`,
          loginIds
        );
        lockRows.forEach((row) => {
          lockMap.set(String(row.username || ''), {
            locked_until: row.locked_until || null,
            locked_ip_count: Number(row.locked_ip_count || 0),
          });
        });
      }
      return users.map((item) => {
        const loginId = resolveUserLoginId(item, builtinAccountUsernames);
        const lockInfo = loginId ? lockMap.get(loginId) : null;
        const locked = !!(
          loginId &&
          lockInfo &&
          Number(lockInfo.locked_ip_count || 0) > 0 &&
          isLocked({ lockedUntilIso: lockInfo.locked_until })
        );
        return {
          ...item,
          login_id: loginId || null,
          lock_status: locked ? 'locked' : 'normal',
          locked_until: locked ? lockInfo.locked_until : null,
          locked_ip_count: locked ? Number(lockInfo.locked_ip_count || 0) : 0,
        };
      });
    },

    async createUser({ actor, payload }) {
      assertDbMethods(db, ['run', 'get']);
      const { username, password, role, is_active, email, phone, wecom_id, app_access, department_code } = payload || {};
      if (!username || !password) throw createHttpError(400, '请输入账号和密码');

      const usernameRuleError = validateUsernameFormat(username);
      if (usernameRuleError) throw createHttpError(400, usernameRuleError);

      const security = await getSecurityConfig();
      const passwordRuleError = validatePasswordComplexity(password, security?.passwordPolicy);
      if (passwordRuleError) throw createHttpError(400, passwordRuleError);

      const emailRuleError = validateEmailFormat(email);
      if (emailRuleError) throw createHttpError(400, emailRuleError);

      const phoneRuleError = validatePhoneFormat(phone);
      if (phoneRuleError) throw createHttpError(400, phoneRuleError);

      const nextRole = normalizeUserRole(role || 'user');
      if (!ALLOWED_USER_ROLES.has(nextRole)) throw createHttpError(400, '角色不合法');
      const nextDepartmentCode = normalizeDepartmentCode(department_code);

      const nextAccess = normalizeAppAccess(app_access, nextRole);
      if (!nextAccess.length) throw createHttpError(400, '请至少选择一个可访问系统');

      const hash = await hashPassword(password);
      const nextActive = is_active === undefined ? 1 : (Number(is_active) === 1 ? 1 : 0);
      let info;
      try {
        info = await db.run(
          'INSERT INTO users (username, password_hash, role, is_active, email, phone, wecom_id, app_access, department_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [String(username).trim(), hash, nextRole, nextActive, email || null, phone || null, wecom_id || null, JSON.stringify(nextAccess), nextDepartmentCode]
        );
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') throw createHttpError(400, '用户名已存在');
        throw createHttpError(400, err?.sqlMessage || '账号已存在或数据错误');
      }

      const row = formatUserRow(await db.get(
        'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, department_code, totp_enabled, created_at FROM users WHERE id = ?',
        [info.insertId]
      ));
      await logOperation({
        user: actor,
        action: 'CREATE',
        entity: 'user',
        entityId: row.id,
        afterData: row,
      });
      return row;
    },

    async updateUser({ actor, targetId, payload }) {
      assertDbMethods(db, ['get', 'run']);
      const { password, role, is_active, email, phone, wecom_id, app_access, department_code } = payload || {};
      if (
        !password &&
        !role &&
        is_active === undefined &&
        email === undefined &&
        phone === undefined &&
        wecom_id === undefined &&
        app_access === undefined &&
        department_code === undefined
      ) {
        throw createHttpError(400, '没有可更新字段');
      }
      if (email !== undefined) {
        const emailRuleError = validateEmailFormat(email);
        if (emailRuleError) throw createHttpError(400, emailRuleError);
      }
      if (phone !== undefined) {
        const phoneRuleError = validatePhoneFormat(phone);
        if (phoneRuleError) throw createHttpError(400, phoneRuleError);
      }
      const before = formatUserRow(await db.get(
        'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, department_code, totp_enabled, created_at FROM users WHERE id = ?',
        [targetId]
      ));
      if (!before) throw createHttpError(404, '用户不存在');

      if (password) {
        const security = await getSecurityConfig();
        const passwordRuleError = validatePasswordComplexity(password, security?.passwordPolicy);
        if (passwordRuleError) throw createHttpError(400, passwordRuleError);
        const hash = await hashPassword(password);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, targetId]);
      }

      const nextRole = role !== undefined ? normalizeUserRole(role) : normalizeUserRole(before.role);
      if (!ALLOWED_USER_ROLES.has(nextRole)) throw createHttpError(400, '角色不合法');

      if (role !== undefined) {
        if (builtinAccountUsernames.has(String(before.username || '').toLowerCase()) && nextRole !== before.role) {
          throw createHttpError(400, '内置账号角色不可修改');
        }
        await db.run('UPDATE users SET role = ? WHERE id = ?', [nextRole, targetId]);
      }
      if (email !== undefined) {
        await db.run('UPDATE users SET email = ? WHERE id = ?', [email || null, targetId]);
      }
      if (phone !== undefined) {
        await db.run('UPDATE users SET phone = ? WHERE id = ?', [phone || null, targetId]);
      }
      if (wecom_id !== undefined) {
        await db.run('UPDATE users SET wecom_id = ? WHERE id = ?', [wecom_id || null, targetId]);
      }
      if (department_code !== undefined) {
        await db.run('UPDATE users SET department_code = ? WHERE id = ?', [normalizeDepartmentCode(department_code), targetId]);
      }
      if (is_active !== undefined) {
        const nextActive = Number(is_active) === 1 ? 1 : 0;
        if (builtinAccountUsernames.has(String(before.username || '').toLowerCase()) && nextActive !== 1) {
          throw createHttpError(400, '内置账号不可禁用');
        }
        if (String(targetId) === String(actor?.id) && nextActive !== 1) {
          throw createHttpError(400, '不能禁用自己');
        }
        await db.run('UPDATE users SET is_active = ? WHERE id = ?', [nextActive, targetId]);
      }
      if (role !== undefined || app_access !== undefined) {
        if (builtinAccountUsernames.has(String(before.username || '').toLowerCase()) && app_access !== undefined) {
          throw createHttpError(400, '内置账号系统权限不可修改');
        }
        const nextAccess = normalizeAppAccess(app_access !== undefined ? app_access : before.app_access, nextRole);
        if (!nextAccess.length) throw createHttpError(400, '请至少选择一个可访问系统');
        await db.run('UPDATE users SET app_access = ? WHERE id = ?', [JSON.stringify(nextAccess), targetId]);
      }
      const row = formatUserRow(await db.get(
        'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, department_code, totp_enabled, created_at FROM users WHERE id = ?',
        [targetId]
      ));
      let actionType = 'UPDATE';
      if (Number(before.is_active) !== Number(row.is_active)) {
        actionType = Number(row.is_active) === 1 ? 'ENABLE_USER' : 'DISABLE_USER';
      }
      await logOperation({
        user: actor,
        action: actionType,
        entity: 'user',
        entityId: Number(targetId),
        beforeData: before,
        afterData: row,
      });
      return row;
    },

    async unlockUser({ actor, targetId }) {
      assertDbMethods(db, ['get', 'query', 'run']);
      const targetUser = await db.get('SELECT id, username, phone FROM users WHERE id = ?', [targetId]);
      if (!targetUser) throw createHttpError(404, '用户不存在');
      const loginId = resolveUserLoginId(targetUser, builtinAccountUsernames);
      if (!loginId) throw createHttpError(400, '该用户未配置可用登录标识，无法解锁');
      const beforeLocks = await db.query(
        'SELECT username, ip, fail_count, first_fail_at, locked_until, updated_at FROM auth_login_attempts WHERE username = ?',
        [loginId]
      );
      await db.run('DELETE FROM auth_login_attempts WHERE username = ?', [loginId]);
      await logOperation({
        user: actor,
        action: 'UNLOCK_USER',
        entity: 'user',
        entityId: Number(targetId),
        beforeData: {
          username: targetUser.username,
          login_id: loginId,
          lock_records: beforeLocks,
        },
        afterData: {
          username: targetUser.username,
          login_id: loginId,
          unlocked_count: beforeLocks.length,
        },
      });
      return { ok: true, unlocked_count: beforeLocks.length };
    },

    async deleteUser({ actor, targetId }) {
      assertDbMethods(db, ['get', 'run']);
      if (String(targetId) === String(actor?.id)) throw createHttpError(400, '不能删除自己');
      const before = formatUserRow(await db.get(
        'SELECT id, username, role, is_active, email, phone, wecom_id, app_access, totp_enabled, created_at FROM users WHERE id = ?',
        [targetId]
      ));
      if (!before) throw createHttpError(404, '用户不存在');
      if (builtinAccountUsernames.has(String(before.username || '').toLowerCase())) {
        throw createHttpError(400, '内置账号不可删除');
      }
      await db.run('DELETE FROM users WHERE id = ?', [targetId]);
      await logOperation({
        user: actor,
        action: 'DELETE',
        entity: 'user',
        entityId: Number(targetId),
        beforeData: before,
      });
      return { ok: true };
    },

    async resetPassword({ actor, targetId, newPassword }) {
      assertDbMethods(db, ['get', 'run']);
      if (!newPassword) throw createHttpError(400, '请输入新密码');
      const targetUser = await db.get('SELECT id, username FROM users WHERE id = ?', [targetId]);
      if (!targetUser) throw createHttpError(404, '用户不存在');
      const security = await getSecurityConfig();
      const passwordRuleError = validatePasswordComplexity(newPassword, security?.passwordPolicy);
      if (passwordRuleError) throw createHttpError(400, passwordRuleError);
      const hash = await hashPassword(newPassword);
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, targetId]);
      await logOperation({
        user: actor,
        action: 'RESET_PASSWORD',
        entity: 'user',
        entityId: Number(targetId),
        afterData: { username: targetUser.username },
      });
      return { ok: true };
    },
  };
};

module.exports = {
  ALLOWED_USER_ROLES,
  createAdminCenterUsersService,
  formatUserRow,
  normalizeAppAccess,
  normalizeDepartmentCode,
  normalizeUserRole,
  resolveUserLoginId,
  validateEmailFormat,
  validatePasswordComplexity,
  validatePhoneFormat,
  validateUsernameFormat,
};
