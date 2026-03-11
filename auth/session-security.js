const crypto = require('crypto');

const createSessionId = () => crypto.randomBytes(24).toString('hex');

const buildSessionTokenPayload = ({ user, sessionId }) => ({
  id: Number(user?.id || 0),
  username: String(user?.username || ''),
  role: String(user?.role || ''),
  sid: String(sessionId || ''),
});

const isSessionRecordValid = ({ tokenSessionId, sessionRecord, nowMs = Date.now() }) => {
  const tokenSid = String(tokenSessionId || '').trim();
  const recordSid = String(sessionRecord?.session_id || '').trim();
  if (!tokenSid || !recordSid || tokenSid !== recordSid) return false;
  if (sessionRecord?.revoked_at) return false;
  const expiresAtMs = new Date(sessionRecord?.expires_at || '').getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Number(nowMs)) return false;
  return true;
};

module.exports = {
  buildSessionTokenPayload,
  createSessionId,
  isSessionRecordValid,
};
