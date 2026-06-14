const ensureSafeIdentifier = (value, name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value || '')) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
};

const buildBootstrapStatements = ({ database, user, password }) => {
  const safeDbName = ensureSafeIdentifier(database, 'MYSQL_DATABASE');
  const safeUser = ensureSafeIdentifier(user, 'MYSQL_USER');
  const statements = [
    {
      sql: `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      params: [],
    },
  ];

  if (String(password || '') !== '') {
    statements.push({
      sql: `CREATE USER IF NOT EXISTS '${safeUser}'@'%' IDENTIFIED BY ?`,
      params: [String(password)],
    });
    statements.push({
      sql: `ALTER USER '${safeUser}'@'%' IDENTIFIED BY ?`,
      params: [String(password)],
    });
  } else {
    statements.push({
      sql: `CREATE USER IF NOT EXISTS '${safeUser}'@'%'`,
      params: [],
    });
  }

  statements.push({
    sql: `GRANT ALL PRIVILEGES ON \`${safeDbName}\`.* TO '${safeUser}'@'%'`,
    params: [],
  });
  statements.push({ sql: 'FLUSH PRIVILEGES', params: [] });
  return statements;
};

module.exports = {
  buildBootstrapStatements,
  ensureSafeIdentifier,
};
