const ensureSafeIdentifier = (value, name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value || '')) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
};

const buildBootstrapStatements = ({ database, user, password }) => {
  const safeDatabase = ensureSafeIdentifier(database, 'MYSQL_DATABASE');
  const safeUser = ensureSafeIdentifier(user, 'MYSQL_USER');
  return [
    {
      sql: `CREATE DATABASE IF NOT EXISTS \`${safeDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    },
    {
      sql: `CREATE USER IF NOT EXISTS '${safeUser}'@'%' IDENTIFIED BY ?`,
      params: [password],
    },
    {
      sql: `ALTER USER '${safeUser}'@'%' IDENTIFIED BY ?`,
      params: [password],
    },
    {
      sql: `GRANT ALL PRIVILEGES ON \`${safeDatabase}\`.* TO '${safeUser}'@'%'`,
    },
    {
      sql: 'FLUSH PRIVILEGES',
    },
  ];
};

module.exports = {
  buildBootstrapStatements,
};
