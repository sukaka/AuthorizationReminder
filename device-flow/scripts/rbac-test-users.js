const crypto = require('node:crypto');

const normalizeRunId = (value) =>
  String(value || 'local')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'local';

const buildTestPhone = (suffix, index) => {
  const digest = crypto.createHash('sha256').update(`${suffix}:${index}`).digest('hex');
  const subscriber = (BigInt(`0x${digest.slice(0, 16)}`) % 10000000000000000n)
    .toString()
    .padStart(16, '0');
  return `990${index + 1}${subscriber}`;
};

const buildTestUsers = (runId) => {
  const suffix = normalizeRunId(runId);
  return [
    {
      username: `device_flow_rbac_admin_${suffix}`,
      role: 'admin',
      appAccess: ['device-flow'],
      phone: buildTestPhone(suffix, 0),
    },
    {
      username: `device_flow_rbac_auditor_${suffix}`,
      role: 'auditor',
      appAccess: ['audit-center', 'delivery'],
      phone: buildTestPhone(suffix, 1),
    },
    {
      username: `device_flow_rbac_sysadmin_${suffix}`,
      role: 'sysadmin',
      appAccess: ['admin-center'],
      phone: buildTestPhone(suffix, 2),
    },
  ];
};

const buildUpsertStatement = (user, passwordHash) => ({
  sql: `INSERT INTO users
        (username, password_hash, role, app_access, phone, is_active, must_change_password,
         mfa_enabled, mfa_methods, totp_enabled, totp_secret)
        VALUES (?, ?, ?, ?, ?, 1, 0, 0, NULL, 0, NULL)
        ON DUPLICATE KEY UPDATE
          password_hash = VALUES(password_hash),
          role = VALUES(role),
          app_access = VALUES(app_access),
          phone = VALUES(phone),
          is_active = 1,
          must_change_password = 0,
          mfa_enabled = 0,
          mfa_methods = NULL,
          totp_enabled = 0,
          totp_secret = NULL`,
  params: [user.username, passwordHash, user.role, JSON.stringify(user.appAccess), user.phone],
});

const buildCleanupStatements = (users) => {
  const usernames = users.map((item) => item.username);
  const phones = users.map((item) => item.phone);
  const placeholders = usernames.map(() => '?').join(',');
  return [
    {
      sql: `DELETE FROM auth_user_sessions WHERE username IN (${placeholders})`,
      params: usernames,
    },
    {
      sql: `DELETE FROM auth_login_attempts
            WHERE username IN (${placeholders}) OR username IN (${placeholders})`,
      params: [...usernames, ...phones],
    },
    {
      sql: `DELETE FROM auth_mfa_sessions
            WHERE user_id IN (SELECT id FROM users WHERE username IN (${placeholders}))`,
      params: usernames,
    },
    {
      sql: `DELETE FROM auth_totp_pending
            WHERE user_id IN (SELECT id FROM users WHERE username IN (${placeholders}))`,
      params: usernames,
    },
    {
      sql: `DELETE FROM users WHERE username IN (${placeholders})`,
      params: usernames,
    },
  ];
};

const runCli = async () => {
  const mode = String(process.argv[2] || '').trim();
  const runId = process.argv[3];
  const password = process.argv[4];
  if (!['setup', 'cleanup'].includes(mode)) {
    throw new Error('usage: node rbac-test-users.js <setup|cleanup> <run-id> [password]');
  }

  const mysql = require('mysql2/promise');
  const bcrypt = require('bcryptjs');
  const users = buildTestUsers(runId);
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'mysql',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'juxin_reminder',
    connectionLimit: 1,
  });

  try {
    if (mode === 'cleanup') {
      for (const statement of buildCleanupStatements(users)) {
        await pool.execute(statement.sql, statement.params);
      }
      return;
    }
    if (!password || password.length < 24) throw new Error('RBAC test password is missing or too short');
    const hash = await bcrypt.hash(password, 10);
    for (const user of users) {
      const statement = buildUpsertStatement(user, hash);
      await pool.execute(statement.sql, statement.params);
    }
  } finally {
    await pool.end();
  }
};

if (require.main === module || __filename === '[stdin]') {
  runCli().catch((err) => {
    console.error(`[device-flow][rbac-users] ${err?.message || err}`);
    process.exit(1);
  });
}

module.exports = {
  buildCleanupStatements,
  buildTestUsers,
  buildUpsertStatement,
  normalizeRunId,
};
