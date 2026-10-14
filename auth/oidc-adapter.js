const crypto = require('node:crypto');

function createOidcAdapter(db, key) {
  const encrypt = (payload, model, id) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([model, id])));
    const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };
  const decrypt = (value, model, id) => {
    const data = Buffer.from(value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([model, id])));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
  };
  return class OidcAdapter {
    constructor(name) { this.name = name; }
    async upsert(id, payload, expiresIn) {
      await db.run(`INSERT INTO auth_oidc_artifacts
        (model, id, payload, expires_at, grant_id, user_code, uid, consumed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE payload=VALUES(payload), expires_at=VALUES(expires_at),
        grant_id=VALUES(grant_id), user_code=VALUES(user_code), uid=VALUES(uid)`,
      [this.name, id, encrypt(payload, this.name, id), Math.floor(Date.now() / 1000) + expiresIn,
        payload.grantId || null, payload.userCode || null, payload.uid || null, payload.consumed || null]);
    }
    async lookup(column, value) {
      // column is an internal constant, never supplied by an HTTP request.
      const row = await db.get(`SELECT id, payload, consumed FROM auth_oidc_artifacts WHERE model=? AND ${column}=? AND expires_at>? LIMIT 1`, [this.name, value, Math.floor(Date.now() / 1000)]);
      if (!row) return undefined;
      const payload = decrypt(row.payload, this.name, row.id);
      if (row.consumed) payload.consumed = Number(row.consumed);
      return payload;
    }
    find(id) { return this.lookup('id', id); }
    findByUid(uid) { return this.lookup('uid', uid); }
    findByUserCode(code) { return this.lookup('user_code', code); }
    async consume(id) {
      const result = await db.run('UPDATE auth_oidc_artifacts SET consumed=? WHERE model=? AND id=? AND consumed IS NULL AND expires_at>?', [Math.floor(Date.now() / 1000), this.name, id, Math.floor(Date.now() / 1000)]);
      if (result.affectedRows !== 1) {
        const { errors } = await import('oidc-provider');
        throw new errors.InvalidGrant('authorization artifact already consumed');
      }
    }
    async destroy(id) { await db.run('DELETE FROM auth_oidc_artifacts WHERE model=? AND id=?', [this.name, id]); }
    async revokeByGrantId(id) { await db.run('DELETE FROM auth_oidc_artifacts WHERE grant_id=?', [id]); }
  };
}

module.exports = { createOidcAdapter };
