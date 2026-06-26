const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSessionTokenPayload,
  isSessionRecordValid,
} = require('../session-security');

test('buildSessionTokenPayload includes the bound session id', () => {
  const payload = buildSessionTokenPayload({
    user: { id: 7, username: 'viewer', role: 'viewer' },
    sessionId: 'sess-123',
  });

  assert.equal(payload.id, 7);
  assert.equal(payload.username, 'viewer');
  assert.equal(payload.role, 'viewer');
  assert.equal(payload.sid, 'sess-123');
});

test('isSessionRecordValid rejects revoked, mismatched, and expired sessions', () => {
  assert.equal(
    isSessionRecordValid({
      tokenSessionId: 'sess-1',
      sessionRecord: { session_id: 'sess-1', revoked_at: '2026-03-11 01:00:00', expires_at: '2099-01-01 00:00:00' },
      nowMs: Date.parse('2026-03-11T00:00:00Z'),
    }),
    false
  );

  assert.equal(
    isSessionRecordValid({
      tokenSessionId: 'sess-1',
      sessionRecord: { session_id: 'sess-2', revoked_at: null, expires_at: '2099-01-01 00:00:00' },
      nowMs: Date.parse('2026-03-11T00:00:00Z'),
    }),
    false
  );

  assert.equal(
    isSessionRecordValid({
      tokenSessionId: 'sess-1',
      sessionRecord: { session_id: 'sess-1', revoked_at: null, expires_at: '2026-03-10 23:59:59' },
      nowMs: Date.parse('2026-03-11T00:00:00Z'),
    }),
    false
  );
});

test('isSessionRecordValid accepts matching active sessions', () => {
  assert.equal(
    isSessionRecordValid({
      tokenSessionId: 'sess-1',
      sessionRecord: { session_id: 'sess-1', revoked_at: null, expires_at: '2099-01-01 00:00:00' },
      nowMs: Date.parse('2026-03-11T00:00:00Z'),
    }),
    true
  );
});

test('isSessionRecordValid treats MySQL DATETIME strings as UTC', () => {
  assert.equal(
    isSessionRecordValid({
      tokenSessionId: 'sess-1',
      sessionRecord: { session_id: 'sess-1', revoked_at: null, expires_at: '2026-06-26 01:38:40' },
      nowMs: Date.parse('2026-06-26T01:36:21Z'),
    }),
    true
  );
});
