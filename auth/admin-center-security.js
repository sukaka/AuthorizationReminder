const parseConfigRows = (rows = []) =>
  rows.reduce((acc, row) => {
    try {
      acc[row.key] = JSON.parse(row.value);
    } catch (_err) {
      acc[row.key] = {};
    }
    return acc;
  }, {});

const createAdminCenterSecurityService = ({
  db,
  logOperation = async () => {},
} = {}) => {
  if (!db || typeof db !== 'object') throw new Error('db adapter is required');

  return {
    async getSecurity() {
      if (typeof db.query !== 'function') throw new Error('db adapter is missing method(s): query');
      const rows = await db.query('SELECT `key`, value FROM send_configs');
      const configs = parseConfigRows(rows);
      return configs.security || {};
    },

    async saveSecurity({ actor, payload }) {
      if (typeof db.query !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('db adapter is missing method(s): query, transaction');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const error = new Error('安全配置格式不正确');
        error.statusCode = 400;
        throw error;
      }
      const rows = await db.query('SELECT `key`, value FROM send_configs');
      const existing = parseConfigRows(rows);
      const nextConfigs = { ...existing, security: payload };
      await db.transaction(async (trx) => {
        for (const [key, value] of Object.entries(nextConfigs)) {
          await trx.run(
            'INSERT INTO send_configs (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
            [key, JSON.stringify(value || {})]
          );
        }
      });
      await logOperation({
        user: actor,
        action: 'UPDATE',
        entity: 'send_configs',
        entityId: 0,
        beforeData: existing,
        afterData: { security: payload },
      });
      return { ok: true };
    },
  };
};

module.exports = {
  createAdminCenterSecurityService,
};
