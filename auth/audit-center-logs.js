const clampLimit = (value, fallback, min, max) => {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(min, Math.round(limit)));
};

const AUDIT_EXPORT_COLUMNS = Object.freeze([
  'id',
  'system',
  'username',
  'action',
  'entity',
  'entity_id',
  'request_ip',
  'created_at',
  'prev_hash',
  'signature',
  'before_data',
  'after_data',
]);

const encodeCsvCell = (value) => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${String(text).replaceAll('"', '""')}"`;
};

const serializeLogsAsCsv = (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const lines = [AUDIT_EXPORT_COLUMNS.join(',')];
  list.forEach((row) => {
    lines.push(
      AUDIT_EXPORT_COLUMNS
        .map((key) => encodeCsvCell(row?.[key]))
        .join(',')
    );
  });
  return lines.join('\n');
};

const createAuditCenterLogsService = ({
  db,
  computeAuditSignature,
} = {}) => {
  if (!db || typeof db !== 'object') throw new Error('db adapter is required');
  if (typeof computeAuditSignature !== 'function') throw new Error('computeAuditSignature is required');

  return {
    async listLogs({ query = {} } = {}) {
      if (typeof db.query !== 'function') throw new Error('db adapter is missing method(s): query');
      const { username, system, action, entity, date_from, date_to, limit } = query || {};
      const where = [];
      const params = [];
      if (system) {
        where.push('log_system = ?');
        params.push(String(system).trim());
      }
      if (username) {
        where.push('username LIKE ?');
        params.push(`%${username}%`);
      }
      if (action) {
        where.push('action = ?');
        params.push(action);
      }
      if (entity) {
        where.push('entity = ?');
        params.push(entity);
      }
      if (date_from) {
        where.push('created_at >= ?');
        params.push(date_from);
      }
      if (date_to) {
        where.push('created_at <= ?');
        params.push(date_to);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const take = clampLimit(limit, 300, 1, 2000);
      return db.query(
        `SELECT
           id, user_id, username, log_system AS \`system\`, action, entity, entity_id,
           before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
         FROM operation_logs
         ${whereSql}
         ORDER BY id DESC
         LIMIT ?`,
        [...params, take]
      );
    },

    async verifyLogChain({ limitInput } = {}) {
      if (typeof db.query !== 'function') throw new Error('db adapter is missing method(s): query');
      const limit = clampLimit(limitInput, 10000, 1, 50000);
      const rows = await db.query(
        `SELECT id, user_id, username, action, entity, entity_id, before_data, after_data, prev_hash, signature, created_at
         FROM operation_logs
         ORDER BY id ASC
         LIMIT ?`,
        [limit]
      );
      let previousSignature = null;
      let checked = 0;
      for (const row of rows) {
        checked += 1;
        if ((row.prev_hash || null) !== (previousSignature || null)) {
          return {
            ok: false,
            checked,
            failed_id: row.id,
            reason: '链路断裂：prev_hash与前一条签名不一致',
          };
        }
        const expected = computeAuditSignature({
          id: row.id,
          prevHash: row.prev_hash,
          userId: row.user_id,
          username: row.username,
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          beforeData: row.before_data,
          afterData: row.after_data,
          createdAt: row.created_at,
        });
        if (expected !== row.signature) {
          return {
            ok: false,
            checked,
            failed_id: row.id,
            reason: '签名不一致：疑似日志被篡改',
          };
        }
        previousSignature = row.signature;
      }
      return {
        ok: true,
        checked,
        latest_id: rows[rows.length - 1]?.id || 0,
        reason: '',
      };
    },
  };
};

module.exports = {
  AUDIT_EXPORT_COLUMNS,
  createAuditCenterLogsService,
  serializeLogsAsCsv,
};
